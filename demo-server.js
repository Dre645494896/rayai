import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RATIOS, TIERS, resolveSize } from './image-settings.js';

const derive = promisify(scrypt);
const version = 'demo-v1';
const prices = {
  standard: { Medium: 4, Pro: 6, Max: 9 },
  '2k': { Medium: 7, Pro: 10, Max: 15 },
  '4k': { Medium: 12, Pro: 17, Max: 24 },
};
const store = {
  plans: [
    { id: 'standard', name: '标准会员', price: 29, points: 350 },
    { id: 'pro', name: 'Pro 会员', price: 59, points: 800 },
    { id: 'max', name: 'Max 会员', price: 99, points: 1500 },
  ],
  packs: [
    { id: 'small', name: '100 积分', price: 10, points: 100 },
    { id: 'medium', name: '300 积分', price: 30, points: 300 },
    { id: 'large', name: '600 积分', price: 60, points: 600 },
  ],
};
const assets = {
  '/': ['demo.html', 'text/html'], '/demo.html': ['demo.html', 'text/html'],
  '/demo.css': ['demo.css', 'text/css'], '/demo-app.js': ['demo-app.js', 'text/javascript'],
  ...Object.fromEntries(['image-settings.js', 'aurora.js', 'chat-store.js', 'backup.js', 'demo-account.js', 'demo-reflective.js'].map(file => [`/${file}`, [file, 'text/javascript']])),
  ...Object.fromEntries(['style.css', 'simple.css', 'chat.css', 'chat-v2.css', 'chat-v3.css', 'demo-params.css'].map(file => [`/${file}`, [file, 'text/css']])),
  '/rayai-icon.png': ['rayai-icon.png', 'image/png'], '/favicon.ico': ['favicon.ico', 'image/x-icon'],
};
const hash = value => createHash('sha256').update(value).digest('hex');
const fault = (status, message) => Object.assign(new Error(message), { status });
const root = dirname(fileURLToPath(import.meta.url));
const demoCookie = (value, age) => `rayai_demo_sid=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const response = (res, data, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

function quote(tier, ratio, width, height) {
  if (!TIERS.includes(tier) || !RATIOS.includes(ratio)) throw fault(400, '请选择有效的尺寸档和画面比例。');
  if (ratio === 'custom' && ![width, height].every(value => (typeof value === 'number' || typeof value === 'string') && /^\d{1,4}$/.test(String(value)))) throw fault(400, '请输入自定义宽度和高度。');
  const size = resolveSize({ tier, ratio, width, height });
  if (size.error) throw fault(400, `此尺寸与比例不兼容：${size.error}`);
  const longest = Math.max(Number(width), Number(height));
  const billingTier = ratio === 'auto' ? 'standard' : ratio === 'custom' ? (longest <= 1536 ? 'standard' : longest <= 2048 ? '2k' : '4k') : tier;
  return { version, tier, ratio, size: size.size, billingTier, prices: prices[billingTier] };
}

async function body(req, maxBytes) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fault(415, '仅支持 JSON 请求。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.byteLength;
    if (size > maxBytes) { req.resume(); throw fault(413, '请求或参考图超过演示限制。'); }
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fault(400, '请求内容无效。'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw fault(400, '请求内容无效。');
  return value;
}

function credentials(input) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = input.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fault(400, '请输入有效的邮箱地址。');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw fault(400, '密码长度须为 8–128 个字符。');
  return { email, password };
}

function referenceHashes(references) {
  if (!Array.isArray(references) || references.length > 4) throw fault(400, '最多添加 4 张参考图。');
  return references.map(ref => {
    if (typeof ref?.name !== 'string' || ref.name.length > 255 || typeof ref.data !== 'string' || ref.data.length > 28000000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(ref.data)) throw fault(400, '参考图须为 PNG、JPEG 或 WebP，单张不超过 20 MB。');
    if (Buffer.byteLength(ref.data.slice(ref.data.indexOf(',') + 1), 'base64') > 20 * 1024 * 1024) throw fault(400, '单张参考图不能超过 20 MB。');
    return [ref.name, hash(ref.data)];
  });
}

function publicJob(row) {
  const { requestId, prompt, tier, ratio, quality, size, cost, status, error, createdAt, referenceCount } = row;
  return { requestId, prompt, tier, ratio, quality, size, cost, status, error, createdAt, referenceCount, imageUrl: status === 'success' ? `/demo-api/jobs/${encodeURIComponent(requestId)}/image` : null };
}

function sampleImage(row) {
  const [width, height] = (row.size === 'auto' ? '1024x1024' : row.size).split('x').map(Number);
  const palettes = [['#202337', '#df946f', '#575879', '#312b48'], ['#161f31', '#91b6d5', '#4b6385', '#263a53'], ['#2b2530', '#efbb84', '#947482', '#483847']];
  const [sky, sun, far, near] = palettes[parseInt(hash(row.prompt).slice(0, 2), 16) % palettes.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 900 600" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${far}"/></linearGradient><linearGradient id="water" x2="0" y2="1"><stop stop-color="${near}"/><stop offset="1" stop-color="${sky}"/></linearGradient></defs><rect width="900" height="600" fill="url(#sky)"/><circle cx="535" cy="240" r="83" fill="${sun}" opacity=".88"/><path fill="${far}" d="M0 378l128-115 67 46 95-105 147 139 116-66 142 84 91-117 114 100v75H0z"/><path fill="${near}" d="M0 382l70-42 89 37 115-64 169 75 99-19 141 31 122-76 95 46v76H0z"/><path fill="url(#water)" d="M0 420h900v180H0z"/><g stroke="${sun}" opacity=".28" stroke-linecap="round"><path d="M496 437h68m-105 17h145m-99 18h87m-154 21h194m-157 26h101m-119 39h176"/></g><path fill="${sky}" d="M0 548l151-29 181 81H0zm900-48-140 61-95 39h235z"/></svg>`;
}

export function createDemo({ dbPath = ':memory:', generationMs = 1600 } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password TEXT NOT NULL, balance INTEGER NOT NULL CHECK(balance>=0));
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, createdAt INTEGER NOT NULL, requestId TEXT, UNIQUE(userId,requestId,reason));
    CREATE TABLE IF NOT EXISTS demo_purchases (userId TEXT NOT NULL REFERENCES users(id), requestId TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('membership','topup')), itemId TEXT NOT NULL, points INTEGER NOT NULL CHECK(points>0), createdAt INTEGER NOT NULL, PRIMARY KEY(userId,requestId));
    CREATE TABLE IF NOT EXISTS jobs (userId TEXT NOT NULL REFERENCES users(id), requestId TEXT NOT NULL, fingerprint TEXT NOT NULL, prompt TEXT NOT NULL, tier TEXT NOT NULL, ratio TEXT NOT NULL, quality TEXT NOT NULL, size TEXT NOT NULL, cost INTEGER NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL CHECK(status in ('pending','success','failed')), error TEXT, createdAt INTEGER NOT NULL, referenceCount INTEGER NOT NULL, PRIMARY KEY(userId,requestId));`);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const ledger = (userId, delta, reason, requestId = null) => run('INSERT INTO ledger(userId,delta,reason,createdAt,requestId) VALUES(?,?,?,?,?)', userId, delta, reason, Date.now(), requestId);
  const findJob = (userId, id) => get('SELECT * FROM jobs WHERE userId=? AND requestId=?', userId, id);
  const balance = id => get('SELECT balance FROM users WHERE id=?', id).balance;
  const finish = (userId, id, error) => transaction(() => {
    const job = findJob(userId, id);
    if (!job || job.status !== 'pending') return;
    run('UPDATE jobs SET status=?, error=? WHERE userId=? AND requestId=?', error ? 'failed' : 'success', error, userId, id);
    if (error) {
      run('UPDATE users SET balance=balance+? WHERE id=?', job.cost, userId);
      ledger(userId, job.cost, 'refund', id);
    }
  });
  for (const { userId, requestId } of all("SELECT userId,requestId FROM jobs WHERE status='pending'")) finish(userId, requestId, '演示服务重启，积分已退回。');
  run('DELETE FROM sessions WHERE expiresAt<=?', Date.now());
  const timers = new Set();
  let active = 0;
  let closeDb = false;
  function session(req) {
    const token = req.headers.cookie?.match(/(?:^|;\s*)rayai_demo_sid=([a-f0-9]{64})(?:;|$)/)?.[1];
    return token ? get('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.userId WHERE token=? AND expiresAt>?', hash(token), Date.now()) : null;
  }
  function setSession(req, res, userId) {
    const token = randomBytes(32).toString('hex');
    const previous = req.headers.cookie?.match(/(?:^|;\s*)rayai_demo_sid=([a-f0-9]{64})(?:;|$)/)?.[1];
    if (previous) run('DELETE FROM sessions WHERE token=?', hash(previous));
    run('INSERT INTO sessions VALUES(?,?,?)', hash(token), userId, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', demoCookie(token, 7 * 86400));
  }
  const server = createServer(async (req, res) => {
    active++;
    try {
      const host = req.headers.host || '';
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) throw fault(403, '此演示仅在本机可用。');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${host}`) throw fault(403, '不允许跨站提交。');
      if (req.method === 'GET' && Object.hasOwn(assets, path)) {
        const [file, type] = assets[path];
        const data = await readFile(resolve(root, file));
        res.writeHead(200, { 'Content-Type': `${type}${type.startsWith('text/') ? '; charset=utf-8' : ''}` });
        return res.end(data);
      }
      if (!path.startsWith('/demo-api/')) throw fault(404, '此地址不属于本地演示。');
      if (req.method === 'GET' && path === '/demo-api/session') {
        const user = session(req) || null;
        return response(res, { user, balance: user ? balance(user.id) : 0 });
      }
      if (req.method === 'POST' && ['/demo-api/register', '/demo-api/login', '/demo-api/auth'].includes(path)) {
        const { email, password } = credentials(await body(req, 4096));
        const registerOnly = path.endsWith('/register');
        let existing = get('SELECT * FROM users WHERE email=?', email);
        let id;
        if (existing && registerOnly) throw fault(409, '该邮箱已注册，请登录。');
        if (!existing && !path.endsWith('/login')) {
          const newId = randomUUID();
          const salt = randomBytes(16).toString('hex');
          const digest = (await derive(password, salt, 64)).toString('hex');
          transaction(() => {
            existing = get('SELECT * FROM users WHERE email=?', email);
            if (existing) {
              if (registerOnly) throw fault(409, '该邮箱已注册，请登录。');
              return;
            }
            run('INSERT INTO users VALUES(?,?,?,?,?)', newId, email, salt, digest, 50);
            ledger(newId, 50, 'grant');
            id = newId;
          });
        }
        if (!id) {
          const digest = await derive(password, existing?.salt || 'rayai-demo-invalid-account', 64);
          if (!existing || !timingSafeEqual(Buffer.from(existing.password, 'hex'), digest)) throw fault(401, '邮箱或密码不正确。');
          id = existing.id;
        }
        setSession(req, res, id);
        return response(res, { user: { id, email }, balance: balance(id) });
      }
      if (req.method === 'POST' && path === '/demo-api/logout') {
        const token = req.headers.cookie?.match(/(?:^|;\s*)rayai_demo_sid=([a-f0-9]{64})(?:;|$)/)?.[1];
        if (token) run('DELETE FROM sessions WHERE token=?', hash(token));
        res.setHeader('Set-Cookie', demoCookie('', 0));
        return response(res, { ok: true });
      }
      if (req.method === 'GET' && path === '/demo-api/quote') {
        return response(res, quote(...['tier', 'ratio', 'width', 'height'].map(key => url.searchParams.get(key))));
      }
      if (req.method === 'GET' && path === '/demo-api/store') return response(res, store);
      const user = session(req);
      if (!user) throw fault(401, '请先登录演示账号。');
      if (req.method === 'POST' && path === '/demo-api/store/purchase') {
        const { kind, id, requestId } = await body(req, 4096);
        const items = kind === 'membership' ? store.plans : kind === 'topup' ? store.packs : null;
        const item = items?.find(entry => entry.id === id);
        if (!item || typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw fault(400, '请选择有效的演示套餐。');
        return response(res, transaction(() => {
          const previous = get('SELECT kind,itemId,points FROM demo_purchases WHERE userId=? AND requestId=?', user.id, requestId);
          if (previous) {
            if (previous.kind !== kind || previous.itemId !== id) throw fault(409, '此请求标识已用于其他套餐。');
            return { balance: balance(user.id), points: previous.points };
          }
          run('INSERT INTO demo_purchases VALUES(?,?,?,?,?,?)', user.id, requestId, kind, id, item.points, Date.now());
          run('UPDATE users SET balance=balance+? WHERE id=?', item.points, user.id);
          ledger(user.id, item.points, kind, requestId);
          return { balance: balance(user.id), points: item.points };
        }));
      }
      if (req.method === 'GET' && path === '/demo-api/ledger') return response(res, { balance: balance(user.id), entries: all('SELECT id,delta,reason,createdAt,requestId FROM ledger WHERE userId=? ORDER BY id DESC', user.id) });
      if (req.method === 'GET' && path === '/demo-api/jobs') return response(res, { jobs: all('SELECT * FROM jobs WHERE userId=? ORDER BY createdAt DESC, rowid DESC', user.id).map(publicJob), balance: balance(user.id) });
      if (req.method === 'POST' && path === '/demo-api/jobs') {
        const input = await body(req, 32 * 1024 * 1024);
        const { requestId, tier, ratio, quality } = input;
        const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
        if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId) || !prompt || prompt.length > 4000) throw fault(400, '请输入 1–4000 字的提示词并使用有效的请求标识。');
        const current = quote(tier, ratio, input.width, input.height);
        if (typeof quality !== 'string' || !Object.hasOwn(current.prices, quality)) throw fault(400, '请选择 Medium、Pro 或 Max。');
        const refs = referenceHashes(input.references ?? []);
        const simulateFailure = input.simulateFailure === true;
        const fields = [tier, ratio, quality, input.version, prompt, refs, simulateFailure];
        if (ratio === 'custom') fields.push(current.size);
        const fingerprint = hash(JSON.stringify(fields));
        const { job, created } = transaction(() => {
          const existing = findJob(user.id, requestId);
          if (existing) {
            if (existing.fingerprint !== fingerprint) throw fault(409, '此请求标识已用于其他内容。');
            return { job: existing, created: false };
          }
          if (input.version !== version) throw fault(409, '报价已更新，请重新确认。');
          const cost = current.prices[quality];
          const debit = run('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?', cost, user.id, cost);
          if (!debit.changes) throw fault(402, '积分不足，请选择其他尺寸或质量档次。');
          ledger(user.id, -cost, 'charge', requestId);
          run("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,'pending',NULL,?,?)", user.id, requestId, fingerprint, prompt, tier, ratio, quality, current.size, cost, version, Date.now(), refs.length);
          return { job: findJob(user.id, requestId), created: true };
        });
        if (created) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            try { finish(user.id, requestId, simulateFailure ? '模拟生成失败，积分已退回。' : null); }
            catch (error) { console.error('Demo job completion failed:', error.message); }
          }, generationMs);
          timers.add(timer);
        }
        return response(res, { job: publicJob(job), balance: balance(user.id) }, created ? 202 : 200);
      }
      const match = /^\/demo-api\/jobs\/([a-zA-Z0-9_-]{8,80})(\/image)?$/.exec(path);
      if (req.method === 'GET' && match) {
        const job = findJob(user.id, match[1]);
        if (!job || (match[2] && job.status !== 'success')) throw fault(404, '此任务或图片不存在。');
        if (match[2]) { res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); return res.end(sampleImage(job)); }
        return response(res, { job: publicJob(job), balance: balance(user.id) });
      }
      throw fault(404, '未找到此演示接口。');
    } catch (error) {
      if (!error.status) console.error('Demo request failed:', error.message);
      if (!res.headersSent && !res.destroyed) response(res, { error: error.status ? error.message : '本地演示请求失败，请重试。' }, error.status || 500);
      else if (!res.writableEnded) res.end();
    } finally {
      if (--active === 0 && closeDb) db.close();
    }
  });
  server.on('close', () => {
    for (const timer of timers) clearTimeout(timer);
    closeDb = true;
    if (!active) db.close();
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(root, '.demo-data');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const server = createDemo({ dbPath: resolve(dir, 'rayai.sqlite') });
  server.listen(Number(process.env.DEMO_PORT || 4175), '127.0.0.1', () => console.log(`RayAI 本地演示：http://127.0.0.1:${server.address().port}`));
}
