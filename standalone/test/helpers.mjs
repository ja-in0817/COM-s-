import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';
import { provisionAdmin } from '../server/auth.mjs';

export const TEST_PASSWORD = 'Test-only-password-428!';
let nextIdentity = 0;

export function expectSuccess(response, message = 'Request should succeed') {
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${message}; HTTP ${response.status}: ${JSON.stringify(response.body)}`,
  );
  return response.body;
}

export function expectDenied(response, message = 'Request should be rejected') {
  assert.ok(
    response.status >= 400 && response.status < 500,
    `${message}; HTTP ${response.status}: ${JSON.stringify(response.body)}`,
  );
  assert.equal(typeof response.body.error, 'string');
}

export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
    this.csrf = undefined;
  }

  async ready() {
    const response = await this.get('/api/me');
    expectSuccess(response);
    assert.equal(typeof response.body.csrf_token, 'string');
    this.csrf = response.body.csrf_token;
    return response.body;
  }

  async request(method, pathname, body, options = {}) {
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const headers = { Accept: 'application/json' };
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (write) {
      headers['Content-Type'] = 'application/json';
      if (options.origin !== false) headers.Origin = options.origin ?? this.baseUrl;
      if (options.csrf !== false && this.csrf) headers['X-CSRF-Token'] = this.csrf;
    }
    Object.assign(headers, options.headers);
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers,
      ...(write ? { body: JSON.stringify(body ?? {}) } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
    const setCookies = response.headers.getSetCookie();
    for (const cookie of setCookies) {
      const pair = cookie.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || /(?:^|;)\s*max-age=0(?:;|$)/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Expected JSON for ${method} ${pathname}; HTTP ${response.status}`);
      }
    }
    if (typeof data?.csrf_token === 'string') this.csrf = data.csrf_token;
    return { status: response.status, body: data, headers: response.headers, setCookies };
  }

  get(pathname, options) { return this.request('GET', pathname, undefined, options); }
  post(pathname, body, options) { return this.request('POST', pathname, body, options); }
  patch(pathname, body, options) { return this.request('PATCH', pathname, body, options); }
  delete(pathname, body, options) { return this.request('DELETE', pathname, body, options); }

  async login(username, password = TEST_PASSWORD) {
    await this.ready();
    return this.post('/api/auth/login', { username, password });
  }
}

export async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'moa-independent-test-'));
  const dbPath = path.join(directory, 'app.sqlite');
  let app;
  let baseUrl;

  const start = async () => {
    app = await createApp({
      dbPath,
      origin: (req) => `http://127.0.0.1:${req.socket.localPort}`,
      secureCookies: false,
      rateLimits: false,
    });
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', () => {
        app.server.off('error', reject);
        resolve();
      });
    });
    baseUrl = `http://127.0.0.1:${app.server.address().port}`;
  };

  await start();
  t.after(async () => {
    try {
      await app?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  await provisionAdmin(app.db, {
    username: 'test_admin',
    password: TEST_PASSWORD,
    nickname: '검증 운영자',
  });
  const admin = new ApiClient(baseUrl);
  expectSuccess(await admin.login('test_admin'), 'Administrator login');

  const context = {
    admin,
    dbPath,
    get app() { return app; },
    get baseUrl() { return baseUrl; },
    client() { return new ApiClient(baseUrl); },
    async invite(age = 14, extra = {}) {
      const response = await admin.post('/api/admin/invites', {
        label: `검증 초대 ${++nextIdentity}`,
        age,
        age_verified: true,
        guardian_verified: age === 13,
        ...extra,
      });
      return response;
    },
    async member(age = 14) {
      const invitation = expectSuccess(await context.invite(age), 'Create participant invitation');
      const client = context.client();
      await client.ready();
      const username = `member_${++nextIdentity}`;
      const response = await client.post('/api/auth/register', {
        username,
        password: TEST_PASSWORD,
        nickname: `참여자 ${nextIdentity}`,
        invite_code: invitation.invite_code,
        consent: true,
      });
      const { user } = expectSuccess(response, 'Register participant');
      assert.equal(user.role, 'participant');
      assert.equal(user.age, age);
      return { client, user, username, invitation, response };
    },
    async group(member, extra = {}) {
      const response = await member.client.post('/api/groups', {
        title: `같이 그림 그리기 ${++nextIdentity}`,
        description: '부담 없이 짧게 참여하는 검증용 모임',
        topic: '그림',
        mode: 'text',
        intensity: 'low',
        schedule: '토요일 오후 2시',
        capacity: 3,
        ...extra,
      });
      return expectSuccess(response, 'Create group').group;
    },
    async restart() {
      await app.close();
      app = undefined;
      await start();
      return baseUrl;
    },
  };
  return context;
}
