//! HearLink 桌面端外壳（Tauri）。
//!
//! 只做三件事：
//!   1. 把 Web 端（React）装进原生窗口；
//!   2. 以 sidecar 方式启停 Rust 音频引擎，并把配置写给它；
//!   3. 托盘里一键开关"系统级增强"，退出时确保设备还原。
//!
//! 引擎的路径/参数约定见 `rust/hearlink-audio` 的 `run` 命令。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};

/// VB-CABLE 的捕获端：所有应用的声音先流到这里。
const CAPTURE_DEVICE: &str = "CABLE Output";
/// 接管目标：把系统默认播放设备切到它。
const TAKEOVER_DEVICE: &str = "CABLE Input";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    running: bool,
    pid: Option<u32>,
    profile_path: String,
    log_path: String,
}

struct EngineHandle {
    child: Mutex<Option<Child>>,
}

impl EngineHandle {
    fn new() -> Self {
        Self { child: Mutex::new(None) }
    }
}

// ---------------------------------------------------------------- 路径

fn app_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("HearLink")
}

fn profile_path() -> PathBuf {
    app_dir().join("profile.json")
}

fn stop_flag_path() -> PathBuf {
    app_dir().join("engine.stop")
}

fn log_path() -> PathBuf {
    app_dir().join("engine.log")
}

/// 引擎可执行文件。安装包形态就在同目录；`tauri dev` 形态在 `src-tauri/binaries/`。
fn engine_binary() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("HEARLINK_ENGINE") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Ok(path);
        }
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .ok_or_else(|| "无法确定程序所在目录".to_string())?;

    let names = [
        "hearlink-audio.exe",
        "hearlink-audio-x86_64-pc-windows-msvc.exe",
    ];
    let mut tried = Vec::new();
    for dir in [
        exe_dir.clone(),
        exe_dir.join("..").join("binaries"),
        exe_dir.join("..").join("..").join("binaries"),
    ] {
        for name in names {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Ok(candidate);
            }
            tried.push(candidate.display().to_string());
        }
    }

    Err(format!(
        "找不到音频引擎可执行文件，已尝试：\n  {}",
        tried.join("\n  ")
    ))
}

// ---------------------------------------------------------------- 引擎控制

fn status_snapshot(handle: &EngineHandle) -> EngineStatus {
    let mut guard = handle.child.lock().unwrap();
    let mut running = false;
    let mut pid = None;
    let mut stale = false;
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                running = true;
                pid = Some(child.id());
            }
            _ => stale = true,
        }
    }
    if stale {
        *guard = None;
    }

    EngineStatus {
        running,
        pid,
        profile_path: profile_path().display().to_string(),
        log_path: log_path().display().to_string(),
    }
}

/// 原子写配置：先写临时文件再改名，引擎那边就不会读到半截 JSON。
fn write_profile(json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|err| format!("补偿配置不是合法 JSON：{err}"))?;

    let path = profile_path();
    let dir = path.parent().ok_or_else(|| "无法确定配置目录".to_string())?;
    std::fs::create_dir_all(dir).map_err(|err| format!("创建目录失败：{err}"))?;

    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, json).map_err(|err| format!("写临时配置失败：{err}"))?;
    std::fs::rename(&temp, &path).map_err(|err| format!("替换配置失败：{err}"))
}

fn log_tail(lines: usize) -> String {
    let Ok(text) = std::fs::read_to_string(log_path()) else {
        return String::new();
    };
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

fn spawn_engine(profile: &Path, stop_flag: &Path) -> Result<Child, String> {
    let binary = engine_binary()?;
    let log_file = std::fs::File::create(log_path())
        .map_err(|err| format!("创建引擎日志失败：{err}"))?;
    let log_copy = log_file
        .try_clone()
        .map_err(|err| format!("复制日志句柄失败：{err}"))?;

    let mut command = Command::new(&binary);
    command
        .arg("run")
        .arg("--profile")
        .arg(profile)
        .arg("--input")
        .arg(CAPTURE_DEVICE)
        .arg("--output")
        .arg("default")
        .arg("--takeover")
        .arg(TAKEOVER_DEVICE)
        .arg("--stop-file")
        .arg(stop_flag)
        .arg("--seconds")
        .arg("0")
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_copy))
        .stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|err| format!("启动引擎失败（{}）：{err}", binary.display()))
}

/// 引擎被强杀时的兜底：跑一次 `restore`，把默认设备还回去。
fn run_restore() {
    let Ok(binary) = engine_binary() else {
        return;
    };
    let mut command = Command::new(binary);
    command
        .arg("restore")
        .arg("--force")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    if let Ok(mut child) = command.spawn() {
        let _ = child.wait();
    }
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn start_engine(
    app: &AppHandle,
    handle: &EngineHandle,
    profile_json: Option<String>,
) -> Result<EngineStatus, String> {
    let current = status_snapshot(handle);
    if current.running {
        return Ok(current);
    }

    if let Some(json) = profile_json {
        write_profile(&json)?;
    }

    let profile = profile_path();
    if !profile.exists() {
        focus_main_window(app);
        let _ = app.emit("engine-needs-profile", ());
        return Err("还没有补偿配置：请先完成一次听力自测再开启系统级增强".into());
    }

    let stop_flag = stop_flag_path();
    let _ = std::fs::remove_file(&stop_flag);
    let mut child = spawn_engine(&profile, &stop_flag)?;

    // 引擎起流需要一点时间；期间若退出，说明参数或设备有问题，把日志带回去
    let deadline = Instant::now() + Duration::from_millis(2500);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => {
                return Err(format!(
                    "音频引擎启动后立即退出，最近日志：\n{}",
                    log_tail(30)
                ));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(err) => return Err(format!("等待引擎状态失败：{err}")),
        }
    }

    *handle.child.lock().unwrap() = Some(child);
    let status = status_snapshot(handle);
    let _ = app.emit("engine-status", &status);
    Ok(status)
}

fn stop_engine(handle: &EngineHandle, app: Option<&AppHandle>) -> EngineStatus {
    let mut guard = handle.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        // 写停止标记让引擎自己收尾（正常退出路径会还原默认设备）
        let _ = std::fs::write(stop_flag_path(), b"stop");

        let deadline = Instant::now() + Duration::from_secs(6);
        let mut exited = false;
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }

        if !exited {
            // 引擎没理停止标记：只能强杀，再用 restore 兜底还原设备
            let _ = child.kill();
            let _ = child.wait();
            run_restore();
        }
        let _ = std::fs::remove_file(stop_flag_path());
    }
    drop(guard);

    let status = status_snapshot(handle);
    if let Some(app) = app {
        let _ = app.emit("engine-status", &status);
    }
    status
}

// ---------------------------------------------------------------- 命令

#[tauri::command]
fn system_engine_status(state: State<'_, EngineHandle>) -> EngineStatus {
    status_snapshot(&state)
}

#[tauri::command]
fn system_profile_write(profile_json: String) -> Result<String, String> {
    write_profile(&profile_json)?;
    Ok(profile_path().display().to_string())
}

#[tauri::command]
fn system_engine_start(
    app: AppHandle,
    state: State<'_, EngineHandle>,
    profile_json: Option<String>,
) -> Result<EngineStatus, String> {
    start_engine(&app, &state, profile_json)
}

#[tauri::command]
fn system_engine_stop(app: AppHandle, state: State<'_, EngineHandle>) -> Result<EngineStatus, String> {
    Ok(stop_engine(&state, Some(&app)))
}

// ---------------------------------------------------------------- SQLite 本地库

/// 桌面端数据库：SQLite 文件 + 参数化查询桥。
///
/// 表结构由前端 `SQLITE_SCHEMA` 建（单一真源），这里只负责安全地执行 SQL：
/// 一律参数绑定，不拼字符串。
struct AppDb {
    conn: Mutex<rusqlite::Connection>,
}

fn db_path() -> PathBuf {
    app_dir().join("hearlink.db")
}

impl AppDb {
    fn open() -> Result<Self, String> {
        let path = db_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|err| format!("创建数据目录失败：{err}"))?;
        }
        let conn = rusqlite::Connection::open(&path)
            .map_err(|err| format!("打开数据库失败 {}：{err}", path.display()))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; \
             PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;",
        )
        .map_err(|err| format!("初始化数据库失败：{err}"))?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}

fn to_sql_value(value: &serde_json::Value) -> Result<rusqlite::types::Value, String> {
    use rusqlite::types::Value as SqlValue;
    Ok(match value {
        serde_json::Value::Null => SqlValue::Null,
        serde_json::Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        serde_json::Value::String(text) => SqlValue::Text(text.clone()),
        serde_json::Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                SqlValue::Integer(integer)
            } else if let Some(real) = number.as_f64() {
                SqlValue::Real(real)
            } else {
                return Err(format!("不支持的数值参数：{number}"));
            }
        }
        other => return Err(format!("不支持的参数类型：{other}")),
    })
}

fn execute_sql(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[serde_json::Value],
) -> Result<usize, String> {
    let values: Vec<rusqlite::types::Value> =
        params.iter().map(to_sql_value).collect::<Result<_, _>>()?;
    let mut statement = conn
        .prepare(sql)
        .map_err(|err| format!("SQL 解析失败：{err}\n{sql}"))?;
    statement
        .execute(rusqlite::params_from_iter(values.iter()))
        .map_err(|err| format!("SQL 执行失败：{err}\n{sql}"))
}

fn query_rows(
    conn: &rusqlite::Connection,
    sql: &str,
    params: &[serde_json::Value],
) -> Result<Vec<serde_json::Value>, String> {
    use rusqlite::types::ValueRef;
    let values: Vec<rusqlite::types::Value> =
        params.iter().map(to_sql_value).collect::<Result<_, _>>()?;
    let mut statement = conn
        .prepare(sql)
        .map_err(|err| format!("SQL 解析失败：{err}\n{sql}"))?;
    let columns: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    let mut rows = statement
        .query(rusqlite::params_from_iter(values.iter()))
        .map_err(|err| format!("SQL 查询失败：{err}\n{sql}"))?;

    let mut output = Vec::new();
    while let Some(row) = rows.next().map_err(|err| format!("读取行失败：{err}"))? {
        let mut object = serde_json::Map::new();
        for (index, column) in columns.iter().enumerate() {
            let value = match row
                .get_ref(index)
                .map_err(|err| format!("读取列 {column} 失败：{err}"))?
            {
                ValueRef::Null => serde_json::Value::Null,
                ValueRef::Integer(number) => serde_json::json!(number),
                ValueRef::Real(number) => serde_json::json!(number),
                ValueRef::Text(bytes) => serde_json::json!(String::from_utf8_lossy(bytes)),
                ValueRef::Blob(_) => serde_json::Value::Null,
            };
            object.insert(column.clone(), value);
        }
        output.push(serde_json::Value::Object(object));
    }
    Ok(output)
}

#[tauri::command]
fn sqlite_batch(db: State<'_, AppDb>, sql: String) -> Result<(), String> {
    let conn = db.conn.lock().unwrap();
    conn.execute_batch(&sql)
        .map_err(|err| format!("SQL 批处理失败：{err}"))
}

#[tauri::command]
fn sqlite_execute(
    db: State<'_, AppDb>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<usize, String> {
    let conn = db.conn.lock().unwrap();
    execute_sql(&conn, &sql, &params)
}

#[tauri::command]
fn sqlite_query(
    db: State<'_, AppDb>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.conn.lock().unwrap();
    query_rows(&conn, &sql, &params)
}

// ---------------------------------------------------------------- 托盘

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "engine_start", "开启系统级增强", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "engine_stop", "关闭系统级增强", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let sep_a = PredefinedMenuItem::separator(app)?;
    let sep_b = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&show, &sep_a, &start, &stop, &sep_b, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("HearLink · 听力辅助")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_main_window(app),
            "engine_start" => {
                let handle = app.state::<EngineHandle>();
                if let Err(err) = start_engine(app, &handle, None) {
                    eprintln!("托盘开启系统级增强失败：{err}");
                    focus_main_window(app);
                }
            }
            "engine_stop" => {
                let handle = app.state::<EngineHandle>();
                let _ = stop_engine(&handle, Some(app));
            }
            "quit" => {
                let handle = app.state::<EngineHandle>();
                let _ = stop_engine(&handle, Some(app));
                app.exit(0);
            }
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(EngineHandle::new())
        .invoke_handler(tauri::generate_handler![
            system_engine_status,
            system_profile_write,
            system_engine_start,
            system_engine_stop,
            sqlite_batch,
            sqlite_execute,
            sqlite_query
        ])
        .setup(|app| {
            let db = AppDb::open()?;
            app.manage(db);
            build_tray(app.handle())?;

            // 开机自启/无界面验证：带 --engine-autostart 时直接按已保存的配置开引擎
            if std::env::args().any(|arg| arg == "--engine-autostart") {
                let handle = app.state::<EngineHandle>();
                if let Err(err) = start_engine(app.handle(), &handle, None) {
                    eprintln!("自启系统级增强失败：{err}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗口 = 退出程序，退出前先把引擎停掉并还原默认设备；
            // 想常驻时用最小化即可，托盘菜单随时可以开关系统级增强。
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let handle = window.state::<EngineHandle>();
                let _ = stop_engine(&handle, Some(window.app_handle()));
            }
        })
        .build(tauri::generate_context!())
        .expect("启动 HearLink 桌面端失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let handle = app.state::<EngineHandle>();
                let status = stop_engine(&handle, None);
                let _ = status;
            }
        });
}

#[cfg(test)]
mod db_tests {
    use super::*;
    use serde_json::json;

    fn memory_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().expect("内存库应能打开");
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);",
        )
        .expect("建表失败");
        conn
    }

    #[test]
    fn execute_and_query_roundtrip() {
        let conn = memory_db();
        let changed = execute_sql(
            &conn,
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            &[json!("theme"), json!("dark")],
        )
        .expect("插入应成功");
        assert_eq!(changed, 1);

        let rows = query_rows(&conn, "SELECT key, value FROM settings WHERE key = ?", &[json!("theme")])
            .expect("查询应成功");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["key"], json!("theme"));
        assert_eq!(rows[0]["value"], json!("dark"));
    }

    #[test]
    fn query_maps_sql_types_to_json() {
        let conn = memory_db();
        let rows = query_rows(
            &conn,
            "SELECT 1 AS integer_value, 2.5 AS real_value, NULL AS null_value, 'txt' AS text_value",
            &[],
        )
        .expect("查询应成功");
        assert_eq!(rows[0]["integer_value"], json!(1));
        assert_eq!(rows[0]["real_value"], json!(2.5));
        assert_eq!(rows[0]["null_value"], serde_json::Value::Null);
        assert_eq!(rows[0]["text_value"], json!("txt"));
    }

    #[test]
    fn parameters_are_bound_not_interpolated() {
        let conn = memory_db();
        let tricky = "'; DROP TABLE settings; --";
        execute_sql(&conn, "INSERT INTO settings (key, value) VALUES (?, ?)", &[json!(tricky), json!(tricky)])
            .expect("含引号的参数应安全落地");
        let rows = query_rows(&conn, "SELECT COUNT(*) AS c FROM settings", &[]).expect("查询应成功");
        assert_eq!(rows[0]["c"], json!(1), "表应当还在，参数没有被拼进 SQL");
    }

    #[test]
    fn bad_sql_returns_error_instead_of_panicking() {
        let conn = memory_db();
        assert!(execute_sql(&conn, "INSERT INTO missing_table VALUES (1)", &[]).is_err());
        assert!(query_rows(&conn, "SELECT * FROM missing_table", &[]).is_err());
    }

    #[test]
    fn unsupported_parameter_type_is_rejected() {
        let conn = memory_db();
        let result = execute_sql(
            &conn,
            "INSERT INTO settings (key, value) VALUES (?, ?)",
            &[json!("nested"), json!({ "a": 1 })],
        );
        assert!(result.is_err());
    }
}
