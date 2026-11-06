//! 双二阶（Biquad）滤波器：Peaking EQ 的 RBJ Cookbook 实现。
//!
//! 与 Web 版 `BiquadFilterNode(type='peaking')` 使用同一套系数公式，
//! 保证浏览器预览与桌面端处理结果一致。

use std::f32::consts::PI;

/// 单个二阶节，Direct Form II Transposed。
#[derive(Clone, Debug)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    /// 峰值滤波器（Peaking EQ），参数与 Web Audio 的 `BiquadFilterNode` 一致。
    pub fn peaking(sample_rate: f32, frequency: f32, gain_db: f32, q: f32) -> Self {
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * PI * (frequency / sample_rate).clamp(1e-6, 0.49);
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q.max(1e-3));

        let a0 = 1.0 + alpha / a;
        Self {
            b0: (1.0 + alpha * a) / a0,
            b1: (-2.0 * cos_w0) / a0,
            b2: (1.0 - alpha * a) / a0,
            a1: (-2.0 * cos_w0) / a0,
            a2: (1.0 - alpha / a) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    /// 该频点的幅度响应 |H(e^{jw})|，用于自测时与实测增益对比。
    pub fn magnitude(&self, sample_rate: f32, frequency: f32) -> f32 {
        let w = 2.0 * PI * frequency / sample_rate;
        let z1 = (w.cos(), -w.sin()); // z^-1
        let z2 = cmul(z1, z1); // z^-2

        let num = cadd(
            cadd((self.b0, 0.0), cmul((self.b1, 0.0), z1)),
            cmul((self.b2, 0.0), z2),
        );
        let den = cadd(
            cadd((1.0, 0.0), cmul((self.a1, 0.0), z1)),
            cmul((self.a2, 0.0), z2),
        );

        num.0.hypot(num.1) / den.0.hypot(den.1).max(1e-12)
    }
}

#[inline]
fn cmul(a: (f32, f32), b: (f32, f32)) -> (f32, f32) {
    (a.0 * b.0 - a.1 * b.1, a.0 * b.1 + a.1 * b.0)
}

#[inline]
fn cadd(a: (f32, f32), b: (f32, f32)) -> (f32, f32) {
    (a.0 + b.0, a.1 + b.1)
}

/// 单耳处理链：前置增益 + 多段峰值 EQ 串联。
pub struct ChannelChain {
    bands: Vec<Biquad>,
    frequencies: Vec<f32>,
    pre_gain: f32,
    pre_gain_db: f32,
}

impl ChannelChain {
    pub fn new(
        bands: &[(f32, f32, f32)], // (frequency, gain_db, q)
        pre_gain_db: f32,
        sample_rate: f32,
    ) -> Self {
        Self {
            bands: bands
                .iter()
                .map(|(freq, gain, q)| Biquad::peaking(sample_rate, *freq, *gain, *q))
                .collect(),
            frequencies: bands.iter().map(|(freq, _, _)| *freq).collect(),
            pre_gain: 10f32.powf(pre_gain_db / 20.0),
            pre_gain_db,
        }
    }

    /// 空链（直通），用于未测听的一侧。
    pub fn bypass() -> Self {
        Self::new(&[], 0.0, 48_000.0)
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let mut y = x * self.pre_gain;
        for band in &mut self.bands {
            y = band.process(y);
        }
        y
    }

    pub fn reset(&mut self) {
        for band in &mut self.bands {
            band.reset();
        }
    }

    /// 整条链在指定频点的理论增益（dB），含前置增益。
    pub fn magnitude_db(&self, sample_rate: f32, frequency: f32) -> f32 {
        let mut magnitude = 1.0_f32;
        for band in &self.bands {
            magnitude *= band.magnitude(sample_rate, frequency);
        }
        20.0 * magnitude.max(1e-9).log10() + self.pre_gain_db
    }

    pub fn band_frequencies(&self) -> &[f32] {
        &self.frequencies
    }

    pub fn pre_gain_db(&self) -> f32 {
        self.pre_gain_db
    }

    pub fn band_count(&self) -> usize {
        self.bands.len()
    }
}

/// 双耳处理：左声道走左耳链，右声道走右耳链。
pub struct StereoProcessor {
    pub left: ChannelChain,
    pub right: ChannelChain,
}

impl StereoProcessor {
    #[inline]
    pub fn process_frame(&mut self, left: f32, right: f32) -> (f32, f32) {
        (self.left.process(left), self.right.process(right))
    }

    pub fn reset(&mut self) {
        self.left.reset();
        self.right.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(samples: &[f32]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    /// 用正弦波实测增益，验证滤波器实现与解析式一致。
    fn measured_gain_db(
        chain: &mut ChannelChain,
        sample_rate: f32,
        frequency: f32,
        amplitude: f32,
    ) -> f32 {
        chain.reset();
        let total = (sample_rate * 1.0) as usize;
        let skip = total / 2;
        let mut input = Vec::with_capacity(total - skip);
        let mut output = Vec::with_capacity(total - skip);

        for index in 0..total {
            let t = index as f32 / sample_rate;
            let x = amplitude * (2.0 * PI * frequency * t).sin();
            let y = chain.process(x);
            if index >= skip {
                input.push(x);
                output.push(y);
            }
        }
        20.0 * (rms(&output) / rms(&input)).log10()
    }

    #[test]
    fn peaking_filter_gain_matches_analytic() {
        let sample_rate = 48_000.0;
        let cases = [(500.0, 10.0), (1000.0, 5.0), (2000.0, 15.0), (4000.0, 24.0)];

        for (frequency, gain_db) in cases {
            let mut chain = ChannelChain::new(&[(frequency, gain_db, 1.0)], 0.0, sample_rate);
            let analytic = chain.magnitude_db(sample_rate, frequency);
            let measured = measured_gain_db(&mut chain, sample_rate, frequency, 0.1);

            assert!(
                (analytic - measured).abs() < 0.2,
                "{frequency}Hz 解析值 {analytic:.2}dB 与实测 {measured:.2}dB 不一致"
            );
            assert!(
                (measured - gain_db).abs() < 0.2,
                "{frequency}Hz 实测增益 {measured:.2}dB 应接近设定值 {gain_db}dB"
            );
        }
    }

    #[test]
    fn chain_response_is_sum_of_bands() {
        let sample_rate = 48_000.0;
        let bands = [(500.0, 6.0, 1.0), (2000.0, 12.0, 1.0)];
        let chain = ChannelChain::new(&bands, -3.0, sample_rate);

        // 在 500 Hz 处，2 kHz 的峰几乎无贡献，故总增益应接近 6 - 3 = 3 dB
        let at_500 = chain.magnitude_db(sample_rate, 500.0);
        assert!((at_500 - 3.0).abs() < 1.0, "500Hz 处应为 ~3dB，实际 {at_500:.2}");

        // 在 2 kHz 处应接近 12 - 3 = 9 dB
        let at_2k = chain.magnitude_db(sample_rate, 2000.0);
        assert!((at_2k - 9.0).abs() < 1.5, "2kHz 处应为 ~9dB，实际 {at_2k:.2}");
    }

    #[test]
    fn pre_gain_is_applied() {
        let sample_rate = 48_000.0;
        let chain = ChannelChain::new(&[], -6.0, sample_rate);
        let magnitude = chain.magnitude_db(sample_rate, 1000.0);
        assert!((magnitude + 6.0).abs() < 0.01);
    }

    #[test]
    fn stereo_processor_keeps_channels_independent() {
        let sample_rate = 48_000.0;
        let mut processor = StereoProcessor {
            left: ChannelChain::new(&[(1000.0, 0.0, 1.0)], 0.0, sample_rate),
            right: ChannelChain::new(&[(1000.0, 12.0, 1.0)], 0.0, sample_rate),
        };

        let mut left_out = Vec::new();
        let mut right_out = Vec::new();
        let total = sample_rate as usize / 2;
        for index in 0..total {
            let t = index as f32 / sample_rate;
            let x = 0.1 * (2.0 * PI * 1000.0 * t).sin();
            let (l, r) = processor.process_frame(x, x);
            if index > total / 2 {
                left_out.push(l);
                right_out.push(r);
            }
        }

        let gain_left = 20.0 * (rms(&left_out) / rms(&right_out)).log10();
        assert!(gain_left < -10.0, "右耳应比左耳高约 12dB，实际差值 {gain_left:.2}dB");
    }
}
