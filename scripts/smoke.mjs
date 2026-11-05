#!/usr/bin/env node
/**
 * 端到端冒烟测试：注册 → 双耳测听 → 生成双耳配置 → 导出 → 单侧用户 → 登录/登出/未授权。
 * 用法：node scripts/smoke.mjs
 * 前置：后端已在 http://localhost:3000 运行，Postgres 已启动。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.API_BASE ?? 'http://localhost:3000/api';
const password = 'Passw0rd!2026';
const stamp = Date.now();
const username = process.env.SMOKE_USER ?? `smoke_${stamp}`;
const singleEarUser = `smoke_single_${stamp}`;

const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

function createClient() {
  let cookie = '';
  return {
    async call(path, init = {}) {
      const headers = { 'Content-Type': 'application/json', ...(init.headers ?? {}) };
      if (cookie) headers.Cookie = cookie;

      const response = await fetch(`${base}${path}`, { ...init, headers });
      const setCookies = response.headers.getSetCookie?.() ?? [];
      if (setCookies.length > 0) {
        cookie = setCookies.map((item) => item.split(';')[0]).join('; ');
      }
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    clearCookie() {
      cookie = '';
    },
  };
}

const LEFT_RESULTS = [
  { frequency: 500, level: 25, heard: true },
  { frequency: 1000, level: 20, heard: true },
  { frequency: 2000, level: 25, heard: true },
  { frequency: 4000, level: 30, heard: true },
];

const RIGHT_RESULTS = [
  { frequency: 250, level: 40, heard: true },
  { frequency: 250, level: 30, heard: false },
  { frequency: 500, level: 60, heard: true },
  { frequency: 1000, level: 30, heard: true },
  { frequency: 2000, level: 50, heard: true },
  { frequency: 4000, level: 70, heard: true },
  { frequency: 8000, level: 90, heard: false },
];

const client = createClient();

const health = await client.call('/health');
record('health', health.status === 200 && health.body?.data?.status === 'ok');

const registered = await client.call('/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username, password, nickname: '冒烟测试' }),
});
record('register', registered.status === 200 && Boolean(registered.body?.traceId), `traceId=${registered.body?.traceId?.slice(0, 8)}`);

const me = await client.call('/auth/me');
record('me', me.status === 200 && me.body?.data?.user?.username === username);

const leftTest = await client.call('/hearing/tests', {
  method: 'POST',
  body: JSON.stringify({ ear: 'LEFT', deviceNote: '冒烟脚本 · 有线耳机' }),
});
const leftId = leftTest.body?.data?.test?.id;
record('create LEFT test', leftTest.status === 200 && leftTest.body?.data?.test?.ear === 'LEFT', `id=${leftId?.slice(0, 8)}`);

const completedLeft = await client.call(`/hearing/tests/${leftId}`, {
  method: 'PATCH',
  body: JSON.stringify({ results: LEFT_RESULTS, complete: true }),
});
record(
  'complete LEFT',
  completedLeft.status === 200 && completedLeft.body?.data?.test?.status === 'COMPLETED',
  `pta=${completedLeft.body?.data?.config?.ears?.LEFT?.ptaDbHl}`,
);

const rightTest = await client.call('/hearing/tests', {
  method: 'POST',
  body: JSON.stringify({ ear: 'RIGHT' }),
});
const rightId = rightTest.body?.data?.test?.id;
record('create RIGHT test', rightTest.status === 200 && rightTest.body?.data?.test?.ear === 'RIGHT');

const completedRight = await client.call(`/hearing/tests/${rightId}`, {
  method: 'PATCH',
  body: JSON.stringify({ results: RIGHT_RESULTS, complete: true }),
});
const config = completedRight.body?.data?.config;
record(
  'complete RIGHT',
  completedRight.status === 200 && config?.ears?.RIGHT?.grade?.key === 'moderately_severe',
  `pta=${config?.ears?.RIGHT?.ptaDbHl} grade=${config?.ears?.RIGHT?.grade?.label}`,
);

record(
  '双耳独立计算',
  config?.ears?.LEFT?.ptaDbHl === 25 && config?.ears?.RIGHT?.ptaDbHl === 52.5,
  `LEFT=${config?.ears?.LEFT?.ptaDbHl} RIGHT=${config?.ears?.RIGHT?.ptaDbHl}`,
);

const leftGains = JSON.stringify(config?.ears?.LEFT?.eqBands?.map((band) => band.gainDb));
const rightGains = JSON.stringify(config?.ears?.RIGHT?.eqBands?.map((band) => band.gainDb));
record('左右耳增益曲线不同', leftGains !== rightGains, `LEFT=${leftGains} RIGHT=${rightGains}`);

record(
  '整体分级取较好耳',
  config?.overallGrade?.key === 'mild',
  `overall=${config?.overallGrade?.label}`,
);

const profile = await client.call('/hearing/profile');
record(
  'profile 返回双耳',
  profile.status === 200 &&
    Boolean(profile.body?.data?.profiles?.LEFT) &&
    Boolean(profile.body?.data?.profiles?.RIGHT),
  `LEFT=${profile.body?.data?.profiles?.LEFT?.sourceTestId?.slice(0, 8)} RIGHT=${profile.body?.data?.profiles?.RIGHT?.sourceTestId?.slice(0, 8)}`,
);

const exported = await client.call('/hearing/profile/config');
record(
  'export 双耳配置',
  exported.status === 200 &&
    Boolean(exported.body?.data?.ears?.LEFT) &&
    Boolean(exported.body?.data?.ears?.RIGHT),
);

if (config) {
  const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'compensation-config.sample.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`[INFO] 双耳配置样例已写入 ${target}`);
}

// 单侧场景：只测左耳时，右侧应为 null 并给出补测提示
const singleClient = createClient();
await singleClient.call('/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username: singleEarUser, password }),
});
const singleTest = await singleClient.call('/hearing/tests', {
  method: 'POST',
  body: JSON.stringify({ ear: 'LEFT' }),
});
const singleCompleted = await singleClient.call(`/hearing/tests/${singleTest.body?.data?.test?.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    results: [
      { frequency: 500, level: 40, heard: true },
      { frequency: 1000, level: 40, heard: true },
      { frequency: 2000, level: 40, heard: true },
      { frequency: 4000, level: 40, heard: true },
    ],
    complete: true,
  }),
});
const singleConfig = singleCompleted.body?.data?.config;
record(
  '单侧测听：右侧为空',
  singleConfig?.ears?.RIGHT === null && Boolean(singleConfig?.ears?.LEFT),
);
record(
  '单侧测听：提示补测',
  Array.isArray(singleConfig?.notes) && singleConfig.notes.some((note) => note.includes('单侧')),
);

const unauthClient = createClient();
const unauth = await unauthClient.call('/hearing/profile');
record('unauthorized guard', unauth.status === 401, `HTTP ${unauth.status}`);

const loggedOut = await client.call('/auth/logout', { method: 'POST' });
record('logout', loggedOut.status === 200);
const afterLogout = await client.call('/auth/me');
record('after logout', afterLogout.status === 401, `HTTP ${afterLogout.status}`);

const relogin = await client.call('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username, password }),
});
record('login again', relogin.status === 200 && relogin.body?.data?.user?.username === username);

const failed = checks.filter((check) => !check.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed (user=${username})`);
