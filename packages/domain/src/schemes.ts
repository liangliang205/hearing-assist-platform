/**
 * 声音增强方案。
 *
 * 方案一（gain）：按听力曲线做增益补偿，已实现。
 * 方案二（frequencyLowering）：把听不到的高频搬移到可听的中频区，属 v0.2，
 *   当前只提供参数规划与接口占位，不参与实际处理。
 *
 * 两套方案最终都要落到同一个处理链接口上（见桌面端 `createProcessor`），
 * 这样切换方案时，试听、文件导出、未来的系统级处理都不用改调用方。
 */

import type { FrequencyThreshold } from './audiogram';

export type ProcessingScheme = 'gain' | 'frequencyLowering';

export interface SchemeCapability {
  key: ProcessingScheme;
  /** 面向用户的名称 */
  label: string;
  /** 一句话说明原理 */
  summary: string;
  /** 适合谁 */
  suitableFor: string;
  available: boolean;
  /** 补充说明（已实现方案的适用范围 / 未实现方案的计划） */
  plannedNote?: string;
}

export const PROCESSING_SCHEMES: readonly SchemeCapability[] = [
  {
    key: 'gain',
    label: '方案一 · 增益补偿',
    summary: '把对应频段的响度提上来，让原本听不清的声音变大。',
    suitableFor: '各频段都有残余听力、只是听阈升高的情况',
    available: true,
  },
  {
    key: 'frequencyLowering',
    label: '方案二 · 频率重映射',
    summary: '把高频能量搬移到你还听得见的中频区，保留信息而不是单纯放大。',
    suitableFor: '高频损失严重、放大也听不到辅音的情况',
    available: true,
    plannedNote: '由桌面引擎执行（STFT 搬移）；浏览器试听仍按方案一处理。',
  },
] as const;

export function getScheme(key: ProcessingScheme): SchemeCapability {
  const found = PROCESSING_SCHEMES.find((item) => item.key === key);
  if (!found) throw new Error(`未知处理方案：${key}`);
  return found;
}

export function isSchemeAvailable(key: ProcessingScheme): boolean {
  return getScheme(key).available;
}

export type FrequencyLoweringStrategy = 'bandShift' | 'linearCompression' | 'nonlinearCompression';

/**
 * 方案二的参数规划结果。
 *
 * `implemented` 恒为 false：这个结构只做「参数规划」，真正的 STFT 搬移在桌面
 * Rust 引擎里执行，搬移量由引擎按半带宽推导（`shiftHz` 为 null 时）。
 */
export interface FrequencyLoweringPlan {
  implemented: false;
  strategy: FrequencyLoweringStrategy;
  /** 搬移量（Hz）；规划阶段为 null，由引擎按半带宽推导 */
  shiftHz: number | null;
  /** 起始频率：从这个频率往上开始搬移 */
  fmin: number;
  /** 上边界频率 */
  fmax: number;
  /** 选中的起始频率依据（哪个频点开始明显下降） */
  reason: string;
  note: string;
}

/** 有明显下降的判定阈值（dB HL）。 */
const LOWERING_THRESHOLD_DB = 40;

/**
 * 依据听力图规划频率重映射参数。
 *
 * 规则很简单：找出第一个「明显下降」的频点作为起始频率 fmin，
 * 把 fmin 以上的能量当作需要搬移的对象。真实算法还需要考虑残留听力上限、
 * 搬移后的音质与可懂度，这里只是把接口和默认值定下来。
 */
export function planFrequencyLowering(audiogram: FrequencyThreshold[]): FrequencyLoweringPlan {
  const affected = audiogram
    .filter((item) => (item.thresholdDbHl ?? 95) > LOWERING_THRESHOLD_DB)
    .map((item) => item.frequency)
    .sort((a, b) => a - b);

  const fmin = affected[0] ?? 4000;
  const reason =
    affected.length > 0
      ? `${fmin} Hz 起听阈超过 ${LOWERING_THRESHOLD_DB} dB，是第一个明显下降的频点`
      : `未发现超过 ${LOWERING_THRESHOLD_DB} dB 的明显下降，暂按 4000 Hz 预留`;

  return {
    implemented: false,
    strategy: 'bandShift',
    shiftHz: null,
    fmin,
    fmax: 8000,
    reason,
    note: '搬移量由桌面引擎按半带宽推导；浏览器试听仍按方案一处理，两个方案互斥。',
  };
}
