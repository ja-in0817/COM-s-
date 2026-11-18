import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase } from './database.mjs';
import { handleAuth, provisionAdmin, readSession, parseCookies, cookieNames, safeEqual, digest, fail } from './auth.mjs';
import { handleDomain, anonymizeUser } from './domain.mjs';

const DEFAULT_DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const WRITE_METHODS = new Set(['POST','PUT','PATCH','DELETE']);
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webp':'image/webp','.woff2':'font/woff2','.json':'application/json; charset=utf-8'};

function headers(res, secure) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
  if (secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
}
function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(body));
}
async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) fail(415,'JSON 요청만 사용할 수 있어요.');
  if (Number(req.headers['content-length'] || 0) > 16384) fail(413,'요청 내용이 너무 길어요.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) fail(413,'요청 내용이 너무 길어요.');
    chunks.push(chunk);
  }
  let result;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { fail(400,'요청 내용을 읽을 수 없어요.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400,'올바른 요청 형식이 아니에요.');
  return result;
}
function limiter() {
  const buckets = new Map();
  let sweeps = 0;
  return (key, max, windowMs, now) => {
    if (++sweeps % 100 === 0 || buckets.size > 10000) {
      for (const [k,v] of buckets) if (v.reset <= now) buckets.delete(k);
      if (buckets.size > 10000) fail(429,'잠시 후 다시 시도해 주세요.');
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) { bucket = {count:0,reset:now+windowMs}; buckets.set(key,bucket); }
    if (++bucket.count > max) fail(429,'요청이 많아요. 잠시 후 다시 시도해 주세요.');
  };
}
function expectedOrigin(config, req) {
  const value = typeof config.origin === 'function' ? config.origin(req) : config.origin;
  return new URL(value).origin;
}

const normalizedIp = value => String(value || '').replace(/^::ffff:/,'');
export function clientAddress(req, config) {
  const direct = normalizedIp(req.socket.remoteAddress);
  // Render explicitly documents that its edge overwrites CF-Connecting-IP.
  // This mode is opt-in and the production launcher also requires RENDER=true.
  // https://render.com/articles/host-pocketbase-on-render
  const header = config.trustRenderProxy ? req.headers['cf-connecting-ip']
    : config.trustedProxyIp && direct === normalizedIp(config.trustedProxyIp) ? req.headers['x-real-ip'] : null;
  if (header !== null) {
    if (typeof header !== 'string' || !isIP(header)) fail(400,'올바른 프록시 연결 정보가 아니에요.');
    return normalizedIp(header);
  }
  return direct;
}

export async function createApp(options = {}) {
  const config = {
    dbPath: options.dbPath || process.env.DATABASE_PATH || './data/moa.sqlite',
    origin: options.origin || process.env.APP_ORIGIN || (process.env.RENDER === 'true' && process.env.RENDER_EXTERNAL_URL) || 'http://localhost:3000',
    secureCookies: options.secureCookies ?? process.env.NODE_ENV === 'production',
    rateLimits: options.rateLimits !== false,
    trustRenderProxy: options.trustRenderProxy ?? (process.env.TRUST_RENDER_PROXY === '1' && process.env.RENDER === 'true'),
    trustedProxyIp: options.trustedProxyIp || process.env.TRUSTED_PROXY_IP || '',
    distPath: resolve(options.distPath || DEFAULT_DIST),
    now: options.now || Date.now,
  };
  if (process.env.TRUST_RENDER_PROXY === '1' && process.env.RENDER !== 'true' && options.trustRenderProxy === undefined) throw new Error('TRUST_RENDER_PROXY is only supported on Render.');
  if (config.trustedProxyIp && !isIP(config.trustedProxyIp)) throw new Error('TRUSTED_PROXY_IP must be one exact proxy IP address.');
  if (process.env.NODE_ENV === 'production') {
    if (typeof config.origin !== 'string' || !config.origin.startsWith('https://') || !config.secureCookies) throw new Error('Production requires a configured HTTPS APP_ORIGIN and secure cookies.');
  }
  if (typeof config.origin === 'string') {
    const parsed = new URL(config.origin);
    if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('APP_ORIGIN must be a bare HTTP(S) origin.');
  }
  const db = openDatabase(config.dbPath), rate = limiter();
  if (process.env.INITIAL_ADMIN_USERNAME && process.env.INITIAL_ADMIN_PASSWORD && !db.prepare("SELECT 1 FROM users WHERE role = 'admin' AND disabled_at IS NULL").get()) {
    await provisionAdmin(db,{username:process.env.INITIAL_ADMIN_USERNAME,password:process.env.INITIAL_ADMIN_PASSWORD});
  }
  // Bootstrap values are never logged, returned by an API, or used as ongoing credentials.
  delete process.env.INITIAL_ADMIN_PASSWORD;
  const server = createServer(async (req,res) => {
    headers(res,config.secureCookies);
    try {
      const origin = expectedOrigin(config,req);
      const url = new URL(req.url || '/',origin);
      if (url.origin !== origin) fail(400,'올바른 요청 주소가 아니에요.');
      const now = config.now();
      if (url.pathname === '/api/health' && req.method === 'GET') {
        db.prepare('SELECT 1').get();
        return send(res,200,{ok:true,storage:'sqlite',version:'1.0.0'});
      }
      if (url.pathname.startsWith('/api/')) {
        const cookies = parseCookies(req);
        let {user,session} = readSession(db,cookies,config.secureCookies,now);
        let body = {};
        if (WRITE_METHODS.has(req.method)) {
          if (req.headers.origin !== origin || ['cross-site','none'].includes(String(req.headers['sec-fetch-site'] || ''))) fail(403,'같은 사이트에서 다시 시도해 주세요.');
          const token = req.headers['x-csrf-token'], cookie = cookies[cookieNames(config.secureCookies).csrf];
          if (!token || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !safeEqual(token,cookie) || (session && !safeEqual(digest(token),session.csrf_hash))) fail(403,'화면을 새로고침한 후 다시 시도해 주세요.');
          const address = config.rateLimits ? clientAddress(req,config) : '';
          if (config.rateLimits) rate(`write:${user?.id || address}`,180,60*1000,now);
          body = await jsonBody(req);
          const hadSession = !!session;
          // The body may arrive slowly. Revocation while receiving it must take effect
          // before a profile, invite, membership, or other authenticated write runs.
          ({user,session} = readSession(db,cookies,config.secureCookies,config.now()));
          if (hadSession && !session) fail(401,'로그인이 만료됐어요. 다시 로그인해 주세요.');
          if (session && !safeEqual(digest(token),session.csrf_hash)) fail(403,'화면을 새로고침한 후 다시 시도해 주세요.');
          if (config.rateLimits && ['/api/auth/login','/api/auth/register','/api/auth/password','/api/account'].includes(url.pathname)) {
            rate(`auth-ip:${address}`,100,15*60*1000,now);
            // Account limits also apply; arbitrary forwarding headers remain untrusted.
            rate(`auth-user:${digest(String(body.username || user?.id || '').toLowerCase().slice(0,128))}`,12,15*60*1000,now);
          }
        } else if (!['GET','HEAD'].includes(req.method)) {
          fail(405,'지원하지 않는 요청 방식이에요.');
        }
        const auth = await handleAuth({req,url,body,user,session,cookies,res,db,now,config,anonymizeUser});
        if (auth) return send(res,auth.status || 200,auth.body);
        const result = await handleDomain({req,url,body,user,db,now,config});
        if (result) return send(res,result.status || 200,result.body);
        return send(res,404,{error:'요청한 기능을 찾을 수 없어요.'});
      }
      if (!['GET','HEAD'].includes(req.method)) fail(405,'지원하지 않는 요청 방식이에요.');
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { fail(400,'올바른 요청 주소가 아니에요.'); }
      if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part.startsWith('.'))) fail(404,'페이지를 찾을 수 없어요.');
      let file = resolve(config.distPath, `.${decoded}`);
      if (file !== config.distPath && !file.startsWith(config.distPath+sep)) fail(404,'페이지를 찾을 수 없어요.');
      try { if (!(await stat(file)).isFile()) file = resolve(config.distPath,'index.html'); }
      catch { if (extname(file)) fail(404,'파일을 찾을 수 없어요.'); file = resolve(config.distPath,'index.html'); }
      let content;
      try { content = await readFile(file); } catch { return send(res,503,{error:'화면 빌드가 준비되지 않았어요. 운영자가 npm run build를 실행해야 합니다.'}); }
      const extension = extname(file);
      res.setHeader('Content-Type',TYPES[extension] || 'application/octet-stream');
      res.setHeader('Cache-Control',file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.setHeader('Content-Length',content.length);
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
      // No body, SQL parameter, credential, contact, or message text is written to logs.
      if (status === 500) console.error(JSON.stringify({event:'request_error',type:error.code || error.name || 'Error'}));
      if (status === 429) res.setHeader('Retry-After','60');
      send(res,status,{error:status===500?'처리하지 못했어요. 잠시 후 다시 시도해 주세요.':error.message});
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    if (server.listening) await new Promise((ok,reject) => { server.close(error=>error?reject(error):ok()); server.closeIdleConnections(); });
    db.close();
  }
  return {server,db,close,config};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await createApp();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a number between 1 and 65535.');
  app.server.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'server_ready',port,version:'1.0.0'})));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.close().then(()=>process.exit(0)));
}
