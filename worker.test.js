import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from './dist/server/index.js';
import { hashInvite } from './invite-auth.js';

const base = { baseUrl: 'https://api.example.test/v1', apiKey: 'secret', model: 'gpt-image-2.6-sunburst', prompt: '测试画面' };
const ownerEnv={OWNER_USER_ID:'owner'};
const post = (path, body, headers={}) => new Request(`https://rayai.example${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json','oai-authenticated-user-id':'owner',...headers }, body: JSON.stringify(body) });

test('线上页面与图标由 Worker 提供', async () => {
  const worker = createWorker();
  const page = await worker.fetch(new Request('https://rayai.example/'));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /RayAI · AI创作平台/);
  const icon = await worker.fetch(new Request('https://rayai.example/rayai-icon.png'));
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
  assert.ok((await icon.arrayBuffer()).byteLength > 1000);
  const favicon = await worker.fetch(new Request('https://rayai.example/favicon.ico'));
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get('content-type'), 'image/x-icon');
});

test('线上文生图和带参考图请求转发到正确接口', async () => {
  const calls = [];
  const worker = createWorker(async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200 });
  });
  const generated = await worker.fetch(post('/api/generate', { ...base, mode: 'generate', params: { size: '1024x1024' } }),ownerEnv);
  assert.equal(generated.status, 200);
  assert.equal(calls[0].url, 'https://api.example.test/v1/images/generations');
  assert.equal(JSON.parse(calls[0].options.body).size, '1024x1024');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret');
  const edited = await worker.fetch(post('/api/generate', { ...base, mode: 'edit', images: [{ name: '参考图.png', data: 'data:image/png;base64,aGVsbG8=' }] }),ownerEnv);
  assert.equal(edited.status, 200);
  assert.equal(calls[1].url, 'https://api.example.test/v1/images/edits');
  assert.equal(calls[1].options.body.get('image[]').name, '参考图.png');
});

test('线上下载代理保留图片格式并拒绝非图片响应', async () => {
  const worker = createWorker(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }));
  const image = await worker.fetch(post('/api/download', { url: 'https://images.example.test/picture.png' }),ownerEnv);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const rejected = createWorker(async () => new Response('no', { headers: { 'Content-Type': 'text/html' } }));
  const response = await rejected.fetch(post('/api/download', { url: 'https://images.example.test/picture.png' }),ownerEnv);
  assert.equal(response.status, 502);
});

test('邀请码保护接口，撤销后凭证失效', async()=>{
  const env={INVITE_SESSION_SECRET:'test-secret-long-enough',INVITE_CODES:JSON.stringify({tester:await hashInvite('sample-invite-code')})};
  const worker=createWorker(async()=>new Response(JSON.stringify({data:[{b64_json:'aGVsbG8='}]})));
  const body={...base,mode:'generate'};
  assert.equal((await worker.fetch(post('/api/generate',body,{'oai-authenticated-user-id':''}),env)).status,401);
  const redeemed=await worker.fetch(post('/api/invite',{code:'sample-invite-code'},{'oai-authenticated-user-id':''}),env);
  assert.equal(redeemed.status,200);
  const cookie=redeemed.headers.get('set-cookie').split(';')[0];
  assert.match(redeemed.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await worker.fetch(post('/api/generate',body,{'oai-authenticated-user-id':'',cookie}),env)).status,200);
  assert.equal((await worker.fetch(post('/api/generate',body,{'oai-authenticated-user-id':'',cookie}),{...env,INVITE_CODES:'{}'})).status,401);
});

test('站点主人可凭邮箱或私有站点指定 IP 免邀请码访问',async()=>{
  const worker=createWorker();
  const env={OWNER_USER_ID:'account-id',OWNER_EMAIL:'zhaiderui@gmail.com',OWNER_ALLOWED_IPS:'2001:49f0:d077:8::5',OWNER_IP_BYPASS_PRIVATE:'true',INVITE_SESSION_SECRET:'test-secret',INVITE_CODES:'{}'};
  const session=(headers)=>worker.fetch(new Request('https://rayai.example/api/session',{headers}),env);
  assert.equal((await (await session({'oai-authenticated-user-id':'site-scoped-id','oai-authenticated-user-email':'ZHAIDERUI@gmail.com'})).json()).authenticated,true);
  assert.equal((await (await session({'cf-connecting-ip':'2001:49f0:d077:8::5'})).json()).authenticated,true);
  assert.equal((await (await session({'cf-connecting-ip':'2001:49f0:d077:8::6'})).json()).authenticated,false);
  assert.equal((await (await worker.fetch(new Request('https://rayai.example/api/session',{headers:{'cf-connecting-ip':'2001:49f0:d077:8::5'}}),{...env,OWNER_IP_BYPASS_PRIVATE:'false'})).json()).authenticated,false);
});

test('内置模型只使用服务端模型、地址和密钥',async()=>{
  let actual;
  const worker=createWorker(async(url,options)=>{actual={url:String(url),options};return new Response(JSON.stringify({data:[{b64_json:'aGVsbG8='}]}));});
  const env={...ownerEnv,MUZE_API_KEY:'admin-secret',MUZE_BASE_URL:'https://api.muzeai.top/v1'};
  const result=await worker.fetch(post('/api/generate',{...base,builtinId:'gpt-image-2.6-sunburst',baseUrl:'https://evil.example/v1',apiKey:'fake',model:'other',mode:'generate'}),env);
  assert.equal(result.status,200);
  assert.equal(actual.url,'https://api.muzeai.top/v1/images/generations');
  assert.equal(actual.options.headers.Authorization,'Bearer admin-secret');
  assert.equal(JSON.parse(actual.options.body).model,'gpt-image-2.6-sunburst');
  assert.doesNotMatch(await result.text(),/admin-secret/);
  const forged=await worker.fetch(post('/api/generate',{...base,builtinId:'gpt-image-2.6-sunburst',mode:'generate',params:{model:'other'}}),env);
  assert.equal(forged.status,400);
  const unknown=await worker.fetch(post('/api/generate',{...base,builtinId:'unknown-model',mode:'generate'}),env);
  assert.equal(unknown.status,400);
  for(const [model,key] of [['gpt-image-2','image-2-secret'],['gpt-image-2.5-sunburst','image-2-5-secret']]){
    const configured={...env,MUZE_API_KEY_IMAGE_2:'image-2-secret',MUZE_API_KEY_IMAGE_2_5:'image-2-5-secret'};
    const response=await worker.fetch(post('/api/generate',{...base,builtinId:model,mode:'generate',params:{size:'1024x1024',quality:'standard',style:'vivid',n:1,response_format:'url'}}),configured);
    assert.equal(response.status,200);
    assert.equal(actual.options.headers.Authorization,`Bearer ${key}`);
    assert.equal(JSON.parse(actual.options.body).model,model);
    assert.equal(actual.url,'https://api.muzeai.top/v1/images/generations');
    const edit=await worker.fetch(post('/api/generate',{...base,builtinId:model,mode:'edit',images:[{name:'ref.png',data:'data:image/png;base64,aGVsbG8='}],params:{}}),configured);
    assert.equal(edit.status,200);
    assert.equal(actual.url,'https://api.muzeai.top/v1/images/edits');
    assert.equal(actual.options.headers.Authorization,`Bearer ${key}`);
  }
  const missing=await worker.fetch(post('/api/generate',{...base,builtinId:'gpt-image-2',mode:'generate'}),env);
  assert.equal(missing.status,503);
});
