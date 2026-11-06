import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBinauralConfig,
  buildEarCompensation,
  buildEqBands,
  classifyGrade,
  compositeResponseDb,
  computeThresholds,
  effectiveGainDb,
  interpolateThresholdDb,
  MAX_GAIN_DB,
  pickOverallGrade,
  prescribedGainDb,
  pureToneAverage,
  TEST_FREQUENCIES,
  type RawHearingResult,
} from './audiogram';
import { EXTENDED_FREQUENCIES } from './frequencies';

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

describe('prescribedGainDb（软拐点半增益）', () => {
  it('正常听阈不加增益', () => {
    assert.equal(prescribedGainDb(20), 0);
  });

  it('拐点处按半增益：50 dB → 15 dB', () => {
    assert.equal(prescribedGainDb(50), 15);
  });

  it('拐点以上进入压缩段：60 dB → 18.5 dB', () => {
    assert.equal(prescribedGainDb(60), 18.5);
  });

  it('90 dB → 29 dB', () => {
    assert.equal(prescribedGainDb(90), 29);
  });

  it('超过上限封顶 30 dB', () => {
    assert.equal(prescribedGainDb(100), 30);
  });

  it('增益随听阈单调不减', () => {
    let previous = 0;
    for (let hl = 0; hl <= 100; hl += 5) {
      const gain = prescribedGainDb(hl);
      assert.ok(gain >= previous - 1e-9, `HL=${hl} 增益 ${gain} < 前一个 ${previous}`);
      previous = gain;
    }
  });
});

describe('interpolateThresholdDb', () => {
  const audiogram = computeThresholds([
    { frequency: 250, level: 20, heard: true },
    { frequency: 8000, level: 80, heard: true },
  ]);

  it('测点处取实测值', () => {
    assert.equal(interpolateThresholdDb(audiogram, 250), 20);
    assert.equal(interpolateThresholdDb(audiogram, 8000), 80);
  });

  it('测点之间按对数频率插值', () => {
    // 250→8000 跨 5 个倍频程，2000 位于 3/5 处：20 + 60 × 0.6 = 56
    assert.equal(interpolateThresholdDb(audiogram, 2000), 56);
  });

  it('超出测听范围时取端点值，不外推', () => {
    assert.equal(interpolateThresholdDb(audiogram, 125), 20);
    assert.equal(interpolateThresholdDb(audiogram, 10000), 80);
  });
});

describe('buildEqBands（补偿频带）', () => {
  /** 由 6 个听阈构造一只耳的补偿参数。 */
  const earFrom = (values: number[]) =>
    buildEarCompensation({
      ear: 'LEFT',
      testId: null,
      results: TEST_FREQUENCIES.map((frequency, index) => ({
        frequency,
        level: values[index],
        heard: true,
      })),
    });

  it('每个测听频点一段，共 6 段', () => {
    const ear = earFrom([20, 20, 20, 20, 20, 20]);
    assert.equal(ear.eqBands.length, TEST_FREQUENCIES.length);
    assert.deepEqual(
      ear.eqBands.map((band) => band.frequency),
      [...TEST_FREQUENCIES],
    );
  });

  it('正常听力全部不加增益', () => {
    const ear = earFrom([15, 15, 15, 15, 15, 15]);
    assert.ok(ear.eqBands.every((band) => band.gainDb === 0));
  });

  it('合成响应贴合处方目标（误差 < 0.5 dB）', () => {
    const ear = earFrom([28, 26, 35, 57, 92, 87]);
    for (const frequency of TEST_FREQUENCIES) {
      const target = prescribedGainDb(interpolateThresholdDb(ear.audiogram, frequency));
      const actual = effectiveGainDb(ear, frequency);
      assert.ok(
        Math.abs(actual - target) < 0.5,
        `${frequency}Hz 目标 ${target.toFixed(1)} dB，实际 ${actual.toFixed(1)} dB`,
      );
    }
  });

  it('高频损失时高频有效增益更大', () => {
    const ear = earFrom([20, 25, 30, 55, 80, 85]);
    assert.ok(effectiveGainDb(ear, 4000) > effectiveGainDb(ear, 1000));
    assert.ok(effectiveGainDb(ear, 8000) > effectiveGainDb(ear, 4000));
  });

  it('不会因为相邻频带叠加而整体超标', () => {
    const ear = earFrom([28, 26, 35, 57, 92, 87]);
    const max = Math.max(...TEST_FREQUENCIES.map((frequency) => effectiveGainDb(ear, frequency)));
    assert.ok(max <= MAX_GAIN_DB + 1, `最大有效增益 ${max.toFixed(1)} dB 超过处方上限`);
  });

  it('精细模式（9 个频点）生成 9 段并贴合处方', () => {
    const ear = buildEarCompensation({
      ear: 'RIGHT',
      testId: null,
      results: EXTENDED_FREQUENCIES.map((frequency) => ({ frequency, level: 45, heard: true })),
    });

    assert.equal(ear.eqBands.length, EXTENDED_FREQUENCIES.length);

    const target = prescribedGainDb(45);
    for (const frequency of EXTENDED_FREQUENCIES) {
      const actual = effectiveGainDb(ear, frequency);
      assert.ok(
        Math.abs(actual - target) < 1,
        `${frequency}Hz 目标 ${target.toFixed(1)} dB，实际 ${actual.toFixed(1)} dB`,
      );
    }
  });
});

describe('compositeResponseDb（有效增益）', () => {
  it('单个频带在中心频率处等于设定增益加前置增益', () => {
    const bands = [{ frequency: 1000, gainDb: 12, q: 2, type: 'peaking' as const }];
    const response = compositeResponseDb(bands, -6, 1000, 48_000);
    assert.ok(Math.abs(response - 6) < 0.1, `实际 ${response}`);
  });

  it('相邻频带会在中心频率处叠加，比单个频带更高', () => {
    const single = compositeResponseDb(
      [{ frequency: 1000, gainDb: 12, q: 2, type: 'peaking' }],
      0,
      1000,
      48_000,
    );
    const paired = compositeResponseDb(
      [
        { frequency: 800, gainDb: 12, q: 2, type: 'peaking' },
        { frequency: 1000, gainDb: 12, q: 2, type: 'peaking' },
      ],
      0,
      1000,
      48_000,
    );
    assert.ok(paired > single, `叠加后 ${paired} 应高于单频带 ${single}`);
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
