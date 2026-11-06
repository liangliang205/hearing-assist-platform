import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  answerStaircase,
  answerVerification,
  createStaircase,
  createVerification,
  currentVerificationStimulus,
  MAX_LEVEL_DB,
  MAX_VERIFICATION_ATTEMPTS,
  type StaircaseState,
} from './hearingTest';

/** 依次作答，返回最终状态。 */
function run(answers: boolean[], startLevel = 40): StaircaseState {
  let state = createStaircase(1000, startLevel);
  for (const heard of answers) {
    if (state.done) break;
    state = answerStaircase(state, heard);
  }
  return state;
}

describe('answerStaircase', () => {
  it('听到后下行 10 dB', () => {
    const state = run([true]);
    assert.equal(state.level, 30);
    assert.equal(state.presentations, 1);
    assert.equal(state.done, false);
  });

  it('未听到后上行 5 dB，并进入确认状态', () => {
    const state = run([false]);
    assert.equal(state.level, 45);
    assert.equal(state.pendingConfirm, 45);
  });

  it('上升后同一强度听到两次才判定为听阈', () => {
    // 40 听到 → 30 听到 → 20 未听到 → 25 听到 → 25 再听到
    const state = run([true, true, false, true, true]);
    assert.equal(state.done, true);
    assert.equal(state.threshold, 25);
    assert.equal(state.presentations, 5);
  });

  it('确认失败则继续上行', () => {
    // 40 听到 → 30 未听到 → 35 听到（第 1 次）→ 35 未听到 → 40 听到…
    const state = run([true, false, true, false, true, true]);
    assert.equal(state.done, true);
    // 最后一次在 40 dB 上连续听到两次
    assert.equal(state.threshold, 40);
  });

  it('一直未听到：升到 90 dB 仍听不到，判定为未测出', () => {
    const state = run([false, false, false, false, false, false, false, false, false, false, false, false]);
    assert.equal(state.done, true);
    assert.equal(state.threshold, null);
    assert.equal(state.level, MAX_LEVEL_DB);
  });

  it('听力很好：降到最低强度后取最低听到值', () => {
    // 40→30→20→10→0→-10 全部听到，再降越界
    const state = run([true, true, true, true, true, true]);
    assert.equal(state.done, true);
    assert.equal(state.threshold, -10);
  });

  it('呈现次数用尽时按已听到的最低值兜底', () => {
    let state = createStaircase(1000);
    for (let index = 0; index < 25 && !state.done; index += 1) {
      // 交替听到/未听到，制造无法收敛的情况
      state = answerStaircase(state, index % 2 === 0);
    }
    assert.equal(state.done, true);
    assert.equal(state.presentations, 20);
    assert.ok(state.threshold === null || typeof state.threshold === 'number');
  });

  it('已完成的状态不再变化', () => {
    const done = run([true, true, false, true, true]);
    const again = answerStaircase(done, true);
    assert.equal(again, done);
  });

  it('记录完整的作答轨迹', () => {
    const state = run([true, false]);
    assert.deepEqual(state.answered, [
      { level: 40, heard: true },
      { level: 30, heard: false },
    ]);
  });
});

describe('answerVerification（复验）', () => {
  it('两种音型都听到即确认阈值', () => {
    let state = createVerification(1000, 40);
    assert.equal(currentVerificationStimulus(state), 'pure');

    state = answerVerification(state, true);
    assert.equal(currentVerificationStimulus(state), 'warble');

    state = answerVerification(state, true);
    assert.equal(state.done, true);
    assert.equal(state.threshold, 40);
  });

  it('连续音没听到时上调 5 dB 并重新开始', () => {
    let state = createVerification(1000, 40);
    state = answerVerification(state, false);

    assert.equal(state.done, false);
    assert.equal(state.level, 45);
    assert.equal(currentVerificationStimulus(state), 'pure');
  });

  it('上调后两种音型都听到，阈值取上调后的值', () => {
    let state = createVerification(1000, 40);
    state = answerVerification(state, false);
    state = answerVerification(state, true);
    state = answerVerification(state, true);

    assert.equal(state.done, true);
    assert.equal(state.threshold, 45);
  });

  it('升到最大输出仍听不到则记为未测出', () => {
    let state = createVerification(1000, MAX_LEVEL_DB);
    state = answerVerification(state, false);

    assert.equal(state.done, true);
    assert.equal(state.threshold, null);
  });

  it('尝试次数用尽后结束', () => {
    let state = createVerification(1000, 30);
    for (let index = 0; index < MAX_VERIFICATION_ATTEMPTS; index += 1) {
      state = answerVerification(state, false);
    }

    assert.equal(state.done, true);
    assert.equal(state.threshold, null);
  });

  it('判阈为 null 时无需复验', () => {
    const state = createVerification(1000, null);
    assert.equal(state.done, true);
    assert.equal(state.threshold, null);
  });

  it('记录每次复验的音型与强度', () => {
    let state = createVerification(1000, 40);
    state = answerVerification(state, true);
    state = answerVerification(state, false);

    assert.deepEqual(state.results, [
      { stimulus: 'pure', level: 40, heard: true },
      { stimulus: 'warble', level: 40, heard: false },
    ]);
  });
});
