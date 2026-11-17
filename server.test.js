import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, discover, createServer } from './server.js';
import { hashInvite } from './invite-auth.js';

const base = { baseUrl: 'https://api.muzeai.top/v1', apiKey: 'test-key', model: 'gpt-image-2.6-sunburst', prompt: '一只猫', params: { quality: 'high' } };

test('文生图发送 JSON 到图片生成接口并读取 base64 图片', async () => {
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://api.muzeai.top/v1/images/generations');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(JSON.parse(options.body), { model: base.model, prompt: base.prompt, quality: 'high' });
    return new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200 });
  };
  const result = await generate({ ...base, mode: 'generate' }, fetcher);
  assert.deepEqual(result.images, ['data:image/png;base64,aGVsbG8=']);
});

test('图生图发送图片表单到编辑接口', async () => {
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://api.muzeai.top/v1/images/edits');
    assert.equal(options.body.get('model'), base.model);
    assert.equal(options.body.get('image[]').type, 'image/png');
    return new Response(JSON.stringify({ data: [{ url: 'https://example.com/result.png' }] }), { status: 200 });
  };
  const result = await generate({ ...base, mode: 'edit', images: [{ name: 'test.png', data: 'data:image/png;base64,aGVsbG8=' }] }, fetcher);
  assert.equal(result.images[0], 'https://example.com/result.png');
});

test('错误响应原样保留状态和正文', async () => {
  await assert.rejects(generate({ ...base, mode: 'generate' }, async () => new Response('{"error":"unsupported quality"}', { status: 400 })), /HTTP 400.*unsupported quality/);
});

test('接口提供 OpenAPI 时自动读取参数', async () => {
  const spec = { paths: { '/v1/images/generations': { post: { requestBody: { content: { 'application/json': { schema: { properties: { model: {type:'string'}, prompt:{type:'string'}, quality:{type:'string',enum:['low','high'],default:'high'} } } } } } } } } };
  const result = await discover(base, async () => new Response(JSON.stringify(spec), { status: 200, headers: { 'content-type': 'application/json' } }));
  assert.equal(result.verified, true);
  assert.deepEqual(result.fields, [{name:'quality',type:'select',options:'low,high',value:'high',modes:'both'}]);
});

test('未公开参数结构时使用已知模型文档配置', async () => {
  const result = await discover(base, async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.equal(result.verified, false);
  assert.equal(result.fields[0].name, 'size');
});

test('本地页面与 API 可访问', async () => {
  const server = createServer(async () => new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200 }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(address);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /RayAI/);
    for(const asset of ['chat-app.js','image-settings.js','chat-v3.css','rayai-icon.png']){
      const response=await fetch(`${address}/${asset}`);
      assert.equal(response.status,200,`${asset} 应能被页面加载`);
      if(asset==='rayai-icon.png')assert.match(response.headers.get('content-type'),/^image\/png/);
    }
    assert.equal((await fetch(`${address}/missing.js`)).status,404);
    const response = await fetch(`${address}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, mode: 'generate' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).images.length, 1);
  } finally { server.close(); }
});

test('生产环境未设置邀请码时不会开放生图接口', async () => {
  const server = createServer(fetch, { NODE_ENV: 'production' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${address}/api/session`);
    assert.deepEqual(await session.json(), { authenticated: false });
    const response = await fetch(`${address}/api/generate`, { method: 'POST' });
    assert.equal(response.status, 401);
  } finally { server.close(); }
});

test('生产环境使用邀请码后才能调用接口', async () => {
  const env = {
    NODE_ENV: 'production',
    INVITE_SESSION_SECRET: 'test-session-secret',
    INVITE_CODES: JSON.stringify({ friend: await hashInvite('friend-code') }),
  };
  const server = createServer(fetch, env);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const redeem = await fetch(`${address}/api/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'friend-code' }),
    });
    assert.equal(redeem.status, 200);
    const cookie = redeem.headers.get('set-cookie').split(';')[0];
    const session = await fetch(`${address}/api/session`, { headers: { Cookie: cookie } });
    assert.deepEqual(await session.json(), { authenticated: true });
  } finally { server.close(); }
});

test('GitHub Pages 来源可跨域使用邀请码，其他来源被拒绝', async () => {
  const env={NODE_ENV:'production',FRONTEND_ORIGIN:'https://dre645494896.github.io',INVITE_SESSION_SECRET:'test-session-secret',INVITE_CODES:JSON.stringify({friend:await hashInvite('friend-code')})};
  const server=createServer(fetch,env);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const address=`http://127.0.0.1:${server.address().port}`;
    const preflight=await fetch(`${address}/api/invite`,{method:'OPTIONS',headers:{Origin:env.FRONTEND_ORIGIN}});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),env.FRONTEND_ORIGIN);
    const redeem=await fetch(`${address}/api/invite`,{method:'POST',headers:{Origin:env.FRONTEND_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({code:'friend-code'})});
    const token=(await redeem.json()).token;
    assert.ok(token);
    const session=await fetch(`${address}/api/session`,{headers:{Origin:env.FRONTEND_ORIGIN,Authorization:`Bearer ${token}`}});
    assert.deepEqual(await session.json(),{authenticated:true});
    assert.equal((await fetch(`${address}/api/session`,{headers:{Origin:'https://evil.example',Authorization:`Bearer ${token}`}})).status,403);
    assert.equal((await fetch(`${address}/api/health`)).status,200);
  }finally{server.close();}
});
