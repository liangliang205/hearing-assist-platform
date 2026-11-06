//! 配置热更新（任务 3）。
//!
//! 桌面端把当前补偿配置写成 JSON（建议先写临时文件再 rename 原子替换），
//! 引擎在**普通线程**里轮询文件指纹，发现变化就重建处理管线，再经无锁队列
//! 交给音频回调替换：
//!
//! ```text
//! watcher（普通线程） --新管线--> incoming 队列 --pop--> 音频回调
//! 音频回调 --旧管线--> retired 队列 --> watcher 线程析构
//! ```
//!
//! 实时线程里只做 `pop` + `Option::replace`：不加锁、不分配；旧管线不在这里
//! 析构，避免把 malloc/free 带进音频回调。

use crate::lowering::Pipeline;
use crate::profile::CompensationConfig;
use crossbeam_queue::ArrayQueue;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// 轮询间隔。目标「1 秒内生效」，300 ms 足够，又不至于把磁盘搞响。
pub const POLL_INTERVAL: Duration = Duration::from_millis(300);

const MAILBOX: usize = 4;

pub fn build_processor(config: &CompensationConfig, sample_rate: f32) -> Pipeline {
    Pipeline::from_config(config, sample_rate)
}

/// 文件指纹：mtime + 长度。改一次内容必然变，`touch` 也算变（重建一次无害）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fingerprint {
    modified: std::time::SystemTime,
    len: u64,
}

pub fn fingerprint(path: &Path) -> Option<Fingerprint> {
    let meta = std::fs::metadata(path).ok()?;
    Some(Fingerprint { modified: meta.modified().ok()?, len: meta.len() })
}

/// 音频回调与 watcher 之间的交换通道。克隆只是复制两个 `Arc`。
#[derive(Clone)]
pub struct HotSwap {
    incoming: Arc<ArrayQueue<Pipeline>>,
    retired: Arc<ArrayQueue<Pipeline>>,
}

impl HotSwap {
    pub fn new() -> Self {
        Self {
            incoming: Arc::new(ArrayQueue::new(MAILBOX)),
            retired: Arc::new(ArrayQueue::new(MAILBOX)),
        }
    }

    /// **音频回调**调用：有新配置就换上，旧配置丢进 retired 队列。
    /// 返回是否发生了替换。
    pub fn poll(&self, current: &mut Option<Pipeline>) -> bool {
        let Some(next) = self.incoming.pop() else {
            return false;
        };
        if let Some(old) = current.replace(next) {
            // 队列满（watcher 没来得及收）时只能就地析构，属于罕见情况
            let _ = self.retired.push(old);
        }
        true
    }

    /// watcher 线程调用：把音频回调退役的旧管线真正释放掉。
    pub fn drain_retired(&self) {
        while self.retired.pop().is_some() {}
    }

    /// watcher 线程调用：发布新管线。
    pub fn publish(&self, processor: Pipeline) -> Result<(), String> {
        self.incoming
            .push(processor)
            .map_err(|_| "热更新队列已满，本次更新被丢弃".to_string())
    }

    #[cfg(test)]
    fn retired_len(&self) -> usize {
        self.retired.len()
    }
}

impl Default for HotSwap {
    fn default() -> Self {
        Self::new()
    }
}

/// 监听配置文件变化，把新管线推给音频回调。
pub struct Watcher {
    path: PathBuf,
    sample_rate: f32,
    hot: HotSwap,
}

impl Watcher {
    pub fn new(path: impl Into<PathBuf>, sample_rate: f32, hot: HotSwap) -> Self {
        Self { path: path.into(), sample_rate, hot }
    }

    /// 阻塞轮询，直到 `stop` 置位。
    pub fn run(self, stop: Arc<AtomicBool>) {
        let mut seen = fingerprint(&self.path);
        let mut last_error: Option<String> = None;

        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(POLL_INTERVAL);
            self.hot.drain_retired();

            let Some(current) = fingerprint(&self.path) else {
                continue;
            };
            if Some(current) == seen {
                continue;
            }

            // 解析失败通常是桌面端正写到一半：不记录指纹，下一轮重试；
            // 报错只在内容变化时提示一次，避免刷屏。
            let config = match CompensationConfig::load(&self.path) {
                Ok(config) => config,
                Err(err) => {
                    self.report_once(&mut last_error, &err);
                    continue;
                }
            };
            if !config.has_ear(true) && !config.has_ear(false) {
                self.report_once(&mut last_error, "新配置里左右耳都没有参数");
                continue;
            }

            let lowering = config
                .lowering_settings()
                .and_then(|settings| settings.sanitize(self.sample_rate));
            match self.hot.publish(build_processor(&config, self.sample_rate)) {
                Ok(()) => {
                    seen = Some(current);
                    last_error = None;
                    // 两个方案互斥、原音直通优先，日志照实说明当前生效的是什么
                    if config.bypass {
                        println!("配置已热更新：原音直通（对比用，不做任何处理）");
                    } else {
                        match lowering {
                            Some(settings) => println!(
                                "配置已热更新：频率重映射 {:.0}–{:.0} Hz 下移 {:.0} Hz（增益补偿不叠加）",
                                settings.fmin, settings.fmax, settings.shift_hz
                            ),
                            None => println!(
                                "配置已热更新：增益补偿 左 {} 段 / 右 {} 段，前置增益 L{:+.1}dB R{:+.1}dB",
                                config.bands_for(true).len(),
                                config.bands_for(false).len(),
                                config.pre_gain_for(true),
                                config.pre_gain_for(false)
                            ),
                        }
                    }
                }
                Err(err) => self.report_once(&mut last_error, &err),
            }
        }
    }

    fn report_once(&self, last_error: &mut Option<String>, message: &str) {
        if last_error.as_deref() != Some(message) {
            eprintln!("配置热更新失败（继续使用上一份配置）：{message}");
            *last_error = Some(message.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    /// 写一份最小可用的补偿配置（改动 `gain_db` 会改变长度/内容）。
    fn write_profile(path: &Path, gain_db: f32) {
        let text = format!(
            r#"{{"version":1,"ears":{{
                "LEFT":{{"eqBands":[{{"frequency":1000,"gainDb":{gain_db},"q":1}}],"preGainDb":0}},
                "RIGHT":{{"eqBands":[],"preGainDb":0}}
            }}}}"#
        );
        std::fs::write(path, text).expect("写临时配置失败");
    }

    fn temp_profile(name: &str, gain_db: f32) -> PathBuf {
        let path = std::env::temp_dir()
            .join(format!("hearlink-hotswap-{}-{name}.json", std::process::id()));
        write_profile(&path, gain_db);
        path
    }

    #[test]
    fn poll_swaps_processor_and_retires_old() {
        let sample_rate = 48_000.0;
        let first = temp_profile("poll-a", 6.0);
        let second = temp_profile("poll-b", 12.0);

        let mut current = Some(build_processor(
            &CompensationConfig::load(&first).expect("应能读配置"),
            sample_rate,
        ));
        let before = current.as_ref().unwrap().magnitude_db(true, sample_rate, 1000.0);
        assert!((before - 6.0).abs() < 0.5, "初始增益应约 6dB，实际 {before:.2}");

        let hot = HotSwap::new();
        let newer = CompensationConfig::load(&second).expect("应能读配置");
        hot.publish(build_processor(&newer, sample_rate)).expect("应能发布");

        assert!(hot.poll(&mut current), "应取到新配置");
        let after = current.as_ref().unwrap().magnitude_db(true, sample_rate, 1000.0);
        assert!((after - 12.0).abs() < 0.5, "换新后增益应约 12dB，实际 {after:.2}");

        assert_eq!(hot.retired_len(), 1, "旧管线应被交还给 watcher 线程释放");
        hot.drain_retired();
        assert_eq!(hot.retired_len(), 0);

        let _ = std::fs::remove_file(&first);
        let _ = std::fs::remove_file(&second);
    }

    #[test]
    fn poll_without_update_is_a_no_op() {
        let hot = HotSwap::new();
        let mut current = Some(build_processor(
            &CompensationConfig::load(&temp_profile("noop", 3.0)).expect("应能读配置"),
            48_000.0,
        ));
        assert!(!hot.poll(&mut current));
        assert!(current.is_some());
    }

    #[test]
    fn fingerprint_changes_when_file_is_rewritten() {
        let path = temp_profile("fingerprint", 6.0);
        let first = fingerprint(&path).expect("应有指纹");
        write_profile(&path, 30.0);
        let second = fingerprint(&path).expect("应有指纹");
        assert_ne!(first, second, "内容变化后指纹必须不同");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn browser_style_partial_write_keeps_previous_config() {
        // 模拟"桌面端写到一半"：先写坏 JSON，watcher 应拒绝并保留旧配置，
        // 再写好之后仍然能生效。
        let path = temp_profile("partial", 6.0);
        let hot = HotSwap::new();
        let stop = Arc::new(AtomicBool::new(false));
        let mut current = Some(build_processor(
            &CompensationConfig::load(&path).expect("应能读配置"),
            48_000.0,
        ));

        let watcher = {
            let hot = hot.clone();
            let stop = stop.clone();
            let path = path.clone();
            std::thread::spawn(move || Watcher::new(path, 48_000.0, hot).run(stop))
        };

        std::thread::sleep(Duration::from_millis(150));
        std::fs::write(&path, b"{\"version\":1,\"ears\":{\"LEFT\"").expect("写坏文件失败");
        std::thread::sleep(Duration::from_millis(500));
        assert!(!hot.poll(&mut current), "坏配置不应生效");

        write_profile(&path, 9.0);
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut applied = false;
        while Instant::now() < deadline {
            if hot.poll(&mut current) {
                applied = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        stop.store(true, Ordering::Relaxed);
        let _ = watcher.join();
        let _ = std::fs::remove_file(&path);

        assert!(applied, "写完整后应生效");
        let gain = current.as_ref().unwrap().magnitude_db(true, 48_000.0, 1000.0);
        assert!((gain - 9.0).abs() < 0.5, "增益应约 9dB，实际 {gain:.2}");
    }
}
