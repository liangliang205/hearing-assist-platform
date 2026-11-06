//! 系统默认播放设备的设置与还原。
//!
//! Windows 没有公开的"设置默认设备"API，但音频策略服务的 `IPolicyConfig`
//! 接口可以做到（Vista 起可用，各类音频工具都在用）。这里用裸 FFI + 手写
//! vtable 实现，不引入额外 crate。

use crate::com::{check, com_release, guid, wide, Guid, HResult, CLSCTX_ALL};
use std::ffi::c_void;
use std::ptr;

/// {870AF99C-171D-4F9E-AF0D-E63DF40C2BC9}
const CLSID_POLICY_CONFIG_CLIENT: Guid =
    guid(0x870AF99C, 0x171D, 0x4F9E, [0xAF, 0x0D, 0xE6, 0x3D, 0xF4, 0x0C, 0x2B, 0xC9]);

/// {F8679F50-850A-41CF-9C72-430F290290C8}
const IID_POLICY_CONFIG: Guid =
    guid(0xF8679F50, 0x850A, 0x41CF, [0x9C, 0x72, 0x43, 0x0F, 0x29, 0x02, 0x90, 0xC8]);

/// 音频设备角色。`Console` 就是"默认设备"。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum Role {
    Console = 0,
    Multimedia = 1,
    Communications = 2,
}

impl Role {
    pub const ALL: [Role; 3] = [Role::Console, Role::Multimedia, Role::Communications];

    pub fn label(self) -> &'static str {
        match self {
            Role::Console => "控制台",
            Role::Multimedia => "多媒体",
            Role::Communications => "通信",
        }
    }

    /// 状态文件里的键名（与 Windows 的角色名一致）。
    pub fn key(self) -> &'static str {
        match self {
            Role::Console => "console",
            Role::Multimedia => "multimedia",
            Role::Communications => "communications",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        match key {
            "console" => Some(Role::Console),
            "multimedia" => Some(Role::Multimedia),
            "communications" => Some(Role::Communications),
            _ => None,
        }
    }
}

#[repr(C)]
struct PolicyConfigVtbl {
    query_interface: usize,
    add_ref: usize,
    release: usize,
    get_mix_format: usize,
    get_device_format: usize,
    reset_device_format: usize,
    set_device_format: usize,
    get_processing_period: usize,
    set_processing_period: usize,
    get_share_mode: usize,
    set_share_mode: usize,
    get_property_value: usize,
    set_property_value: usize,
    set_default_endpoint: unsafe extern "system" fn(*mut c_void, *const u16, i32) -> HResult,
    set_endpoint_visibility: usize,
}

struct PolicyConfig {
    vtbl: *const PolicyConfigVtbl,
    this: *mut c_void,
}

impl Drop for PolicyConfig {
    fn drop(&mut self) {
        unsafe { com_release(self.this) }
    }
}

fn open() -> Result<PolicyConfig, String> {
    crate::com::ensure_com();
    unsafe {
        let mut this: *mut c_void = ptr::null_mut();
        let hr = crate::com::CoCreateInstance(
            &CLSID_POLICY_CONFIG_CLIENT,
            ptr::null_mut(),
            CLSCTX_ALL,
            &IID_POLICY_CONFIG,
            &mut this,
        );
        check(hr, "CoCreateInstance(IPolicyConfig)")?;
        if this.is_null() {
            return Err("CoCreateInstance(IPolicyConfig) 返回空指针".into());
        }
        let vtbl = *(this as *const *const PolicyConfigVtbl);
        Ok(PolicyConfig { vtbl, this })
    }
}

/// 把指定端点设为系统默认播放设备。
///
/// `endpoint_id` 形如 `{0.0.0.00000000}.{6ca5ae2c-...}`——即 MMDevices 里
/// Render 子键的 GUID 加上前缀。
pub fn set_default_endpoint(endpoint_id: &str, role: Role) -> Result<(), String> {
    let config = open()?;
    let wide_id = wide(endpoint_id);
    unsafe {
        let set_default = (*config.vtbl).set_default_endpoint;
        let hr = set_default(config.this, wide_id.as_ptr(), role as i32);
        check(hr, &format!("SetDefaultEndpoint({})", role.label()))?;
    }
    Ok(())
}

/// 依次设置 Console / Multimedia / Communications 三个角色，
/// 避免某些程序按特定角色选设备。
pub fn set_default_endpoint_all_roles(endpoint_id: &str) -> Result<(), String> {
    for role in Role::ALL {
        set_default_endpoint(endpoint_id, role)?;
    }
    Ok(())
}
