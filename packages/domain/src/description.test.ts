import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FrequencyThreshold } from './audiogram';
import { describeHearing } from './description';

function threshold(frequency: number, value: number | null): FrequencyThreshold {
  return {
    frequency,
    thresholdDbHl: value,
    maxLevelTestedDbHl: value ?? 90,
    heardCount: value === null ? 0 : 1,
  };
}

const NORMAL: FrequencyThreshold[] = [
  threshold(250, 15),
  threshold(500, 15),
  threshold(1000, 10),
  threshold(2000, 15),
  threshold(4000, 15),
  threshold(8000, 20),
];

const HIGH_LOSS: FrequencyThreshold[] = [
  threshold(250, 15),
  threshold(500, 20),
  threshold(1000, 25),
  threshold(2000, 35),
  threshold(4000, 60),
  threshold(8000, 70),
];

describe('describeHearing', () => {
  it('没有数据时给出引导', () => {
    const result = describeHearing([]);
    assert.equal(result.headline, '还没有测听数据');
    assert.equal(result.bands.length, 0);
    assert.ok(result.tips.length > 0);
  });

  it('正常听力：三个频段都为 good，并给出基线建议', () => {
    const result = describeHearing(NORMAL);
    assert.equal(result.bands.length, 3);
    assert.ok(result.bands.every((band) => band.severity === 'good'));
    assert.ok(result.tips.some((tip) => tip.includes('基线')));
  });

  it('高频下降：以高频为主，并提示辅音与字幕', () => {
    const result = describeHearing(HIGH_LOSS);
    assert.ok(result.headline.includes('高频'), result.headline);

    const high = result.bands.find((band) => band.key === 'high');
    assert.ok(high);
    assert.equal(high.severity, 'concern');
    assert.ok(result.tips.some((tip) => tip.includes('辅音') || tip.includes('字幕')));
  });

  it('未测出的频点按 95 dB 计，判为明显下降', () => {
    const result = describeHearing([threshold(4000, null), threshold(8000, null)]);
    const high = result.bands.find((band) => band.key === 'high');
    assert.ok(high);
    assert.equal(high.averageDb, 95);
    assert.equal(high.severity, 'concern');
  });

  it('存在明显下降时提示就医', () => {
    const result = describeHearing(HIGH_LOSS);
    assert.ok(result.tips.some((tip) => tip.includes('听力中心')));
  });

  it('低频下降时给出低频相关建议', () => {
    const lowLoss: FrequencyThreshold[] = [
      threshold(250, 55),
      threshold(500, 55),
      threshold(1000, 20),
      threshold(2000, 20),
      threshold(4000, 20),
      threshold(8000, 20),
    ];
    const result = describeHearing(lowLoss);
    assert.ok(result.tips.some((tip) => tip.includes('低频')));
  });
});
