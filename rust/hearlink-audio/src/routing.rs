//! 默认设备接管与还原（任务 2，安全关键）。
//!
//! 规则很简单：**宁可没接管成功，也不能让用户"电脑突然没声音"**。因此
//! 状态文件先落盘、再切设备；正常退出、Ctrl+C、崩溃三种情况都要能还原：
//!
//! ```text
//! begin()   记录三个角色的当前默认 → 写 pending 状态文件 → 切到目标设备
//! restore() 按记录逐角色还原 → 成功后清除状态文件
//! recover() 启动时发现 pending 且原进程已不在 → 先还原再继续
//! ```
//!
//! 状态文件：`%APPDATA%\HearLink\routing.json`

use crate::endpoints::{self, DataFlow, Endpoint};
use crate::route::{self, Role};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::c_void;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: u32 = 1;

const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
const STILL_ACTIVE: u32 = 259;

#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> *mut c_void;
    fn GetExitCodeProcess(h_process: *mut c_void, lp_exit_code: *mut u32) -> i32;
    fn CloseHandle(h_object: *mut c_void) -> i32;
}

/// 是否还有进程活着。崩溃（含被强杀）后用它判断"该不该替它还原"。
fn pid_alive(pid: u32) -> bool {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code == STILL_ACTIVE
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingState {
    pub schema: u32,
    /// 处于"已接管、未还原"状态。崩溃后就是靠这个标记来补救。
    pub pending: bool,
    /// 接管方进程号，用于判断"是不是还有个活的引擎在用着"。
    pub pid: u32,
    pub started_at_ms: u64,
    /// 切到了哪个端点（一般是 CABLE Input）。
    pub target: String,
    /// 接管前各角色的默认端点，key 见 `Role::key()`。
    pub previous: BTreeMap<String, String>,
}

pub fn state_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("HearLink").join("routing.json")
}

pub fn load() -> Result<Option<RoutingState>, String> {
    let path = state_path();
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("读取状态文件失败 {}：{err}", path.display())),
    };
    let state: RoutingState = serde_json::from_str(&text)
        .map_err(|err| format!("解析状态文件失败 {}：{err}", path.display()))?;
    Ok(Some(state))
}

/// 先写临时文件再改名，避免写到一半断电留下半截 JSON。
fn save(state: &RoutingState) -> Result<(), String> {
    let path = state_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("创建目录失败 {}：{err}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(state)
        .map_err(|err| format!("序列化状态失败：{err}"))?;

    let temp = path.with_extension("json.tmp");
    fs::write(&temp, text).map_err(|err| format!("写入 {} 失败：{err}", temp.display()))?;
    fs::rename(&temp, &path).map_err(|err| {
        let _ = fs::remove_file(&temp);
        format!("写状态文件失败 {}：{err}", path.display())
    })
}

fn clear() -> Result<(), String> {
    let path = state_path();
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("删除状态文件失败 {}：{err}", path.display())),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// 当前三个角色的默认端点。
fn current_defaults() -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for (role, id) in endpoints::defaults(DataFlow::Render) {
        map.insert(role.key().to_string(), id);
    }
    map
}

fn label_for(role: &str) -> &'static str {
    Role::from_key(role).map(Role::label).unwrap_or("未知角色")
}

fn name_of(endpoints: &[Endpoint], id: &str) -> Option<String> {
    endpoints
        .iter()
        .find(|endpoint| endpoint.id.eq_ignore_ascii_case(id))
        .map(|endpoint| endpoint.name.clone())
}

/// 按记录还原。设备已不存在时跳过并给出警告（拔掉的设备没法还原）。
fn restore_previous(previous: &BTreeMap<String, String>) -> Result<Vec<String>, String> {
    let available = endpoints::list(DataFlow::Render)?;
    let mut warnings = Vec::new();
    let mut failures = Vec::new();

    for role in Role::ALL {
        let Some(id) = previous.get(role.key()) else {
            continue;
        };
        if !available
            .iter()
            .any(|endpoint| endpoint.id.eq_ignore_ascii_case(id))
        {
            warnings.push(format!(
                "{} 的默认设备（{id}）已不在系统中，跳过",
                role.label()
            ));
            continue;
        }
        if let Err(err) = route::set_default_endpoint(id, role) {
            failures.push(format!("{}：{err}", role.label()));
        }
    }

    if failures.is_empty() {
        Ok(warnings)
    } else {
        Err(format!("还原默认设备失败：{}", failures.join("；")))
    }
}

/// 正在生效的接管。`Drop` 兜底还原——正常返回、`?` 提前返回、panic 都能覆盖；
/// 被强杀时靠下次启动的 `recover()`。
pub struct Takeover {
    state: RoutingState,
    restored: bool,
}

impl Takeover {
    pub fn previous(&self) -> &BTreeMap<String, String> {
        &self.state.previous
    }

    /// 还原并清除状态文件。失败时保留状态文件，下次启动继续重试。
    pub fn restore(&mut self) -> Result<Vec<String>, String> {
        if self.restored {
            return Ok(Vec::new());
        }
        let warnings = restore_previous(&self.state.previous)?;
        clear()?;
        self.restored = true;
        Ok(warnings)
    }
}

impl Drop for Takeover {
    fn drop(&mut self) {
        if self.restored {
            return;
        }
        match self.restore() {
            Ok(warnings) => {
                for warning in warnings {
                    eprintln!("  ! {warning}");
                }
            }
            Err(err) => eprintln!(
                "  ! 还原默认设备失败：{err}\n    状态文件仍保留在 {}，下次启动会自动重试",
                state_path().display()
            ),
        }
    }
}

/// 接管：先记录、再切换。
///
/// `target` 必须是 Render 方向的端点 ID（调用方先用 `endpoints::resolve` 解析名字）。
pub fn begin(target: &str) -> Result<Takeover, String> {
    // 上一次若崩在半路，先把系统恢复到用户自己的设备，否则会把"接管后的状态"记成原始状态
    recover(false)?;

    let previous = current_defaults();
    if previous.is_empty() {
        return Err("读不到当前默认播放设备，出于安全考虑放弃接管".into());
    }

    let state = RoutingState {
        schema: SCHEMA_VERSION,
        pending: true,
        pid: std::process::id(),
        started_at_ms: now_ms(),
        target: target.to_string(),
        previous,
    };

    // 顺序很重要：先落盘再切设备。中间断电/被杀也能靠状态文件还原。
    save(&state)?;

    if let Err(err) = route::set_default_endpoint_all_roles(target) {
        // 切失败（可能已经切了一半）：立刻按记录还原，然后清状态
        let _ = restore_previous(&state.previous);
        let _ = clear();
        return Err(format!("切换默认播放设备失败：{err}"));
    }

    Ok(Takeover { state, restored: false })
}

/// 启动时清理上一次崩溃/被杀遗留的接管。
///
/// 返回 `Some(警告列表)` 表示真的做了还原；`None` 表示没有待处理的接管。
/// 若原接管进程还活着且 `force` 为假，报错而不动手——避免把正在工作的引擎
/// 的设备抢回去。
pub fn recover(force: bool) -> Result<Option<Vec<String>>, String> {
    let Some(state) = load()? else {
        return Ok(None);
    };
    if !state.pending {
        return Ok(None);
    }
    if !force && pid_alive(state.pid) {
        return Err(format!(
            "默认设备正被另一个引擎进程（pid {}）接管中，未做改动",
            state.pid
        ));
    }

    let warnings = restore_previous(&state.previous)?;
    clear()?;
    Ok(Some(warnings))
}

/// `routing` 命令用：把状态文件内容摊平成可读的行。
pub fn describe_state(state: &RoutingState) -> Vec<String> {
    let available = endpoints::list(DataFlow::Render).unwrap_or_default();
    let target_name = name_of(&available, &state.target).unwrap_or_else(|| "<不在系统中>".into());

    let mut lines = vec![
        format!("状态文件：{}", state_path().display()),
        format!("pending：{}", if state.pending { "是（未还原）" } else { "否" }),
        format!(
            "接管进程：pid {}（{}）",
            state.pid,
            if pid_alive(state.pid) { "仍在运行" } else { "已退出" }
        ),
        format!("接管目标：{target_name}\n      {}", state.target),
        "接管前的默认设备：".to_string(),
    ];

    for (role, id) in &state.previous {
        let name = name_of(&available, id).unwrap_or_else(|| "<不在系统中>".into());
        lines.push(format!("  {}：{name}\n      {id}", label_for(role)));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_roundtrip_through_json() {
        let mut previous = BTreeMap::new();
        previous.insert("console".to_string(), "id-speaker".to_string());
        previous.insert("communications".to_string(), "id-headset".to_string());

        let state = RoutingState {
            schema: SCHEMA_VERSION,
            pending: true,
            pid: 4242,
            started_at_ms: 0,
            target: "id-cable".to_string(),
            previous: previous.clone(),
        };

        let text = serde_json::to_string(&state).expect("应能序列化");
        let parsed: RoutingState = serde_json::from_str(&text).expect("应能反序列化");
        assert!(parsed.pending);
        assert_eq!(parsed.pid, 4242);
        assert_eq!(parsed.target, "id-cable");
        assert_eq!(parsed.previous, previous);
    }

    #[test]
    fn state_path_lives_under_appdata() {
        let path = state_path();
        assert!(path.ends_with("HearLink/routing.json") || path.ends_with("HearLink\\routing.json"));
    }

    #[test]
    fn current_pid_counts_as_alive() {
        assert!(pid_alive(std::process::id()));
    }

    #[test]
    fn obviously_dead_pid_is_not_alive() {
        // pid 0 / 超大 pid 都不可能是我们自己的进程
        assert!(!pid_alive(0xFFFF_FFF0));
    }
}
