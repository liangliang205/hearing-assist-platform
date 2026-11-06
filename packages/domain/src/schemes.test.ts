import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FrequencyThreshold } from './audiogram';
import {
  getScheme,
  isSchemeAvailable,
  planFrequencyLowering,
  PROCESSING_SCHEMES,
} from './schemes';

function threshold(frequency: number, value: number | null): FrequencyThreshold {
  return {
    frequency,
    thresholdDbHl: value,
    maxLevelTestedDbHl: value ?? 90,
    heardCount: value === null ? 0 : 1,
  };
}

describe('PROCESSING_SCHEMES', () => {
  it('提供两个方案，都已可用', () => {
    assert.equal(PROCESSING_SCHEMES.length, 2);

    const gain = getScheme('gain');
    assert.equal(gain.available, true);

    const lowering = getScheme('frequencyLowering');
    assert.equal(lowering.available, true);
    assert.ok(lowering.plannedNote, '方案二应说明浏览器试听仍按方案一处理');
  });

  it('isSchemeAvailable 与定义一致', () => {
    assert.equal(isSchemeAvailable('gain'), true);
    assert.equal(isSchemeAvailable('frequencyLowering'), true);
  });

  it('未知方案抛错', () => {
    // @ts-expect-error 故意传入非法值
    assert.throws(() => getScheme('unknown'), /未知处理方案/);
  });
});

describe('planFrequencyLowering', () => {
  it('以第一个明显下降的频点作为起始频率', () => {
    const plan = planFrequencyLowering([
      threshold(250, 15),
      threshold(500, 20),
      threshold(1000, 30),
      threshold(2000, 45),
      threshold(4000, 70),
      threshold(8000, 80),
    ]);

    assert.equal(plan.implemented, false);
    assert.equal(plan.fmin, 2000);
    assert.equal(plan.fmax, 8000);
    assert.equal(plan.shiftHz, null);
    assert.ok(plan.reason.includes('2000 Hz'));
  });

  it('未测出的频点按明显下降处理', () => {
    const plan = planFrequencyLowering([
      threshold(250, 20),
      threshold(500, 20),
      threshold(1000, 20),
      threshold(2000, 20),
      threshold(4000, null),
      threshold(8000, null),
    ]);
    assert.equal(plan.fmin, 4000);
  });

  it('没有明显下降时按 4000 Hz 预留', () => {
    const plan = planFrequencyLowering([
      threshold(500, 15),
      threshold(1000, 20),
      threshold(2000, 25),
      threshold(4000, 30),
    ]);
    assert.equal(plan.fmin, 4000);
    assert.ok(plan.reason.includes('未发现'));
  });

  it('参数规划不返回可用位移量（由引擎按半带宽推导）', () => {
    const plan = planFrequencyLowering([threshold(4000, 80)]);
    assert.equal(plan.shiftHz, null);
    assert.equal(plan.strategy, 'bandShift');
    assert.ok(plan.note.includes('桌面引擎'));
  });
});
