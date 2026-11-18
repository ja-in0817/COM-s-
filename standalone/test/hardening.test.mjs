import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../server/database.mjs';
import { clientAddress } from '../server/index.mjs';

test('database, WAL, and SHM files remain owner-only in an existing 0755 directory', {
  skip: process.platform === 'win32' ? 'POSIX file permissions are required for this check' : false,
}, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moa-file-permissions-'));
  let db;
  t.after(async () => {
    try { db?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  await chmod(directory, 0o755);
  const dbPath = path.join(directory, 'app.sqlite');
  // An existing permissive file must be tightened before SQLite creates sidecars.
  await writeFile(dbPath, '');
  await chmod(dbPath, 0o644);
  db = openDatabase(dbPath);
  for (const suffix of ['', '-wal', '-shm']) {
    const mode = (await stat(dbPath + suffix)).mode & 0o777;
    assert.equal(mode, 0o600, `${path.basename(dbPath + suffix)} must only be readable and writable by its owner`);
  }
});

test('client addresses ignore arbitrary forwarding headers and trust only explicitly configured proxy values', () => {
  const request = (headers, remoteAddress = '::ffff:192.0.2.10') => ({
    headers, socket: { remoteAddress },
  });
  const spoofedHeaders = {
    'x-forwarded-for': '203.0.113.100, 198.51.100.20',
    'cf-connecting-ip': '203.0.113.101',
    'x-real-ip': '203.0.113.102',
  };
  assert.equal(clientAddress(request(spoofedHeaders), {}), '192.0.2.10');
  assert.equal(clientAddress(request(spoofedHeaders), { trustedProxyIp: '192.0.2.11' }), '192.0.2.10');

  const exactProxy = { trustedProxyIp: '192.0.2.10' };
  assert.equal(clientAddress(request(spoofedHeaders), exactProxy), '203.0.113.102');
  assert.equal(clientAddress(request({ 'x-real-ip': '2001:db8::25' }), exactProxy), '2001:db8::25');
  for (const invalid of [undefined, '', 'not-an-ip', '203.0.113.5, 203.0.113.6', '203.0.113.5:443', ['203.0.113.5']]) {
    assert.throws(
      () => clientAddress(request({ ...spoofedHeaders, 'x-real-ip': invalid }), exactProxy),
      (error) => error.status === 400,
      'A trusted proxy must supply one valid X-Real-IP value',
    );
  }

  const renderProxy = { trustRenderProxy: true };
  const first = clientAddress(request(spoofedHeaders), renderProxy);
  const second = clientAddress(request({ ...spoofedHeaders, 'cf-connecting-ip': '203.0.113.103' }), renderProxy);
  assert.equal(first, '203.0.113.101');
  assert.equal(second, '203.0.113.103');
  assert.notEqual(first, second, 'Different Render edge client IPs must retain different rate-limit keys');
  for (const invalid of [undefined, '', 'not-an-ip', '203.0.113.5, 203.0.113.6', ['203.0.113.5']]) {
    assert.throws(
      () => clientAddress(request({ ...spoofedHeaders, 'cf-connecting-ip': invalid }), renderProxy),
      (error) => error.status === 400,
      'Render mode must not fall back to forged X-Forwarded-For or X-Real-IP values',
    );
  }
});
