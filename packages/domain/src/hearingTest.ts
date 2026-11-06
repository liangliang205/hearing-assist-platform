/**
 * 纯音测听的阶梯法（纯函数状态机）。
 *
 * 参考 Hughson–Westlake 的简化流程：
 *   1. 从 40 dB HL 起测；
 *   2. 听到 → 降 10 dB；未听到 → 升 5 dB；
 *   3. 上升后在某强度首次听到，视为「候选听阈」，再重放确认一次；
 *      同一强度听到两次（2 次呈现）才判定为听阈；
 *   4. 降到 -10 dB 以下或升到 90 dB 仍未听到，按已听到的最低值 / 未测出处理。
 *
 * 这样比「第一次出现 5 dB 包夹就结束」更稳，能过滤偶发误触。
 *
 * 测听频点见 `frequencies.ts`（标准 6 点 / 精细 9 点）。
 */

export const START_LEVEL_DB = 40;
export const MAX_LEVEL_DB = 90;
export const MIN_LEVEL_DB = -10;

/** 单个频点的最大呈现次数，防止异常状态下死循环。 */
export const MAX_PRESENTATIONS = 20;

/** 判定听阈所需的「听到」确认次数。 */
export const REQUIRED_CONFIRMATIONS = 2;

export interface TestAnswer {
  level: number;
  heard: boolean;
}

/**
 * 测听音型。
 *
 * 临床上判阈一般用脉冲纯音（断续出现，便于与耳鸣区分）；
 * 连续纯音更难察觉，啭音介于两者之间，后两者用于复验阈值是否可靠。
 */
export type StimulusType = 'pulsed' | 'pure' | 'warble';

export const STIMULUS_LABELS: Record<StimulusType, string> = {
  pulsed: '脉冲纯音',
  pure: '连续纯音',
  warble: '啭音',
};

export const STIMULUS_HINTS: Record<StimulusType, string> = {
  pulsed: '断续的「嘀—嘀—」，临床判阈常用',
  pure: '持续平稳的「嘟——」，最难察觉',
  warble: '音高轻微起伏的「呜——」，介于两者之间',
};

/** 判阈阶段固定使用的音型。 */
export const THRESHOLD_STIMULUS: StimulusType = 'pulsed';

/** 复验阶段依次播放的音型（在判出的阈值上再确认）。 */
export const VERIFICATION_STIMULI: StimulusType[] = ['pure', 'warble'];

/** 复验的最多尝试次数，防止在强噪声环境下无限重试。 */
export const MAX_VERIFICATION_ATTEMPTS = 6;

export interface VerificationState {
  frequency: number;
  level: number;
  /** 当前要播放的音型下标。 */
  index: number;
  attempts: number;
  results: Array<{ stimulus: StimulusType; level: number; heard: boolean }>;
  done: boolean;
  threshold: number | null;
}

export function createVerification(
  frequency: number,
  threshold: number | null,
): VerificationState {
  return {
    frequency,
    level: threshold ?? MAX_LEVEL_DB,
    index: 0,
    attempts: 0,
    results: [],
    done: threshold === null,
    threshold,
  };
}

export function currentVerificationStimulus(state: VerificationState): StimulusType {
  return VERIFICATION_STIMULI[state.index] ?? VERIFICATION_STIMULI[0];
}

/**
 * 复验一次作答。
 *
 * - 听到：换下一种音型；两种音型都听到 → 阈值确认。
 * - 没听到：阈值上调 5 dB，从第一种音型重新开始（脉冲音听得见、连续音听不见，
 *   说明真实阈值略高于判阈结果）。
 * - 升到上限仍听不到，或尝试次数用尽 → 记为未测出。
 */
export function answerVerification(state: VerificationState, heard: boolean): VerificationState {
  if (state.done) return state;

  const stimulus = currentVerificationStimulus(state);
  const results = [...state.results, { stimulus, level: state.level, heard }];
  const attempts = state.attempts + 1;

  if (heard) {
    const nextIndex = state.index + 1;
    if (nextIndex >= VERIFICATION_STIMULI.length) {
      return { ...state, results, attempts, index: 0, done: true, threshold: state.level };
    }
    return { ...state, results, attempts, index: nextIndex };
  }

  if (state.level >= MAX_LEVEL_DB || attempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { ...state, results, attempts, done: true, threshold: null };
  }

  return { ...state, results, attempts, index: 0, level: state.level + 5 };
}

export interface StaircaseState {
  frequency: number;
  /** 下一次播放的强度。 */
  level: number;
  presentations: number;
  answered: TestAnswer[];
  heardLevels: number[];
  notHeardLevels: number[];
  /** 上升后进入的候选强度；非空表示正在确认。 */
  pendingConfirm: number | null;
  /** 候选强度上已确认的次数。 */
  confirmCount: number;
  threshold: number | null;
  done: boolean;
}

export function createStaircase(frequency: number, startLevel = START_LEVEL_DB): StaircaseState {
  return {
    frequency,
    level: startLevel,
    presentations: 0,
    answered: [],
    heardLevels: [],
    notHeardLevels: [],
    pendingConfirm: null,
    confirmCount: 0,
    threshold: null,
    done: false,
  };
}

function finish(state: StaircaseState, threshold: number | null): StaircaseState {
  return { ...state, threshold, done: true };
}

/**
 * 记录一次作答，返回新的状态。
 * `state.level` 是本次播放的强度，调用方需在播放后调用本函数。
 */
export function answerStaircase(state: StaircaseState, heard: boolean): StaircaseState {
  if (state.done) return state;

  const level = state.level;
  const answered = [...state.answered, { level, heard }];
  const presentations = state.presentations + 1;
  const heardLevels = heard ? [...state.heardLevels, level] : state.heardLevels;
  const notHeardLevels = heard ? state.notHeardLevels : [...state.notHeardLevels, level];

  const base: StaircaseState = {
    ...state,
    answered,
    presentations,
    heardLevels,
    notHeardLevels,
  };

  if (presentations >= MAX_PRESENTATIONS) {
    const threshold = heardLevels.length ? Math.min(...heardLevels) : null;
    return finish(base, threshold);
  }

  if (heard) {
    // 正在确认候选听阈
    if (base.pendingConfirm === level) {
      const confirmCount = base.confirmCount + 1;
      if (confirmCount >= REQUIRED_CONFIRMATIONS) {
        return finish({ ...base, confirmCount }, level);
      }
      // 需要再确认一次：同一强度重放
      return { ...base, confirmCount };
    }

    // 正常下行 10 dB
    const nextLevel = level - 10;
    if (nextLevel < MIN_LEVEL_DB) {
      return finish(base, Math.min(...heardLevels));
    }
    return { ...base, level: nextLevel, pendingConfirm: null, confirmCount: 0 };
  }

  // 未听到：上行 5 dB，并在到达的强度上等待确认
  const nextLevel = level + 5;
  if (nextLevel > MAX_LEVEL_DB) {
    const threshold = heardLevels.length ? Math.min(...heardLevels) : null;
    return finish(base, threshold);
  }
  return { ...base, level: nextLevel, pendingConfirm: nextLevel, confirmCount: 0 };
}

/** 是否为「上升阶段」（上一次未听到）。用于界面提示。 */
export function isAscending(state: StaircaseState): boolean {
  const last = state.answered[state.answered.length - 1];
  return last ? !last.heard : false;
}

/** 依据已作答的数据，估算当前频点还需几次呈现（仅用于进度展示）。 */
export function estimatedRemaining(state: StaircaseState): number {
  if (state.done) return 0;
  return Math.max(1, MAX_PRESENTATIONS - state.presentations);
}
