import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBinauralConfig,
  buildEarCompensation,
  buildEqBands,
  classifyGrade,
  computeThresholds,
  pickOverallGrade,
  pureToneAverage,
  type RawHearingResult,
} from './audiogram';

const RIGHT_EAR_RESULTS: RawHearingResult[] = [
  { frequency: 500, level: 60, heard: true },
  { frequency: 1000, level: 30, heard: true },
  { frequency: 2000, level: 50, heard: true },
  { frequency: 4000, level: 70, heard: true },
  { frequency: 8000, level: 90, heard: false },
];

const LEFT_EAR_RESULTS: RawHearingResult[] = [
  { frequency: 500, level: 25, heard: true },
  { frequency: 1000, level: 20, heard: true },
  { frequency: 2000, level: 25, heard: true },
  { frequency: 4000, level: 30, heard: true },
];

describe('computeThresholds', () => {
  it('取每个频点最低的「听到」强度作为听阈', () => {
    const results: RawHearingResult[] = [
      { frequency: 1000, level: 40, heard: true },
      { frequency: 1000, level: 30, heard: true },
      { frequency: 1000, level: 20, heard: false },
      { frequency: 4000, level: 90, heard: false },
    ];
    const thresholds = computeThresholds(results);

    assert.equal(thresholds.length, 2);
    assert.equal(thresholds[0].frequency, 1000);
    assert.equal(thresholds[0].thresholdDbHl, 30);
    assert.equal(thresholds[0].heardCount, 2);
    assert.equal(thresholds[1].frequency, 4000);
    assert.equal(thresholds[1].thresholdDbHl, null);
    assert.equal(thresholds[1].maxLevelTestedDbHl, 90);
  });

  it('按频率升序排列', () => {
    const thresholds = computeThresholds([
      { frequency: 8000, level: 50, heard: true },
      { frequency: 250, level: 20, heard: true },
    ]);
    assert.deepEqual(
      thresholds.map((item) => item.frequency),
      [250, 8000],
    );
  });
});

describe('pureToneAverage', () => {
  it('对 500/1k/2k/4k 求平均', () => {
    const thresholds = computeThresholds([
      { frequency: 500, level: 40, heard: true },
      { frequency: 1000, level: 50, heard: true },
      { frequency: 2000, level: 60, heard: true },
      { frequency: 4000, level: 70, heard: true },
      { frequency: 250, level: 10, heard: true },
    ]);
    assert.equal(pureToneAverage(thresholds), 55);
  });

  it('未测出的频点按 95 dB 计入，避免低估损失程度', () => {
    const thresholds = computeThresholds([
      { frequency: 500, level: 40, heard: true },
      { frequency: 1000, level: 50, heard: true },
      { frequency: 2000, level: 60, heard: true },
      { frequency: 4000, level: 90, heard: false },
    ]);
    // (40 + 50 + 60 + 95) / 4 = 61.25 → 保留一位小数
    assert.equal(pureToneAverage(thresholds), 61.3);
  });

  it('没有 PTA 频点时返回 null', () => {
    const thresholds = computeThresholds([{ frequency: 250, level: 30, heard: true }]);
    assert.equal(pureToneAverage(thresholds), null);
  });
});

describe('classifyGrade（WHO 2021 边界）', () => {
  const cases: Array<[number, string]> = [
    [19.9, 'normal'],
    [20, 'mild'],
    [34.9, 'mild'],
    [35, 'moderate'],
    [49.9, 'moderate'],
    [50, 'moderately_severe'],
    [65, 'severe'],
    [80, 'profound'],
    [95, 'complete'],
  ];

  for (const [pta, expected] of cases) {
    it(`PTA=${pta} → ${expected}`, () => {
      assert.equal(classifyGrade(pta).key, expected);
    });
  }

  it('null 不抛异常', () => {
    assert.equal(classifyGrade(null).key, 'normal');
  });
});

describe('buildEqBands（半增益规则）', () => {
  it('正常听力不加增益', () => {
    const thresholds = computeThresholds([{ frequency: 1000, level: 15, heard: true }]);
    assert.equal(buildEqBands(thresholds)[0].gainDb, 0);
  });

  it('60 dB HL → (60-20)*0.5 = 20 dB', () => {
    const thresholds = computeThresholds([{ frequency: 2000, level: 60, heard: true }]);
    assert.equal(buildEqBands(thresholds)[0].gainDb, 20);
  });

  it('按 5 dB 量化：55 dB HL → 17.5 → 取整到 20', () => {
    const thresholds = computeThresholds([{ frequency: 3000, level: 55, heard: true }]);
    assert.equal(buildEqBands(thresholds)[0].gainDb, 20);
  });

  it('单频增益上限 24 dB', () => {
    const thresholds = computeThresholds([{ frequency: 8000, level: 90, heard: false }]);
    assert.equal(buildEqBands(thresholds)[0].gainDb, 24);
  });
});

describe('buildEarCompensation', () => {
  it('记录耳别与来源自测', () => {
    const right = buildEarCompensation({ ear: 'RIGHT', testId: 'test-r', results: RIGHT_EAR_RESULTS });
    const left = buildEarCompensation({ ear: 'LEFT', testId: 'test-l', results: LEFT_EAR_RESULTS });

    assert.equal(right.ear, 'RIGHT');
    assert.equal(right.sourceTestId, 'test-r');
    assert.equal(left.ear, 'LEFT');
    assert.equal(left.ptaDbHl, 25);
    assert.equal(left.grade.key, 'mild');
  });

  it('左右耳各自独立计算，互不影响', () => {
    const right = buildEarCompensation({ ear: 'RIGHT', testId: null, results: RIGHT_EAR_RESULTS });
    const left = buildEarCompensation({ ear: 'LEFT', testId: null, results: LEFT_EAR_RESULTS });

    assert.ok(right.ptaDbHl !== left.ptaDbHl);
    assert.notDeepEqual(
      right.eqBands.map((band) => band.gainDb),
      left.eqBands.map((band) => band.gainDb),
    );
  });

  it('最大增益 > 12 dB 时预留 -6 dB 前置增益', () => {
    const right = buildEarCompensation({ ear: 'RIGHT', testId: null, results: RIGHT_EAR_RESULTS });
    assert.ok(Math.max(...right.eqBands.map((band) => band.gainDb)) > 12);
    assert.equal(right.preGainDb, -6);
  });

  it('全部正常时不预留前置增益', () => {
    const normal = buildEarCompensation({
      ear: 'LEFT',
      testId: null,
      results: [{ frequency: 1000, level: 10, heard: true }],
    });
    assert.equal(normal.preGainDb, 0);
    assert.equal(normal.grade.key, 'normal');
  });
});

describe('buildBinauralConfig', () => {
  const right = buildEarCompensation({ ear: 'RIGHT', testId: 'r', results: RIGHT_EAR_RESULTS });
  const left = buildEarCompensation({ ear: 'LEFT', testId: 'l', results: LEFT_EAR_RESULTS });

  it('双耳配置同时包含左右参数', () => {
    const config = buildBinauralConfig({ LEFT: left, RIGHT: right });
    assert.equal(config.version, 1);
    assert.equal(config.ears.LEFT?.ear, 'LEFT');
    assert.equal(config.ears.RIGHT?.ear, 'RIGHT');
    assert.equal(config.notes.some((note) => note.includes('单侧')), false);
  });

  it('整体分级取较好耳', () => {
    const config = buildBinauralConfig({ LEFT: left, RIGHT: right });
    // 左耳 PTA 25（轻度）优于右耳 PTA 52.5（中重度）
    assert.equal(config.overallGrade.key, 'mild');
  });

  it('只有单耳时提示补测', () => {
    const config = buildBinauralConfig({ LEFT: null, RIGHT: right });
    assert.equal(config.ears.LEFT, null);
    assert.ok(config.notes.some((note) => note.includes('单侧')));
    assert.equal(config.overallGrade.key, right.grade.key);
  });

  it('双耳都未测听时给出占位分级', () => {
    const config = buildBinauralConfig({ LEFT: null, RIGHT: null });
    assert.equal(config.overallGrade.label, '尚未测听');
  });

  it('frequency 降低参数保持预留状态', () => {
    const config = buildBinauralConfig({ LEFT: left, RIGHT: right });
    assert.equal(config.frequencyLowering.enabled, false);
    assert.equal(config.frequencyLowering.fmin, 1600);
    assert.equal(config.frequencyLowering.fmax, 8000);
  });
});

describe('pickOverallGrade', () => {
  it('两侧 PTA 相同时取任意一侧，不抛异常', () => {
    const right = buildEarCompensation({ ear: 'RIGHT', testId: null, results: LEFT_EAR_RESULTS });
    const left = buildEarCompensation({ ear: 'LEFT', testId: null, results: LEFT_EAR_RESULTS });
    const grade = pickOverallGrade({ LEFT: left, RIGHT: right });
    assert.equal(grade.key, 'mild');
  });
});
