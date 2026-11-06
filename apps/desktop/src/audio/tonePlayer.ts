import { ensureAudioReady } from './audioEngine';

const MIN_AMPLITUDE = 0.0005;
const MAX_AMPLITUDE = 0.9;
const MAX_DB_HL = 90;

/** 纯音升降沿时长（秒）。临床要求 50 ms，避免「咔哒」声被误听成刺激。 */
const RISE_FALL = 0.05;

/** 脉冲音的节奏：250 ms 发声 + 250 ms 静音。 */
const PULSE_ON = 0.25;
const PULSE_PERIOD = 0.5;

/** 啭音的调制深度与速率（±5%、5 Hz），与听力计常用的啭音参数接近。 */
const WARBLE_DEPTH = 0.05;
const WARBLE_RATE = 5;

/**
 * 把 dB HL 映射成输出幅度。
 * 注意：浏览器无法做声学校准，这里只是把 0～90 dB HL 映射到可听～接近满量程，
 * 用于相对阈值判定，不等同于临床 dB SPL。
 */
export function dbHlToAmplitude(levelDbHl: number): number {
  const clamped = Math.max(0, Math.min(MAX_DB_HL, levelDbHl));
  return MIN_AMPLITUDE * Math.pow(MAX_AMPLITUDE / MIN_AMPLITUDE, clamped / MAX_DB_HL);
}

/** 播放到哪一侧。测听必须单耳播放，否则好耳会「替」坏耳听到。 */
export type ToneEar = 'LEFT' | 'RIGHT' | 'BOTH';

/** 音型：脉冲纯音用于判阈，连续纯音与啭音用于复验。 */
export type ToneStimulus = 'pulsed' | 'pure' | 'warble';

export interface PlayToneOptions {
  frequency: number;
  levelDbHl: number;
  durationMs?: number;
  ear?: ToneEar;
  stimulus?: ToneStimulus;
  /** 系统音量校准系数（线性），用于适配用户的输出音量。 */
  calibrationGain?: number;
}

let activeOscillator: OscillatorNode | null = null;
let activeLfo: OscillatorNode | null = null;

/** 脉冲音的增益包络：按 250 ms 通断排程。 */
function schedulePulses(
  gain: AudioParam,
  startAt: number,
  duration: number,
  amplitude: number,
): void {
  gain.setValueAtTime(0, startAt);

  for (let offset = 0; offset < duration; offset += PULSE_PERIOD) {
    const onStart = offset;
    const onEnd = Math.min(offset + PULSE_ON, duration);
    const ramp = Math.min(0.015, (onEnd - onStart) / 4);

    gain.setValueAtTime(0, startAt + onStart);
    gain.linearRampToValueAtTime(amplitude, startAt + onStart + ramp);
    gain.setValueAtTime(amplitude, startAt + onEnd - ramp);
    gain.linearRampToValueAtTime(0, startAt + onEnd);
  }
}

/** 播放一段纯音，返回的 Promise 在播放结束后 resolve。 */
export async function playTone({
  frequency,
  levelDbHl,
  durationMs = 1200,
  ear = 'BOTH',
  stimulus = 'pure',
  calibrationGain = 1,
}: PlayToneOptions): Promise<void> {
  const context = await ensureAudioReady();
  stopTone();

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const merger = context.createChannelMerger(2);

  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.value = 0;

  oscillator.connect(gain);

  // 单耳隔离：只写入目标声道，另一声道保持静音
  if (ear === 'LEFT') {
    gain.connect(merger, 0, 0);
  } else if (ear === 'RIGHT') {
    gain.connect(merger, 0, 1);
  } else {
    gain.connect(merger, 0, 0);
    gain.connect(merger, 0, 1);
  }
  merger.connect(context.destination);

  const startAt = context.currentTime;
  const duration = durationMs / 1000;
  const amplitude = dbHlToAmplitude(levelDbHl) * Math.max(0.05, calibrationGain);

  let lfo: OscillatorNode | null = null;
  let depth: GainNode | null = null;

  if (stimulus === 'pulsed') {
    schedulePulses(gain.gain, startAt, duration, amplitude);
  } else {
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(amplitude, startAt + RISE_FALL);
    gain.gain.setValueAtTime(amplitude, startAt + duration - RISE_FALL);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
  }

  if (stimulus === 'warble') {
    lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = WARBLE_RATE;

    depth = context.createGain();
    depth.gain.value = frequency * WARBLE_DEPTH;

    lfo.connect(depth);
    depth.connect(oscillator.frequency);

    lfo.start(startAt);
    lfo.stop(startAt + duration + 0.05);
    activeLfo = lfo;
  }

  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
  activeOscillator = oscillator;

  await new Promise<void>((resolve) => {
    oscillator.onended = () => {
      if (activeOscillator === oscillator) activeOscillator = null;
      if (activeLfo === lfo) activeLfo = null;
      oscillator.disconnect();
      gain.disconnect();
      merger.disconnect();
      lfo?.disconnect();
      depth?.disconnect();
      resolve();
    };
  });
}

export function stopTone(): void {
  const stopNode = (node: OscillatorNode | null) => {
    if (!node) return;
    try {
      node.stop();
    } catch {
      // 已经停止时忽略
    }
  };

  stopNode(activeOscillator);
  stopNode(activeLfo);
  activeOscillator = null;
  activeLfo = null;
}
