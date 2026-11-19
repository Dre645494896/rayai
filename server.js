import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { officialFields, sanitizeOutput } from './image-settings.js';
import { redeemInvite, inviteIdentity } from './invite-auth.js';
import { applyBuiltin } from './builtin-models.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const maxBody = 35 * 1024 * 1024;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBody) throw Object.assign(new Error('上传内容超过 35 MB'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
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

function imageFromData(item, format = 'png') {
  if (typeof item?.b64_json === 'string') return `data:image/${format === 'jpg' ? 'jpeg' : format};base64,${item.b64_json}`;
  if (typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)) return item.url;
  return null;
}

export function normalizeImages(payload, format = 'png') {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.map(item => imageFromData(item, format)).filter(Boolean);
}

export async function discover(input, fetcher = fetch) {
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
      const fields = Object.entries(properties).filter(([name]) => !['model','prompt','image'].includes(name)).map(([name, rule]) => ({ name, type: rule.enum ? 'select' : rule.type === 'integer' || rule.type === 'number' ? 'number' : rule.type === 'boolean' ? 'boolean' : 'text', options: rule.enum?.join(',') || '', value: rule.default === undefined ? '' : String(rule.default), modes: 'both' }));
      return { fields: sanitizeOutput(fields), source: `已从 ${url.pathname} 读取参数`, verified: true };
    } catch {}
  }
  const preset=officialFields(model);
  if (preset) return { fields: preset, source:`接口未公开参数清单；已使用 GPT Image ${model.match(/^gpt-image-(2(?:\.\d)?)/)[1]} 官方参数预设`, verified:false };
  return { fields:[], source:'接口未公开可读取的参数清单，请提供 OpenAPI 文档地址以自动生成字段', verified:false };
}

function parseUpload(upload) {
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(upload?.data || '');
  if (!match) throw Object.assign(new Error('参考图仅支持 PNG、JPEG 或 WebP'), { status: 400 });
  const bytes = Buffer.from(match[3], 'base64');
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw Object.assign(new Error('单张参考图须小于 20 MB'), { status: 400 });
  return { blob: new Blob([bytes], { type: match[1] }), filename: upload.name || 'reference.png' };
}

export async function generate(input, fetcher = fetch) {
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

export function createServer(fetcher = fetch, env = process.env) {
  const localDev = env.NODE_ENV !== 'production';
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, `http://${host}`).pathname;
      if(pathname.startsWith('/api/')&&req.headers.origin){
        const sameOrigin=new URL(req.headers.origin).host===req.headers.host;
        if(!sameOrigin&&req.headers.origin!==env.FRONTEND_ORIGIN)return send(res,403,{error:'不允许的网页来源'});
        if(!sameOrigin){
          res.setHeader('Access-Control-Allow-Origin',req.headers.origin);
          res.setHeader('Vary','Origin');
          res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
          res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
        }
      }
      if(req.method==='OPTIONS'&&pathname.startsWith('/api/'))return send(res,204,'');
      if(req.method==='GET'&&pathname==='/api/health')return send(res,200,{ok:true});
      const identityRequest=new Request('http://localhost',{headers:{cookie:req.headers.cookie||'',authorization:req.headers.authorization||''}});
      if(req.method==='GET'&&pathname==='/api/session')return send(res,200,{authenticated:!!(await inviteIdentity(identityRequest,env,localDev))});
      if(req.method==='POST'&&pathname==='/api/invite'){const result=await redeemInvite((await readJson(req)).code,env);if(!result)return send(res,403,{error:'邀请码无效或尚未启用'});res.setHeader('Set-Cookie',result.cookie);return send(res,200,{authenticated:true,token:result.token,expiresAt:result.expiresAt});}
      if(pathname.startsWith('/api/')&&!await inviteIdentity(identityRequest,env,localDev))return send(res,401,{error:'请先输入内测邀请码'});
      if (req.method === 'POST' && req.url === '/api/generate') return send(res, 200, await generate(applyBuiltin(await readJson(req),env), fetcher));
      if (req.method === 'POST' && req.url === '/api/discover') return send(res, 200, await discover(await readJson(req), fetcher));
      if (req.method === 'POST' && req.url === '/api/download') {
        const { url } = await readJson(req);
        const target = new URL(url);
        if (target.protocol !== 'https:' || target.username || target.password) throw Object.assign(new Error('下载地址无效'), { status: 400 });
        const response = await fetcher(target, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw Object.assign(new Error(`图片下载失败：HTTP ${response.status}`), { status: 502 });
        const type = response.headers.get('content-type')?.split(';')[0] || '';
        if (!['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'].includes(type)) throw Object.assign(new Error('接口返回的链接不是受支持的图片'), { status: 502 });
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > maxBody) throw Object.assign(new Error('图片超过 35 MB'), { status: 413 });
        return send(res, 200, bytes, type);
      }
      if (req.method !== 'GET') return send(res, 405, { error: '不支持的请求方法' });
      if(pathname !== '/' && !/^\/[A-Za-z0-9][A-Za-z0-9.-]*\.(html|js|css|svg|png|ico)$/.test(pathname)) return send(res, 404, { error: '未找到页面' });
      const file = path.join(root, pathname === '/' ? 'index.html' : pathname.slice(1));
      return send(res, 200, await readFile(file), types[path.extname(file)]);
    } catch (error) { return send(res, error.status || (error.code === 'ENOENT' ? 404 : 500), { error: error.message }); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(port, host, () => console.log(`本地生图网站：http://${host}:${port}`));
}
