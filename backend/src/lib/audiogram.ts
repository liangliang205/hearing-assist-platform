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

/** 测听频点：按倍频程排列，覆盖语音主要能量区与高频辅音区。 */
export const TEST_FREQUENCIES = [250, 500, 1000, 2000, 4000, 8000] as const;

/** 听阈正常上限（dB HL）。 */
export const NORMAL_THRESHOLD_DB = 20;

/** 单频最大补偿增益（dB），防止过度放大导致不适与啸叫。 */
export const MAX_GAIN_DB = 24;

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
  const ptaFrequencies = [500, 1000, 2000, 4000];
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
 * 由听阈生成补偿增益曲线（半增益规则）：
 *   gain = clamp( (threshold - 20) * 0.5 , 0, 24 )，按 5 dB 量化。
 * 即听力损失越重、补偿越多；正常听力不加增益，避免无谓放大噪声。
 */
export function buildEqBands(thresholds: FrequencyThreshold[]): EqBand[] {
  return thresholds
    .filter((item) => item.thresholdDbHl !== null || item.heardCount === 0)
    .map((item) => {
      const threshold = item.thresholdDbHl ?? UNMEASURED_LEVEL_DB;
      const deficit = Math.max(0, threshold - NORMAL_THRESHOLD_DB);
      const rawGain = deficit * 0.5;
      const gainDb = Math.min(MAX_GAIN_DB, Math.round(rawGain / 5) * 5);
      return {
        frequency: item.frequency,
        gainDb,
        q: 1,
        type: 'peaking' as const,
      };
    });
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
  const eqBands = buildEqBands(audiogram);
  const maxGain = eqBands.reduce((max, band) => Math.max(max, band.gainDb), 0);

  return {
    ear: input.ear,
    sourceTestId: input.testId,
    generatedAt: (input.now ?? new Date()).toISOString(),
    audiogram,
    ptaDbHl: pta,
    grade: classifyGrade(pta),
    eqBands,
    // 最大增益较高时预留 6 dB 余量，配合限幅器避免削波
    preGainDb: maxGain > 12 ? -6 : 0,
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
