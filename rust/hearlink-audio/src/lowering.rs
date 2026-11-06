//! 频率重映射（方案二）：STFT 分段搬移。
//!
//! 高频损失的用户"放大也听不到"，那就把听不到的高频**搬**到还听得见的中频区，
//! 保留信息而不是单纯加大音量。做法是最常见的 band shift：
//!
//! ```text
//! 输入 → sqrt-Hann 加窗（1024 点）→ FFT → 把 [fmin, fmax] 的复数 bin 下移 shift
//!      → IFFT → sqrt-Hann 窗 → 50% 重叠相加 → 输出
//! ```
//!
//! 几个实现要点：
//! - 分析/合成都用 sqrt-Hann，乘积是 Hann，50% 重叠时**完美重叠相加**（常量和为 1）；
//! - 正频率 bin 搬移时必须同步搬它的共轭镜像（N-k），否则输出不再是实信号、
//!   幅度只剩一半且带正交分量；
//! - 每帧给搬移副本乘一个 ±1（相位旋转 π·shift·m 的整数倍），让相邻帧在目标
//!   频率上相位一致——不处理的话，搬移量为奇数 bin 时两帧会互相抵消；
//! - 原频段保留（只叠加副本，不挖掉），避免把用户还有残余听力的 4–8 kHz 弄没；
//! - 延迟 = 一个帧长（1024 点 ≈ 21 ms @ 48 kHz）。

use crate::profile::CompensationConfig;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::Arc;

/// FFT 帧长。48 kHz 下分辨率 46.9 Hz，延迟 21.3 ms。
pub const FFT_SIZE: usize = 1024;
const HOP: usize = FFT_SIZE / 2;

pub const DEFAULT_FMIN: f32 = 4000.0;
pub const DEFAULT_FMAX: f32 = 8000.0;

/// 搬移副本的增益。原频段保留、副本再按原幅度叠加会让总能量 +3 dB，
/// 容易顶到限幅；这里给副本 -3 dB，听感上已经够用。
const SHIFTED_GAIN: f32 = 0.7;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LoweringSettings {
    pub fmin: f32,
    pub fmax: f32,
    pub shift_hz: f32,
}

impl LoweringSettings {
    /// 没有显式给 shiftHz 时的默认值：把整段往下搬半个带宽，
    /// 保证搬移后的两端都还落在可听范围内。
    pub fn default_shift(fmin: f32, fmax: f32) -> f32 {
        ((fmax - fmin) / 2.0).max(50.0)
    }

    /// 夹到奈奎斯特以内；参数明显不合理时返回 None（宁可不处理，也不要乱处理）。
    pub fn sanitize(self, sample_rate: f32) -> Option<Self> {
        if !(sample_rate.is_finite() && sample_rate >= 16_000.0) {
            return None;
        }
        if !(self.fmin.is_finite() && self.fmax.is_finite() && self.shift_hz.is_finite()) {
            return None;
        }
        if self.fmin <= 0.0 || self.fmax <= self.fmin || self.shift_hz <= 0.0 {
            return None;
        }

        let nyquist = sample_rate / 2.0;
        let fmax = self.fmax.min(nyquist * 0.95);
        let fmin = self.fmin.max(100.0);
        if fmax - fmin < 200.0 {
            return None;
        }
        let shift_hz = self.shift_hz.max(50.0).min(nyquist * 0.8);
        Some(Self { fmin, fmax, shift_hz })
    }
}

fn sqrt_hann(size: usize) -> Vec<f32> {
    (0..size)
        .map(|index| {
            let phase = 2.0 * std::f32::consts::PI * index as f32 / size as f32;
            (0.5 - 0.5 * phase.cos()).sqrt()
        })
        .collect()
}

/// 单声道搬移器（左右耳各一个实例，参数相同）。
pub struct LoweringChannel {
    fft: Arc<dyn Fft<f32>>,
    ifft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    spec: Vec<Complex<f32>>,
    frame: Vec<f32>,
    /// 最近 FFT_SIZE 个输入样本
    history: Vec<f32>,
    pending: Vec<f32>,
    /// 重叠相加缓冲（环形）
    ola: Vec<f32>,
    ola_read: usize,
    bin_lo: usize,
    bin_hi: usize,
    shift_bins: usize,
    frame_index: u64,
}

impl LoweringChannel {
    pub fn new(settings: LoweringSettings, sample_rate: f32) -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let window = sqrt_hann(FFT_SIZE);
        let bin = |frequency: f32| {
            ((frequency / sample_rate) * FFT_SIZE as f32).round() as isize
        };

        let half = (FFT_SIZE / 2 - 1) as isize;
        let bin_lo = bin(settings.fmin).clamp(1, half) as usize;
        let bin_hi = bin(settings.fmax).clamp(bin_lo as isize, half) as usize;
        let shift_bins = bin(settings.shift_hz).clamp(1, half) as usize;

        Self {
            fft: planner.plan_fft_forward(FFT_SIZE),
            ifft: planner.plan_fft_inverse(FFT_SIZE),
            window,
            spec: vec![Complex::new(0.0, 0.0); FFT_SIZE],
            frame: vec![0.0; FFT_SIZE],
            history: vec![0.0; FFT_SIZE],
            pending: Vec::with_capacity(HOP),
            ola: vec![0.0; FFT_SIZE],
            ola_read: 0,
            bin_lo,
            bin_hi,
            shift_bins,
            frame_index: 0,
        }
    }

    /// 实际生效的搬移量（bin 数），用于日志与自测。
    pub fn shift_bins(&self) -> usize {
        self.shift_bins
    }

    /// 逐样本处理，返回**上一帧**的结果（延迟一个帧长）。
    pub fn process(&mut self, sample: f32) -> f32 {
        let output = self.ola[self.ola_read];
        self.ola[self.ola_read] = 0.0;
        self.ola_read = (self.ola_read + 1) % FFT_SIZE;

        self.pending.push(sample);
        if self.pending.len() == HOP {
            self.history.drain(..HOP);
            self.history.extend_from_slice(&self.pending);
            self.pending.clear();
            self.process_frame();
        }
        output
    }

    fn process_frame(&mut self) {
        for index in 0..FFT_SIZE {
            self.frame[index] = self.history[index] * self.window[index];
            self.spec[index] = Complex::new(self.frame[index], 0.0);
        }
        self.fft.process(&mut self.spec);

        // 搬移量为奇数 bin 时，相邻两帧在目标频率上相位差 π，需要翻转符号
        let flip = (self.frame_index as usize * self.shift_bins) % 2 == 1;
        let sign = if flip { -1.0 } else { 1.0 };

        for bin in self.bin_lo..=self.bin_hi {
            let target = bin as isize - self.shift_bins as isize;
            if target < 1 || target as usize >= FFT_SIZE / 2 {
                continue;
            }
            let mirror = FFT_SIZE - bin;
            let mirror_target = FFT_SIZE - target as usize;

            let value = self.spec[bin] * (sign * SHIFTED_GAIN);
            let mirror_value = self.spec[mirror] * (sign * SHIFTED_GAIN);

            self.spec[target as usize] += value;
            self.spec[mirror_target] += mirror_value;
        }

        self.ifft.process(&mut self.spec);

        let scale = 1.0 / FFT_SIZE as f32;
        for index in 0..FFT_SIZE {
            let position = (self.ola_read + index) % FFT_SIZE;
            self.ola[position] += self.spec[index].re * self.window[index] * scale;
        }
        self.frame_index += 1;
    }
}

/// 双耳完整处理管线：先做增益补偿（EQ），再（可选）做频率重映射。
///
/// 两个方案共用这一条链，桌面端换档案时整体热替换。
pub struct Pipeline {
    eq: crate::biquad::StereoProcessor,
    lowering_left: Option<LoweringChannel>,
    lowering_right: Option<LoweringChannel>,
    /// 直通（A/B 听原音）：不做任何处理
    bypass: bool,
}

impl Pipeline {
    pub fn from_config(config: &CompensationConfig, sample_rate: f32) -> Self {
        if config.bypass {
            return Self {
                eq: crate::biquad::StereoProcessor {
                    left: crate::biquad::ChannelChain::new(&[], 0.0, sample_rate),
                    right: crate::biquad::ChannelChain::new(&[], 0.0, sample_rate),
                },
                lowering_left: None,
                lowering_right: None,
                bypass: true,
            };
        }

        let eq = crate::biquad::StereoProcessor {
            left: crate::biquad::ChannelChain::new(
                &config.bands_for(true),
                config.pre_gain_for(true),
                sample_rate,
            ),
            right: crate::biquad::ChannelChain::new(
                &config.bands_for(false),
                config.pre_gain_for(false),
                sample_rate,
            ),
        };

        let settings = config
            .lowering_settings()
            .and_then(|settings| settings.sanitize(sample_rate));
        let (lowering_left, lowering_right) = match settings {
            Some(settings) => (
                Some(LoweringChannel::new(settings, sample_rate)),
                Some(LoweringChannel::new(settings, sample_rate)),
            ),
            None => (None, None),
        };

        Self { eq, lowering_left, lowering_right, bypass: false }
    }

    pub fn lowering_active(&self) -> bool {
        self.lowering_left.is_some()
    }

    /// 当前是否处于直通（原音对比）状态。
    pub fn is_bypass(&self) -> bool {
        self.bypass
    }

    /// 该侧在当前配置下的理论增益（dB），供热更新测试使用。
    #[cfg(test)]
    pub fn magnitude_db(&self, left: bool, sample_rate: f32, frequency: f32) -> f32 {
        let chain = if left { &self.eq.left } else { &self.eq.right };
        chain.magnitude_db(sample_rate, frequency)
    }

    #[inline]
    pub fn process_frame(&mut self, left: f32, right: f32) -> (f32, f32) {
        // 原音对比：整条链直通，不做任何处理
        if self.bypass {
            return (left, right);
        }

        // 两个方案互斥：开了频率重映射就只做搬移，不再叠加增益补偿
        if let (Some(lowering_left), Some(lowering_right)) =
            (&mut self.lowering_left, &mut self.lowering_right)
        {
            let left = lowering_left.process(left);
            let right = lowering_right.process(right);
            return (left.clamp(-1.0, 1.0), right.clamp(-1.0, 1.0));
        }

        let (left, right) = self.eq.process_frame(left, right);
        // 搬移是叠加式的，输出可能超过 ±1；在链路末端限幅，避免数字过载
        (left.clamp(-1.0, 1.0), right.clamp(-1.0, 1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 单频点幅度（DFT 投影），用于验证"搬到哪里去了、搬过去多少"。
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

    /// 生成 1 秒正弦，返回稳态段（跳过帧延迟与瞬态）。
    fn run_tone(settings: Option<LoweringSettings>, tone_hz: f32, amplitude: f32) -> Vec<f32> {
        let sample_rate = 48_000.0;
        let total = 48_000;
        let mut output = Vec::with_capacity(total);
        match settings {
            Some(settings) => {
                let mut channel = LoweringChannel::new(settings, sample_rate);
                for index in 0..total {
                    let t = index as f32 / sample_rate;
                    let x = amplitude * (2.0 * std::f32::consts::PI * tone_hz * t).sin();
                    output.push(channel.process(x));
                }
            }
            None => {
                // 关闭时直通
                for index in 0..total {
                    let t = index as f32 / sample_rate;
                    output.push(amplitude * (2.0 * std::f32::consts::PI * tone_hz * t).sin());
                }
            }
        }
        output.into_iter().skip(4 * FFT_SIZE).collect()
    }

    #[test]
    fn shifts_tone_into_audible_band() {
        let sample_rate = 48_000.0;
        let settings = LoweringSettings { fmin: 4000.0, fmax: 8000.0, shift_hz: 2000.0 }
            .sanitize(sample_rate)
            .expect("参数应有效");
        let shift = LoweringChannel::new(settings, sample_rate).shift_bins() as f32
            * sample_rate
            / FFT_SIZE as f32;
        let target = 6000.0 - shift;
        let output = run_tone(Some(settings), 6000.0, 0.2);

        let original = magnitude_at(&output, sample_rate, 6000.0);
        let shifted = magnitude_at(&output, sample_rate, target);

        // 原频段保留
        assert!(original > 0.15, "6000 Hz 原信号应保留，实测幅度 {original:.3}");
        // 目标频点出现能量，且量级与原信号相当
        assert!(
            shifted > 0.1,
            "搬移后 {target:.0} Hz 应出现能量，实测 {shifted:.3}"
        );
    }

    #[test]
    fn odd_shift_bins_does_not_cancel_between_frames() {
        // 搬移奇数个 bin 时，如果不做 ±1 相位翻转，相邻帧在目标频率上会互相抵消。
        // 47.9 Hz 的搬移量 ≈ 1 个 bin（46.9 Hz），正好是奇数 bin 的情形。
        let settings = LoweringSettings { fmin: 1000.0, fmax: 3000.0, shift_hz: 47.0 }
            .sanitize(48_000.0)
            .expect("参数应有效");
        let channel_bins = LoweringChannel::new(settings, 48_000.0).shift_bins();
        assert_eq!(channel_bins, 1, "47 Hz 应折算成 1 个 bin");

        let output = run_tone(Some(settings), 2000.0, 0.2);
        let shifted = magnitude_at(&output, 48_000.0, 2000.0 - 46.875);
        assert!(shifted > 0.05, "奇数 bin 搬移后仍应有能量，实测 {shifted:.3}");
    }

    #[test]
    fn sanitize_rejects_nonsense() {
        assert!(LoweringSettings { fmin: 8000.0, fmax: 4000.0, shift_hz: 1000.0 }
            .sanitize(48_000.0)
            .is_none());
        let clamped = LoweringSettings { fmin: 4000.0, fmax: 40_000.0, shift_hz: 2000.0 }
            .sanitize(48_000.0)
            .expect("应被夹到奈奎斯特以内");
        assert!(clamped.fmax < 24_000.0);
        assert!(LoweringSettings { fmin: 4000.0, fmax: 8000.0, shift_hz: 2000.0 }
            .sanitize(16_000.0)
            .is_some());
        // 8 kHz 采样率下 4–8 kHz 整段都在奈奎斯特之外，应当直接拒绝
        assert!(LoweringSettings { fmin: 4000.0, fmax: 8000.0, shift_hz: 2000.0 }
            .sanitize(8_000.0)
            .is_none());
    }

    #[test]
    fn default_shift_is_half_band() {
        assert_eq!(LoweringSettings::default_shift(4000.0, 8000.0), 2000.0);
        assert_eq!(LoweringSettings::default_shift(1600.0, 8000.0), 3200.0);
    }

    #[test]
    fn pipeline_without_lowering_is_passthrough_plus_eq() {
        let sample_rate = 48_000.0;
        let config = CompensationConfig {
            version: 1,
            ears: crate::profile::Ears { left: None, right: None },
            frequency_lowering: None,
            bypass: false,
        };
        let mut pipeline = Pipeline::from_config(&config, sample_rate);
        assert!(!pipeline.lowering_active());
        assert!(!pipeline.is_bypass());
        let (left, _right) = pipeline.process_frame(0.25, -0.25);
        assert!((left - 0.25).abs() < 1e-6);
    }

    /// 直通（原音对比）：即使配置里有 +12 dB，也不做任何处理。
    #[test]
    fn bypass_leaves_signal_untouched() {
        let sample_rate = 48_000.0;
        let mut config = config_with_boost_and_lowering(false);
        config.bypass = true;

        let pipeline = Pipeline::from_config(&config, sample_rate);
        assert!(pipeline.is_bypass());

        let amplitude = run_500hz(&config, sample_rate);
        assert!(
            (amplitude - 0.2).abs() < 1e-3,
            "原音直通时幅度应保持 0.2，实测 {amplitude:.4}"
        );
    }

    fn config_with_boost_and_lowering(enabled: bool) -> CompensationConfig {
        CompensationConfig {
            version: 1,
            ears: crate::profile::Ears {
                left: Some(crate::profile::EarSettings {
                    eq_bands: vec![crate::profile::EqBand {
                        frequency: 500.0,
                        gain_db: 12.0,
                        q: 1.0,
                    }],
                    pre_gain_db: 0.0,
                }),
                right: None,
            },
            frequency_lowering: Some(crate::profile::FrequencyLoweringConfig {
                enabled,
                shift_hz: Some(2000.0),
                fmin: Some(4000.0),
                fmax: Some(8000.0),
            }),
            bypass: false,
        }
    }

    /// 500 Hz 正弦经过管线，返回稳态段在 500 Hz 处的幅度。
    fn run_500hz(config: &CompensationConfig, sample_rate: f32) -> f32 {
        let mut pipeline = Pipeline::from_config(config, sample_rate);
        let mut output = Vec::new();
        for index in 0..48_000 {
            let t = index as f32 / sample_rate;
            let x = 0.2 * (2.0 * std::f32::consts::PI * 500.0 * t).sin();
            let (left, _right) = pipeline.process_frame(x, x);
            output.push(left);
        }
        magnitude_at(&output[4 * FFT_SIZE..], sample_rate, 500.0)
    }

    #[test]
    fn gain_applies_when_lowering_disabled() {
        let amplitude = run_500hz(&config_with_boost_and_lowering(false), 48_000.0);
        // +12 dB ≈ 4 倍
        assert!(
            (amplitude - 0.8).abs() < 0.15,
            "只做增益补偿时 500 Hz 应被放大约 4 倍，实测 {amplitude:.3}"
        );
    }

    #[test]
    fn lowering_and_gain_are_mutually_exclusive() {
        let amplitude = run_500hz(&config_with_boost_and_lowering(true), 48_000.0);
        // 开了频率重映射就只做搬移：500 Hz 不在搬移带内，应原样通过，不被 +12 dB 放大
        assert!(
            (amplitude - 0.2).abs() < 0.05,
            "开频率重映射时不应再叠加增益补偿，实测 {amplitude:.3}"
        );
    }
}
