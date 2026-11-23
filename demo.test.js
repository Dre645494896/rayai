import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
// The existing project supports Node 20; the optional Demo requires Node 24.
const supportsDemo = Number(process.versions.node.split('.')[0]) >= 24;
const { createDemo } = supportsDemo ? await import('./demo-server.js') : {};
const demoTest = supportsDemo ? test : test.skip;

async function open(options) {
  const server = createDemo(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    client() {
      let cookie;
      return async (route, body) => {
        const headers = cookie ? { cookie } : {};
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(`${base}${route}`, { headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
        const session = res.headers.get('set-cookie');
        if (session) cookie = session.split(';')[0];
        const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
        return { status: res.status, data };
      };
    },
  };
}
const api = '/demo-api';
const demoUser = { email: 'designer@example.test', password: 'test-only-0926' };
const register = (call, email = demoUser.email) => call(`${api}/register`, { ...demoUser, email });
const makeJob = (requestId, options = {}) => ({ requestId, tier: '2k', ratio: '3:2', quality: 'Pro', version: 'demo-v1', prompt: '落日湖泊', ...options });
async function settled(call, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { data } = await call(`${api}/jobs/${id}`);
    if (data.job?.status !== 'pending') return data;
    await delay(10);
  }
  assert.fail('Demo job did not settle');
}

demoTest('Demo 直接使用原版样式和极光动画资源', async t => {
  const server = await open();
  t.after(server.close);
  const call = server.client();
  for (const file of ['style.css', 'simple.css', 'chat.css', 'chat-v2.css', 'chat-v3.css', 'aurora.js']) {
    const { status, data } = await call(`/${file}`);
    assert.equal(status, 200, file);
    assert.equal(data, await readFile(new URL(file, import.meta.url), 'utf8'), file);
  }
});

demoTest('Demo 统一入口自动注册，已有账号只校验密码，赠分不重复', async t => {
  const server = await open();
  t.after(server.close);
  const signIn = (call, credentials = demoUser) => call(`${api}/auth`, credentials);
  const [first, second] = [server.client(), server.client()];
  const results = await Promise.all([signIn(first), signIn(second)]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.equal(results[0].data.user.id, results[1].data.user.id);
  assert.equal(results[1].data.balance, 50);
  const guest = server.client();
  assert.equal((await signIn(guest, { ...demoUser, password: 'incorrect-password' })).status, 401);
  assert.equal((await guest(`${api}/session`)).data.user, null);
  assert.equal((await signIn(guest, { ...demoUser, email: demoUser.email.toUpperCase() })).data.user.id, results[0].data.user.id);
  assert.deepEqual((await guest(`${api}/ledger`)).data.entries.map(entry => entry.delta), [50]);
});

demoTest('Demo 邮箱账号、三档报价、图像结果与积分流水', async t => {
  const server = await open({ generationMs: 20 });
  t.after(server.close);
  const call = server.client();
  assert.equal((await call(`${api}/ledger`)).status, 401);
  assert.equal((await register(call)).data.balance, 50);
  assert.equal((await register(call, 'Designer@Example.Test')).status, 409);
  const table = { standard: { Medium: 4, Pro: 6, Max: 9 }, '2k': { Medium: 7, Pro: 10, Max: 15 }, '4k': { Medium: 12, Pro: 17, Max: 24 } };
  for (const [tier, prices] of Object.entries(table)) assert.deepEqual((await call(`${api}/quote?tier=${tier}&ratio=21%3A9`)).data.prices, prices);
  assert.equal((await call(`${api}/quote?tier=4k&ratio=1%3A1`)).status, 400);
  assert.deepEqual((await call(`${api}/quote?tier=2k&ratio=auto`)).data, { version: 'demo-v1', tier: '2k', ratio: 'auto', size: 'auto', billingTier: 'standard', prices: table.standard });
  assert.equal((await call(`${api}/quote?tier=standard&ratio=custom&width=2048&height=1024`)).data.prices.Pro, 10);
  assert.equal((await call(`${api}/quote?tier=standard&ratio=custom&width=2049&height=1024`)).status, 400);
  assert.equal((await call(`${api}/jobs`, makeJob('req_obsolete', { version: 'old' }))).status, 409);
  const request = makeJob('req_success', { references: [{ name: 'ref.png', data: 'data:image/png;base64,iVBORw0KGgo=' }] });
  const submission = await call(`${api}/jobs`, request);
  assert.equal(submission.status, 202);
  assert.equal(submission.data.balance, 40);
  const { job } = await settled(call, request.requestId);
  assert.equal(job.status, 'success');
  assert.equal(job.referenceCount, 1);
  assert.match((await call(job.imageUrl)).data, /width="2048" height="1360"/);
  assert.deepEqual((await call(`${api}/ledger`)).data.entries.map(e => e.delta), [-10, 50]);
  const second = server.client();
  assert.equal((await register(second, 'another@example.test')).data.balance, 50);
  assert.equal((await second(job.imageUrl)).status, 404);
  assert.equal((await second(`${api}/jobs/${request.requestId}`)).status, 404);
  assert.deepEqual((await second(`${api}/jobs`)).data.jobs, []);
  assert.equal((await call(`${api}/logout`, {})).status, 200);
  assert.equal((await call(`${api}/session`)).data.user, null);
  assert.equal((await call(`${api}/login`, { ...demoUser, password: 'wrong-password' })).status, 401);
  assert.equal((await call(`${api}/login`, demoUser)).data.balance, 40);
  assert.equal((await call('/api/generate', {})).status, 404);
});

demoTest('Demo 会员与充值金额由目录决定；积分只到账一次', async t => {
  const server = await open();
  t.after(server.close);
  const call = server.client();
  const { data: catalog } = await call(`${api}/store`);
  assert.deepEqual(catalog.plans.map(({price,points}) => [price,points]), [[29,350],[59,800],[99,1500]]);
  assert.deepEqual(catalog.packs.map(({price,points}) => [price,points]), [[10,100],[30,300],[60,600]]);
  const buy = { kind:'topup', id:'small', requestId:'topup_request_1', points:999999 };
  assert.equal((await call(`${api}/store/purchase`, buy)).status, 401);
  await register(call);
  assert.equal((await call(`${api}/store/purchase`, { ...buy, id:'invalid' })).status, 400);
  assert.deepEqual((await Promise.all([call(`${api}/store/purchase`, buy), call(`${api}/store/purchase`, buy)])).map(r => r.data), [{balance:150,points:100}, {balance:150,points:100}]);
  assert.equal((await call(`${api}/store/purchase`, { ...buy, kind:'membership', id:'pro' })).status, 409);
  assert.deepEqual((await call(`${api}/store/purchase`, { kind:'membership', id:'pro', requestId:'plan_request_1' })).data, {balance:950,points:800});
  const entries = (await call(`${api}/ledger`)).data.entries;
  assert.deepEqual(entries.map(({reason,delta}) => [reason,delta]), [['membership',800],['topup',100],['grant',50]]);
  const second = server.client();
  assert.equal((await register(second, 'other@example.test')).data.balance, 50);
});

demoTest('Demo 保留自定义尺寸；服务端按有效宽高定价', async t => {
  const server = await open({ generationMs: 20 });
  t.after(server.close);
  const call = server.client();
  await register(call);
  const payload = makeJob('req_custom_size', { tier: 'standard', ratio: 'custom', width: 2048, height: 1024, cost: 1 });
  const { status, data } = await call(`${api}/jobs`, payload);
  assert.equal(status, 202);
  assert.equal(data.job.size, '2048x1024');
  assert.equal(data.job.cost, 10);
  assert.equal(data.balance, 40);
  assert.equal((await call(`${api}/jobs`, { ...payload, height: 1040 })).status, 409);
});

demoTest('Demo 并发不会超扣；同一请求与失败退款均幂等', async t => {
  const server = await open({ generationMs: 100 });
  t.after(server.close);
  const call = server.client();
  await register(call);
  const fail = makeJob('req_fail_once', { simulateFailure: true });
  const submit = () => call(`${api}/jobs`, fail);
  assert.deepEqual((await Promise.all([submit(), submit(), submit()])).map(r => r.status).sort(), [200, 200, 202]);
  assert.equal((await call(`${api}/jobs`, { ...fail, prompt: '另一个提示词' })).status, 409);
  assert.equal((await settled(call, fail.requestId)).balance, 50);
  assert.equal((await submit()).data.job.status, 'failed');
  assert.deepEqual((await call(`${api}/ledger`)).data.entries.map(e => e.delta), [10, -10, 50]);
  const large = ['job_large_1', 'job_large_2', 'job_large_3'].map(requestId => call(`${api}/jobs`, makeJob(requestId, { tier: '4k', ratio: '21:9', quality: 'Max' })));
  assert.deepEqual((await Promise.all(large)).map(r => r.status).sort(), [202, 202, 402]);
  assert.equal((await call(`${api}/session`)).data.balance, 2);
});

demoTest('Demo 重启可查询历史，未完成的任务只退一次', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'rayai-demo-test-'));
  const options = { dbPath: join(folder, 'test.sqlite'), generationMs: 100000 };
  const before = await open(options);
  try {
    const call = before.client();
    await register(call);
    assert.equal((await call(`${api}/jobs`, makeJob('req_restart'))).data.balance, 40);
  } finally { await before.close(); }
  for (let count = 0; count < 2; count++) {
    const after = await open(options);
    try {
      const call = after.client();
      assert.equal((await call(`${api}/login`, demoUser)).data.balance, 50);
      assert.equal((await call(`${api}/jobs/req_restart`)).data.job.status, 'failed');
      assert.deepEqual((await call(`${api}/ledger`)).data.entries.map(e => e.delta), [10, -10, 50]);
    } finally { await after.close(); }
  }
});
