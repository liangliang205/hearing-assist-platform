import type { CompensationConfig, ProcessingScheme } from '@hearlink/domain';
import { createProcessor } from './enhancementChain';

/**
 * 离线渲染：把整段音频按双耳参数处理后返回新的 AudioBuffer。
 * 与试听走同一套处理链，保证「听到的」和「导出的」一致。
 */
export async function renderEnhancedBuffer(
  buffer: AudioBuffer,
  config: CompensationConfig,
  scheme: ProcessingScheme = 'gain',
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
  const stereo = createProcessor(scheme, context, config);

  const source = context.createBufferSource();
  source.buffer = buffer;

  const merger = context.createChannelMerger(2);
  if (buffer.numberOfChannels >= 2) {
    const splitter = context.createChannelSplitter(2);
    source.connect(splitter);
    splitter.connect(stereo.chains.LEFT.input, 0, 0);
    splitter.connect(stereo.chains.RIGHT.input, 1, 0);
  } else {
    source.connect(stereo.chains.LEFT.input);
    source.connect(stereo.chains.RIGHT.input);
  }

  stereo.chains.LEFT.output.connect(merger, 0, 0);
  stereo.chains.RIGHT.output.connect(merger, 0, 1);
  merger.connect(context.destination);

  source.start();
  const rendered = await context.startRendering();
  stereo.dispose();
  return rendered;
}

/** 把 AudioBuffer 编码为 16-bit PCM WAV。 */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel += 1) {
    channelData.push(buffer.getChannelData(channel));
  }

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface ProcessedFile {
  name: string;
  blob: Blob;
  durationSeconds: number;
}

/** 读取本地音频文件 → 双耳处理 → 输出 WAV。 */
export async function processAudioFile(
  file: File,
  config: CompensationConfig,
  scheme: ProcessingScheme = 'gain',
): Promise<ProcessedFile> {
  const arrayBuffer = await file.arrayBuffer();
  const decodeContext = new AudioContext();
  try {
    const decoded = await decodeContext.decodeAudioData(arrayBuffer);
    const rendered = await renderEnhancedBuffer(decoded, config, scheme);
    return {
      name: `${file.name.replace(/\.[^.]+$/, '')}-增强.wav`,
      blob: encodeWav(rendered),
      durationSeconds: decoded.duration,
    };
  } finally {
    await decodeContext.close();
  }
}

export function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/')) return true;
  return /\.(wav|mp3|flac|ogg|m4a|aac|opus|wma)$/i.test(file.name);
}
