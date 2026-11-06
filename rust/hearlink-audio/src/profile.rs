//! 补偿配置解析：直接读取 Web 端导出的 `CompensationConfig` JSON。
//!
//! 与服务端 `backend/src/lib/audiogram.ts` 的契约保持一致，
//! 桌面端无需重新定义一套格式。

use crate::lowering::{LoweringSettings, DEFAULT_FMAX, DEFAULT_FMIN};
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct EqBand {
    pub frequency: f32,
    #[serde(rename = "gainDb")]
    pub gain_db: f32,
    pub q: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EarSettings {
    pub eq_bands: Vec<EqBand>,
    pub pre_gain_db: f32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Ears {
    #[serde(rename = "LEFT", default)]
    pub left: Option<EarSettings>,
    #[serde(rename = "RIGHT", default)]
    pub right: Option<EarSettings>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompensationConfig {
    #[serde(default = "default_version")]
    pub version: u32,
    pub ears: Ears,
    /// 方案二（频率重映射）参数，由桌面端写入；`enabled: false` 时引擎只做增益补偿。
    #[serde(default, rename = "frequencyLowering")]
    pub frequency_lowering: Option<FrequencyLoweringConfig>,
    /// 对比用：true 时整条链路直通（既不做增益补偿也不做搬移），用于 A/B 听原音。
    #[serde(default)]
    pub bypass: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyLoweringConfig {
    #[serde(default)]
    pub enabled: bool,
    /// 未给时按半带宽推导（见 `LoweringSettings::default_shift`）
    #[serde(default)]
    pub shift_hz: Option<f32>,
    #[serde(default)]
    pub fmin: Option<f32>,
    #[serde(default)]
    pub fmax: Option<f32>,
}

fn default_version() -> u32 {
    1
}

impl CompensationConfig {
    pub fn load(path: &Path) -> Result<Self, String> {
        let text = fs::read_to_string(path)
            .map_err(|err| format!("读取配置失败 {}: {err}", path.display()))?;
        serde_json::from_str(&text).map_err(|err| format!("解析配置失败 {}: {err}", path.display()))
    }

    /// 转成 `ChannelChain::new` 需要的 (frequency, gain_db, q) 三元组。
    pub fn bands_for(&self, left: bool) -> Vec<(f32, f32, f32)> {
        let settings = if left {
            self.ears.left.as_ref()
        } else {
            self.ears.right.as_ref()
        };
        settings
            .map(|item| {
                item.eq_bands
                    .iter()
                    .map(|band| (band.frequency, band.gain_db, band.q))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn pre_gain_for(&self, left: bool) -> f32 {
        let settings = if left {
            self.ears.left.as_ref()
        } else {
            self.ears.right.as_ref()
        };
        settings.map(|item| item.pre_gain_db).unwrap_or(0.0)
    }

    pub fn has_ear(&self, left: bool) -> bool {
        if left {
            self.ears.left.is_some()
        } else {
            self.ears.right.is_some()
        }
    }

    /// 方案二的搬移参数；未启用或缺字段时返回 None（引擎退化为纯增益补偿）。
    pub fn lowering_settings(&self) -> Option<LoweringSettings> {
        let config = self.frequency_lowering.as_ref()?;
        if !config.enabled {
            return None;
        }
        let fmin = config.fmin.unwrap_or(DEFAULT_FMIN);
        let fmax = config.fmax.unwrap_or(DEFAULT_FMAX);
        let shift_hz = config
            .shift_hz
            .filter(|shift| shift.is_finite() && *shift > 0.0)
            .unwrap_or_else(|| LoweringSettings::default_shift(fmin, fmax));
        Some(LoweringSettings { fmin, fmax, shift_hz })
    }
}
