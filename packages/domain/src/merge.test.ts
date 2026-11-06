import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EarCompensation } from './audiogram';
import { planEarMerge } from './merge';

/** 只关心 generatedAt 的最小补偿对象。 */
function compensation(generatedAt: string): EarCompensation {
  return { generatedAt } as EarCompensation;
}

describe('planEarMerge（双耳合并策略）', () => {
  it('云端更新时从云端拉取', () => {
    const plan = planEarMerge(
      { LEFT: compensation('2026-01-01T00:00:00.000Z') },
      { LEFT: compensation('2026-02-01T00:00:00.000Z') },
    );
    assert.deepEqual(plan.pull, ['LEFT']);
    assert.deepEqual(plan.push, []);
  });

  it('本机更新时上传', () => {
    const plan = planEarMerge(
      { RIGHT: compensation('2026-03-01T00:00:00.000Z') },
      { RIGHT: compensation('2026-02-01T00:00:00.000Z') },
    );
    assert.deepEqual(plan.push, ['RIGHT']);
    assert.deepEqual(plan.pull, []);
  });

  it('只有云端有数据时拉取', () => {
    const plan = planEarMerge({}, { LEFT: compensation('2026-01-01T00:00:00.000Z') });
    assert.deepEqual(plan.pull, ['LEFT']);
  });

  it('只有本机有数据时上传', () => {
    const plan = planEarMerge({ RIGHT: compensation('2026-01-01T00:00:00.000Z') }, {});
    assert.deepEqual(plan.push, ['RIGHT']);
  });

  it('两侧都没有时不做任何操作', () => {
    const plan = planEarMerge({}, {});
    assert.deepEqual(plan.pull, []);
    assert.deepEqual(plan.push, []);
  });

  it('时间相同视为本机为准，避免反复拉取', () => {
    const same = '2026-01-01T00:00:00.000Z';
    const plan = planEarMerge({ LEFT: compensation(same) }, { LEFT: compensation(same) });
    assert.deepEqual(plan.push, ['LEFT']);
    assert.deepEqual(plan.pull, []);
  });

  it('左右耳可以分别走拉取与上传', () => {
    const plan = planEarMerge(
      {
        LEFT: compensation('2026-01-01T00:00:00.000Z'),
        RIGHT: compensation('2026-05-01T00:00:00.000Z'),
      },
      {
        LEFT: compensation('2026-04-01T00:00:00.000Z'),
        RIGHT: compensation('2026-02-01T00:00:00.000Z'),
      },
    );
    assert.deepEqual(plan.pull, ['LEFT']);
    assert.deepEqual(plan.push, ['RIGHT']);
  });

  it('时间无法解析时以本机为准', () => {
    const plan = planEarMerge(
      { LEFT: compensation('not-a-date') },
      { LEFT: compensation('2026-01-01T00:00:00.000Z') },
    );
    assert.deepEqual(plan.push, ['LEFT']);
  });
});
