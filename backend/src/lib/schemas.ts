import { z } from 'zod';

export const usernameSchema = z
  .string()
  .min(3, '用户名至少 3 个字符')
  .max(32, '用户名最多 32 个字符')
  .regex(/^[a-zA-Z0-9_]+$/, '用户名仅支持字母、数字和下划线');

export const passwordSchema = z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位');

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  nickname: z.string().max(32).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码'),
});

export const earSchema = z.enum(['LEFT', 'RIGHT'], {
  errorMap: () => ({ message: '耳别只能是 LEFT 或 RIGHT' }),
});

/** 单次纯音测听结果：某频率、某强度下是否听到。耳别由所属会话决定。 */
export const hearingResultSchema = z.object({
  frequency: z.number().int().min(125).max(16000),
  level: z.number().min(-10).max(120),
  heard: z.boolean(),
});

export const hearingTestCreateSchema = z.object({
  ear: earSchema,
  deviceNote: z.string().max(200).optional(),
});

export const hearingTestPatchSchema = z
  .object({
    results: z.array(hearingResultSchema).min(1).max(400).optional(),
    deviceNote: z.string().max(200).optional(),
    complete: z.boolean().optional(),
  })
  .refine((value) => value.results !== undefined || value.deviceNote !== undefined || value.complete === true, {
    message: '至少提供 results、deviceNote 或 complete 之一',
  });

export const profileUpdateSchema = z
  .object({
    ear: earSchema,
    sourceTestId: z.string().uuid().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .refine((value) => Boolean(value.sourceTestId) || Boolean(value.config), {
    message: 'sourceTestId 与 config 至少提供一个',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type HearingResultInput = z.infer<typeof hearingResultSchema>;
export type HearingTestPatchInput = z.infer<typeof hearingTestPatchSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
