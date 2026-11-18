import { resolve } from 'node:path';
import { openDatabase, backupDatabase } from './database.mjs';
import { provisionAdmin, hashPassword, audit } from './auth.mjs';

const [command, argument] = process.argv.slice(2);
const db = openDatabase(process.env.DATABASE_PATH || './data/moa.sqlite');
try {
  if (command === 'backup') {
    if (!argument) throw new Error('Usage: npm run admin -- backup /secure/path/moa-backup.sqlite');
    await backupDatabase(db,resolve(argument));
    console.log('백업을 저장했습니다.');
  } else if (command === 'create-admin' || command === 'reset-password') {
    if (!argument) throw new Error(`Usage: npm run admin -- ${command} USERNAME (password via stdin)`);
    if (process.stdin.isTTY) throw new Error('비밀번호는 명령 인자 대신 표준입력으로 전달하세요. DEPLOYMENT.md를 확인하세요.');
    let password = '';
    for await (const chunk of process.stdin) { password += chunk.toString(); if (password.length > 1024) throw new Error('Password input is too long.'); }
    password = password.replace(/\r?\n$/, '');
    if (command === 'create-admin') {
      await provisionAdmin(db,{username:argument,password});
      console.log('운영자 계정을 만들었습니다.');
    } else {
      const user = db.prepare('SELECT id FROM users WHERE username = ? AND disabled_at IS NULL').get(argument.toLowerCase());
      if (!user) throw new Error('활성 계정이 없습니다.');
      const hash = await hashPassword(password);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash,user.id);
        db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
        audit(db,null,'account.operator_password_reset',user.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      console.log('비밀번호를 변경하고 기존 세션을 종료했습니다.');
    }
    password = '';
  } else {
    console.log('Commands: create-admin USERNAME | reset-password USERNAME | backup FILE');
    process.exitCode = 1;
  }
} finally { db.close(); }
