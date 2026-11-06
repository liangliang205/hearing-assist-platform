/**
 * @hearlink/domain —— 共享领域逻辑
 *
 * 这里只放「与运行环境无关」的纯函数和类型：
 * - 听力学计算（听阈、PTA、WHO 分级、补偿增益）
 * - 双耳补偿配置的构建与校验
 * - 听力结果的通俗解读
 * - 纯音测听的阶梯法状态机
 *
 * 桌面端（apps/desktop）与服务端（services/server）都直接引用本包，
 * 保证两边算出来的参数完全一致，不会出现「服务端一套、桌面端另一套」。
 */

export * from './audiogram';
export * from './description';
export * from './frequencies';
export * from './hearingTest';
export * from './merge';
export * from './schemes';

import type { RawHearingResult } from './audiogram';

/** 单次测听作答。UI 层更习惯这个名字，语义与 RawHearingResult 完全一致。 */
export type HearingResult = RawHearingResult;
