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
  return { status: response.status, body: await response.json().catch(() => null) };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};

// —— 1. 隐私同意：未同意时不应有任何上传（由客户端保证，这里验证接口层仍有鉴权）
const anonymous = await call('/api/hearing/profile');
check('未登录访问云端档案被拒绝', anonymous.status === 401);

// —— 2. 注册 + 上传 + 删除云端（撤回同意路径）
const username = `consent_${Date.now()}`;
await call('/api/auth/register', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'HearLink123' }),
});

const sample = JSON.parse(
  (await import('node:fs')).readFileSync('samples/compensation-config.sample.json', 'utf8'),
);

await call('/api/hearing/profile', {
  method: 'PUT',
  body: JSON.stringify({ ear: 'LEFT', config: sample.ears.LEFT }),
});
await call('/api/hearing/profile', {
  method: 'PUT',
  body: JSON.stringify({ ear: 'RIGHT', config: sample.ears.RIGHT }),
});

const before = await call('/api/hearing/profile');
check(
  '上传后云端有双耳档案',
  before.status === 200 && before.body?.data?.profiles?.LEFT !== null,
);

const removed = await call('/api/hearing/profile', { method: 'DELETE' });
check('撤回同意：DELETE 删除云端档案', removed.status === 200, `deleted=${removed.body?.data?.deleted}`);

const after = await call('/api/hearing/profile');
check('删除后云端档案不存在', after.status === 404);

await call('/api/auth/logout', { method: 'POST' });

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
