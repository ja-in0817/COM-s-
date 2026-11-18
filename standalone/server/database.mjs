import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readFileSync, chmodSync, openSync, closeSync, fchmodSync, existsSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    // SQLite inherits the database's permissions when it creates WAL/SHM sidecars.
    // Apply 0600 before opening, including when the containing directory already exists.
    const descriptor = openSync(path, constants.O_CREAT | constants.O_RDWR, 0o600);
    try { fchmodSync(descriptor, 0o600); } finally { closeSync(descriptor); }
    for (const suffix of ['-wal','-shm']) if (existsSync(path + suffix)) chmodSync(path + suffix,0o600);
  }
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    for (const [version, name] of [[1, 'core.sql'], [2, 'domain.sql']]) {
      if (db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)) continue;
      const sql = readFileSync(new URL(name, import.meta.url), 'utf8');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?,?,?)').run(version, name, Date.now());
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (path !== ':memory:') chmodSync(path, 0o600);
    return db;
  } catch (error) { db.close(); throw error; }
}

export async function backupDatabase(db, destination) {
  mkdirSync(dirname(resolve(destination)), { recursive: true, mode: 0o700 });
  const descriptor = openSync(destination, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
  closeSync(descriptor);
  await backup(db, destination);
  chmodSync(destination, 0o600);
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
