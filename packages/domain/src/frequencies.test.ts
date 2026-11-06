import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clinicalOrder,
  EXTENDED_FREQUENCIES,
  frequenciesFor,
  normalizeFrequencies,
  OCTAVE_FREQUENCIES,
  PTA_FREQUENCIES,
  TEST_FREQUENCY_SETS,
} from './frequencies';

describe('测听频点', () => {
  it('标准模式为 6 个倍频程频点', () => {
    assert.equal(OCTAVE_FREQUENCIES.length, 6);
    assert.deepEqual([...OCTAVE_FREQUENCIES], [250, 500, 1000, 2000, 4000, 8000]);
  });

  it('精细模式为 9 个频点，包含 125 / 3000 / 6000', () => {
    assert.equal(EXTENDED_FREQUENCIES.length, 9);
    assert.ok(EXTENDED_FREQUENCIES.includes(125));
    assert.ok(EXTENDED_FREQUENCIES.includes(3000));
    assert.ok(EXTENDED_FREQUENCIES.includes(6000));
  });

  it('精细模式是标准模式的超集，且升序', () => {
    for (const frequency of OCTAVE_FREQUENCIES) {
      assert.ok(EXTENDED_FREQUENCIES.includes(frequency), `缺少 ${frequency}`);
    }
    const sorted = [...EXTENDED_FREQUENCIES].sort((a, b) => a - b);
    assert.deepEqual([...EXTENDED_FREQUENCIES], sorted);
  });

  it('PTA 频点固定为 500/1k/2k/4k', () => {
    assert.deepEqual([...PTA_FREQUENCIES], [500, 1000, 2000, 4000]);
  });

  it('frequenciesFor 按模式返回对应频点', () => {
    assert.deepEqual([...frequenciesFor('standard')], [...OCTAVE_FREQUENCIES]);
    assert.deepEqual([...frequenciesFor('extended')], [...EXTENDED_FREQUENCIES]);
  });

  it('每个模式都提供界面所需的元信息', () => {
    assert.equal(TEST_FREQUENCY_SETS.length, 2);
    for (const option of TEST_FREQUENCY_SETS) {
      assert.ok(option.label.length > 0);
      assert.ok(option.description.length > 0);
      assert.ok(option.estimatedMinutes > 0);
      assert.ok(option.frequencies.length > 0);
    }
  });

  it('normalizeFrequencies 去重并升序', () => {
    assert.deepEqual(normalizeFrequencies([4000, 250, 1000, 250]), [250, 1000, 4000]);
  });
});

describe('clinicalOrder（临床测听顺序）', () => {
  it('从 1000 Hz 起测，再测高频，最后测低频', () => {
    assert.deepEqual(clinicalOrder(OCTAVE_FREQUENCIES), [1000, 2000, 4000, 8000, 500, 250]);
  });

  it('精细模式同样以 1000 Hz 起始，低频倒序', () => {
    assert.deepEqual(clinicalOrder(EXTENDED_FREQUENCIES), [
      1000, 2000, 3000, 4000, 6000, 8000, 500, 250, 125,
    ]);
  });

  it('不修改传入数组，且包含全部频点', () => {
    const source = [...EXTENDED_FREQUENCIES];
    const ordered = clinicalOrder(source);
    assert.deepEqual(source, [...EXTENDED_FREQUENCIES]);
    assert.equal(ordered.length, EXTENDED_FREQUENCIES.length);
    assert.deepEqual([...ordered].sort((a, b) => a - b), [...EXTENDED_FREQUENCIES]);
  });

  it('单个频点也能处理', () => {
    assert.deepEqual(clinicalOrder([4000]), [4000]);
  });
});
