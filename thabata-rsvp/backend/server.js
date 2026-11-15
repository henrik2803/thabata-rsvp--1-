import http from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { openDatabase } from './database.js';
import { startupDiagnostic, startupError } from './startup-errors.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = { '/': 'index.html', '/admin': 'admin.html', '/style.css': 'style.css',
  '/fonts/Fredoka.ttf': 'fonts/Fredoka.ttf', '/app.js': 'app.js', '/admin.js': 'admin.js' };
const mime = { '.ttf': 'font/ttf', '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};
class InvalidBody extends Error {}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new InvalidBody();
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new InvalidBody(); }
}
const cleanName = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const validName = (value, min) => value.length >= min && value.length <= 100 &&
  /\p{L}/u.test(value) && !/[\u0000-\u001f\u007f]/u.test(value);

// Direct installs ignore forwarded headers. With one trusted proxy, only its
// rightmost appended address is used, never the untrusted leftmost value.
export function clientIP(req, trustProxyHops = 0) {
  const direct = req.socket.remoteAddress || 'unknown';
  if (trustProxyHops !== 1) return direct;
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded !== 'string') return direct;
  const last = forwarded.split(',').at(-1).trim();
  return isIP(last) ? last : direct;
}

export async function createApplication(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const password = options.password ?? process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error('ADMIN_PASSWORD deve ter pelo menos 12 caracteres.');
  const proxyHops = Number(options.trustProxyHops ?? process.env.TRUST_PROXY_HOPS ?? 0);
  if (![0, 1].includes(proxyHops)) throw new Error('TRUST_PROXY_HOPS deve ser 0 ou 1.');
  const originValue = options.appOrigin ?? process.env.APP_ORIGIN ?? process.env.RENDER_EXTERNAL_URL;
  let appOrigin;
  if (originValue) {
    let url;
    try { url = new URL(originValue); } catch { throw startupError('CONFIG_ORIGIN'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || (production && url.protocol !== 'https:')) {
      throw new Error('APP_ORIGIN deve ser a origem pública HTTPS, sem caminho.');
    }
    appOrigin = url.origin;
  }
  if (production && !appOrigin) throw new Error('Configure APP_ORIGIN ou RENDER_EXTERNAL_URL.');
  const db = options.db ?? await openDatabase({
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL,
    dataDir: options.dataDir ?? process.env.DATA_DIR ?? path.join(root, 'data'), production,
  });
  const logger = options.logger ?? (entry => console.error(JSON.stringify(entry)));
  const salt = randomBytes(16), hash = scryptSync(password, salt, 64);
  const sessions = new Map(), limits = new Map();
  const cookie = (token, age = 28800) => `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${production ? '; Secure' : ''}`;
  function rate(req, key, max) {
    const now = Date.now(), k = `${key}:${clientIP(req, proxyHops)}`;
    let value = limits.get(k);
    if (!value || value.until <= now) {
      if (limits.size >= 10000 && !limits.has(k)) return false;
      value = { count: 0, until: now + 900000 }; limits.set(k, value);
    }
    return ++value.count <= max;
  }
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, until] of sessions) if (until <= now) sessions.delete(k);
    for (const [k, value] of limits) if (value.until <= now) limits.delete(k);
  }, 60000);
  cleanup.unref();
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let route = 'unknown';
    try {
      let p;
      try { p = new URL(req.url, 'http://localhost').pathname; } catch { return send(res, 400, { error: 'Requisição inválida.' }); }
      route = p === '/api/rsvp' ? 'rsvp' : p === '/healthz' ? 'health' : p.startsWith('/api/admin/') ? 'admin' : 'other';
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'Origem não autorizada.' });
        if (req.headers.origin) {
          let origin;
          try { origin = new URL(req.headers.origin).origin; } catch { return send(res, 403, { error: 'Origem não autorizada.' }); }
          const expected = appOrigin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
          if (origin !== expected) return send(res, 403, { error: 'Origem não autorizada.' });
        }
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Envie JSON.' });
      }
      const token = (req.headers.cookie || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const auth = token && sessions.get(token) > Date.now();
      if (p === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
        await db.health(); return send(res, 200, { ok: true });
      }
      if (p === '/api/rsvp' && req.method === 'POST') {
        if (!rate(req, 'rsvp', 20)) return send(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos.' });
        const data = await body(req), name = cleanName(data.name);
        let phone = typeof data.phone === 'string' ? data.phone.replace(/\D/g, '') : '';
        if (phone.startsWith('55') && phone.length >= 12) phone = phone.slice(2);
        if (!validName(name, 3) || !/^[1-9]{2}[2-9]\d{7,8}$/.test(phone) || data.consent !== true) {
          return send(res, 400, { error: 'Informe seu nome, telefone com DDD e aceite o uso dos dados.' });
        }
        const companions = data.companions ?? [];
        if (!Array.isArray(companions) || companions.length > 20 || companions.some(c =>
          !c || typeof c !== 'object' || !validName(cleanName(c.name), 2) || !['0-4', '5-9', '10+'].includes(c.ageGroup))) {
          return send(res, 400, { error: 'Informe nome e faixa etária de cada acompanhante (máximo 20).' });
        }
        const inserted = await db.insertGuest({ name, phone, created_at: new Date().toISOString(),
          companions: companions.map(c => ({ name: cleanName(c.name), ageGroup: c.ageGroup })) });
        if (!inserted) return send(res, 409, { error: 'Este telefone já tem uma confirmação. Para alterar seu grupo, entre em contato com a organização.' });
        return send(res, 201, { message: 'Presença confirmada!', total: 1 + companions.length });
      }
      if (p === '/api/login' && req.method === 'POST') {
        if (!rate(req, 'login', 10)) return send(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos.' });
        const data = await body(req);
        const candidate = scryptSync(typeof data.password === 'string' ? data.password : '', salt, 64);
        if (!timingSafeEqual(candidate, hash)) return send(res, 401, { error: 'Senha incorreta.' });
        const session = randomBytes(32).toString('hex'); sessions.set(session, Date.now() + 28800000);
        res.setHeader('Set-Cookie', cookie(session)); return send(res, 200, { ok: true });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        sessions.delete(token); res.setHeader('Set-Cookie', cookie('', 0)); return send(res, 200, { ok: true });
      }
      if (p.startsWith('/api/admin/')) {
        if (!auth) return send(res, 401, { error: 'Faça login para acessar o painel.' });
        if (p === '/api/admin/guests' && req.method === 'GET') return send(res, 200, { guests: await db.listGuests() });
        if (/^\/api\/admin\/guests\/\d+$/.test(p) && req.method === 'DELETE') {
          const id = Number(p.split('/').pop());
          if (!Number.isSafeInteger(id) || id < 1) return send(res, 400, { error: 'Grupo inválido.' });
          const deleted = await db.deleteGuest(id); return send(res, deleted ? 200 : 404, { ok: deleted });
        }
      }
      if (['GET', 'HEAD'].includes(req.method) && files[p]) {
        res.setHeader('Content-Type', mime[path.extname(files[p])]);
        res.end(req.method === 'HEAD' ? '' : readFileSync(path.join(root, 'public', files[p]))); return;
      }
      send(res, 404, { error: 'Não encontrado.' });
    } catch (error) {
      if (error instanceof InvalidBody) return send(res, 400, { error: 'Dados inválidos. Revise os campos e tente novamente.' });
      // Omit exception messages, URLs, headers and request bodies from logs.
      logger({ event: 'request_failed', requestId, route, code: /^\d{5}$/.test(error.code || '') ? error.code : 'INTERNAL' });
      send(res, route === 'health' ? 503 : 500, { error: 'Não foi possível concluir. Seus dados continuam no formulário; tente novamente.', requestId });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, db, async close() {
    clearInterval(cleanup);
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await db.close();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let app;
  try {
    app = await createApplication();
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT inválida.');
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(port, '0.0.0.0', () => { app.server.off('error', reject); resolve(); });
    });
    console.log(`Servidor pronto na porta ${app.server.address().port}. Painel: /admin`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); });
  } catch (error) {
    if (app) await app.close().catch(() => {});
    const diagnostic = startupDiagnostic(error);
    console.error(`Falha ao iniciar [${diagnostic.code}]: ${diagnostic.message}`);
    process.exitCode = 1;
  }
}
