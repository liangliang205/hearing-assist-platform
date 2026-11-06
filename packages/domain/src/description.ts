/**
 * 听力结果的通俗解读。
 *
 * 面向的不是医生，而是用户自己：告诉他「你在哪个频段听不清、这会影响什么」。
 * 严禁输出诊断结论，只描述影响与建议。
 */

import { classifyGrade, type FrequencyThreshold } from './audiogram';

/** 频段划分：低频承载男声基频与环境轰鸣，中频是语音主体，高频是辅音清晰度。 */
export const FREQUENCY_BANDS = [
  { key: 'low', label: '低频', frequencies: [250, 500], impact: '男声的浑厚感、鼓点与环境低频' },
  { key: 'mid', label: '中频', frequencies: [1000, 2000], impact: '日常对话的主体能量，最重要' },
  { key: 'high', label: '高频', frequencies: [4000, 8000], impact: '辅音（s / sh / f / t）与女声、儿童声音' },
] as const;

export type BandKey = (typeof FREQUENCY_BANDS)[number]['key'];

export type Severity = 'good' | 'notice' | 'concern';

export interface BandInsight {
  key: BandKey;
  label: string;
  averageDb: number | null;
  severity: Severity;
  text: string;
}

export interface HearingDescription {
  headline: string;
  bands: BandInsight[];
  tips: string[];
}

function severityOf(averageDb: number): Severity {
  if (averageDb < 25) return 'good';
  if (averageDb < 45) return 'notice';
  return 'concern';
}

const SEVERITY_TEXT: Record<Severity, string> = {
  good: '基本正常',
  notice: '略有下降',
  concern: '明显下降',
};

/** 计算某频段的平均听阈；未测出的频点按 95 dB 计。 */
function bandAverage(audiogram: FrequencyThreshold[], frequencies: readonly number[]): number | null {
  const values = frequencies
    .map((frequency) => audiogram.find((item) => item.frequency === frequency))
    .filter((item): item is FrequencyThreshold => Boolean(item))
    .map((item) => item.thresholdDbHl ?? 95);

  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

/**
 * 由听力图生成通俗说明。
 * 传入的是单耳听力图；双耳对比由调用方展示。
 */
export function describeHearing(audiogram: FrequencyThreshold[]): HearingDescription {
  if (audiogram.length === 0) {
    return {
      headline: '还没有测听数据',
      bands: [],
      tips: ['完成一次纯音自测后，这里会告诉你各频段的听音情况。'],
    };
  }

  const bands: BandInsight[] = FREQUENCY_BANDS.map((band) => {
    const averageDb = bandAverage(audiogram, band.frequencies);
    if (averageDb === null) {
      return {
        key: band.key,
        label: band.label,
        averageDb: null,
        severity: 'good' as Severity,
        text: '该频段未测听',
      };
    }
    const severity = severityOf(averageDb);
    return {
      key: band.key,
      label: band.label,
      averageDb,
      severity,
      text:
        severity === 'good'
          ? `${band.label}基本正常，${band.impact}听得清`
          : `${band.label}${SEVERITY_TEXT[severity]}（平均 ${averageDb} dB），${band.impact}会吃力`,
    };
  });

  const worst = bands
    .filter((band) => band.averageDb !== null)
    .sort((a, b) => (b.averageDb ?? 0) - (a.averageDb ?? 0))[0];

  const overall = classifyGrade(
    (() => {
      const values = bands
        .map((band) => band.averageDb)
        .filter((value): value is number => value !== null);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    })(),
  );

  const headline =
    worst && worst.severity !== 'good'
      ? `整体${overall.label}，以${worst.label}下降为主`
      : `整体${overall.label}`;

  const tips: string[] = [];
  const high = bands.find((band) => band.key === 'high');
  const mid = bands.find((band) => band.key === 'mid');
  const low = bands.find((band) => band.key === 'low');

  if (high && high.severity !== 'good') {
    tips.push('高频下降时，辅音容易听不清，建议配合字幕使用，并在安静环境中交流。');
  }
  if (mid && mid.severity !== 'good') {
    tips.push('中频是语音主体，建议优先使用「声音增强」中的补偿方案，并适当提高音量。');
  }
  if (low && low.severity !== 'good') {
    tips.push('低频下降会让声音变薄，听音乐时可适当提升低频增益，但注意不要过响。');
  }
  if (bands.some((band) => band.severity === 'concern')) {
    tips.push('存在明显听力下降，建议到正规听力中心做一次标准纯音测听，本工具的结果不能替代临床检查。');
  }
  if (tips.length === 0) {
    tips.push('各频段听力基本正常，可保留本次档案作为基线，日后对比使用。');
  }

  return { headline, bands, tips };
}
