/**
 * 听力学领域逻辑（纯函数，无 IO，便于单元测试与后续桌面端复用）。
 *
 * 口径说明：
 * 1. 浏览器无法做声学校准，本模块输出的是「相对听阈」，用于个性化补偿与前后对比，
 *    不等同于临床纯音测听结果；
 * 2. 分级采用 WHO 2021 建议的 PTA（500/1000/2000/4000 Hz 平均），逐耳计算；
 *    整体分级取较好耳，符合「以好耳定级」的通行做法；
 * 3. 增益采用简化的半增益（half-gain）规则，按 5 dB 量化并限幅，避免过度放大；
 * 4. 频率降低（frequency lowering）参数沿用 openMHA 的 shift/fmin/fmax 形式，
 *    现阶段只写进配置、不在浏览器内执行，留给后续系统级实时处理客户端使用。
 */

import { OCTAVE_FREQUENCIES, PTA_FREQUENCIES } from './frequencies';

/**
 * 标准测听频点（保留导出以兼容旧引用）。
 * 唯一定义在 `frequencies.ts`，避免两份常量漂移。
 */
export const TEST_FREQUENCIES = OCTAVE_FREQUENCIES;

/** 听阈正常上限（dB HL）。 */
export const NORMAL_THRESHOLD_DB = 20;

/**
 * 软拐点：听阈低于该值时按半增益，高于该值后降低斜率（压缩），
 * 避免重度损失时增益被硬上限压平，丢失频段间的差异。
 */
export const SOFT_KNEE_DB = 50;

/** 拐点以下的增益斜率（半增益）。 */
export const HALF_GAIN_SLOPE = 0.5;

/** 拐点以上的增益斜率（压缩段）。 */
export const COMPRESSED_SLOPE = 0.35;

/** 单频最大补偿增益（dB），防止过度放大导致不适与啸叫。 */
export const MAX_GAIN_DB = 30;

/**
 * 频带增益允许的上限（比处方上限高）。
 * 因为整条链带一个负的前置增益，频带需要多补一点才能让最终响应达到处方值。
 */
export const MAX_BAND_GAIN_DB = 40;

/**
 * 补偿频带使用的 Q 值。
 *
 * 不用很窄的 Q：只有 6 个测听频点，窄带会让频点之间出现凹陷；
 * 也不能叠加太多频带——相邻频带的响应会相加，总增益远超设定值。
 * 这里用 6 个频带 + 迭代求解，使实际响应贴合处方目标。
 */
export const EQ_BAND_Q = 1.4;

/** 未能测出听阈时，按最大输出 + 5 dB 估算，用于分级。 */
export const UNMEASURED_LEVEL_DB = 95;

export type Ear = 'LEFT' | 'RIGHT';

export const EARS: Ear[] = ['LEFT', 'RIGHT'];

export const EAR_LABELS: Record<Ear, string> = {
  LEFT: '左耳',
  RIGHT: '右耳',
};

export type GradeKey =
  | 'normal'
  | 'mild'
  | 'moderate'
  | 'moderately_severe'
  | 'severe'
  | 'profound'
  | 'complete';

export interface RawHearingResult {
  frequency: number;
  level: number;
  heard: boolean;
}

export interface FrequencyThreshold {
  frequency: number;
  /** 该频点测得的最低可听强度；null 表示在最大输出下仍未听到。 */
  thresholdDbHl: number | null;
  /** 该频点实际测试到的最大强度，用于前端展示与复核。 */
  maxLevelTestedDbHl: number;
  heardCount: number;
}

export interface EqBand {
  frequency: number;
  gainDb: number;
  q: number;
  type: 'peaking';
}

export interface DynamicSettings {
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

export interface LimiterSettings {
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

/** 单耳补偿参数。左、右耳各一份，允许只有一侧。 */
export interface EarCompensation {
  ear: Ear;
  sourceTestId: string | null;
  generatedAt: string;
  audiogram: FrequencyThreshold[];
  ptaDbHl: number | null;
  grade: { key: GradeKey; label: string };
  eqBands: EqBand[];
  preGainDb: number;
  compressor: DynamicSettings;
  limiter: LimiterSettings;
}

/** 双耳合计配置：桌面端按 LEFT/RIGHT 分别处理左右声道。 */
export interface CompensationConfig {
  version: 1;
  generatedAt: string;
  ears: Record<Ear, EarCompensation | null>;
  overallGrade: { key: GradeKey; label: string };
  frequencyLowering: {
    enabled: boolean;
    shiftHz: number | null;
    fmin: number;
    fmax: number;
    note: string;
  };
  notes: string[];
}

const DEFAULT_COMPRESSOR: DynamicSettings = {
  thresholdDb: -24,
  kneeDb: 12,
  ratio: 2,
  attackMs: 10,
  releaseMs: 250,
};

const DEFAULT_LIMITER: LimiterSettings = {
  thresholdDb: -3,
  ratio: 20,
  attackMs: 3,
  releaseMs: 120,
};

/** 按频点汇总原始作答，得到每个频点的听阈。 */
export function computeThresholds(results: RawHearingResult[]): FrequencyThreshold[] {
  const byFrequency = new Map<number, RawHearingResult[]>();
  for (const result of results) {
    const list = byFrequency.get(result.frequency) ?? [];
    list.push(result);
    byFrequency.set(result.frequency, list);
  }

  return [...byFrequency.keys()]
    .sort((a, b) => a - b)
    .map((frequency) => {
      const list = byFrequency.get(frequency) ?? [];
      const heardLevels = list.filter((item) => item.heard).map((item) => item.level);
      return {
        frequency,
        thresholdDbHl: heardLevels.length ? Math.min(...heardLevels) : null,
        maxLevelTestedDbHl: list.reduce((max, item) => Math.max(max, item.level), 0),
        heardCount: heardLevels.length,
      };
    });
}

/** PTA（500/1000/2000/4000 Hz），未测出频点按 UNMEASURED_LEVEL_DB 计。 */
export function pureToneAverage(thresholds: FrequencyThreshold[]): number | null {
  const ptaFrequencies = PTA_FREQUENCIES;
  const values = ptaFrequencies
    .map((frequency) => thresholds.find((item) => item.frequency === frequency))
    .filter((item): item is FrequencyThreshold => Boolean(item))
    .map((item) => item.thresholdDbHl ?? UNMEASURED_LEVEL_DB);

  if (values.length === 0) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(average * 10) / 10;
}

/** WHO 2021 听力损失分级。 */
export function classifyGrade(pta: number | null): { key: GradeKey; label: string } {
  if (pta === null) return { key: 'normal', label: '未测出有效听阈' };
  if (pta < 20) return { key: 'normal', label: '正常听力' };
  if (pta < 35) return { key: 'mild', label: '轻度听力损失' };
  if (pta < 50) return { key: 'moderate', label: '中度听力损失' };
  if (pta < 65) return { key: 'moderately_severe', label: '中重度听力损失' };
  if (pta < 80) return { key: 'severe', label: '重度听力损失' };
  if (pta < 95) return { key: 'profound', label: '极重度听力损失' };
  return { key: 'complete', label: '全聋' };
}

/**
 * 补偿增益处方（软拐点半增益）：
 *   听阈 ≤ 50 dB 时按半增益；超过 50 dB 后斜率降到 0.35，最高 30 dB。
 *
 * 相比「半增益 + 24 dB 硬截断」，这样能保留重度损失频段之间的差异
 * （例如 57 dB 与 92 dB 不再是同一个增益）。
 */
export function prescribedGainDb(thresholdDbHl: number): number {
  const deficit = Math.max(0, thresholdDbHl - NORMAL_THRESHOLD_DB);
  const kneeDeficit = SOFT_KNEE_DB - NORMAL_THRESHOLD_DB;

  const raw =
    deficit <= kneeDeficit
      ? deficit * HALF_GAIN_SLOPE
      : kneeDeficit * HALF_GAIN_SLOPE + (deficit - kneeDeficit) * COMPRESSED_SLOPE;

  return Math.min(MAX_GAIN_DB, raw);
}

/**
 * 在测听频点之间按对数频率线性插值听阈。
 * 超出测听范围时取端点值（不做外推，避免产生不存在的损失）。
 */
export function interpolateThresholdDb(
  audiogram: FrequencyThreshold[],
  frequency: number,
): number {
  const points = [...audiogram]
    .map((item) => ({ frequency: item.frequency, value: item.thresholdDbHl ?? UNMEASURED_LEVEL_DB }))
    .sort((a, b) => a.frequency - b.frequency);

  if (points.length === 0) return UNMEASURED_LEVEL_DB;

  const first = points[0];
  if (frequency <= first.frequency) return first.value;

  const last = points[points.length - 1];
  if (frequency >= last.frequency) return last.value;

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (frequency >= a.frequency && frequency <= b.frequency) {
      const ratio =
        Math.log2(frequency / a.frequency) / Math.log2(b.frequency / a.frequency);
      return a.value + (b.value - a.value) * ratio;
    }
  }

  return last.value;
}

/**
 * 单个 peaking 滤波器在指定频率处的幅度（dB），与 Web Audio / Rust 实现同源。
 */
function peakingMagnitudeDb(
  sampleRate: number,
  centerFrequency: number,
  gainDb: number,
  q: number,
  frequency: number,
): number {
  const a = Math.pow(10, gainDb / 40);
  const w0 = 2 * Math.PI * Math.min(Math.max(centerFrequency / sampleRate, 1e-6), 0.49);
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(q, 1e-3));

  const a0 = 1 + alpha / a;
  const b0 = (1 + alpha * a) / a0;
  const b1 = (-2 * cosW0) / a0;
  const b2 = (1 - alpha * a) / a0;
  const a1 = (-2 * cosW0) / a0;
  const a2 = (1 - alpha / a) / a0;

  const w = (2 * Math.PI * frequency) / sampleRate;
  const zr = Math.cos(w);
  const zi = -Math.sin(w);
  const z2r = zr * zr - zi * zi;
  const z2i = 2 * zr * zi;

  const numR = b0 + b1 * zr + b2 * z2r;
  const numI = b1 * zi + b2 * z2i;
  const denR = 1 + a1 * zr + a2 * z2r;
  const denI = a1 * zi + a2 * z2i;

  const numerator = Math.hypot(numR, numI);
  const denominator = Math.hypot(denR, denI) || 1e-12;
  return 20 * Math.log10(numerator / denominator);
}

/**
 * 高斯消元解线性方程组（列主元）。
 * 频带数量少（6 段），直接求解比迭代更稳，不会过冲。
 */
function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);

  for (let col = 0; col < size; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (Math.abs(rows[pivot][col]) < 1e-9) continue;

    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];

    const divisor = rows[col][col];
    for (let index = col; index <= size; index += 1) {
      rows[col][index] /= divisor;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = rows[row][col];
      if (factor === 0) continue;
      for (let index = col; index <= size; index += 1) {
        rows[row][index] -= factor * rows[col][index];
      }
    }
  }

  return rows.map((row) => row[size]);
}

/**
 * 求各频带的设定增益，使整条链在各频点的**实际响应**贴近目标处方。
 *
 * 相邻 peaking 滤波器的响应会叠加（dB 相加），若直接把处方值当作每个频带的增益，
 * 合成后就会明显超标（实测可达 70 dB 以上）。这里把关系看成线性方程组
 * `M · g = target` 直接求解，再用残差修正处理 [0, 上限] 的截断。
 */
function solveBandGains(
  targets: number[],
  frequencies: number[],
  q: number,
  sampleRate = 48_000,
  refinements = 4,
): number[] {
  // basis[i][j]：第 j 个频带设 1 dB 时，在第 i 个频点处的响应（dB）
  const basis = frequencies.map((targetFrequency) =>
    frequencies.map((centerFrequency) =>
      peakingMagnitudeDb(sampleRate, centerFrequency, 1, q, targetFrequency),
    ),
  );

  const clamp = (value: number) => Math.min(MAX_BAND_GAIN_DB, Math.max(0, value));

  const toBands = (values: number[]): EqBand[] =>
    frequencies.map((frequency, index) => ({
      frequency,
      gainDb: values[index],
      q,
      type: 'peaking' as const,
    }));

  // 首解：线性模型
  let gains = solveLinearSystem(basis, targets).map(clamp);

  // 残差修正：必须用「真实响应」计算误差。
  // peaking 滤波器的 dB 响应对增益并非严格线性，离线性的成分会让线性解偏大，
  // 若仍用线性模型算残差就修不回来。
  for (let iteration = 0; iteration < refinements; iteration += 1) {
    const bands = toBands(gains);
    const errors = frequencies.map(
      (frequency, index) => targets[index] - compositeResponseDb(bands, 0, frequency, sampleRate),
    );

    if (errors.every((error) => Math.abs(error) < 0.3)) break;

    const correction = solveLinearSystem(basis, errors);
    gains = gains.map((value, index) => clamp(value + correction[index]));
  }

  return gains.map((value) => Math.round(value * 2) / 2);
}

/**
 * 由听力图生成补偿频带（每个测听频点一段）。
 *
 * `preGainDb` 是整条链的前置增益：频带目标会把它抵消掉，
 * 从而保证「最终响应 ≈ 处方增益」，而不是被前置增益整体拉低。
 */
export function buildEqBands(audiogram: FrequencyThreshold[], preGainDb = 0): EqBand[] {
  if (audiogram.length === 0) return [];

  // 用该耳实际测过的频点做频带中心：标准模式 6 段，精细模式 9 段
  const frequencies = audiogram.map((item) => item.frequency).sort((a, b) => a - b);
  const targets = frequencies.map((frequency) =>
    Math.max(
      0,
      prescribedGainDb(interpolateThresholdDb(audiogram, frequency)) - preGainDb,
    ),
  );
  const gains = solveBandGains(targets, frequencies, EQ_BAND_Q);

  return frequencies.map((frequency, index) => ({
    frequency,
    gainDb: gains[index],
    q: EQ_BAND_Q,
    type: 'peaking' as const,
  }));
}

/**
 * 整条 EQ 链在指定频率处**实际**的合成增益（dB，含前置增益）。
 *
 * 这是「有效增益」：把相邻频带的叠加、前置增益都算进去，
 * 与试听/导出听到的效果一致，而不是单个频带的标称增益。
 */
export function compositeResponseDb(
  bands: EqBand[],
  preGainDb: number,
  frequency: number,
  sampleRate = 48_000,
): number {
  let total = 0;
  for (const band of bands) {
    if (band.gainDb === 0) continue;
    total += peakingMagnitudeDb(sampleRate, band.frequency, band.gainDb, band.q, frequency);
  }
  return total + preGainDb;
}

/** 便捷方法：某只耳在指定频率处的有效增益。 */
export function effectiveGainDb(
  ear: EarCompensation,
  frequency: number,
  sampleRate = 48_000,
): number {
  return compositeResponseDb(ear.eqBands, ear.preGainDb, frequency, sampleRate);
}

/** 生成单耳补偿参数。 */
export function buildEarCompensation(input: {
  ear: Ear;
  testId: string | null;
  results: RawHearingResult[];
  now?: Date;
}): EarCompensation {
  const audiogram = computeThresholds(input.results);
  const pta = pureToneAverage(audiogram);

  // 先按处方算出各频点的目标增益，再据此决定前置增益余量
  const measuredFrequencies =
    audiogram.length > 0 ? audiogram.map((item) => item.frequency) : [...OCTAVE_FREQUENCIES];
  const maxTarget = measuredFrequencies.reduce((max, frequency) => {
    const target = prescribedGainDb(interpolateThresholdDb(audiogram, frequency));
    return Math.max(max, target);
  }, 0);
  const preGainDb = maxTarget > 18 ? -6 : 0;
  const eqBands = buildEqBands(audiogram, preGainDb);

  return {
    ear: input.ear,
    sourceTestId: input.testId,
    generatedAt: (input.now ?? new Date()).toISOString(),
    audiogram,
    ptaDbHl: pta,
    grade: classifyGrade(pta),
    eqBands,
    // 增益较高时预留 6 dB 余量，配合限幅器避免削波
    preGainDb,
    compressor: { ...DEFAULT_COMPRESSOR },
    limiter: { ...DEFAULT_LIMITER },
  };
}

function effectivePta(ear: EarCompensation): number {
  return ear.ptaDbHl ?? UNMEASURED_LEVEL_DB;
}

/** 整体分级取较好耳（PTA 更低者），符合「以好耳定级」的通行做法。 */
export function pickOverallGrade(
  ears: Record<Ear, EarCompensation | null>,
): { key: GradeKey; label: string } {
  const candidates = EARS.map((ear) => ears[ear]).filter(
    (item): item is EarCompensation => item !== null,
  );
  if (candidates.length === 0) return { key: 'normal', label: '尚未测听' };

  const best = candidates.reduce((left, right) =>
    effectivePta(left) <= effectivePta(right) ? left : right,
  );
  return best.grade;
}

/**
 * 组装双耳合计配置。
 * 这份 JSON 同时是「浏览器内预览」和「系统级客户端」的共同契约。
 */
export function buildBinauralConfig(
  ears: Record<Ear, EarCompensation | null>,
  now?: Date,
): CompensationConfig {
  const notes = [
    '本结果由网页端纯音自测生成，未做声学校准，仅用于个性化补偿与前后对比，不作为医疗诊断依据。',
    '补偿增益采用简化半增益规则并按 5 dB 量化，单频上限 24 dB。',
    '如出现耳鸣、耳痛或明显不适，请立即停止使用并咨询听力专业人员。',
  ];
  if (!ears.LEFT || !ears.RIGHT) {
    notes.push('尚有单侧听力未测听，未测侧将按「不补偿」处理，建议补测双耳。');
  }

  return {
    version: 1,
    generatedAt: (now ?? new Date()).toISOString(),
    ears,
    overallGrade: pickOverallGrade(ears),
    frequencyLowering: {
      enabled: false,
      shiftHz: null,
      fmin: 1600,
      fmax: 8000,
      note: '频率搬移/压缩需系统级实时处理，当前版本仅在配置中预留参数，不参与浏览器内处理。',
    },
    notes,
  };
}
