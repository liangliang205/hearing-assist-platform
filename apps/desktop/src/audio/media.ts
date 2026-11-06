import type { StereoEnhancementChain } from './enhancementChain';

/** 生成对数扫频测试音（默认 100 Hz → 8 kHz），便于在无外部素材时验证补偿效果。 */
export function createSweepBuffer(
  context: BaseAudioContext,
  options?: { seconds?: number; startHz?: number; endHz?: number; amplitude?: number },
): AudioBuffer {
  const seconds = options?.seconds ?? 6;
  const startHz = options?.startHz ?? 100;
  const endHz = options?.endHz ?? 8000;
  const amplitude = options?.amplitude ?? 0.35;

  const sampleRate = context.sampleRate;
  const length = Math.floor(seconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  const ratio = Math.log(endHz / startHz);
  const attackSamples = Math.floor(0.02 * sampleRate);
  const releaseSamples = Math.floor(0.05 * sampleRate);
  let phase = 0;

  for (let index = 0; index < length; index += 1) {
    const progress = index / length;
    const frequency = startHz * Math.exp(ratio * progress);
    phase += (2 * Math.PI * frequency) / sampleRate;

    const attack = Math.min(1, index / attackSamples);
    const release = Math.min(1, (length - index) / releaseSamples);
    data[index] = amplitude * Math.sin(phase) * attack * release;
  }

  return buffer;
}

export async function decodeAudioFile(context: AudioContext, file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return context.decodeAudioData(arrayBuffer);
}

export interface PlaybackController {
  stop(): void;
  setEnhanced(enabled: boolean): void;
}

/**
 * 播放一段音频，并在「原音」与「双耳增强」之间切换。
 * 立体声素材按声道拆分：左声道 → 左耳链，右声道 → 右耳链；
 * 单声道素材同时送入两条链，保证扫频测试音也能听出左右耳差异。
 */
export function playBufferThroughStereoChain(
  context: AudioContext,
  buffer: AudioBuffer,
  stereo: StereoEnhancementChain,
  options?: { enhanced?: boolean; loop?: boolean; onEnded?: () => void },
): PlaybackController {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = options?.loop ?? false;

  const dry = context.createGain();
  const wet = context.createGain();
  const merger = context.createChannelMerger(2);
  const left = stereo.chains.LEFT;
  const right = stereo.chains.RIGHT;

  const enhanced = options?.enhanced ?? false;
  dry.gain.value = enhanced ? 0 : 1;
  wet.gain.value = enhanced ? 1 : 0;

  let splitter: ChannelSplitterNode | null = null;
  if (buffer.numberOfChannels >= 2) {
    splitter = context.createChannelSplitter(2);
    source.connect(splitter);
    splitter.connect(left.input, 0, 0);
    splitter.connect(right.input, 1, 0);
  } else {
    source.connect(left.input);
    source.connect(right.input);
  }

  left.output.connect(merger, 0, 0);
  right.output.connect(merger, 0, 1);

  merger.connect(wet);
  wet.connect(context.destination);
  source.connect(dry);
  dry.connect(context.destination);

  source.onended = () => {
    options?.onEnded?.();
  };

  source.start();

  return {
    setEnhanced(next: boolean) {
      const now = context.currentTime;
      dry.gain.setTargetAtTime(next ? 0 : 1, now, 0.02);
      wet.gain.setTargetAtTime(next ? 1 : 0, now, 0.02);
    },
    stop() {
      try {
        source.stop();
      } catch {
        // 已停止则忽略
      }
      source.disconnect();
      splitter?.disconnect();
      left.output.disconnect();
      right.output.disconnect();
      merger.disconnect();
      dry.disconnect();
      wet.disconnect();
    },
  };
}
