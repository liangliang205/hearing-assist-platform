//! 最小 COM 互操作层：GUID、宽字符串、初始化、引用计数与 PROPVARIANT。
//!
//! 系统音频接入只需要几个固定接口（`IMMDeviceEnumerator`、`IPropertyStore`、
//! `IPolicyConfig`），因此不引入 `windows` crate，直接按 COM 二进制布局手写
//! vtable。各模块只声明自己用到的方法，未用到的槽位留着占位。

use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::ptr;
use std::sync::Once;

pub type HResult = i32;

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct Guid {
    pub data1: u32,
    pub data2: u16,
    pub data3: u16,
    pub data4: [u8; 8],
}

pub const fn guid(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> Guid {
    Guid { data1, data2, data3, data4 }
}

pub const COINIT_MULTITHREADED: u32 = 0x0;
pub const CLSCTX_ALL: u32 = 0x17;
/// `IPropertyStore::OpenPropertyStore` 的访问模式：只读。
pub const STGM_READ: u32 = 0x0;
/// PROPVARIANT 的宽字符串类型。
pub const VT_LPWSTR: u16 = 31;

#[link(name = "ole32")]
extern "system" {
    pub fn CoInitializeEx(reserved: *mut c_void, coinit: u32) -> HResult;
    pub fn CoCreateInstance(
        rclsid: *const Guid,
        punk_outer: *mut c_void,
        dw_cls_context: u32,
        riid: *const Guid,
        ppv: *mut *mut c_void,
    ) -> HResult;
    pub fn CoTaskMemFree(pv: *mut c_void);
    pub fn PropVariantClear(pvar: *mut PropVariant);
}

/// PROPVARIANT：8 字节头（`vt` + 3 个保留字）+ 16 字节联合体。
///
/// 用 `[usize; 2]` 而非 `[u8; 16]` 是为了拿到 8 字节对齐——`VT_LPWSTR` 的
/// 指针就在偏移 8 处，对齐错位会读到垃圾。
#[repr(C)]
pub struct PropVariant {
    pub vt: u16,
    reserved: [u16; 3],
    value: [usize; 2],
}

impl PropVariant {
    pub fn zeroed() -> Self {
        Self { vt: 0, reserved: [0; 3], value: [0; 2] }
    }

    /// 只处理 `VT_LPWSTR`；设备名一定是字符串，其它类型一律当作"没有值"。
    pub fn as_wide_ptr(&self) -> Option<*const u16> {
        if self.vt == VT_LPWSTR && self.value[0] != 0 {
            Some(self.value[0] as *const u16)
        } else {
            None
        }
    }
}

impl Default for PropVariant {
    fn default() -> Self {
        Self::zeroed()
    }
}

pub fn wide(text: &str) -> Vec<u16> {
    OsStr::new(text).encode_wide().chain(std::iter::once(0)).collect()
}

/// 进程内初始化 COM，只做一次。
///
/// 若当前线程已按其它模式初始化过（`RPC_E_CHANGED_MODE`），忽略即可——
/// 接口调用本身仍然可用。
pub fn ensure_com() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| unsafe {
        let _ = CoInitializeEx(ptr::null_mut(), COINIT_MULTITHREADED);
    });
}

pub fn check(hr: HResult, what: &str) -> Result<(), String> {
    if hr < 0 {
        Err(format!("{what} 失败：0x{:08X}", hr as u32))
    } else {
        Ok(())
    }
}

/// 读一块由 COM 分配、以 NUL 结尾的宽字符串（不负责释放）。
pub unsafe fn read_lpwstr(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}

/// 取 vtable 第 `index` 个槽（0 起，含 IUnknown 的 3 个）。
pub unsafe fn vtable_slot(this: *mut c_void, index: usize) -> usize {
    let vtbl = *(this as *const *const usize);
    *vtbl.add(index)
}

/// 调用 `IUnknown::Release`。所有手写的 COM 包装都用它收尾。
pub unsafe fn com_release(this: *mut c_void) {
    if this.is_null() {
        return;
    }
    let release: unsafe extern "system" fn(*mut c_void) -> u32 =
        std::mem::transmute(vtable_slot(this, 2));
    release(this);
}

pub unsafe fn prop_variant_clear(value: *mut PropVariant) {
    let _ = PropVariantClear(value);
}
