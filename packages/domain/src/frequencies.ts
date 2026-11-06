/**
 * 测听频点定义（唯一来源）。
 *
 * 为什么用倍频程：人耳对频率的感知是对数的，250→500 与 4000→8000 主观上是
 * 同样大的一步；临床纯音测听也按倍频程取点，这样结果才能和医院听力图对照。
 *
 * 线性等 Hz 间隔会把测听时间花在感知差异很小的高频，却漏掉对语音清晰度
 * 最关键的 250–1000 Hz。
 */

/** 标准频点：倍频程，临床通用。 */
export const OCTAVE_FREQUENCIES = [250, 500, 1000, 2000, 4000, 8000] as const;

/**
 * 精细频点：在倍频程基础上补 125 / 3000 / 6000。
 * 125 Hz 用于低频下限；3000 / 6000 Hz 用于描出噪声性听力损失在 4 kHz 附近的切迹。
 */
export const EXTENDED_FREQUENCIES = [125, 250, 500, 1000, 2000, 3000, 4000, 6000, 8000] as const;

/** PTA 计算频点：固定取这四个，与 WHO 分级口径一致，不随测听模式变化。 */
export const PTA_FREQUENCIES = [500, 1000, 2000, 4000] as const;

export type TestFrequencySet = 'standard' | 'extended';

export interface FrequencySetOption {
  key: TestFrequencySet;
  label: string;
  description: string;
  frequencies: readonly number[];
  /** 单耳预计耗时（分钟），仅用于界面提示 */
  estimatedMinutes: number;
}

export const TEST_FREQUENCY_SETS: readonly FrequencySetOption[] = [
  {
    key: 'standard',
    label: '标准 · 6 个频点',
    description: '250–8000 Hz 倍频程，临床通用，单耳约 3–5 分钟',
    frequencies: OCTAVE_FREQUENCIES,
    estimatedMinutes: 4,
  },
  {
    key: 'extended',
    label: '精细 · 9 个频点',
    description: '增加 125 / 3000 / 6000 Hz，可看低频下限与 4 kHz 切迹，单耳约 5–7 分钟',
    frequencies: EXTENDED_FREQUENCIES,
    estimatedMinutes: 6,
  },
] as const;

export function frequenciesFor(set: TestFrequencySet): readonly number[] {
  return TEST_FREQUENCY_SETS.find((item) => item.key === set)?.frequencies ?? OCTAVE_FREQUENCIES;
}

/** 把任意频率列表去重并升序排列，供画图与插值使用。 */
export function normalizeFrequencies(frequencies: Iterable<number>): number[] {
  return [...new Set(frequencies)].sort((a, b) => a - b);
}

/**
 * 临床测听顺序：从 1000 Hz 起测，再测高频，最后测低频。
 *
 * 原因：1000 Hz 最稳定、最容易被理解，先建立应答规则；
 * 高频先测可以避免低频的「振动感」被误判为听到；低频放最后，
 * 也符合 ASHA / ISO 8253-1 的常规做法（1000 → 2000 → 4000 → 8000 → 500 → 250）。
 */
export function clinicalOrder(frequencies: readonly number[]): number[] {
  const sorted = [...new Set(frequencies)].sort((a, b) => a - b);
  const high = sorted.filter((frequency) => frequency >= 1000);
  const low = sorted.filter((frequency) => frequency < 1000).sort((a, b) => b - a);
  return [...high, ...low];
}
