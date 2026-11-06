//! 音频端点枚举与按名字解析（任务 1）。
//!
//! 引擎需要从系统里拿两件事：
//!   1. 设备名 → 端点 ID（`{0.0.0.00000000}.{GUID}`），`route` 命令要用；
//!   2. 当前默认设备是谁，用于启动前记录、退出时还原。
//!
//! 两者都通过 `IMMDeviceEnumerator` 完成，不再依赖外部 PowerShell 查注册表。
//! 名称来自 `IPropertyStore` 的 `PKEY_Device_FriendlyName`。

use crate::com::{
    self, check, com_release, guid, read_lpwstr, Guid, HResult, PropVariant, CLSCTX_ALL, STGM_READ,
};
use crate::route::Role;
use std::ffi::c_void;
use std::ptr;

/// {BCDE0395-E52F-467C-8E3D-C4579291692E}
const CLSID_MM_DEVICE_ENUMERATOR: Guid =
    guid(0xBCDE0395, 0xE52F, 0x467C, [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E]);

/// {A95664D2-9614-4F35-A746-DE8DB63617E6}
const IID_IMM_DEVICE_ENUMERATOR: Guid =
    guid(0xA95664D2, 0x9614, 0x4F35, [0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6]);

/// {A45C254E-DF1C-4EFD-8020-67D146A850E0}：设备属性那一组 PROPERTYKEY 的 fmtid。
const FMTID_DEVICE: Guid =
    guid(0xA45C254E, 0xDF1C, 0x4EFD, [0x80, 0x20, 0x67, 0xD1, 0x46, 0xA8, 0x50, 0xE0]);

const PKEY_DEVICE_FRIENDLY_NAME: u32 = 14;
const PKEY_DEVICE_DESC: u32 = 2;

const DEVICE_STATE_ACTIVE: u32 = 0x1;

// ---------------------------------------------------------------- 类型

/// 数据流方向：渲染（播放）与捕获（录音）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DataFlow {
    Render,
    Capture,
}

impl DataFlow {
    pub fn parse(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "render" | "output" | "playback" | "输出" | "播放" => Some(Self::Render),
            "capture" | "input" | "record" | "输入" | "录音" => Some(Self::Capture),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Render => "输出",
            Self::Capture => "输入",
        }
    }

    fn native(self) -> i32 {
        match self {
            Self::Render => 0,
            Self::Capture => 1,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Endpoint {
    /// 形如 `{0.0.0.00000000}.{91e11276-b54f-46b2-ac9c-aeba7402ec1c}`
    pub id: String,
    /// 友好名，如 `扬声器 (Realtek(R) Audio)`
    pub name: String,
    pub flow: DataFlow,
    /// 它是哪些角色的默认设备（Console 即"默认设备"）。
    pub default_roles: Vec<Role>,
}

impl Endpoint {
    pub fn is_default(&self) -> bool {
        !self.default_roles.is_empty()
    }

    /// 一行展示：`名称  [默认：控制台 多媒体]`
    pub fn describe(&self) -> String {
        if self.default_roles.is_empty() {
            self.name.clone()
        } else {
            let roles: Vec<&str> = self.default_roles.iter().map(|role| role.label()).collect();
            format!("{}  [默认：{}]", self.name, roles.join(" "))
        }
    }
}

// ---------------------------------------------------------------- COM 接口

#[repr(C)]
struct EnumeratorVtbl {
    query_interface: usize,
    add_ref: usize,
    release: usize,
    enum_audio_endpoints:
        unsafe extern "system" fn(*mut c_void, i32, u32, *mut *mut c_void) -> HResult,
    get_default_audio_endpoint:
        unsafe extern "system" fn(*mut c_void, i32, i32, *mut *mut c_void) -> HResult,
    get_device: usize,
    register_endpoint_notification_callback: usize,
    unregister_endpoint_notification_callback: usize,
}

#[repr(C)]
struct CollectionVtbl {
    query_interface: usize,
    add_ref: usize,
    release: usize,
    get_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> HResult,
    item: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> HResult,
}

#[repr(C)]
struct DeviceVtbl {
    query_interface: usize,
    add_ref: usize,
    release: usize,
    activate: usize,
    open_property_store: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> HResult,
    get_id: unsafe extern "system" fn(*mut c_void, *mut *mut u16) -> HResult,
    get_state: usize,
}

#[repr(C)]
struct StoreVtbl {
    query_interface: usize,
    add_ref: usize,
    release: usize,
    get_count: usize,
    get_at: usize,
    get_value: unsafe extern "system" fn(*mut c_void, *const PropertyKey, *mut PropVariant) -> HResult,
    set_value: usize,
    commit: usize,
}

#[repr(C)]
struct PropertyKey {
    format_id: Guid,
    property_id: u32,
}

/// 带引用计数的接口持有者：`Drop` 时 `Release`。
struct ComObject<T> {
    vtbl: *const T,
    this: *mut c_void,
}

impl<T> ComObject<T> {
    unsafe fn from_raw(this: *mut c_void) -> Self {
        let vtbl = *(this as *const *const T);
        Self { vtbl, this }
    }
}

impl<T> Drop for ComObject<T> {
    fn drop(&mut self) {
        unsafe { com_release(self.this) }
    }
}

type Enumerator = ComObject<EnumeratorVtbl>;
type Collection = ComObject<CollectionVtbl>;
type Device = ComObject<DeviceVtbl>;
type Store = ComObject<StoreVtbl>;

impl Enumerator {
    fn open() -> Result<Self, String> {
        com::ensure_com();
        unsafe {
            let mut this: *mut c_void = ptr::null_mut();
            let hr = com::CoCreateInstance(
                &CLSID_MM_DEVICE_ENUMERATOR,
                ptr::null_mut(),
                CLSCTX_ALL,
                &IID_IMM_DEVICE_ENUMERATOR,
                &mut this,
            );
            check(hr, "CoCreateInstance(MMDeviceEnumerator)")?;
            if this.is_null() {
                return Err("CoCreateInstance(MMDeviceEnumerator) 返回空指针".into());
            }
            Ok(Self::from_raw(this))
        }
    }

    fn enum_endpoints(&self, flow: DataFlow) -> Result<Collection, String> {
        unsafe {
            let mut this: *mut c_void = ptr::null_mut();
            let call = (*self.vtbl).enum_audio_endpoints;
            let hr = call(self.this, flow.native(), DEVICE_STATE_ACTIVE, &mut this);
            check(hr, "EnumAudioEndpoints")?;
            if this.is_null() {
                return Err("EnumAudioEndpoints 返回空指针".into());
            }
            Ok(Collection::from_raw(this))
        }
    }

    fn default_endpoint(&self, flow: DataFlow, role: Role) -> Result<Device, String> {
        unsafe {
            let mut this: *mut c_void = ptr::null_mut();
            let call = (*self.vtbl).get_default_audio_endpoint;
            let hr = call(self.this, flow.native(), role as i32, &mut this);
            check(hr, "GetDefaultAudioEndpoint")?;
            if this.is_null() {
                return Err("GetDefaultAudioEndpoint 返回空指针".into());
            }
            Ok(Device::from_raw(this))
        }
    }
}

impl Collection {
    fn count(&self) -> Result<u32, String> {
        unsafe {
            let mut count = 0u32;
            let call = (*self.vtbl).get_count;
            check(call(self.this, &mut count), "IMMDeviceCollection::GetCount")?;
            Ok(count)
        }
    }

    fn item(&self, index: u32) -> Result<Device, String> {
        unsafe {
            let mut this: *mut c_void = ptr::null_mut();
            let call = (*self.vtbl).item;
            check(call(self.this, index, &mut this), "IMMDeviceCollection::Item")?;
            if this.is_null() {
                return Err(format!("IMMDeviceCollection::Item({index}) 返回空指针"));
            }
            Ok(Device::from_raw(this))
        }
    }
}

impl Device {
    /// 端点 ID。`GetId` 分配的内存必须用 `CoTaskMemFree` 释放。
    fn id(&self) -> Result<String, String> {
        unsafe {
            let mut raw: *mut u16 = ptr::null_mut();
            let call = (*self.vtbl).get_id;
            check(call(self.this, &mut raw), "IMMDevice::GetId")?;
            if raw.is_null() {
                return Err("IMMDevice::GetId 返回空指针".into());
            }
            let id = read_lpwstr(raw);
            com::CoTaskMemFree(raw as *mut c_void);
            Ok(id)
        }
    }

    /// 读一个字符串属性，失败返回 `None`（属性缺失不影响枚举）。
    fn property_string(&self, pid: u32) -> Option<String> {
        unsafe {
            let mut store_ptr: *mut c_void = ptr::null_mut();
            let open = (*self.vtbl).open_property_store;
            if open(self.this, STGM_READ, &mut store_ptr) < 0 || store_ptr.is_null() {
                return None;
            }
            let store = Store::from_raw(store_ptr);

            let key = PropertyKey { format_id: FMTID_DEVICE, property_id: pid };
            let mut value = PropVariant::zeroed();
            let get_value = (*store.vtbl).get_value;
            if get_value(store.this, &key, &mut value) < 0 {
                return None;
            }
            let text = value
                .as_wide_ptr()
                .map(|raw| read_lpwstr(raw))
                .filter(|text| !text.trim().is_empty());
            com::prop_variant_clear(&mut value);
            text
        }
    }

    /// 友好名；没有友好名时退回设备描述，再退回占位符。
    fn name(&self) -> String {
        self.property_string(PKEY_DEVICE_FRIENDLY_NAME)
            .or_else(|| self.property_string(PKEY_DEVICE_DESC))
            .unwrap_or_else(|| "<未命名设备>".to_string())
    }
}

// ---------------------------------------------------------------- 对外 API

/// 当前默认端点（三个角色各自记录）。还原逻辑与列表标记都靠它。
pub fn defaults(flow: DataFlow) -> Vec<(Role, String)> {
    match Enumerator::open() {
        Ok(enumerator) => default_ids(&enumerator, flow),
        Err(_) => Vec::new(),
    }
}

fn default_ids(enumerator: &Enumerator, flow: DataFlow) -> Vec<(Role, String)> {
    let mut found = Vec::new();
    for role in Role::ALL {
        if let Ok(device) = enumerator.default_endpoint(flow, role) {
            if let Ok(id) = device.id() {
                found.push((role, id));
            }
        }
    }
    found
}

/// 当前默认播放设备的友好名。
///
/// 产品里 `run --output default` 用它：接管前先抓下"用户真正在用的输出设备"。
pub fn default_render_name() -> Option<String> {
    let (_, id) = defaults(DataFlow::Render).into_iter().next()?;
    let endpoints = list(DataFlow::Render).ok()?;
    endpoints
        .into_iter()
        .find(|endpoint| endpoint.id.eq_ignore_ascii_case(&id))
        .map(|endpoint| endpoint.name)
}

/// 枚举某方向下所有**活跃**端点，并标出各自的默认角色。
pub fn list(flow: DataFlow) -> Result<Vec<Endpoint>, String> {
    let enumerator = Enumerator::open()?;
    let collection = enumerator.enum_endpoints(flow)?;
    let defaults = default_ids(&enumerator, flow);
    let count = collection.count()?;

    let mut endpoints = Vec::with_capacity(count as usize);
    for index in 0..count {
        let device = collection.item(index)?;
        let id = device.id()?;
        let default_roles = defaults
            .iter()
            .filter(|(_, default_id)| default_id.eq_ignore_ascii_case(&id))
            .map(|(role, _)| *role)
            .collect();
        endpoints.push(Endpoint { id, name: device.name(), flow, default_roles });
    }
    Ok(endpoints)
}

/// 按名字找端点：优先整串相等，其次前缀，最后包含。
///
/// 端点 ID 本身也可以直接作为 `needle` 传入。命中多个时报错并列出候选，
/// 绝不"自己猜一个"——静默选错设备会让用户以为程序把声音弄没了。
pub fn resolve(flow: DataFlow, needle: &str) -> Result<Endpoint, String> {
    let endpoints = list(flow)?;
    pick(&endpoints, flow, needle)
}

/// `resolve` 的纯逻辑部分（不碰 COM，便于单测）。
pub fn pick(endpoints: &[Endpoint], flow: DataFlow, needle: &str) -> Result<Endpoint, String> {
    let needle = needle.trim();
    if needle.is_empty() {
        return Err("设备名不能为空".into());
    }
    if endpoints.is_empty() {
        return Err(format!("系统里没有可用的{}设备", flow.label()));
    }

    if let Some(hit) = endpoints
        .iter()
        .find(|endpoint| endpoint.id.eq_ignore_ascii_case(needle))
    {
        return Ok(hit.clone());
    }

    let wanted = needle.to_lowercase();
    let name_of = |endpoint: &Endpoint| endpoint.name.to_lowercase();

    let tiers: [(&str, fn(&str, &str) -> bool); 3] = [
        ("完全相同", |name, wanted| name == wanted),
        ("前缀匹配", |name, wanted| name.starts_with(wanted)),
        ("包含", |name, wanted| name.contains(wanted)),
    ];

    for (how, matcher) in tiers {
        let hits: Vec<&Endpoint> = endpoints
            .iter()
            .filter(|endpoint| matcher(&name_of(endpoint), &wanted))
            .collect();
        match hits.len() {
            0 => continue,
            1 => return Ok(hits[0].clone()),
            _ => {
                let mut message = format!(
                    "\"{needle}\" 以{how}方式匹配到 {} 个{}设备，请写得更具体：",
                    hits.len(),
                    flow.label()
                );
                for hit in hits {
                    message.push_str(&format!("\n  • {}\n      {}", hit.name, hit.id));
                }
                return Err(message);
            }
        }
    }

    let mut message = format!("未找到名字包含 \"{needle}\" 的{}设备。当前可用：", flow.label());
    for endpoint in endpoints {
        message.push_str(&format!("\n  • {}\n      {}", endpoint.name, endpoint.id));
    }
    Err(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint(name: &str, id: &str) -> Endpoint {
        Endpoint {
            id: id.to_string(),
            name: name.to_string(),
            flow: DataFlow::Render,
            default_roles: Vec::new(),
        }
    }

    fn sample() -> Vec<Endpoint> {
        vec![
            endpoint("CABLE Input (VB-Audio Virtual Cable)", "id-cable-input"),
            endpoint("CABLE In 16ch (VB-Audio Virtual Cable)", "id-cable-16ch"),
            endpoint("扬声器 (2- Realtek High Definition Audio)", "id-speaker"),
        ]
    }

    #[test]
    fn exact_name_wins() {
        let picked = pick(&sample(), DataFlow::Render, "CABLE In 16ch (VB-Audio Virtual Cable)")
            .expect("应命中");
        assert_eq!(picked.id, "id-cable-16ch");
    }

    #[test]
    fn prefix_match_is_used_when_unique() {
        let picked = pick(&sample(), DataFlow::Render, "CABLE Input").expect("应命中");
        assert_eq!(picked.id, "id-cable-input");

        let picked = pick(&sample(), DataFlow::Render, "扬声器").expect("应命中");
        assert_eq!(picked.id, "id-speaker");
    }

    #[test]
    fn substring_match_is_case_insensitive() {
        let picked = pick(&sample(), DataFlow::Render, "realtek").expect("应命中");
        assert_eq!(picked.id, "id-speaker");
    }

    #[test]
    fn endpoint_id_can_be_passed_directly() {
        let picked = pick(&sample(), DataFlow::Render, "ID-SPEAKER").expect("应命中");
        assert_eq!(picked.name, "扬声器 (2- Realtek High Definition Audio)");
    }

    #[test]
    fn ambiguous_prefix_reports_candidates_instead_of_guessing() {
        let error = pick(&sample(), DataFlow::Render, "CABLE In").expect_err("应当报歧义");
        assert!(error.contains("2 个输出设备"), "错误信息应说明命中数量：{error}");
        assert!(error.contains("id-cable-input"));
        assert!(error.contains("id-cable-16ch"));
    }

    #[test]
    fn missing_name_lists_available_devices() {
        let error = pick(&sample(), DataFlow::Render, "蓝牙耳机").expect_err("应当报未找到");
        assert!(error.contains("未找到"), "错误信息应是未找到：{error}");
        assert!(error.contains("id-speaker"));
    }

    #[test]
    fn empty_needle_is_rejected() {
        assert!(pick(&sample(), DataFlow::Render, "   ").is_err());
    }
}
