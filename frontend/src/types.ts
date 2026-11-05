export type Ear = 'LEFT' | 'RIGHT';

export const EAR_LABELS: Record<Ear, string> = {
  LEFT: '左耳',
  RIGHT: '右耳',
};

export interface User {
  id: string;
  username: string;
  nickname: string | null;
  role: string;
  status: string;
  createdAt: string;
}

export interface HearingResult {
  frequency: number;
  level: number;
  heard: boolean;
}

export type HearingTestStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface HearingTest {
  id: string;
  ear: Ear;
  status: HearingTestStatus;
  deviceNote: string | null;
  startedAt: string;
  finishedAt: string | null;
  resultCount: number;
  results: HearingResult[];
}

export interface FrequencyThreshold {
  frequency: number;
  thresholdDbHl: number | null;
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

/** 单耳补偿参数。 */
export interface EarCompensation {
  ear: Ear;
  sourceTestId: string | null;
  generatedAt: string;
  audiogram: FrequencyThreshold[];
  ptaDbHl: number | null;
  grade: { key: string; label: string };
  eqBands: EqBand[];
  preGainDb: number;
  compressor: DynamicSettings;
  limiter: LimiterSettings;
}

/** 双耳合计配置：左、右声道分别处理。 */
export interface CompensationConfig {
  version: number;
  generatedAt: string;
  ears: Record<Ear, EarCompensation | null>;
  overallGrade: { key: string; label: string };
  frequencyLowering: {
    enabled: boolean;
    shiftHz: number | null;
    fmin: number;
    fmax: number;
    note: string;
  };
  notes: string[];
}

export interface HearingProfile {
  id: string;
  ear: Ear;
  sourceTestId: string | null;
  updatedAt: string;
  config: EarCompensation;
}

export type EarProfileMap = Record<Ear, HearingProfile | null>;

export interface HearingTestPatchResponse {
  test: HearingTest;
  profile?: HearingProfile;
  config?: CompensationConfig | null;
}

export interface ProfileResponse {
  profiles: EarProfileMap;
  config: CompensationConfig;
}
