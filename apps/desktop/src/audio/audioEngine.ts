let sharedContext: AudioContext | null = null;

/** 全局单例 AudioContext：浏览器限制同时存在的上下文数量，必须复用。 */
export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error('当前浏览器不支持 Web Audio API，请更换 Chrome / Edge 等现代浏览器');
    sharedContext = new Ctor({ latencyHint: 'interactive' });
  }
  return sharedContext;
}

/** 浏览器要求音频必须由用户手势唤醒。 */
export async function ensureAudioReady(): Promise<AudioContext> {
  const context = getAudioContext();
  if (context.state === 'suspended') {
    await context.resume();
  }
  return context;
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-9));
}
