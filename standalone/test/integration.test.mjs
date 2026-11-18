import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { ApiClient, TEST_PASSWORD, expectDenied, expectSuccess, fixture } from './helpers.mjs';

test('health and anonymous identity do not expose server paths or trust identity headers', async (t) => {
  const ctx = await fixture(t);
  const anonymous = ctx.client();
  const health = expectSuccess(await anonymous.get('/api/health'));
  assert.equal(health.ok, true);
  assert.equal(health.storage, 'sqlite');
  assert.equal(JSON.stringify(health).includes(ctx.dbPath), false);

  const spoofed = await anonymous.get('/api/me', {
    headers: {
      'X-User-Id': 'test_admin',
      'X-User-Role': 'admin',
      'X-Role': 'admin',
      'X-Authenticated-User': 'test_admin',
    },
  });
  const identity = expectSuccess(spoofed);
  assert.equal(identity.user, null);
  assert.equal(identity.capabilities.registration, 'invite');
  assert.equal(identity.capabilities.ai_enabled, false);
  assert.equal(identity.capabilities.external_referral, false);
  expectDenied(await anonymous.get('/api/admin/invites', {
    headers: { 'X-User-Role': 'admin', 'X-User-Id': 'test_admin' },
  }));
});

test('write requests require matching Origin, JSON content type, and server-issued CSRF token', async (t) => {
  const ctx = await fixture(t);
  const member = await ctx.member();
  const profile = { nickname: '변경되면 안 되는 이름' };
  expectDenied(await member.client.patch('/api/profile', profile, { csrf: false }));
  expectDenied(await member.client.patch('/api/profile', profile, {
    headers: { 'X-CSRF-Token': 'forged-csrf-token' },
  }));
  expectDenied(await member.client.patch('/api/profile', profile, { origin: false }));
  expectDenied(await member.client.patch('/api/profile', profile, { origin: 'https://untrusted.example' }));
  expectDenied(await member.client.patch('/api/profile', profile, {
    headers: { 'Content-Type': 'text/plain' },
  }));
  assert.equal(expectSuccess(await member.client.get('/api/me')).user.nickname, member.user.nickname);
  expectSuccess(await member.client.patch('/api/profile', { nickname: '내가 고른 이름' }));
  assert.equal(expectSuccess(await member.client.get('/api/me')).user.nickname, '내가 고른 이름');
});

test('invitations enforce age, guardian verification, one-time use, and participant-only registration', async (t) => {
  const ctx = await fixture(t);
  expectDenied(await ctx.invite(12));
  expectDenied(await ctx.invite(19));
  expectDenied(await ctx.invite(13, { guardian_verified: false }));
  expectDenied(await ctx.invite(14, { age_verified: false }));
  const youngest = await ctx.member(13);
  assert.equal(youngest.user.age_group, '13-15');

  const invitation = expectSuccess(await ctx.invite(14));
  const applicant = ctx.client();
  await applicant.ready();
  expectDenied(await applicant.post('/api/auth/register', {
    username: 'short_password', password: 'short', nickname: '새 참여자',
    invite_code: invitation.invite_code, consent: true,
  }));
  expectDenied(await applicant.post('/api/auth/register', {
    username: 'no_consent', password: TEST_PASSWORD, nickname: '새 참여자',
    invite_code: invitation.invite_code, consent: false,
  }));
  const forgedRegistration = await applicant.post('/api/auth/register', {
    username: 'participant_identity', password: TEST_PASSWORD, nickname: '새 참여자',
    invite_code: invitation.invite_code, consent: true, role: 'admin', age: 18,
    age_group: '16-18',
  });
  let registered;
  if (forgedRegistration.status >= 400 && forgedRegistration.status < 500) {
    registered = expectSuccess(await applicant.post('/api/auth/register', {
      username: 'participant_identity', password: TEST_PASSWORD, nickname: '새 참여자',
      invite_code: invitation.invite_code, consent: true,
    }));
  } else {
    registered = expectSuccess(forgedRegistration);
  }
  assert.equal(registered.user.role, 'participant');
  assert.equal(registered.user.age, 14);
  assert.equal(registered.user.age_group, '13-15');
  assert.equal('password_hash' in registered.user, false);

  const duplicate = ctx.client();
  await duplicate.ready();
  expectDenied(await duplicate.post('/api/auth/register', {
    username: 'reused_invitation', password: TEST_PASSWORD, nickname: '두 번째 참여자',
    invite_code: invitation.invite_code, consent: true,
  }));
  expectDenied(await applicant.get('/api/admin/invites', {
    headers: { 'X-User-Role': 'admin', 'X-Role': 'admin' },
  }));

  const changed = await applicant.patch('/api/profile', { role: 'admin', age: 18, age_group: '16-18' });
  if (changed.status >= 400) expectDenied(changed);
  const user = expectSuccess(await applicant.get('/api/me')).user;
  assert.equal(user.role, 'participant');
  assert.equal(user.age_group, '13-15');
});

test('real sessions authenticate users and password changes revoke other sessions', async (t) => {
  const ctx = await fixture(t);
  const member = await ctx.member();
  assert.ok(member.response.setCookies.some((cookie) => /;\s*httponly(?:;|$)/i.test(cookie)));
  assert.equal(expectSuccess(await member.client.get('/api/me')).user.id, member.user.id);
  const otherSession = ctx.client();
  expectSuccess(await otherSession.login(member.username));
  const newPassword = 'Changed-test-password-782!';
  expectSuccess(await member.client.post('/api/auth/password', {
    current_password: TEST_PASSWORD, new_password: newPassword,
  }));
  const oldSession = await otherSession.get('/api/me');
  if (oldSession.status === 200) assert.equal(oldSession.body.user, null);
  else expectDenied(oldSession);
  const fresh = ctx.client();
  expectDenied(await fresh.login(member.username, TEST_PASSWORD));
  expectSuccess(await fresh.login(member.username, newPassword));
  expectSuccess(await fresh.post('/api/auth/logout', {}));
  assert.equal(expectSuccess(await fresh.get('/api/me')).user, null);
});

test('logging out while an authenticated request body is incomplete prevents the pending profile write', async (t) => {
  const ctx = await fixture(t);
  const member = await ctx.member();
  const logoutClient = ctx.client();
  logoutClient.cookies = new Map(member.client.cookies);
  logoutClient.csrf = member.client.csrf;
  const payload = Buffer.from(JSON.stringify({ nickname: '로그아웃 뒤 변경 금지' }));
  let slowRequest;
  let logoutCompleted = false;
  let response;
  try {
    response = await new Promise((resolve, reject) => {
      slowRequest = httpRequest(`${ctx.baseUrl}/api/profile`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Expect: '100-continue',
          Origin: ctx.baseUrl,
          Cookie: [...member.client.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
          'X-CSRF-Token': member.client.csrf,
        },
      }, async (incoming) => {
        try {
          const chunks = [];
          for await (const chunk of incoming) chunks.push(chunk);
          resolve({ status: incoming.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (error) {
          reject(error);
        }
      });
      slowRequest.on('error', reject);
      slowRequest.setTimeout(10_000, () => slowRequest.destroy(new Error('Slow-body regression request timed out')));
      // The 100 response confirms the server has received the headers and entered
      // its body-reading phase. Keep JSON incomplete until the same session ends.
      slowRequest.once('continue', async () => {
        try {
          await new Promise((written, failed) => {
            slowRequest.write(payload.subarray(0, 10), (error) => error ? failed(error) : written());
          });
          expectSuccess(await logoutClient.post('/api/auth/logout', {}));
          logoutCompleted = true;
          slowRequest.end(payload.subarray(10));
        } catch (error) {
          slowRequest.destroy();
          reject(error);
        }
      });
      slowRequest.flushHeaders();
    });
  } finally {
    slowRequest?.destroy();
  }
  assert.equal(logoutCompleted, true);
  assert.equal(response.status, 401, 'Revoked sessions must be rechecked after the request body finishes');
  expectDenied(response);
  const returning = ctx.client();
  expectSuccess(await returning.login(member.username));
  assert.equal(expectSuccess(await returning.get('/api/me')).user.nickname, member.user.nickname);
});

test('age groups stay separate and concurrent joining cannot exceed the peer capacity', async (t) => {
  const ctx = await fixture(t);
  const owner = await ctx.member(14);
  const peer = await ctx.member(15);
  const contenderA = await ctx.member(14);
  const contenderB = await ctx.member(15);
  const older = await ctx.member(17);
  const group = await ctx.group(owner, { capacity: 3 });
  assert.equal(group.age_group, '13-15');
  assert.equal(expectSuccess(await older.client.get('/api/groups')).groups.some((g) => g.id === group.id), false);
  expectDenied(await older.client.post(`/api/groups/${group.id}/join`, {}));
  expectSuccess(await peer.client.post(`/api/groups/${group.id}/join`, {}));
  const results = await Promise.all([
    contenderA.client.post(`/api/groups/${group.id}/join`, {}),
    contenderB.client.post(`/api/groups/${group.id}/join`, {}),
  ]);
  assert.equal(results.filter((response) => response.status >= 200 && response.status < 300).length, 1);
  results.filter((response) => response.status >= 400).forEach((response) => expectDenied(response));
  const detail = expectSuccess(await owner.client.get(`/api/groups/${group.id}`));
  assert.equal(detail.group.member_count, 3);
  assert.equal(detail.members.filter((m) => m.age_group !== 'staff').length, 3);
  for (const publicMember of detail.members) {
    for (const privateKey of ['username', 'district', 'password_hash', 'age', 'contact']) {
      assert.equal(privateKey in publicMember, false, `Member response must omit ${privateKey}`);
    }
  }
  expectSuccess(await peer.client.post(`/api/groups/${group.id}/pause`, { paused: true }));
  const loser = results[0].status >= 400 ? contenderA : contenderB;
  expectDenied(await loser.client.post(`/api/groups/${group.id}/join`, {}), 'Pausing keeps the seat');
  expectSuccess(await owner.client.post(`/api/groups/${group.id}/leave`, {}));
  expectDenied(await owner.client.get(`/api/groups/${group.id}`), 'Leaving removes message access immediately');
  expectSuccess(await loser.client.post(`/api/groups/${group.id}/join`, {}));
  const updated = expectSuccess(await loser.client.get(`/api/groups/${group.id}`));
  assert.notEqual(updated.group.owner_id, owner.user.id);
  assert.equal(updated.group.member_count, 3);
});

test('nonmembers cannot read or write group messages and retries do not duplicate messages', async (t) => {
  const ctx = await fixture(t);
  const owner = await ctx.member();
  const outsider = await ctx.member();
  const group = await ctx.group(owner);
  const anonymous = ctx.client();
  await anonymous.ready();
  for (const client of [anonymous, outsider.client]) {
    expectDenied(await client.get(`/api/groups/${group.id}`));
    expectDenied(await client.post(`/api/groups/${group.id}/messages`, {
      body: '권한 없는 메시지', client_id: randomUUID(), user_id: owner.user.id,
    }, { headers: { 'X-User-Id': owner.user.id, 'X-User-Role': 'admin' } }));
  }
  const message = { body: '오늘은 조용히 그림을 그릴게요.', client_id: randomUUID() };
  const first = expectSuccess(await owner.client.post(`/api/groups/${group.id}/messages`, message));
  const retry = expectSuccess(await owner.client.post(`/api/groups/${group.id}/messages`, message));
  assert.equal(first.message.id, retry.message.id);
  assert.equal(first.message.user_id, owner.user.id);
  const detail = expectSuccess(await owner.client.get(`/api/groups/${group.id}`));
  assert.equal(detail.messages.filter((item) => item.id === first.message.id).length, 1);
});

test('mutual blocks prevent joining and blocked messages are not shown to the blocker', async (t) => {
  const ctx = await fixture(t);
  const owner = await ctx.member();
  const peer = await ctx.member();
  const group = await ctx.group(owner);
  expectSuccess(await peer.client.post('/api/blocks', { target_id: owner.user.id }));
  expectDenied(await peer.client.post(`/api/groups/${group.id}/join`, {}));
  expectSuccess(await peer.client.delete(`/api/blocks/${owner.user.id}`, {}));
  expectSuccess(await peer.client.post(`/api/groups/${group.id}/join`, {}));
  expectSuccess(await owner.client.post('/api/blocks', { target_id: peer.user.id }));
  const hiddenText = `차단된 메시지 ${randomUUID()}`;
  const sent = await peer.client.post(`/api/groups/${group.id}/messages`, {
    body: hiddenText, client_id: randomUUID(),
  });
  if (sent.status >= 400) expectDenied(sent);
  else expectSuccess(sent);
  const detail = expectSuccess(await owner.client.get(`/api/groups/${group.id}`));
  assert.equal(detail.messages.some((message) => message.body === hiddenText), false);
});

test('referrals require consent, stay in an internal queue, and cannot be read or canceled by another user', async (t) => {
  const ctx = await fixture(t);
  const applicant = await ctx.member();
  const stranger = await ctx.member();
  const directory = expectSuccess(await applicant.client.get('/api/organizations')).organizations;
  assert.ok(directory.length > 0, 'The official support directory must contain real source links');
  for (const organization of directory) {
    assert.equal(organization.verification_status, 'directory_only');
    assert.match(organization.source_url, /^https:\/\//);
  }
  const organization = directory.find((entry) => entry.min_age <= 14 && entry.max_age >= 14) ?? directory[0];
  const payload = {
    organization_id: organization.id,
    contact: 'test-participant@example.test',
    note: '처음에는 문자로 안내받고 싶어요.',
  };
  expectDenied(await applicant.client.post('/api/referrals', { ...payload, consent: false }));
  const saved = expectSuccess(await applicant.client.post('/api/referrals', { ...payload, consent: true })).referral;
  assert.equal(saved.status, 'awaiting_connection');
  assert.equal(expectSuccess(await applicant.client.get('/api/me')).capabilities.external_referral, false);
  assert.ok(expectSuccess(await applicant.client.get('/api/referrals')).referrals.some((item) => item.id === saved.id));
  assert.equal(expectSuccess(await stranger.client.get('/api/referrals')).referrals.some((item) => item.id === saved.id), false);
  expectDenied(await stranger.client.post(`/api/referrals/${saved.id}/cancel`, {}));
  expectDenied(await stranger.client.get('/api/admin/referrals'));
  expectSuccess(await applicant.client.post(`/api/referrals/${saved.id}/cancel`, {}));
  const after = expectSuccess(await applicant.client.get('/api/referrals')).referrals.find((item) => item.id === saved.id);
  assert.equal(after.status, 'cancelled');
});

test('reports require group access and only staff can hide or restrict with reversible decisions', async (t) => {
  const ctx = await fixture(t);
  const reporter = await ctx.member();
  const target = await ctx.member();
  const outsider = await ctx.member();
  const group = await ctx.group(reporter);
  expectSuccess(await target.client.post(`/api/groups/${group.id}/join`, {}));
  const originalText = '운영자 검토 흐름을 확인하는 메시지';
  const message = expectSuccess(await target.client.post(`/api/groups/${group.id}/messages`, {
    body: originalText, client_id: randomUUID(),
  })).message;
  const reportPayload = {
    group_id: group.id, message_id: message.id, target_id: target.user.id,
    category: '불편한 대화', reason: '운영자가 내용을 확인해 주세요.',
  };
  expectDenied(await outsider.client.post('/api/reports', reportPayload));
  const report = expectSuccess(await reporter.client.post('/api/reports', reportPayload));
  expectDenied(await reporter.client.get('/api/admin/reports'));
  const decision = { decision: 'hide_message', note: '내용 확인 후 숨김 처리' };
  expectDenied(await reporter.client.post(`/api/admin/reports/${report.report_id}/review`, decision, {
    headers: { 'X-User-Role': 'admin' },
  }));
  const queue = expectSuccess(await ctx.admin.get('/api/admin/reports')).reports;
  assert.ok(queue.some((item) => item.id === report.report_id && item.message_body === originalText));
  expectSuccess(await ctx.admin.post(`/api/admin/reports/${report.report_id}/review`, decision));
  const hidden = expectSuccess(await reporter.client.get(`/api/groups/${group.id}`));
  assert.equal(hidden.messages.some((item) => item.body === originalText), false);
  assert.equal(hidden.group.status, 'active', 'A report must not delete the group');
  expectSuccess(await ctx.admin.post(`/api/admin/reports/${report.report_id}/review`, {
    decision: 'restore', note: '재검토 후 메시지 복구',
  }));
  const restored = expectSuccess(await reporter.client.get(`/api/groups/${group.id}`));
  assert.ok(restored.messages.some((item) => item.id === message.id && item.body === originalText));

  const restriction = expectSuccess(await reporter.client.post('/api/reports', reportPayload));
  expectSuccess(await ctx.admin.post(`/api/admin/reports/${restriction.report_id}/review`, {
    decision: 'restrict_user', note: '검토 후 이 모임의 참여 제한',
  }));
  expectDenied(await target.client.get(`/api/groups/${group.id}`));
  expectDenied(await target.client.post(`/api/groups/${group.id}/join`, {}));
  expectSuccess(await reporter.client.get(`/api/groups/${group.id}`));
  expectSuccess(await ctx.admin.post(`/api/admin/reports/${restriction.report_id}/review`, {
    decision: 'restore', note: '재검토 후 본인의 선택에 따라 재참여 허용',
  }));
  expectSuccess(await target.client.post(`/api/groups/${group.id}/join`, {}));
});

test('account deletion revokes access and erases message, referral, and related report details', async (t) => {
  const ctx = await fixture(t);
  const leaving = await ctx.member();
  const peer = await ctx.member();
  const group = await ctx.group(leaving);
  expectSuccess(await peer.client.post(`/api/groups/${group.id}/join`, {}));
  const marker = `erase-private-detail-${randomUUID()}`;
  const message = expectSuccess(await leaving.client.post(`/api/groups/${group.id}/messages`, {
    body: marker, client_id: randomUUID(),
  })).message;
  const report = expectSuccess(await peer.client.post('/api/reports', {
    group_id: group.id, message_id: message.id, target_id: leaving.user.id,
    category: '검토 요청', reason: marker,
  }));
  expectSuccess(await ctx.admin.post(`/api/admin/reports/${report.report_id}/review`, {
    decision: 'dismiss', note: marker,
  }));
  const organizations = expectSuccess(await leaving.client.get('/api/organizations')).organizations;
  const referral = expectSuccess(await leaving.client.post('/api/referrals', {
    organization_id: organizations[0].id, consent: true, contact: marker, note: marker,
  })).referral;
  expectDenied(await leaving.client.delete('/api/account', { password: 'incorrect-password' }));
  expectSuccess(await leaving.client.delete('/api/account', { password: TEST_PASSWORD }));
  assert.equal(expectSuccess(await leaving.client.get('/api/me')).user, null);
  expectDenied(await ctx.client().login(leaving.username));
  const detail = expectSuccess(await peer.client.get(`/api/groups/${group.id}`));
  assert.equal(detail.group.owner_id, peer.user.id);
  assert.equal(detail.members.some((item) => item.id === leaving.user.id), false);
  assert.equal(JSON.stringify(detail.messages).includes(marker), false);
  const requests = expectSuccess(await ctx.admin.get('/api/admin/referrals')).referrals;
  const erasedRequest = requests.find((item) => item.id === referral.id);
  assert.equal(erasedRequest.status, 'cancelled');
  assert.equal(erasedRequest.contact, '');
  assert.equal(erasedRequest.note, '');
  assert.equal(JSON.stringify(expectSuccess(await ctx.admin.get('/api/admin/reports'))).includes(marker), false);
  const review = ctx.app.db.prepare('SELECT note FROM report_reviews WHERE report_id = ?').all(report.report_id);
  const audit = ctx.app.db.prepare('SELECT detail FROM audit_log').all();
  assert.equal(JSON.stringify({ review, audit }).includes(marker), false);
  const storedAccount = ctx.app.db.prepare('SELECT username, password_hash, disabled_at FROM users WHERE id = ?').get(leaving.user.id);
  assert.notEqual(storedAccount.username, leaving.username);
  assert.equal(storedAccount.password_hash, '');
  assert.ok(storedAccount.disabled_at);
});

test('accounts, messages, memberships, and referral requests survive a server restart', async (t) => {
  const ctx = await fixture(t);
  const member = await ctx.member();
  const group = await ctx.group(member);
  const text = '재시작 뒤에도 남아 있어야 하는 실제 저장 메시지';
  const message = expectSuccess(await member.client.post(`/api/groups/${group.id}/messages`, {
    body: text, client_id: randomUUID(),
  })).message;
  const organizations = expectSuccess(await member.client.get('/api/organizations')).organizations;
  const referral = expectSuccess(await member.client.post('/api/referrals', {
    organization_id: organizations[0].id,
    consent: true,
    contact: 'restart-check@example.test',
    note: '내부 접수 지속성 검증',
  })).referral;

  await ctx.restart();
  const returning = new ApiClient(ctx.baseUrl);
  const login = expectSuccess(await returning.login(member.username));
  assert.equal(login.user.id, member.user.id);
  const detail = expectSuccess(await returning.get(`/api/groups/${group.id}`));
  assert.ok(detail.members.some((item) => item.id === member.user.id));
  assert.ok(detail.messages.some((item) => item.id === message.id && item.body === text));
  assert.ok(expectSuccess(await returning.get('/api/referrals')).referrals.some((item) => item.id === referral.id));
});
