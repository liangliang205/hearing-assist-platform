import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:5173';
let cookie = '';

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });

  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    if (pair.startsWith('hl_session=')) cookie = pair;
  }

  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const sample = JSON.parse(
  readFileSync('samples/compensation-config.sample.json', 'utf8'),
);
const left = sample.ears?.LEFT;
const right = sample.ears?.RIGHT;

if (!left || !right) {
  console.error('样例配置缺少双耳数据');
  process.exit(1);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const username = `desk_${Date.now()}`;

const registered = await call('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'HearLink123', nickname: '桌面端' }),
});
check('注册', registered.status === 200 && registered.body?.code === 0, username);

const me = await call('/api/auth/me');
check('会话生效（Cookie 走代理）', me.status === 200 && me.body?.data?.user?.username === username);

const pushedLeft = await call('/api/hearing/profile', {
  method: 'PUT',
  body: JSON.stringify({ ear: 'LEFT', config: left }),
});
check('上传左耳配置', pushedLeft.status === 200);

const pushedRight = await call('/api/hearing/profile', {
  method: 'PUT',
  body: JSON.stringify({ ear: 'RIGHT', config: right }),
});
check('上传右耳配置', pushedRight.status === 200);

const fetched = await call('/api/hearing/profile');
const fetchedLeft = fetched.body?.data?.profiles?.LEFT?.config;
const fetchedRight = fetched.body?.data?.profiles?.RIGHT?.config;
check(
  '取回双耳配置且数值一致',
  fetched.status === 200 &&
    fetchedLeft?.ptaDbHl === left.ptaDbHl &&
    fetchedRight?.ptaDbHl === right.ptaDbHl,
  `LEFT=${fetchedLeft?.ptaDbHl} RIGHT=${fetchedRight?.ptaDbHl}`,
);

check(
  '云端合成双耳配置',
  fetched.body?.data?.config?.ears?.LEFT !== null &&
    fetched.body?.data?.config?.ears?.RIGHT !== null,
);

const loggedOut = await call('/api/auth/logout', { method: 'POST' });
check('退出登录', loggedOut.status === 200);

const afterLogout = await call('/api/auth/me');
check('退出后会话失效', afterLogout.status === 401);

const preflight = await fetch(`${BASE}/api/auth/me`, {
  method: 'OPTIONS',
  headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
});
check(
  '预检请求命中 CORS 中间件',
  preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === 'http://localhost:5173',
  `status=${preflight.status}`,
);

const passed = results.filter((item) => item.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
