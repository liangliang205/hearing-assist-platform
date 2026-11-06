//! HearLink 音频引擎（spike）
//!
//! 命令：
//!   devices    按 cpal 视角列出音频设备（通道数、采样率）
//!   endpoints  按 Windows 端点视角列出设备（端点 ID、默认设备）
//!   resolve    设备名 → 端点 ID
//!   route      切换系统默认播放设备（可给名字）
//!   restore    还原上次崩溃/被杀遗留的设备接管
//!   routing    查看接管状态文件
//!   selftest   离线验证 DSP（不需要任何虚拟声卡）
//!   run        实时链路：捕获 → 双耳 DSP → 输出（可接管系统默认设备）
//!
//! 目标：验证方案二（VB-CABLE + Rust）的可行性与延迟。

mod biquad;
mod com;
mod endpoints;
mod hotswap;
mod lowering;
mod profile;
mod route;
mod routing;

use biquad::ChannelChain;
use crossbeam_queue::ArrayQueue;
use endpoints::DataFlow;
use hotswap::HotSwap;
use profile::CompensationConfig;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

const DEFAULT_RATE: u32 = 48_000;
const DEFAULT_BUFFER: u32 = 256;

#[link(name = "kernel32")]
extern "system" {
    fn SetConsoleCtrlHandler(
        handler: Option<unsafe extern "system" fn(u32) -> i32>,
        add: i32,
    ) -> i32;
}

/// Ctrl+C / 关闭控制台窗口时置位，主循环看到后按顺序收尾（含还原设备）。
static SHUTDOWN: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn on_console_ctrl(_ctrl_type: u32) -> i32 {
    SHUTDOWN.store(true, Ordering::SeqCst);
    1
}

fn install_console_ctrl_handler() {
    unsafe {
        if SetConsoleCtrlHandler(Some(on_console_ctrl), 1) == 0 {
            eprintln!("提示：未能注册 Ctrl+C 处理，退出时会由状态文件兜底还原");
        }
    }
}

// ---------------------------------------------------------------- 参数解析

struct Args {
    positional: Vec<String>,
    flags: HashMap<String, String>,
}

impl Args {
    fn parse() -> Self {
        let mut positional = Vec::new();
        let mut flags = HashMap::new();
        let mut iter = std::env::args().skip(1).peekable();

        while let Some(item) = iter.next() {
            if let Some(key) = item.strip_prefix("--") {
                let value = match iter.peek() {
                    Some(next) if !next.starts_with("--") => iter.next().unwrap_or_default(),
                    _ => "true".to_string(),
                };
                flags.insert(key.to_string(), value);
            } else {
                positional.push(item);
            }
        }
        Self { positional, flags }
    }

    fn value(&self, key: &str) -> Option<String> {
        self.flags.get(key).cloned()
    }

    fn value_or(&self, key: &str, default: &str) -> String {
        self.value(key).unwrap_or_else(|| default.to_string())
    }

    fn number<T: std::str::FromStr>(&self, key: &str, default: T) -> T {
        self.value(key)
            .and_then(|raw| raw.parse::<T>().ok())
            .unwrap_or(default)
    }
}

// ---------------------------------------------------------------- 统计

#[derive(Default)]
struct Stats {
    input_frames: AtomicU64,
    output_frames: AtomicU64,
    underruns: AtomicU64,
    drops: AtomicU64,
    callbacks: AtomicU64,
    total_process_us: AtomicU64,
    max_process_us: AtomicU64,
    /// 音频回调实际换上热更新配置的次数
    profile_swaps: AtomicU64,
}

impl Stats {
    fn snapshot(&self) -> String {
        let callbacks = self.callbacks.load(Ordering::Relaxed).max(1);
        let total = self.total_process_us.load(Ordering::Relaxed);
        format!(
            "入{:>9} 帧 | 出{:>9} 帧 | 欠载{:>6} | 丢弃{:>6} | 回调平均{:>6.0}µs 最大{:>6}µs",
            self.input_frames.load(Ordering::Relaxed),
            self.output_frames.load(Ordering::Relaxed),
            self.underruns.load(Ordering::Relaxed),
            self.drops.load(Ordering::Relaxed),
            total as f64 / callbacks as f64,
            self.max_process_us.load(Ordering::Relaxed),
        )
    }
}

// ---------------------------------------------------------------- 入口

fn cmd_route(args: &Args) -> Result<(), String> {
    let role_text = args.value_or("role", "all");
    let role = match role_text.trim().to_ascii_lowercase().as_str() {
        "all" | "全部" => None,
        "console" | "默认" | "控制台" => Some(route::Role::Console),
        "multimedia" | "多媒体" => Some(route::Role::Multimedia),
        "communications" | "通信" => Some(route::Role::Communications),
        other => {
            return Err(format!(
                "未知角色：{other}（可选 console | multimedia | communications | all）"
            ))
        }
    };

    // --id 直接给端点 ID；--name 则在进程内枚举后解析，不再依赖外部查 GUID
    let (endpoint_id, resolved_name) = match (args.value("id"), args.value("name")) {
        (Some(id), _) => (id, None),
        (None, Some(name)) => {
            let flow = parse_flow(&args.value_or("flow", "render"))?;
            let endpoint = endpoints::resolve(flow, &name)?;
            (endpoint.id, Some(endpoint.name))
        }
        (None, None) => {
            return Err(
                "用法：route --name <设备名> [--flow render] [--role ...]\n  或：route --id <端点ID> [--role ...]"
                    .to_string(),
            )
        }
    };

    match role {
        Some(role) => route::set_default_endpoint(&endpoint_id, role)?,
        None => route::set_default_endpoint_all_roles(&endpoint_id)?,
    }

    match resolved_name {
        Some(name) => println!("已把默认播放设备切到：{name}\n  {endpoint_id}（role={role_text}）"),
        None => println!("已把默认播放设备切到：{endpoint_id}（role={role_text}）"),
    }
    Ok(())
}

fn cmd_endpoints(args: &Args) -> Result<(), String> {
    let flow_text = args.value_or("flow", "all");
    let flows = match flow_text.trim().to_ascii_lowercase().as_str() {
        "all" | "both" | "全部" => vec![DataFlow::Render, DataFlow::Capture],
        _ => vec![parse_flow(&flow_text)?],
    };

    for (index, flow) in flows.iter().enumerate() {
        if index > 0 {
            println!();
        }
        let list = endpoints::list(*flow)?;
        println!("{}设备（{} 个激活端点）：", flow.label(), list.len());
        if list.is_empty() {
            println!("  （无）");
        }
        for endpoint in &list {
            println!(
                "  {}{}",
                if endpoint.is_default() { "● " } else { "  " },
                endpoint.describe()
            );
            println!("      {}", endpoint.id);
        }
    }
    Ok(())
}

fn cmd_resolve(args: &Args) -> Result<(), String> {
    let needle = args
        .value("name")
        .or_else(|| args.positional.get(1).cloned())
        .ok_or_else(|| {
            "用法：resolve <设备名关键字> [--flow render|capture]，例如 resolve \"CABLE Input\""
                .to_string()
        })?;

    let flow = parse_flow(&args.value_or("flow", "render"))?;
    let endpoint = endpoints::resolve(flow, &needle)?;

    if args.flags.contains_key("verbose") {
        println!("{}设备：{}", endpoint.flow.label(), endpoint.describe());
    }
    println!("{}", endpoint.id);
    Ok(())
}

fn parse_flow(text: &str) -> Result<DataFlow, String> {
    DataFlow::parse(text).ok_or_else(|| format!("未知方向：{text}（可选 render | capture）"))
}

/// 解析 `--takeover` 的目标端点，并挡住"输出设备就是接管目标"的回环配置。
fn resolve_takeover_target(
    needle: &str,
    output_needle: &str,
) -> Result<endpoints::Endpoint, String> {
    let target = endpoints::resolve(DataFlow::Render, needle)?;

    // 输出设备本身也是 Render 端点；若两者相同，引擎会把系统声音灌回自己
    if let Ok(output) = endpoints::resolve(DataFlow::Render, output_needle) {
        if output.id.eq_ignore_ascii_case(&target.id) {
            return Err(format!(
                "接管目标不能与输出设备相同（都是 {}），否则会形成回环",
                target.name
            ));
        }
    }
    Ok(target)
}

fn begin_takeover(target: &endpoints::Endpoint) -> Result<routing::Takeover, String> {
    let takeover = routing::begin(&target.id)?;
    let available = endpoints::list(DataFlow::Render).unwrap_or_default();

    println!("\n接管系统默认播放设备 → {}", target.name);
    println!("  状态文件：{}", routing::state_path().display());
    for (key, id) in takeover.previous() {
        let label = route::Role::from_key(key)
            .map(route::Role::label)
            .unwrap_or("未知");
        let name = available
            .iter()
            .find(|endpoint| endpoint.id.eq_ignore_ascii_case(id))
            .map(|endpoint| endpoint.name.clone())
            .unwrap_or_else(|| id.clone());
        println!("  原{label}：{name}");
    }
    Ok(takeover)
}

fn cmd_restore(args: &Args) -> Result<(), String> {
    let force = args.flags.contains_key("force");

    match routing::recover(force)? {
        Some(warnings) => {
            println!("已按状态文件还原默认播放设备");
            for warning in warnings {
                println!("  ! {warning}");
            }
        }
        None => println!(
            "没有需要还原的设备接管（{}）",
            routing::state_path().display()
        ),
    }
    Ok(())
}

fn cmd_routing() -> Result<(), String> {
    match routing::load()? {
        Some(state) => {
            for line in routing::describe_state(&state) {
                println!("{line}");
            }
        }
        None => println!("没有状态文件（{}）", routing::state_path().display()),
    }
    Ok(())
}

fn main() {
    let args = Args::parse();
    let mode = args.positional.first().cloned().unwrap_or_else(|| "help".into());

    let result = match mode.as_str() {
        "devices" | "list" => cmd_devices(),
        "endpoints" => cmd_endpoints(&args),
        "resolve" => cmd_resolve(&args),
        "restore" => cmd_restore(&args),
        "routing" | "routing-status" => cmd_routing(),
        "selftest" => cmd_selftest(&args),
        "lowering" | "lowering-test" => cmd_lowering_test(&args),
        "run" => cmd_run(&args),
        "route" => cmd_route(&args),
        _ => {
            print_usage();
            Ok(())
        }
    };

    if let Err(message) = result {
        eprintln!("\n错误：{message}");
        std::process::exit(1);
    }
}

fn print_usage() {
    println!(
        r#"HearLink 音频引擎 (spike)

用法：
  hearlink-audio devices
      按 cpal 视角列出输入/输出设备（通道数、采样率）

  hearlink-audio endpoints [--flow render|capture|all]
      按 Windows 端点视角列出设备：友好名 + 端点 ID，● 表示当前默认

  hearlink-audio resolve <设备名关键字> [--flow render|capture] [--verbose]
      设备名 → 端点 ID（只把 ID 打到标准输出，便于脚本/桌面端解析）

  hearlink-audio route --name <设备名> [--flow render] [--role console|multimedia|communications|all]
  hearlink-audio route --id <端点ID> [--role ...]
      切换系统默认播放设备

  hearlink-audio restore [--force]
      还原上一次崩溃/被杀遗留的设备接管（--force 不管原进程是否还在）

  hearlink-audio routing
      查看接管状态文件（%APPDATA%\HearLink\routing.json）

  hearlink-audio selftest --profile <path> [--out <dir>]
      离线验证 DSP：用正弦波实测各频点增益，与理论值比对

  hearlink-audio lowering-test --profile <path> [--tone 6000] [--amplitude 0.2]
      离线验证方案二：给一个测试音，检查高频能量是否被搬到目标频点
      （profile 里 frequencyLowering.enabled 必须为 true）

  hearlink-audio run --profile <path> --input <设备名关键字> --output <设备名关键字|default>
                    [--takeover <CABLE Input 的名字或 ID>] [--seconds 10] [--buffer 256]
                    [--stop-file <path>] [--no-watch]
      --takeover：把系统默认播放设备切到该端点，退出/崩溃后自动还原
      --seconds 0：一直运行，直到 Ctrl+C
      --output default：输出到接管前的系统默认播放设备（桌面端用）
      --stop-file：该文件一出现就按正常流程退出并还原设备（桌面端退出时用）
      --profile 指向的文件被改动后，引擎会在 1 秒内热更新滤波器参数（--no-watch 关闭）

示例：
  hearlink-audio endpoints
  hearlink-audio resolve "CABLE Input"
  hearlink-audio run --profile sample-profile.json --input CABLE --output 扬声器 --takeover "CABLE Input" --seconds 0
"#
    );
}

// ---------------------------------------------------------------- devices

fn cmd_devices() -> Result<(), String> {
    let host = cpal::default_host();
    println!("主机：{:?}", host.id());

    println!("\n输入设备：");
    for device in host.input_devices().map_err(|err| err.to_string())? {
        print_device(&device, true);
    }

    println!("\n输出设备：");
    for device in host.output_devices().map_err(|err| err.to_string())? {
        print_device(&device, false);
    }
    Ok(())
}

fn print_device(device: &cpal::Device, is_input: bool) {
    let name = device.name().unwrap_or_else(|_| "<未知>".into());
    let detail = if is_input {
        device
            .supported_input_configs()
            .ok()
            .and_then(|mut configs| {
                configs.find(|range| range.sample_format() == cpal::SampleFormat::F32)
            })
            .map(|range| {
                format!(
                    "{}ch, {}-{} Hz, {:?}",
                    range.channels(),
                    range.min_sample_rate().0,
                    range.max_sample_rate().0,
                    range.sample_format()
                )
            })
    } else {
        device
            .supported_output_configs()
            .ok()
            .and_then(|mut configs| {
                configs.find(|range| range.sample_format() == cpal::SampleFormat::F32)
            })
            .map(|range| {
                format!(
                    "{}ch, {}-{} Hz, {:?}",
                    range.channels(),
                    range.min_sample_rate().0,
                    range.max_sample_rate().0,
                    range.sample_format()
                )
            })
    };

    match detail {
        Some(info) => println!("  • {name}  [{info}]"),
        None => println!("  • {name}  [无 F32 配置]"),
    }
}

// ---------------------------------------------------------------- selftest

fn cmd_selftest(args: &Args) -> Result<(), String> {
    let profile_path = args.value_or("profile", "sample-profile.json");
    let out_dir = args.value_or("out", ".");
    let config = CompensationConfig::load(Path::new(&profile_path))?;
    let sample_rate = DEFAULT_RATE as f32;

    println!("配置：{profile_path}");
    println!(
        "  左耳：{} 段 | 右耳：{} 段",
        config.bands_for(true).len(),
        config.bands_for(false).len()
    );

    let mut failures = 0usize;

    let mut left = ChannelChain::new(&config.bands_for(true), config.pre_gain_for(true), sample_rate);
    failures += selftest_ear("左耳", &mut left, sample_rate);
    write_demo_wav(Path::new(&out_dir).join("selftest-left.wav"), &mut left, sample_rate)?;

    let mut right =
        ChannelChain::new(&config.bands_for(false), config.pre_gain_for(false), sample_rate);
    failures += selftest_ear("右耳", &mut right, sample_rate);
    write_demo_wav(Path::new(&out_dir).join("selftest-right.wav"), &mut right, sample_rate)?;

    println!("\n对比音频已写入 {out_dir}/selftest-{{left,right}}.wav");

    if failures == 0 {
        println!("\n✅ DSP 自测通过：所有频点误差 < 0.5 dB");
        Ok(())
    } else {
        Err(format!("DSP 自测失败：{failures} 个频点误差超过 0.5 dB"))
    }
}

fn selftest_ear(label: &str, chain: &mut ChannelChain, sample_rate: f32) -> usize {
    let frequencies = chain.band_frequencies().to_vec();
    if frequencies.is_empty() {
        println!("\n{label}：无补偿参数（直通）");
        return 0;
    }

    println!(
        "\n{label}（{} 段，前置增益 {:+.1} dB）",
        chain.band_count(),
        chain.pre_gain_db()
    );
    println!("{:<10} {:>10} {:>10} {:>8}", "频率(Hz)", "理论(dB)", "实测(dB)", "误差");

    let mut failures = 0;
    for frequency in frequencies {
        let analytic = chain.magnitude_db(sample_rate, frequency);
        let measured = measure_gain_db(chain, sample_rate, frequency, 0.1);
        let error = (analytic - measured).abs();
        let ok = error < 0.5;
        if !ok {
            failures += 1;
        }
        println!(
            "{:<10.0} {:>10.2} {:>10.2} {:>8.2}  {}",
            frequency,
            analytic,
            measured,
            error,
            if ok { "✓" } else { "✗" }
        );
    }
    failures
}

/// 用 1 秒正弦波实测增益（跳过前 0.5 秒的瞬态）。
fn measure_gain_db(
    chain: &mut ChannelChain,
    sample_rate: f32,
    frequency: f32,
    amplitude: f32,
) -> f32 {
    chain.reset();
    let total = sample_rate as usize;
    let skip = total / 2;
    let mut input = Vec::with_capacity(total - skip);
    let mut output = Vec::with_capacity(total - skip);

    for index in 0..total {
        let t = index as f32 / sample_rate;
        let x = amplitude * (2.0 * std::f32::consts::PI * frequency * t).sin();
        let y = chain.process(x);
        if index >= skip {
            input.push(x);
            output.push(y);
        }
    }

    20.0 * (rms(&output) / rms(&input).max(1e-9)).log10()
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

// ---------------------------------------------------------------- 频率重映射自测

/// 单频点幅度（DFT 投影）。
fn magnitude_at(samples: &[f32], sample_rate: f32, frequency: f32) -> f32 {
    let mut re = 0.0f64;
    let mut im = 0.0f64;
    for (index, sample) in samples.iter().enumerate() {
        let phase =
            2.0 * std::f64::consts::PI * frequency as f64 * index as f64 / sample_rate as f64;
        re += *sample as f64 * phase.cos();
        im -= *sample as f64 * phase.sin();
    }
    (2.0 * (re * re + im * im).sqrt() / samples.len() as f64) as f32
}

fn db(amplitude: f32, reference: f32) -> f32 {
    20.0 * (amplitude / reference.max(1e-9)).log10()
}

/// 离线验证方案二：给一个测试音，看能量有没有被搬到目标频点。
fn cmd_lowering_test(args: &Args) -> Result<(), String> {
    let profile_path = args.value_or("profile", "sample-profile-lowering.json");
    let tone: f32 = args.number("tone", 6000.0);
    let amplitude: f32 = args.number("amplitude", 0.2);
    let sample_rate = DEFAULT_RATE as f32;

    let config = CompensationConfig::load(Path::new(&profile_path))?;
    let settings = config.lowering_settings().ok_or_else(|| {
        format!("{profile_path} 没有启用频率重映射（frequencyLowering.enabled 应为 true）")
    })?;
    let settings = settings
        .sanitize(sample_rate)
        .ok_or_else(|| "频率重映射参数不合法：请检查 fmin / fmax / shiftHz".to_string())?;

    let mut channel = lowering::LoweringChannel::new(settings, sample_rate);
    let bin_width = sample_rate / lowering::FFT_SIZE as f32;
    let shift_bins = channel.shift_bins();
    let shift_actual = shift_bins as f32 * bin_width;
    let target = tone - shift_actual;

    println!("频率重映射（band shift）");
    println!(
        "  fmin {:>6.0} Hz | fmax {:>6.0} Hz | 设定搬移 {:>6.0} Hz",
        settings.fmin, settings.fmax, settings.shift_hz
    );
    println!(
        "  FFT {} 点，bin 宽 {:.1} Hz → 实际搬移 {} bin = {:.1} Hz",
        lowering::FFT_SIZE,
        bin_width,
        shift_bins,
        shift_actual
    );
    println!("  测试音 {tone:.0} Hz，幅度 {amplitude:.2}，时长 1 秒\n");

    let total = sample_rate as usize;
    let mut output = Vec::with_capacity(total);
    for index in 0..total {
        let t = index as f32 / sample_rate;
        let x = amplitude * (2.0 * std::f32::consts::PI * tone * t).sin();
        output.push(channel.process(x));
    }
    let steady = &output[4 * lowering::FFT_SIZE..];

    let original = magnitude_at(steady, sample_rate, tone);
    let shifted = magnitude_at(steady, sample_rate, target);
    let noise = magnitude_at(steady, sample_rate, 1000.0);

    println!("{:<22} {:>10} {:>12}", "频点", "幅度", "相对输入");
    println!(
        "{:<22} {:>10.4} {:>9.1} dB",
        format!("{tone:.0} Hz（原信号）"),
        original,
        db(original, amplitude)
    );
    println!(
        "{:<22} {:>10.4} {:>9.1} dB",
        format!("{target:.0} Hz（搬移后）"),
        shifted,
        db(shifted, amplitude)
    );
    println!(
        "{:<22} {:>10.4} {:>9.1} dB",
        "1000 Hz（参考底噪）",
        noise,
        db(noise, amplitude)
    );

    if shifted < amplitude * 0.3 {
        return Err(format!(
            "搬移后目标频点能量过低（{shifted:.4}），算法可能没有生效"
        ));
    }
    println!(
        "\n✅ 频率重映射自测通过：{tone:.0} Hz 的能量被搬到 {target:.0} Hz（{:.1} dB）",
        db(shifted, amplitude)
    );
    Ok(())
}

/// 生成 500/1000/4000 Hz 复合音，经过处理链后写成 wav，便于人耳对比。
fn write_demo_wav(path: impl AsRef<Path>, chain: &mut ChannelChain, sample_rate: f32) -> Result<(), String> {
    let path = path.as_ref();
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: sample_rate as u32,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer =
        hound::WavWriter::create(path, spec).map_err(|err| format!("创建 {path:?} 失败: {err}"))?;

    chain.reset();
    let seconds = 3.0_f32;
    let total = (sample_rate * seconds) as usize;
    let tones = [500.0_f32, 1000.0, 4000.0];
    let amplitude = 0.08;

    for index in 0..total {
        let t = index as f32 / sample_rate;
        let mut x = 0.0;
        for tone in tones {
            x += amplitude * (2.0 * std::f32::consts::PI * tone * t).sin();
        }
        let y = chain.process(x);
        writer
            .write_sample(y.clamp(-1.0, 1.0))
            .map_err(|err| format!("写入失败: {err}"))?;
    }

    writer.finalize().map_err(|err| format!("收尾失败: {err}"))
}

// ---------------------------------------------------------------- run

fn cmd_run(args: &Args) -> Result<(), String> {
    // Ctrl+C 也要走"先还原设备"这条路
    install_console_ctrl_handler();

    let profile_path = args.value_or("profile", "sample-profile.json");
    let seconds: u64 = args.number("seconds", 10);
    let buffer_frames: u32 = args.number("buffer", DEFAULT_BUFFER);
    let wanted_rate: u32 = args.number("rate", DEFAULT_RATE);

    let input_needle = args
        .value("input")
        .ok_or_else(|| "缺少 --input，用 `devices` 命令查看设备名".to_string())?;
    let mut output_needle = args
        .value("output")
        .ok_or_else(|| "缺少 --output（或写 default 用系统当前默认播放设备）".to_string())?;

    // --output default：产品形态下输出到"用户真正在用的设备"，由引擎自己枚举，
    // 不用桌面端再去猜设备名。必须在接管之前取，否则拿到的是 CABLE Input。
    if output_needle.trim().eq_ignore_ascii_case("default") {
        output_needle = endpoints::default_render_name().ok_or_else(|| {
            "读不到当前默认播放设备，请用 --output 指定具体设备名".to_string()
        })?;
    }

    // 桌面端退出时写这个文件，引擎看到就按正常流程收尾（含还原设备）
    let stop_file = args.value("stop-file").map(PathBuf::from);

    // 可选：把系统默认播放设备切到 CABLE Input，让所有应用的声音都流进引擎
    let takeover_target = match args.value("takeover") {
        None => None,
        Some(needle) => Some(resolve_takeover_target(&needle, &output_needle)?),
    };

    // 上一次崩溃/被杀遗留的接管：先还原，别让用户一直"没声音"
    match routing::recover(false) {
        Ok(Some(warnings)) => {
            println!("检测到上次异常退出遗留的设备接管，已还原");
            for warning in warnings {
                println!("  ! {warning}");
            }
        }
        Ok(None) => {}
        Err(err) => println!("提示：{err}"),
    }

    let config = CompensationConfig::load(Path::new(&profile_path))?;
    if !config.has_ear(true) && !config.has_ear(false) {
        return Err("配置里左右耳都没有参数".into());
    }

    let host = cpal::default_host();
    let input_device = find_device(&host, &input_needle, true)?;
    let output_device = find_device(&host, &output_needle, false)?;

    let in_config = pick_config(&input_device, true, wanted_rate, buffer_frames)?;
    let out_config = pick_config(&output_device, false, wanted_rate, buffer_frames)?;

    if in_config.sample_rate.0 != out_config.sample_rate.0 {
        return Err(format!(
            "输入 {} Hz 与输出 {} Hz 不一致；请把两个设备在 Windows 声音设置里设为同一采样率",
            in_config.sample_rate.0, out_config.sample_rate.0
        ));
    }

    let sample_rate = in_config.sample_rate.0;
    let in_channels = in_config.channels as usize;
    let out_channels = out_config.channels as usize;

    println!("输入设备：{}", input_device.name().unwrap_or_default());
    println!(
        "  {} ch, {} Hz, 缓冲 {} 帧（{:.2} ms）",
        in_channels,
        sample_rate,
        buffer_frames,
        buffer_frames as f32 * 1000.0 / sample_rate as f32
    );
    println!("输出设备：{}", output_device.name().unwrap_or_default());
    println!("  {} ch, {} Hz", out_channels, sample_rate);
    println!(
        "运行 {}",
        if seconds == 0 { "直到 Ctrl+C".to_string() } else { format!("{seconds} 秒") }
    );

    // 从这里开始，任何提前返回（?）都会经 Drop 还原设备
    let mut takeover = match &takeover_target {
        None => None,
        Some(target) => Some(begin_takeover(target)?),
    };

    // 音频回调持有当前处理链；热更新时经无锁队列换掉它
    let hot = HotSwap::new();
    let mut processor = Some(hotswap::build_processor(&config, sample_rate as f32));

    // 两个方案互斥：只跑用户选的那一个；原音对比时整条链直通
    let bypass = processor
        .as_ref()
        .map(|pipeline| pipeline.is_bypass())
        .unwrap_or(false);
    let lowering_active = processor
        .as_ref()
        .map(|pipeline| pipeline.lowering_active())
        .unwrap_or(false);
    let lowering_settings = config
        .lowering_settings()
        .and_then(|settings| settings.sanitize(sample_rate as f32));
    if bypass {
        println!("处理方案：原音直通（对比用，不做任何处理）");
    } else {
        match (lowering_active, lowering_settings) {
            (true, Some(settings)) => println!(
                "处理方案：频率重映射 —— {:.0}–{:.0} Hz 下移 {:.0} Hz（增益补偿不叠加；额外延迟一个 FFT 帧 ≈ {:.0} ms）",
                settings.fmin,
                settings.fmax,
                settings.shift_hz,
                lowering::FFT_SIZE as f32 * 1000.0 / sample_rate as f32
            ),
            (true, None) => println!("处理方案：频率重映射（增益补偿不叠加）"),
            (false, _) => println!(
                "处理方案：增益补偿 —— 左耳 {} 段 / 右耳 {} 段（前置增益 L{:+.1} dB / R{:+.1} dB）",
                config.bands_for(true).len(),
                config.bands_for(false).len(),
                config.pre_gain_for(true),
                config.pre_gain_for(false)
            ),
        }
    }

    // 环形队列：容量 = 4 个缓冲块，按交错立体声存
    let capacity = (buffer_frames as usize * in_channels * 4).max(1024);
    let queue = Arc::new(ArrayQueue::<f32>::new(capacity));
    let stats = Arc::new(Stats::default());

    let in_queue = queue.clone();
    let in_stats = stats.clone();
    let input_stream = input_device
        .build_input_stream(
            &in_config,
            move |data: &[f32], _info| {
                let frames = data.len() / in_channels;
                for frame in 0..frames {
                    let base = frame * in_channels;
                    let l = data[base];
                    let r = if in_channels >= 2 { data[base + 1] } else { l };

                    if in_queue.len() + 2 > in_queue.capacity() {
                        in_stats.drops.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    let _ = in_queue.push(l);
                    let _ = in_queue.push(r);
                }
                in_stats
                    .input_frames
                    .fetch_add(frames as u64, Ordering::Relaxed);
            },
            move |err| eprintln!("输入流错误：{err}"),
            None,
        )
        .map_err(|err| format!("创建输入流失败：{err}"))?;

    let out_queue = queue.clone();
    let out_stats = stats.clone();
    let out_hot = hot.clone();
    let output_stream = output_device
        .build_output_stream(
            &out_config,
            move |data: &mut [f32], _info| {
                let started = Instant::now();
                let frames = data.len() / out_channels;

                // 实时线程里只 pop + 替换，不加锁、不分配
                if out_hot.poll(&mut processor) {
                    out_stats.profile_swaps.fetch_add(1, Ordering::Relaxed);
                }

                for frame in 0..frames {
                    let (l, r) = match (out_queue.pop(), out_queue.pop()) {
                        (Some(l), Some(r)) => (l, r),
                        _ => {
                            out_stats.underruns.fetch_add(1, Ordering::Relaxed);
                            (0.0, 0.0)
                        }
                    };
                    let (yl, yr) = match processor.as_mut() {
                        Some(processor) => processor.process_frame(l, r),
                        None => (l, r),
                    };

                    let base = frame * out_channels;
                    data[base] = yl;
                    if out_channels >= 2 {
                        data[base + 1] = yr;
                    }
                    for extra in 2..out_channels {
                        data[base + extra] = 0.0;
                    }
                }

                let elapsed = started.elapsed().as_micros() as u64;
                out_stats
                    .max_process_us
                    .fetch_max(elapsed, Ordering::Relaxed);
                out_stats
                    .total_process_us
                    .fetch_add(elapsed, Ordering::Relaxed);
                out_stats.callbacks.fetch_add(1, Ordering::Relaxed);
                out_stats
                    .output_frames
                    .fetch_add(frames as u64, Ordering::Relaxed);
            },
            move |err| eprintln!("输出流错误：{err}"),
            None,
        )
        .map_err(|err| format!("创建输出流失败：{err}"))?;

    input_stream
        .play()
        .map_err(|err| format!("启动输入流失败：{err}"))?;

    // 预填两块再开输出：否则输出流启动瞬间会连续饿死 6 个缓冲块
    // （约 32 ms 的"咔"，并且会把欠载率统计撑到 3%）
    let preroll_frames = (buffer_frames as usize * 2).max(2);
    let preroll_deadline = Instant::now() + Duration::from_secs(1);
    while queue.len() / 2 < preroll_frames && Instant::now() < preroll_deadline {
        std::thread::sleep(Duration::from_millis(2));
    }

    output_stream
        .play()
        .map_err(|err| format!("启动输出流失败：{err}"))?;

    let stop = Arc::new(AtomicBool::new(false));

    // 配置热更新：普通线程看文件指纹，音频回调只做无锁替换
    let watcher = if args.flags.contains_key("no-watch") {
        None
    } else {
        let hot = hot.clone();
        let stop = stop.clone();
        let path = PathBuf::from(&profile_path);
        println!("监听配置变化：{}（{:.0} ms 轮询）", path.display(), hotswap::POLL_INTERVAL.as_millis());
        Some(std::thread::spawn(move || {
            hotswap::Watcher::new(path, sample_rate as f32, hot).run(stop)
        }))
    };

    if let Some(path) = &stop_file {
        println!("停止标记：{}（文件出现即正常退出并还原设备）", path.display());
    }

    let printer = {
        let stats = stats.clone();
        let queue = queue.clone();
        let stop = stop.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(1));
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                let buffered_frames = queue.len() / 2;
                let latency_ms = buffered_frames as f32 * 1000.0 / sample_rate as f32;
                println!(
                    "{} | 队列 {:>4} 帧 ≈ {:.1} ms | 配置 v{}",
                    stats.snapshot(),
                    buffered_frames,
                    latency_ms,
                    stats.profile_swaps.load(Ordering::Relaxed)
                );
            }
        })
    };

    // 主循环只负责等：按秒数退出，或收到 Ctrl+C / 控制台关闭事件
    let deadline = if seconds == 0 {
        None
    } else {
        Some(Instant::now() + Duration::from_secs(seconds))
    };
    loop {
        if SHUTDOWN.load(Ordering::SeqCst) {
            break;
        }
        if let Some(path) = &stop_file {
            if path.exists() {
                println!("\n检测到停止标记 {}，正在收尾…", path.display());
                break;
            }
        }
        if let Some(deadline) = deadline {
            if Instant::now() >= deadline {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if SHUTDOWN.load(Ordering::SeqCst) {
        println!("\n收到退出信号，正在收尾…");
    }

    stop.store(true, Ordering::Relaxed);
    // 先停输出再停输入：反过来的话最后那次回调会因队列已空而记一次假欠载
    drop(output_stream);
    drop(input_stream);
    let _ = printer.join();
    if let Some(watcher) = watcher {
        let _ = watcher.join();
    }

    // 先还设备，再打统计——用户早一秒拿回声音比多看一行日志重要
    let restore_result = match takeover.as_mut() {
        None => Ok(()),
        Some(takeover) => takeover.restore().map(|warnings| {
            for warning in warnings {
                println!("  ! {warning}");
            }
            println!("已还原系统默认播放设备");
        }),
    };

    println!("\n—— 运行结束 ——");
    println!("{}", stats.snapshot());
    let swaps = stats.profile_swaps.load(Ordering::Relaxed);
    if swaps > 0 {
        println!("本次运行热更新配置 {swaps} 次");
    }

    // 欠载是按"饿死的输出帧"计的，分母必须是输出帧数；用回调次数会算出 >100% 的假数据
    let underruns = stats.underruns.load(Ordering::Relaxed);
    let output_frames = stats.output_frames.load(Ordering::Relaxed).max(1);
    let underrun_ratio = underruns as f64 / output_frames as f64;
    println!(
        "欠载 {underruns} 帧 / 共 {output_frames} 帧 = {:.3}% | 最大单次处理 {} µs（预算 {:.0} µs）",
        underrun_ratio * 100.0,
        stats.max_process_us.load(Ordering::Relaxed),
        buffer_frames as f32 * 1_000_000.0 / sample_rate as f32
    );

    if underrun_ratio > 0.01 {
        return Err("欠载率超过 1%，实时链路不达标（可尝试加大 --buffer 或降低采样率）".into());
    }

    // 设备没还回去就算失败——这比统计数字重要得多
    restore_result?;
    Ok(())
}

fn find_device(host: &cpal::Host, needle: &str, is_input: bool) -> Result<cpal::Device, String> {
    let needle_lower = needle.to_lowercase();

    let devices: Vec<cpal::Device> = if is_input {
        host.input_devices()
            .map_err(|err| err.to_string())?
            .collect()
    } else {
        host.output_devices()
            .map_err(|err| err.to_string())?
            .collect()
    };

    for device in devices {
        let name = device.name().unwrap_or_default();
        if name.to_lowercase().contains(&needle_lower) {
            return Ok(device);
        }
    }

    Err(format!(
        "未找到名称包含 \"{needle}\" 的{}设备，请运行 `hearlink-audio devices` 查看",
        if is_input { "输入" } else { "输出" }
    ))
}

fn pick_config(
    device: &cpal::Device,
    is_input: bool,
    wanted_rate: u32,
    buffer_frames: u32,
) -> Result<cpal::StreamConfig, String> {
    let name = device.name().unwrap_or_default();

    let ranges: Vec<cpal::SupportedStreamConfigRange> = if is_input {
        device
            .supported_input_configs()
            .map_err(|err| format!("{name}: {err}"))?
            .collect()
    } else {
        device
            .supported_output_configs()
            .map_err(|err| format!("{name}: {err}"))?
            .collect()
    };

    let mut fallback: Option<cpal::StreamConfig> = None;

    for range in ranges {
        if range.sample_format() != cpal::SampleFormat::F32 {
            continue;
        }
        let min = range.min_sample_rate().0;
        let max = range.max_sample_rate().0;
        let rate = if (min..=max).contains(&wanted_rate) {
            wanted_rate
        } else {
            max.min(DEFAULT_RATE).max(min)
        };

        let config = cpal::StreamConfig {
            channels: range.channels(),
            sample_rate: cpal::SampleRate(rate),
            buffer_size: cpal::BufferSize::Fixed(buffer_frames),
        };

        if rate == wanted_rate {
            return Ok(config);
        }
        if fallback.is_none() {
            fallback = Some(config);
        }
    }

    fallback.ok_or_else(|| format!("设备 {name} 不支持 F32 采样格式"))
}
