import type {
  CompensationConfig,
  DynamicSettings,
  Ear,
  EqBand,
  LimiterSettings,
  ProcessingScheme,
} from '@hearlink/domain';
import { dbToLinear, linearToDb } from './audioEngine';

/** 预留的最大频带数量：密集补偿曲线约 20 段，留出余量。 */
const MAX_BANDS = 32;

/** 一条处理链所需的参数，单耳补偿参数（EarCompensation）结构上兼容它。 */
export interface ChainSettings {
  eqBands: EqBand[];
  preGainDb: number;
  compressor: DynamicSettings;
  limiter: LimiterSettings;
}

/** 未测听一侧使用的直通参数：不放大、不压缩。 */
export const NEUTRAL_SETTINGS: ChainSettings = {
  eqBands: [],
  preGainDb: 0,
  compressor: { thresholdDb: -24, kneeDb: 12, ratio: 2, attackMs: 10, releaseMs: 250 },
  limiter: { thresholdDb: -3, ratio: 20, attackMs: 3, releaseMs: 120 },
};

export interface EnhancementChain {
  readonly input: GainNode;
  readonly output: GainNode;
  applySettings(settings: ChainSettings): void;
  measureResponseDb(frequencies: number[]): number[];
  dispose(): void;
}

/**
 * 构建「前置增益 → 多段峰值 EQ → 压缩 → 限幅」的处理链。
 * 与后端补偿参数一一对应，保证浏览器预览与后续桌面端参数一致。
 */
export function createEnhancementChain(
  context: BaseAudioContext,
  initialSettings?: ChainSettings | null,
): EnhancementChain {
  const input = context.createGain();
  const preGain = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const limiter = context.createDynamicsCompressor();
  const output = context.createGain();

  const bands: BiquadFilterNode[] = [];
  for (let index = 0; index < MAX_BANDS; index += 1) {
    const band = context.createBiquadFilter();
    band.type = 'peaking';
    band.frequency.value = 1000;
    band.Q.value = 1;
    band.gain.value = 0;
    bands.push(band);
  }

  input.connect(preGain);
  let cursor: AudioNode = preGain;
  for (const band of bands) {
    cursor.connect(band);
    cursor = band;
  }
  cursor.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(output);

  let currentSettings: ChainSettings | null = null;

  function applySettings(settings: ChainSettings): void {
    currentSettings = settings;
    preGain.gain.value = dbToLinear(settings.preGainDb);

    bands.forEach((band, index) => {
      const target = settings.eqBands[index];
      if (target) {
        band.frequency.value = target.frequency;
        band.Q.value = target.q;
        band.gain.value = target.gainDb;
      } else {
        band.gain.value = 0;
      }
    });

    compressor.threshold.value = settings.compressor.thresholdDb;
    compressor.knee.value = settings.compressor.kneeDb;
    compressor.ratio.value = settings.compressor.ratio;
    compressor.attack.value = settings.compressor.attackMs / 1000;
    compressor.release.value = settings.compressor.releaseMs / 1000;

    limiter.threshold.value = settings.limiter.thresholdDb;
    limiter.knee.value = 0;
    limiter.ratio.value = settings.limiter.ratio;
    limiter.attack.value = settings.limiter.attackMs / 1000;
    limiter.release.value = settings.limiter.releaseMs / 1000;
  }

  /**
   * 用 BiquadFilterNode.getFrequencyResponse 实测整条 EQ 链的幅度响应。
   * 返回值为该频率处的相对增益（dB，已含前置增益）。
   * 注意：压缩/限幅是时变非线性环节，不在频响曲线内。
   */
  function measureResponseDb(frequencies: number[]): number[] {
    const magnitude = new Float32Array(1);
    const phase = new Float32Array(1);
    const preGainDb = currentSettings?.preGainDb ?? 0;

    return frequencies.map((frequency) => {
      let total = 1;
      for (const band of bands) {
        if (band.gain.value === 0) continue;
        band.getFrequencyResponse(new Float32Array([frequency]), magnitude, phase);
        total *= magnitude[0];
      }
      return linearToDb(total) + preGainDb;
    });
  }

  function dispose(): void {
    input.disconnect();
    preGain.disconnect();
    bands.forEach((band) => band.disconnect());
    compressor.disconnect();
    limiter.disconnect();
    output.disconnect();
  }

  if (initialSettings) applySettings(initialSettings);

  return { input, output, applySettings, measureResponseDb, dispose };
}

export interface StereoEnhancementChain {
  readonly chains: Record<Ear, EnhancementChain>;
  applyConfig(config: CompensationConfig): void;
  measureResponseDb(frequencies: number[]): Record<Ear, number[]>;
  dispose(): void;
}

function settingsFor(config: CompensationConfig, ear: Ear): ChainSettings {
  return config.ears[ear] ?? NEUTRAL_SETTINGS;
}

/**
 * 双耳处理链：左声道走左耳参数，右声道走右耳参数；
 * 未测听的一侧自动退化为直通，不会影响另一侧。
 */
export function createStereoChain(
  context: BaseAudioContext,
  initialConfig: CompensationConfig,
): StereoEnhancementChain {
  const left = createEnhancementChain(context, settingsFor(initialConfig, 'LEFT'));
  const right = createEnhancementChain(context, settingsFor(initialConfig, 'RIGHT'));

  return {
    chains: { LEFT: left, RIGHT: right },
    applyConfig(config: CompensationConfig) {
      left.applySettings(settingsFor(config, 'LEFT'));
      right.applySettings(settingsFor(config, 'RIGHT'));
    },
    measureResponseDb(frequencies: number[]) {
      return {
        LEFT: left.measureResponseDb(frequencies),
        RIGHT: right.measureResponseDb(frequencies),
      };
    },
    dispose() {
      left.dispose();
      right.dispose();
    },
  };
}

/** 方案尚未实现时抛出，调用方据此提示用户而不是静默降级。 */
export class SchemeNotImplementedError extends Error {
  constructor(readonly scheme: ProcessingScheme) {
    super(`处理方案「${scheme}」尚未实现`);
    this.name = 'SchemeNotImplementedError';
  }
}

/**
 * 处理器的统一入口：按方案创建处理链。
 *
 * 方案一（gain）直接返回双耳增益补偿链；
 * 方案二（frequencyLowering）是 v0.2 的接入点——实现时在这里返回
 * 同样满足 `StereoEnhancementChain` 接口的对象即可，调用方（试听、文件导出、
 * 未来的系统级处理）都不需要改动。
 */
export function createProcessor(
  scheme: ProcessingScheme,
  context: BaseAudioContext,
  config: CompensationConfig,
): StereoEnhancementChain {
  switch (scheme) {
    case 'gain':
      return createStereoChain(context, config);
    case 'frequencyLowering':
      // TODO(v0.2)：STFT/滤波器组搬移，输出仍为 StereoEnhancementChain
      throw new SchemeNotImplementedError(scheme);
    default: {
      const exhaustive: never = scheme;
      throw new Error(`未知处理方案：${String(exhaustive)}`);
    }
  }
}
