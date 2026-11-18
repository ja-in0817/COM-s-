import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { transaction } from './database.mjs';

const scrypt = promisify(scryptCallback);
const CONSENT_VERSION = 'moa-youth-2026-11-v1';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_SALT = 'c7a53672d17bd962707e261b78c2fc16';
let activeHashes = 0;
async function deriveKey(password, salt) {
  if (activeHashes >= 4) fail(503,'로그인 요청을 처리하고 있어요. 잠시 후 다시 시도해 주세요.');
  activeHashes++;
  try { return await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}); }
  finally { activeHashes--; }
}

export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function randomToken() { return randomBytes(32).toString('base64url'); }
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function publicUser(user) {
  if (!user) return null;
  const { id, username, nickname, role, age, age_group, district, availability, participation_mode, intensity, created_at } = user;
  return { id, username, nickname, role, age, age_group, district, interests: JSON.parse(user.interests || '[]'), availability, participation_mode, intensity, created_at };
}
export function audit(db, actor, action, target, detail = {}, now = Date.now()) {
  db.prepare('INSERT INTO audit_log(id,actor_id,action,target_id,detail,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), actor, action, target, JSON.stringify(detail), now);
}
function usernameValue(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(value)) fail(400, '아이디는 영문·숫자·밑줄로 3~32자 입력해 주세요.');
  return value.toLowerCase();
}
function nicknameValue(value) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 24) fail(400, '별명은 2~24자로 입력해 주세요.');
  return value.trim();
}
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || Buffer.byteLength(value) > 512) fail(400, '비밀번호는 12~128자로 입력해 주세요.');
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await deriveKey(password, salt);
  return `scrypt:32768:8:1:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128 || Buffer.byteLength(password) > 512) return false;
  const parts = typeof stored === 'string' ? stored.split(':') : [];
  const valid = parts.length === 6 && parts[0] === 'scrypt' && parts[1] === '32768' && parts[2] === '8' && parts[3] === '1' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  const actual = await deriveKey(password, valid ? parts[4] : DUMMY_SALT);
  const expected = valid ? Buffer.from(parts[5], 'hex') : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && valid;
}
export async function provisionAdmin(db, { username, password, nickname = '모아 운영자' }) {
  const normalized = usernameValue(username), name = nicknameValue(nickname);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(normalized)) fail(409, '이미 존재하는 아이디입니다.');
  const hash = await hashPassword(password), id = randomUUID(), now = Date.now();
  transaction(db, () => {
    db.prepare("INSERT INTO users(id,username,password_hash,nickname,role,age,age_group,created_at,consent_version,consent_at) VALUES(?,?,?,?, 'admin',NULL,'staff',?,?,?)")
      .run(id, normalized, hash, name, now, CONSENT_VERSION, now);
    audit(db, id, 'admin.provision', id, {}, now);
  });
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}
export function cookieNames(secure) { return { session: secure ? '__Host-moa_session' : 'moa_session', csrf: secure ? '__Host-moa_csrf' : 'moa_csrf' }; }
export function parseCookies(req) {
  const result = {};
  for (const chunk of String(req.headers.cookie || '').split(';')) {
    const index = chunk.indexOf('=');
    if (index < 1) continue;
    const key = chunk.slice(0,index).trim();
    // Reject ambiguous duplicate security cookies rather than accepting a shadow value.
    if (Object.hasOwn(result,key)) result[key] = '';
    else result[key] = chunk.slice(index+1).trim();
  }
  return result;
}
export function pushCookie(res, name, value, secure, maxAge = SESSION_MS / 1000) {
  const existing = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`]);
}
export function readSession(db, cookies, secure, now) {
  const token = cookies[cookieNames(secure).session];
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { user: null, session: null };
  const session = db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').get(digest(token), now);
  if (!session) return { user:null, session:null };
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND disabled_at IS NULL').get(session.user_id);
  return user ? {user,session} : {user:null,session:null};
}
export function csrfForRequest(db, cookies, session, res, secure) {
  const name = cookieNames(secure).csrf;
  let token = cookies[name];
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || (session && !safeEqual(session.csrf_hash, digest(token)))) {
    token = randomToken();
    pushCookie(res, name, token, secure);
    if (session) db.prepare('UPDATE auth_sessions SET csrf_hash = ? WHERE token_hash = ?').run(digest(token), session.token_hash);
  }
  return token;
}
function createSession(db, userId, res, secure, now, oldSession) {
  const token = randomToken(), csrf = randomToken(), names = cookieNames(secure);
  transaction(db, () => {
    if (oldSession) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(oldSession.token_hash);
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
    // Bound the number of active sessions per account.
    db.prepare('DELETE FROM auth_sessions WHERE token_hash IN (SELECT token_hash FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 9)').run(userId);
    db.prepare('INSERT INTO auth_sessions(token_hash,user_id,csrf_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(digest(token), userId, digest(csrf), now, now+SESSION_MS);
  });
  pushCookie(res,names.session,token,secure);
  pushCookie(res,names.csrf,csrf,secure);
  return csrf;
}
export function requireUser(user) { if (!user) fail(401, '로그인이 필요해요.'); return user; }
function requireStaff(user) { requireUser(user); if (!['admin','moderator'].includes(user.role)) fail(403, '운영자만 사용할 수 있어요.'); }

export async function handleAuth({req,url,body,user,session,cookies,res,db,now,config,anonymizeUser}) {
  const path = url.pathname, method = req.method, secure = config.secureCookies;
  if (path === '/api/me' && method === 'GET') return {body:{user:publicUser(user),csrf_token:csrfForRequest(db,cookies,session,res,secure),capabilities:{registration:'invite',ai_enabled:false,external_referral:false}}};
  if (path === '/api/auth/register' && method === 'POST') {
    if (user) fail(409,'로그아웃한 후 새 계정으로 가입해 주세요.');
    const username = usernameValue(body.username), nickname = nicknameValue(body.nickname);
    validatePassword(body.password);
    if (body.consent !== true) fail(400,'이용 안내와 개인정보 처리 안내를 확인하고 동의해 주세요.');
    if (typeof body.invite_code !== 'string' || body.invite_code.length > 128) fail(400,'유효한 초대코드가 필요해요.');
    const codeHash = digest(body.invite_code.trim());
    let invite = db.prepare('SELECT * FROM invitations WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?').get(codeHash,now);
    if (!invite) fail(400,'사용할 수 없거나 만료된 초대코드예요.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409,'이미 사용 중인 아이디예요.');
    const hash = await hashPassword(body.password), id = randomUUID();
    transaction(db, () => {
      // Re-read after the asynchronous password hash; a code can only be consumed once.
      invite = db.prepare('SELECT * FROM invitations WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?').get(codeHash,Date.now());
      if (!invite) fail(400,'사용할 수 없거나 만료된 초대코드예요.');
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409,'이미 사용 중인 아이디예요.');
      db.prepare("INSERT INTO users(id,username,password_hash,nickname,role,age,age_group,created_at,consent_version,consent_at) VALUES(?,?,?,?, 'participant',?,?,?,?,?)")
        .run(id,username,hash,nickname,invite.age,invite.age_group,now,CONSENT_VERSION,now);
      db.prepare('UPDATE invitations SET used_at = ?, used_by = ? WHERE id = ?').run(now,id,invite.id);
      audit(db,id,'account.register',id,{invitation_id:invite.id,consent_version:CONSENT_VERSION},now);
    });
    const csrf = createSession(db,id,res,secure,now,session);
    return {status:201,body:{user:publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)),csrf_token:csrf}};
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const username = typeof body.username === 'string' ? body.username.toLowerCase().slice(0,128) : '';
    const candidate = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const valid = await verifyPassword(body.password,candidate?.password_hash);
    if (!valid || !candidate || candidate.disabled_at) fail(401,'아이디 또는 비밀번호를 확인해 주세요.');
    // A concurrent deletion or password reset must win over a stale login attempt.
    const current = db.prepare('SELECT * FROM users WHERE id = ? AND disabled_at IS NULL AND password_hash = ?').get(candidate.id,candidate.password_hash);
    if (!current) fail(401,'아이디 또는 비밀번호를 확인해 주세요.');
    const csrf = createSession(db,current.id,res,secure,now,session);
    audit(db,current.id,'account.login',current.id,{},now);
    return {body:{user:publicUser(current),csrf_token:csrf}};
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    if (session) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(session.token_hash);
    const names = cookieNames(secure), csrf = randomToken();
    pushCookie(res,names.session,'',secure,0); pushCookie(res,names.csrf,csrf,secure);
    return {body:{ok:true,csrf_token:csrf}};
  }
  if (path === '/api/auth/password' && method === 'POST') {
    requireUser(user);
    if (!(await verifyPassword(body.current_password,user.password_hash))) fail(403,'현재 비밀번호가 맞지 않아요.');
    const hash = await hashPassword(body.new_password);
    transaction(db,()=>{
      const changed = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ? AND disabled_at IS NULL').run(hash,user.id,user.password_hash);
      if (!changed.changes) fail(409,'계정 상태가 변경됐어요. 다시 로그인해 주세요.');
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash <> ?').run(user.id,session.token_hash);
      audit(db,user.id,'account.password_change',user.id,{},now);
    });
    return {body:{ok:true}};
  }
  if (path === '/api/account' && method === 'DELETE') {
    requireUser(user);
    if (!(await verifyPassword(body.password,user.password_hash))) fail(403,'비밀번호가 맞지 않아요.');
    if (user.role === 'admin' && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL").get().n <= 1) fail(409,'마지막 운영자 계정은 먼저 다른 운영자를 지정해야 삭제할 수 있어요.');
    transaction(db,()=>{
      if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND password_hash = ? AND disabled_at IS NULL').get(user.id,user.password_hash)) fail(409,'계정 상태가 변경됐어요. 다시 로그인해 주세요.');
      anonymizeUser(db,user.id,now);
      db.prepare("UPDATE users SET username = ?, password_hash = '', nickname = '탈퇴한 이용자', district = '', interests = '[]', availability = '', disabled_at = ? WHERE id = ?")
        .run(`deleted_${randomBytes(12).toString('hex')}`,now,user.id);
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
      db.prepare('UPDATE invitations SET label = ? WHERE used_by = ?').run('사용 완료',user.id);
      audit(db,user.id,'account.delete',user.id,{},now);
    });
    const names = cookieNames(secure);
    pushCookie(res,names.session,'',secure,0); pushCookie(res,names.csrf,'',secure,0);
    return {body:{ok:true}};
  }
  if (path === '/api/admin/invites' && method === 'GET') {
    requireStaff(user);
    const rows = db.prepare('SELECT id,label,age,age_group,expires_at,used_at,revoked_at,created_at,guardian_verified FROM invitations ORDER BY created_at DESC LIMIT 250').all();
    return {body:{invites:rows.map(row=>({...row,used:!!row.used_at,guardian_verified:!!row.guardian_verified}))}};
  }
  if (path === '/api/admin/invites' && method === 'POST') {
    requireStaff(user);
    if (!Number.isInteger(body.age) || body.age < 13 || body.age > 18 || body.age_verified !== true) fail(400,'실제 연령을 확인한 만 13~18세만 초대할 수 있어요.');
    if (body.age === 13 && body.guardian_verified !== true) fail(400,'만 14세 미만은 법정대리인 동의 확인이 필요해요.');
    if (typeof body.label !== 'string' || !body.label.trim() || body.label.trim().length > 60) fail(400,'초대 메모는 1~60자로 입력해 주세요.');
    const id = randomUUID(), code = randomToken(), expires = now+7*24*60*60*1000;
    transaction(db,()=>{
      db.prepare('INSERT INTO invitations(id,code_hash,label,age,age_group,guardian_verified,age_verified,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,1,?,?,?)')
        .run(id,digest(code),body.label.trim(),body.age,body.age<=15?'13-15':'16-18',body.guardian_verified===true?1:0,user.id,now,expires);
      audit(db,user.id,'invitation.create',id,{age_verified:true,guardian_verified:body.guardian_verified===true},now);
    });
    return {status:201,body:{id,invite_code:code,expires_at:expires}};
  }
  const revoke = path.match(/^\/api\/admin\/invites\/([a-zA-Z0-9-]+)\/revoke$/);
  if (revoke && method === 'POST') {
    requireStaff(user);
    const result = db.prepare('UPDATE invitations SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(now,revoke[1]);
    if (!result.changes) fail(404,'취소할 수 있는 초대가 없어요.');
    audit(db,user.id,'invitation.revoke',revoke[1],{},now);
    return {body:{ok:true}};
  }
  return null;
}
