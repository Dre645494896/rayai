import assets from 'virtual:site-assets';
import { officialFields, sanitizeOutput } from '../image-settings.js';
import { redeemInvite, inviteIdentity } from '../invite-auth.js';
import { applyBuiltin } from '../builtin-models.js';

const maxBody = 35 * 1024 * 1024;
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

function reply(body, status = 200, type = 'application/json; charset=utf-8') {
  return new Response(typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function isOwner(request, env) {
  const userId = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  if (userId && env.OWNER_USER_ID && userId === env.OWNER_USER_ID) return true;
  if (email && env.OWNER_EMAIL && email === env.OWNER_EMAIL.trim().toLowerCase()) return true;
  // Only enable the IP fallback while the Sites access policy is owner-only.
  if (env.OWNER_IP_BYPASS_PRIVATE !== 'true') return false;
  const ip = request.headers.get('cf-connecting-ip');
  return !!ip && (env.OWNER_ALLOWED_IPS || '').split(',').map(value => value.trim()).includes(ip);
}

async function readJson(request) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBody) throw Object.assign(new Error('上传内容超过 35 MB'), { status: 413 });
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('请求 JSON 格式无效'), { status: 400 }); }
}

function endpoint(base, mode) {
  const url = new URL(base);
  if (url.protocol!=='https:'||url.username||url.password||url.search||url.hash||/^(localhost|\[|\d+(?:\.\d+){3}$)/i.test(url.hostname)||/\.(local|internal)$/i.test(url.hostname)) throw Object.assign(new Error('接口地址须为外部 HTTPS 地址'),{status:400});
  const suffix = mode === 'edit' ? 'images/edits' : 'images/generations';
  const clean = url.pathname.replace(/\/+$/, '').replace(/\/(images\/(generations|edits)|chat\/completions)$/, '');
  url.pathname = `${clean || ''}/${suffix}`.replace(/\/+/g, '/');
  return url.toString();
}

async function discover(input, fetcher) {
  const { baseUrl, apiKey, model } = input || {};
  if (!baseUrl || !model) throw Object.assign(new Error('请先填写 API 地址和模型 ID'), { status: 400 });
  const origin = new URL(endpoint(baseUrl, 'generate'));
  const schemaUrls = [new URL('/openapi.json', origin), new URL('/swagger.json', origin), new URL('/v1/openapi.json', origin)];
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  for (const url of schemaUrls) {
    try {
      const response = await fetcher(url, { headers, signal: AbortSignal.timeout(6000) });
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) continue;
      const spec = await response.json();
      const operation = spec?.paths?.['/v1/images/generations']?.post || spec?.paths?.['/images/generations']?.post;
      let properties = operation?.requestBody?.content?.['application/json']?.schema?.properties;
      if (!properties && operation?.requestBody?.content?.['application/json']?.schema?.$ref) {
        const ref = operation.requestBody.content['application/json'].schema.$ref;
        properties = ref.split('/').slice(1).reduce((part, key) => part?.[key], spec)?.properties;
      }
      if (!properties) continue;
      const fields = Object.entries(properties).filter(([name]) => !['model', 'prompt', 'image'].includes(name)).map(([name, rule]) => ({ name, type: rule.enum ? 'select' : rule.type === 'integer' || rule.type === 'number' ? 'number' : rule.type === 'boolean' ? 'boolean' : 'text', options: rule.enum?.join(',') || '', value: rule.default === undefined ? '' : String(rule.default), modes: 'both' }));
      return { fields: sanitizeOutput(fields), source: `已从 ${url.pathname} 读取参数`, verified: true };
    } catch {}
  }
  const preset = officialFields(model);
  if (preset) return { fields: preset, source: `接口未公开参数清单；已使用 GPT Image ${model.match(/^gpt-image-(2(?:\.\d)?)/)[1]} 官方参数预设`, verified: false };
  return { fields: [], source: '接口未公开可读取的参数清单，请提供 OpenAPI 文档地址以自动生成字段', verified: false };
}

function parseUpload(upload) {
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(upload?.data || '');
  if (!match) throw Object.assign(new Error('参考图仅支持 PNG、JPEG 或 WebP'), { status: 400 });
  const binary = atob(match[3]);
  if (!binary.length || binary.length > 20 * 1024 * 1024) throw Object.assign(new Error('单张参考图须小于 20 MB'), { status: 400 });
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return { blob: new Blob([bytes], { type: match[1] }), filename: upload.name || 'reference.png' };
}

function normalizeImages(payload, format = 'png') {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.map(item => {
    if (typeof item?.b64_json === 'string') return `data:image/${format === 'jpg' ? 'jpeg' : format};base64,${item.b64_json}`;
    if (typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)) return item.url;
    return null;
  }).filter(Boolean);
}

async function generate(input, fetcher) {
  const { baseUrl, apiKey, model, prompt, mode, params = {}, images = [] } = input || {};
  if (!baseUrl || !apiKey || !model || !prompt?.trim()) throw Object.assign(new Error('请填写接口地址、API Key、模型和提示词'), { status: 400 });
  if (!['generate', 'edit'].includes(mode)) throw Object.assign(new Error('无效的生成模式'), { status: 400 });
  if(Object.keys(params).some(key=>['model','prompt','image','image[]'].includes(key)))throw Object.assign(new Error('请求包含保留参数'),{status:400});
  if (mode === 'edit' && !images.length) throw Object.assign(new Error('图生图请先上传参考图'), { status: 400 });
  const url = endpoint(baseUrl, mode);
  let body, headers = { Authorization: `Bearer ${apiKey}` };
  if (mode === 'generate') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ model, prompt, ...params });
  } else {
    const form = new FormData();
    form.append('model', model); form.append('prompt', prompt);
    for (const [key, value] of Object.entries(params)) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    for (const upload of images) { const { blob, filename } = parseUpload(upload); form.append('image[]', blob, filename); }
    body = form;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let response;
  try { response = await fetcher(url, { method: 'POST', headers, body, signal: controller.signal }); }
  catch (error) { throw Object.assign(new Error(error.name === 'AbortError' ? '接口请求超时（180 秒）' : `无法连接接口：${error.message}`), { status: 502 }); }
  finally { clearTimeout(timer); }
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  if (!response.ok) throw Object.assign(new Error(`接口返回 HTTP ${response.status}: ${raw.slice(0, 3000)}`), { status: 502 });
  const result = normalizeImages(payload, params.output_format || 'png');
  if (!result.length) throw Object.assign(new Error(`接口请求成功，但未找到图片。响应：${raw.slice(0, 3000)}`), { status: 502 });
  return { images: result, revisedPrompt: payload?.data?.[0]?.revised_prompt || null };
}

async function download(input, fetcher) {
  const target = new URL(input?.url);
  if (target.protocol !== 'https:' || target.username || target.password) throw Object.assign(new Error('下载地址无效'), { status: 400 });
  const response = await fetcher(target, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Object.assign(new Error(`图片下载失败：HTTP ${response.status}`), { status: 502 });
  const type = response.headers.get('content-type')?.split(';')[0] || '';
  if (!imageTypes.has(type)) throw Object.assign(new Error('接口返回的链接不是受支持的图片'), { status: 502 });
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBody) throw Object.assign(new Error('图片超过 35 MB'), { status: 413 });
  return reply(bytes, 200, type);
}

export function createWorker(fetcher = fetch) {
  return {
    async fetch(request, env = {}) {
      try {
        const pathname = new URL(request.url).pathname;
        const owner=isOwner(request,env);
        if(request.method==='GET'&&pathname==='/api/session')return reply({authenticated:owner||!!(await inviteIdentity(request,env))});
        if(request.method==='POST'&&pathname==='/api/invite'){const result=await redeemInvite((await readJson(request)).code,env);if(!result)return reply({error:'邀请码无效或尚未启用'},403);const response=reply({authenticated:true});response.headers.set('Set-Cookie',result.cookie);return response;}
        if(pathname.startsWith('/api/')&&!owner&&!await inviteIdentity(request,env))return reply({error:'请先输入内测邀请码'},401);
        if (request.method === 'POST' && pathname === '/api/generate') return reply(await generate(applyBuiltin(await readJson(request),env), fetcher));
        if (request.method === 'POST' && pathname === '/api/discover') return reply(await discover(await readJson(request), fetcher));
        if (request.method === 'POST' && pathname === '/api/download') return await download(await readJson(request), fetcher);
        if (request.method !== 'GET') return reply({ error: '不支持的请求方法' }, 405);
        const asset = assets[pathname === '/' ? '/index.html' : pathname];
        if (!asset) return reply({ error: '未找到页面' }, 404);
        const body = asset.base64 ? Uint8Array.from(atob(asset.body), char => char.charCodeAt(0)) : asset.body;
        return reply(body, 200, asset.type);
      } catch (error) {
        return reply({ error: error.message }, error.status || 500);
      }
    },
  };
}

export default createWorker();
