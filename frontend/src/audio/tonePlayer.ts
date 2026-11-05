import { ensureAudioReady } from './audioEngine';

const MIN_AMPLITUDE = 0.0005;
const MAX_AMPLITUDE = 0.9;
const MAX_DB_HL = 90;

/**
 * 把 dB HL 映射成输出幅度。
 * 注意：浏览器无法做声学校准，这里只是把 0～90 dB HL 映射到可听～接近满量程，
 * 用于相对阈值判定，不等同于临床 dB SPL。
 */
export function dbHlToAmplitude(levelDbHl: number): number {
  const clamped = Math.max(0, Math.min(MAX_DB_HL, levelDbHl));
  return MIN_AMPLITUDE * Math.pow(MAX_AMPLITUDE / MIN_AMPLITUDE, clamped / MAX_DB_HL);
}

let activeOscillator: OscillatorNode | null = null;

export interface PlayToneOptions {
  frequency: number;
  levelDbHl: number;
  durationMs?: number;
}

/** 播放一段纯音，返回的 Promise 在播放结束后 resolve。 */
export async function playTone({ frequency, levelDbHl, durationMs = 1200 }: PlayToneOptions): Promise<void> {
  const context = await ensureAudioReady();
  stopTone();

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.value = 0;

  oscillator.connect(gain);
  gain.connect(context.destination);

  const startAt = context.currentTime;
  const duration = durationMs / 1000;
  const fade = 0.02;
  const amplitude = dbHlToAmplitude(levelDbHl);

  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(amplitude, startAt + fade);
  gain.gain.setValueAtTime(amplitude, startAt + duration - fade);
  gain.gain.linearRampToValueAtTime(0, startAt + duration);

  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
  activeOscillator = oscillator;

  await new Promise<void>((resolve) => {
    oscillator.onended = () => {
      if (activeOscillator === oscillator) activeOscillator = null;
      oscillator.disconnect();
      gain.disconnect();
      resolve();
    };
  });
}

export function stopTone(): void {
  if (!activeOscillator) return;
  try {
    activeOscillator.stop();
  } catch {
    // 已经停止时忽略
  }
  activeOscillator = null;
}
