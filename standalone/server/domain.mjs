import { randomUUID } from 'node:crypto';

const occupied = new Set(['active', 'paused']);
const staff = (user) => user?.role === 'moderator' || user?.role === 'admin';
const all = (db, sql, ...args) => db.prepare(sql).all(...args);
const one = (db, sql, ...args) => db.prepare(sql).get(...args) ?? null;
const run = (db, sql, ...args) => db.prepare(sql).run(...args);
const err = (status, message) => { throw Object.assign(new Error(message), { status }); };
const ok = (body = { ok: true }, status = 200) => ({ status, body });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function str(value, label, max, required = true) {
  if (typeof value !== 'string') err(422, `${label}을 확인해 주세요.`);
  const result = value.trim();
  if ((required && !result) || result.length > max || result.includes('\0'))
    err(422, `${label}은 ${required ? '1' : '0'}~${max}자로 입력해 주세요.`);
  return result;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) err(422, `${label}을 확인해 주세요.`);
  return value;
}
function select(value, values, label) {
  if (!values.includes(value)) err(422, `${label}을 확인해 주세요.`);
  return value;
}
function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function audit(db, actor, action, target, detail, now) {
  run(db, 'INSERT INTO audit_log(id,actor_id,action,target_id,detail,created_at) VALUES (?,?,?,?,?,?)',
    randomUUID(), actor, `domain.${action}`, target, JSON.stringify(detail), now);
}
function authenticated(user) {
  if (!user || user.disabled_at !== null && user.disabled_at !== undefined) err(401, '로그인이 필요해요.');
  return user;
}
function requireStaff(user) {
  authenticated(user);
  if (!staff(user)) err(403, '운영 담당자만 사용할 수 있어요.');
}
function publicUser(row) {
  let interests = [];
  try { interests = JSON.parse(row.interests); } catch { /* Existing invalid JSON is never returned verbatim. */ }
  return {
    id: row.id, username: row.username, nickname: row.nickname, role: row.role,
    age: row.age, age_group: row.age_group, district: row.district,
    interests: Array.isArray(interests) ? interests : [], availability: row.availability,
    participation_mode: row.participation_mode, intensity: row.intensity, created_at: row.created_at,
  };
}
function group(db, id) {
  const result = one(db, 'SELECT * FROM groups WHERE id=?', id);
  if (!result) err(404, '모임을 찾을 수 없어요.');
  return result;
}
function restricted(db, gid, uid) {
  return !!one(db, 'SELECT 1 FROM group_restrictions WHERE group_id=? AND user_id=? AND active=1', gid, uid);
}
function membership(db, gid, uid) {
  return one(db, 'SELECT * FROM group_members WHERE group_id=? AND user_id=?', gid, uid);
}
function requireMember(db, gid, user, { historical = false, staffRead = false } = {}) {
  authenticated(user);
  const g = group(db, gid);
  if (staffRead && staff(user)) return g;
  const m = membership(db, gid, user.id);
  if (!m || !historical && (!occupied.has(m.status) || restricted(db, gid, user.id)))
    err(403, '이 모임의 참여자만 사용할 수 있어요.');
  if (user.role === 'participant' && user.age_group !== g.age_group) err(403, '다른 연령대 모임에 접근할 수 없어요.');
  return g;
}
function activeGroup(g) {
  if (g.status !== 'active') err(409, '종료된 모임에서는 새 활동을 만들 수 없어요.');
}
function mutualBlock(db, a, b) {
  return !!one(db, 'SELECT 1 FROM blocks WHERE (blocker_id=? AND target_id=?) OR (blocker_id=? AND target_id=?)', a, b, b, a);
}
function blockedGroup(db, gid, uid) {
  return !!one(db, `SELECT 1 FROM group_members m JOIN users u ON u.id=m.user_id
    WHERE m.group_id=? AND m.status IN ('active','paused') AND u.disabled_at IS NULL AND m.user_id<>?
    AND EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=m.user_id) OR (b.target_id=? AND b.blocker_id=m.user_id))`, gid, uid, uid, uid);
}
function peerCount(db, gid) {
  return one(db, `SELECT COUNT(*) n FROM group_members m JOIN users u ON u.id=m.user_id
    WHERE m.group_id=? AND m.status IN ('active','paused') AND u.role='participant' AND u.disabled_at IS NULL`, gid).n;
}
function viewGroup(db, g, user) {
  const myStatus = membership(db, g.id, user.id)?.status ?? null;
  let interests = [];
  try { interests = JSON.parse(user.interests || '[]'); } catch { /* no inferred interests */ }
  const topic = g.topic.toLocaleLowerCase();
  const interestMatch = Array.isArray(interests) && interests.some((item) => typeof item === 'string' && item.trim() && (topic.includes(item.toLocaleLowerCase()) || item.toLocaleLowerCase().includes(topic)));
  const timeMatch = !!user.availability?.trim() && !!g.schedule.trim() && (user.availability.trim() === g.schedule.trim());
  const reasons = [];
  let score = 0;
  if (user.age_group === g.age_group) { reasons.push(`${g.age_group.replace('-', '~')}세 또래 모임`); score += 5; }
  if (interestMatch) { reasons.push('선택한 관심사와 관련된 주제'); score += 35; }
  if (timeMatch) { reasons.push('입력한 가능 시간과 일치'); score += 25; }
  if (g.mode === user.participation_mode) { reasons.push('텍스트로 참여'); score += 20; }
  if (g.intensity === user.intensity) { reasons.push('선택한 활동 강도와 일치'); score += 15; }
  return {
    id: g.id, title: g.title, description: g.description, topic: g.topic,
    age_group: g.age_group, mode: g.mode, intensity: g.intensity, schedule: g.schedule,
    capacity: g.capacity, member_count: peerCount(db, g.id), owner_id: g.owner_id,
    created_at: g.created_at, status: g.status, my_status: myStatus, reasons, match_score: score,
  };
}
function viewMessage(row) {
  return { id: row.id, user_id: row.user_id, nickname: row.nickname, body: row.hidden ? '운영 검토로 숨겨진 메시지입니다.' : row.body, created_at: row.created_at, hidden: !!row.hidden };
}
function transferOwner(db, gid, leavingId, now, reason = 'empty') {
  const g = group(db, gid);
  if (g.owner_id !== leavingId) return;
  const next = one(db, `SELECT m.user_id FROM group_members m JOIN users u ON u.id=m.user_id
    WHERE m.group_id=? AND m.user_id<>? AND m.status IN ('active','paused') AND u.disabled_at IS NULL
    ORDER BY CASE WHEN u.role='participant' AND m.status='active' THEN 0 WHEN u.role='participant' THEN 1 ELSE 2 END,m.joined_at,m.user_id LIMIT 1`, gid, leavingId);
  if (next) run(db, 'UPDATE groups SET owner_id=? WHERE id=?', next.user_id, gid);
  else run(db, "UPDATE groups SET status='archived',archived_reason=? WHERE id=?", reason, gid);
  audit(db, leavingId, 'group.owner_departed', gid, { replacement_id: next?.user_id ?? null, archived: !next }, now);
}
function sessionView(db, s, user) {
  return { ...s, checked_in: !!one(db, 'SELECT 1 FROM attendance WHERE session_id=? AND user_id=?', s.id, user.id) };
}
function reportList(db) {
  return all(db, `SELECT r.id,r.group_id,g.title AS group_title,r.category,r.reason,r.status,r.created_at,
    r.target_id,u.nickname AS target_name,r.message_id,r.message_snapshot AS message_body
    FROM reports r JOIN groups g ON g.id=r.group_id LEFT JOIN users u ON u.id=r.target_id
    ORDER BY CASE WHEN r.status='open' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 200`);
}
function referralList(db, uid = null) {
  return all(db, `SELECT r.id,r.organization_id,o.name AS organization_name,r.status,r.created_at,r.note,r.contact
    ${uid === null ? ',u.nickname AS applicant_nickname' : ''}
    FROM referrals r JOIN organizations o ON o.id=r.organization_id JOIN users u ON u.id=r.user_id
    ${uid === null ? '' : 'WHERE r.user_id=?'} ORDER BY r.created_at DESC LIMIT 200`, ...(uid === null ? [] : [uid]));
}

export async function handleDomain({ req, url, body = {}, user, db, now = Date.now() }) {
  const method = req.method;
  const path = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (path[0] !== 'api') return null;
  const resource = path[1];

  if (method === 'GET' && resource === 'organizations' && path.length === 2)
    return ok({ organizations: all(db, 'SELECT * FROM organizations ORDER BY name') });

  if (resource === 'profile' && path.length === 2 && method === 'PATCH') {
    authenticated(user);
    const allowed = ['nickname','district','interests','availability','participation_mode','intensity'];
    if (Object.keys(body).some((key) => !allowed.includes(key))) err(422, '변경할 수 없는 프로필 항목이 포함되어 있어요.');
    const p = { ...publicUser(user), ...body };
    p.nickname = str(p.nickname, '별명', 24);
    if (p.nickname.length < 2) err(422, '별명은 2~24자로 입력해 주세요.');
    p.district = str(p.district || '', '시군구', 60, false);
    p.availability = str(p.availability || '', '가능 시간', 200, false);
    select(p.participation_mode, ['text'], '참여 방식');
    select(p.intensity, ['low','medium','high'], '활동 강도');
    if (!Array.isArray(p.interests) || p.interests.length > 10) err(422, '관심사는 최대 10개까지 선택해 주세요.');
    const interests = [...new Set(p.interests.map((item) => str(item, '관심사', 40)))];
    run(db, 'UPDATE users SET nickname=?,district=?,interests=?,availability=?,participation_mode=?,intensity=? WHERE id=?',
      p.nickname,p.district,JSON.stringify(interests),p.availability,p.participation_mode,p.intensity,user.id);
    return ok({ user: publicUser(one(db,'SELECT * FROM users WHERE id=?',user.id)) });
  }

  if (resource === 'groups' && path.length === 2 && method === 'GET') {
    authenticated(user);
    const mine = url.searchParams.get('mine') === '1';
    const list = all(db, `SELECT g.* FROM groups g WHERE ${mine ? "EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=? AND m.status IN ('active','paused'))" : "g.status='active'"}
      ${staff(user) ? '' : 'AND g.age_group=?'} ORDER BY g.created_at DESC,g.id LIMIT 200`,
      ...(mine ? [user.id] : []), ...(staff(user) ? [] : [user.age_group]));
    return ok({ groups: list.filter((g) => occupied.has(membership(db,g.id,user.id)?.status) || !restricted(db,g.id,user.id) && !blockedGroup(db,g.id,user.id)).map((g) => viewGroup(db,g,user)) });
  }
  if (resource === 'groups' && path.length === 2 && method === 'POST') {
    authenticated(user);
    const title = str(body.title, '모임 이름', 80), description = str(body.description ?? '', '모임 소개', 1500, false);
    const topic = str(body.topic, '주제', 80), mode = select(body.mode, ['text'], '진행 방식');
    const intensity = select(body.intensity, ['low','medium','high'], '활동 강도');
    const schedule = str(body.schedule ?? '', '가능 시간', 200, false);
    const capacity = select(body.capacity, [3,4], '또래 정원');
    const ageGroup = select(staff(user) ? body.age_group : user.age_group, ['13-15','16-18'], '연령대');
    if (!staff(user) && body.age_group !== undefined && body.age_group !== user.age_group) err(403, '확인된 본인 연령대에서 모임을 만들 수 있어요.');
    const id = randomUUID();
    transaction(db, () => {
      if (one(db,"SELECT COUNT(*) n FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.user_id=? AND m.status IN ('active','paused') AND g.status='active'",user.id).n >= 10) err(409, '참여 중인 모임을 정리한 뒤 새 모임을 만들어 주세요.');
      run(db,'INSERT INTO groups(id,owner_id,title,description,topic,age_group,mode,intensity,schedule,capacity,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,user.id,title,description,topic,ageGroup,mode,intensity,schedule,capacity,now);
      run(db,"INSERT INTO group_members(group_id,user_id,status,joined_at,updated_at) VALUES (?,?,'active',?,?)",id,user.id,now,now);
      audit(db,user.id,'group.created',id,{ age_group:ageGroup },now);
    });
    return ok({ group: viewGroup(db,group(db,id),user) },201);
  }
  if (resource === 'groups' && path.length === 3 && method === 'GET') {
    const g = requireMember(db,path[2],user,{ staffRead:true });
    const beforeRaw = url.searchParams.get('before');
    const before = beforeRaw === null ? null : integer(Number(beforeRaw),1,Number.MAX_SAFE_INTEGER,'메시지 조회 시각');
    const members = all(db,`SELECT u.id,u.nickname,u.age_group FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? AND m.status IN ('active','paused') AND u.disabled_at IS NULL ORDER BY m.joined_at,u.id`,g.id);
    const messages = all(db,`SELECT m.id,m.user_id,u.nickname,m.body,m.created_at,m.hidden FROM messages m JOIN users u ON u.id=m.user_id
      WHERE m.group_id=? ${before === null ? '' : 'AND m.created_at<?'}
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.target_id=m.user_id) OR (b.target_id=? AND b.blocker_id=m.user_id))
      ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,g.id,...(before===null?[]:[before]),user.id,user.id).reverse().map(viewMessage);
    const sessions = all(db,'SELECT * FROM sessions WHERE group_id=? ORDER BY starts_at DESC,id LIMIT 50',g.id).map((s)=>sessionView(db,s,user));
    return ok({ group:viewGroup(db,g,user), members, messages, sessions });
  }
  if (resource === 'groups' && path.length === 4 && method === 'POST') {
    authenticated(user);
    const gid = path[2], action = path[3];
    if (action === 'join') {
      transaction(db,()=>{
        const g=group(db,gid); activeGroup(g);
        if (!staff(user) && user.age_group!==g.age_group) err(403,'다른 연령대 모임에는 참여할 수 없어요.');
        if (restricted(db,gid,user.id)) err(403,'이 모임의 참여가 제한되어 있어요. 운영 담당자에게 문의해 주세요.');
        if (occupied.has(membership(db,gid,user.id)?.status)) return;
        if (blockedGroup(db,gid,user.id)) err(409,'차단 관계가 있는 이용자가 참여 중인 모임이에요.');
        if (user.role==='participant' && peerCount(db,gid)>=g.capacity) err(409,'또래 정원이 마감됐어요.');
        if (one(db,"SELECT COUNT(*) n FROM group_members m JOIN groups g ON g.id=m.group_id WHERE m.user_id=? AND m.status IN ('active','paused') AND g.status='active'",user.id).n>=10) err(409,'참여 가능한 모임 수를 초과했어요.');
        run(db,"INSERT INTO group_members(group_id,user_id,status,joined_at,updated_at) VALUES (?,?,'active',?,?) ON CONFLICT(group_id,user_id) DO UPDATE SET status='active',joined_at=excluded.joined_at,updated_at=excluded.updated_at",gid,user.id,now,now);
        if (!occupied.has(membership(db,gid,g.owner_id)?.status)) run(db,'UPDATE groups SET owner_id=? WHERE id=?',user.id,gid);
      });
      return ok();
    }
    if (action === 'leave') {
      transaction(db,()=>{
        const g=requireMember(db,gid,user,{ historical:true });
        const m=membership(db,gid,user.id);
        if (occupied.has(m.status)) run(db,"UPDATE group_members SET status='left',updated_at=? WHERE group_id=? AND user_id=?",now,gid,user.id);
        transferOwner(db,g.id,user.id,now);
      });
      return ok();
    }
    if (action === 'pause') {
      const g=requireMember(db,gid,user);activeGroup(g);
      if (typeof body.paused!=='boolean') err(422,'쉬기 설정을 확인해 주세요.');
      run(db,'UPDATE group_members SET status=?,updated_at=? WHERE group_id=? AND user_id=?',body.paused?'paused':'active',now,gid,user.id);
      return ok();
    }
    if (action === 'messages') {
      const messageBody=str(body.body,'메시지',1000),clientId=str(body.client_id,'메시지 식별자',36);
      if (!uuidPattern.test(clientId)) err(422,'올바른 메시지 식별자가 필요해요.');
      return transaction(db,()=>{
        const g=requireMember(db,gid,user);activeGroup(g);
        const existing=one(db,'SELECT * FROM messages WHERE user_id=? AND client_id=?',user.id,clientId);
        if (existing) {
          if (existing.group_id!==gid || existing.body!==messageBody) err(409,'다른 메시지에 사용한 식별자예요.');
          return ok({message:viewMessage({...existing,nickname:user.nickname})});
        }
        const id=randomUUID();
        run(db,'INSERT INTO messages(id,group_id,user_id,body,client_id,created_at) VALUES (?,?,?,?,?,?)',id,gid,user.id,messageBody,clientId,now);
        return ok({message:viewMessage({id,user_id:user.id,nickname:user.nickname,body:messageBody,created_at:now,hidden:0})},201);
      });
    }
    if (action === 'sessions') {
      const g=requireMember(db,gid,user);activeGroup(g);
      const title=str(body.title,'만남 이름',100),starts=integer(body.starts_at,now-60000,now+180*86400000,'만남 시작 시간');
      const duration=select(body.duration_minutes,[15,30,45,60],'만남 길이');
      if (one(db,'SELECT COUNT(*) n FROM sessions WHERE group_id=? AND starts_at>?',gid,now).n>=50) err(409,'예정된 만남이 많아요. 기존 일정을 먼저 확인해 주세요.');
      const s={id:randomUUID(),group_id:gid,created_by:user.id,title,starts_at:starts,duration_minutes:duration,created_at:now};
      run(db,'INSERT INTO sessions(id,group_id,created_by,title,starts_at,duration_minutes,created_at) VALUES (?,?,?,?,?,?,?)',s.id,gid,user.id,title,starts,duration,now);
      return ok({session:sessionView(db,s,user)},201);
    }
    return null;
  }
  if (resource === 'sessions' && path.length===4 && path[3]==='checkin' && method==='POST') {
    authenticated(user);
    const s=one(db,'SELECT * FROM sessions WHERE id=?',path[2]);
    if (!s) err(404,'만남을 찾을 수 없어요.');
    const g=requireMember(db,s.group_id,user);activeGroup(g);
    if (now<s.starts_at-15*60000 || now>s.starts_at+(s.duration_minutes+60)*60000) err(422,'참여 확인은 시작 15분 전부터 종료 60분 뒤까지 가능해요.');
    run(db,'INSERT OR IGNORE INTO attendance(session_id,user_id,checked_in_at) VALUES (?,?,?)',s.id,user.id,now);
    return ok();
  }
  if (resource==='checkins' && path.length===2 && method==='POST') {
    authenticated(user);
    const gid=str(body.group_id,'모임',100);requireMember(db,gid,user,{historical:true});
    const comfort=integer(body.comfort,1,5,'편안함'),intent=integer(body.return_intent,1,5,'다시 참여하고 싶은 정도');
    run(db,'INSERT INTO checkins(id,group_id,user_id,comfort,return_intent,note,created_at) VALUES (?,?,?,?,?,?,?)',randomUUID(),gid,user.id,comfort,intent,str(body.note??'','메모',1000,false),now);
    return ok();
  }
  if (resource==='blocks' && path.length===2 && method==='GET') {
    authenticated(user);
    return ok({blocks:all(db,'SELECT b.target_id,u.nickname,b.created_at FROM blocks b JOIN users u ON u.id=b.target_id WHERE b.blocker_id=? ORDER BY b.created_at DESC',user.id)});
  }
  if (resource==='blocks' && path.length===2 && method==='POST') {
    authenticated(user);const target=str(body.target_id,'차단 대상',100);
    if (target===user.id) err(422,'본인은 차단할 수 없어요.');
    if (!one(db,'SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL',target)) err(404,'이용자를 찾을 수 없어요.');
    run(db,'INSERT OR IGNORE INTO blocks(blocker_id,target_id,created_at) VALUES (?,?,?)',user.id,target,now);
    return ok();
  }
  if (resource==='blocks' && path.length===3 && method==='DELETE') {
    authenticated(user);run(db,'DELETE FROM blocks WHERE blocker_id=? AND target_id=?',user.id,path[2]);return ok();
  }
  if (resource==='reports' && path.length===2 && method==='POST') {
    authenticated(user);const gid=str(body.group_id,'모임',100);requireMember(db,gid,user,{historical:true});
    let target=body.target_id ? str(body.target_id,'신고 대상',100) : null;
    const messageId=body.message_id ? str(body.message_id,'메시지',100) : null;
    let evidence=null;
    if (messageId) {
      const m=one(db,'SELECT * FROM messages WHERE id=? AND group_id=?',messageId,gid);
      if (!m) err(404,'해당 모임의 메시지를 찾을 수 없어요.');
      if (target && target!==m.user_id) err(422,'신고 대상과 메시지 작성자가 일치하지 않아요.');
      target=m.user_id;evidence=m.body;
    }
    if (target) {
      if (target===user.id) err(422,'본인을 신고 대상으로 지정할 수 없어요.');
      if (!membership(db,gid,target)) err(422,'같은 모임의 이용자만 신고할 수 있어요.');
    }
    const id=randomUUID();
    run(db,'INSERT INTO reports(id,reporter_id,group_id,message_id,target_id,category,reason,message_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)',id,user.id,gid,messageId,target,str(body.category,'신고 유형',60),str(body.reason,'신고 이유',1000),evidence,now);
    return ok({report_id:id},201);
  }
  if (resource==='admin' && path[2]==='reports' && path.length===3 && method==='GET') { requireStaff(user);return ok({reports:reportList(db)}); }
  if (resource==='admin' && path[2]==='reports' && path.length===5 && path[4]==='review' && method==='POST') {
    requireStaff(user);
    const decision=select(body.decision,['dismiss','hide_message','restrict_user','restore'],'검토 결과');
    const note=str(body.note,'검토 사유',1000);
    transaction(db,()=>{
      const r=one(db,'SELECT * FROM reports WHERE id=?',path[3]);
      if (!r) err(404,'신고를 찾을 수 없어요.');
      if (r.target_id===user.id) err(403,'본인에 관한 신고는 다른 운영 담당자가 검토해야 해요.');
      const target=r.target_id ? one(db,'SELECT role FROM users WHERE id=?',r.target_id) : null;
      if (target && target.role!=='participant' && user.role!=='admin') err(403,'운영 담당자에 관한 신고는 관리자가 검토해야 해요.');
      if (decision==='restore') {
        if (r.status!=='actioned' || !['hide_message','restrict_user'].includes(r.decision)) err(409,'복구할 조치가 없어요.');
        run(db,"UPDATE reports SET status='restored',reviewed_by=?,reviewed_at=? WHERE id=?",user.id,now,r.id);
        if (r.decision==='hide_message' && !one(db,"SELECT 1 FROM reports WHERE message_id=? AND status='actioned' AND decision='hide_message'",r.message_id))
          run(db,'UPDATE messages SET hidden=0 WHERE id=?',r.message_id);
        if (r.decision==='restrict_user') {
          run(db,'UPDATE group_restrictions SET active=0,restored_at=? WHERE report_id=?',now,r.id);
          if (!restricted(db,r.group_id,r.target_id)) {
            run(db,"UPDATE group_members SET status='left',updated_at=? WHERE group_id=? AND user_id=? AND status='removed'",now,r.group_id,r.target_id);
            run(db,"UPDATE groups SET status='active',archived_reason=NULL WHERE id=? AND status='archived' AND archived_reason='restriction'",r.group_id);
          }
        }
      } else {
        if (r.status!=='open') err(409,'이미 검토한 신고예요. 필요한 경우 복구를 선택해 주세요.');
        if (decision==='hide_message') {
          if (!r.message_id) err(422,'숨길 메시지가 없는 신고예요.');
          run(db,'UPDATE messages SET hidden=1 WHERE id=?',r.message_id);
        }
        if (decision==='restrict_user') {
          if (!r.target_id) err(422,'참여를 제한할 이용자가 없는 신고예요.');
          run(db,'INSERT INTO group_restrictions(group_id,user_id,report_id,active,created_at) VALUES (?,?,?,1,?)',r.group_id,r.target_id,r.id,now);
          run(db,"UPDATE group_members SET status='removed',updated_at=? WHERE group_id=? AND user_id=?",now,r.group_id,r.target_id);
          transferOwner(db,r.group_id,r.target_id,now,'restriction');
        }
        run(db,'UPDATE reports SET status=?,decision=?,reviewed_by=?,reviewed_at=? WHERE id=?',decision==='dismiss'?'dismissed':'actioned',decision,user.id,now,r.id);
      }
      run(db,'INSERT INTO report_reviews(id,report_id,reviewer_id,decision,note,created_at) VALUES (?,?,?,?,?,?)',randomUUID(),r.id,user.id,decision,note,now);
      audit(db,user.id,'report.review',r.id,{decision,group_id:r.group_id,target_id:r.target_id,message_id:r.message_id},now);
    });
    return ok();
  }
  if (resource==='referrals' && path.length===2 && method==='POST') {
    authenticated(user);
    if (body.consent!==true) err(422,'내부 연결 요청을 저장하고 운영 담당자에게 보여 주는 데 동의해 주세요.');
    const orgId=str(body.organization_id,'기관',100);
    if (!one(db,'SELECT 1 FROM organizations WHERE id=?',orgId)) err(404,'안내 기관을 찾을 수 없어요.');
    const contact=str(body.contact,'연락 방법',200),note=str(body.note??'','요청 메모',1000,false),id=randomUUID();
    transaction(db,()=>{
      if (one(db,"SELECT 1 FROM referrals WHERE user_id=? AND organization_id=? AND status='awaiting_connection'",user.id,orgId)) err(409,'이 기관에 대한 내부 연결 요청이 이미 있어요.');
      run(db,"INSERT INTO referrals(id,user_id,organization_id,status,contact,note,consent_at,consent_version,created_at) VALUES (?,?,?,'awaiting_connection',?,?,?,'referral-internal-v1',?)",id,user.id,orgId,contact,note,now,now);
      audit(db,user.id,'referral.saved',id,{organization_id:orgId,external_transmission:false},now);
    });
    return ok({referral:referralList(db,user.id).find((r)=>r.id===id)},201);
  }
  if (resource==='referrals' && path.length===2 && method==='GET') {authenticated(user);return ok({referrals:referralList(db,user.id)});}
  if (resource==='referrals' && path.length===4 && path[3]==='cancel' && method==='POST') {
    authenticated(user);
    transaction(db,()=>{
      const r=one(db,'SELECT id FROM referrals WHERE id=? AND user_id=?',path[2],user.id);
      if (!r) err(404,'연결 요청을 찾을 수 없어요.');
      run(db,"UPDATE referrals SET status='cancelled',cancelled_at=COALESCE(cancelled_at,?),contact='',note='' WHERE id=?",now,r.id);
      audit(db,user.id,'referral.cancelled',r.id,{external_transmission:false},now);
    });
    return ok();
  }
  if (resource==='admin' && path[2]==='referrals' && path.length===3 && method==='GET') {requireStaff(user);return ok({referrals:referralList(db)});}
  return null;
}

// The account controller owns the transaction and disables the core user row.
// Do not start a nested transaction here or alter authentication tables.
export function anonymizeUser(db,userId,now) {
  const related=all(db,"SELECT group_id FROM group_members WHERE user_id=? AND status IN ('active','paused')",userId);
  run(db,"UPDATE group_members SET status='left',updated_at=? WHERE user_id=? AND status IN ('active','paused')",now,userId);
  for (const row of related) transferOwner(db,row.group_id,userId,now);
  run(db,"UPDATE messages SET body='탈퇴한 사용자의 메시지입니다.',hidden=1 WHERE user_id=?",userId);
  run(db,'DELETE FROM attendance WHERE user_id=?',userId);
  run(db,'DELETE FROM checkins WHERE user_id=?',userId);
  run(db,'DELETE FROM blocks WHERE blocker_id=? OR target_id=?',userId,userId);
  run(db,"UPDATE referrals SET status='cancelled',cancelled_at=COALESCE(cancelled_at,?),contact='',note='' WHERE user_id=?",now,userId);
  run(db,`UPDATE reports SET reason='계정 탈퇴로 개인 관련 상세 내용이 삭제되었습니다.',message_snapshot=NULL
    WHERE reporter_id=? OR target_id=? OR message_id IN (SELECT id FROM messages WHERE user_id=?)`,userId,userId,userId);
  run(db,`UPDATE report_reviews SET note='계정 탈퇴로 개인 관련 상세 내용이 삭제되었습니다.'
    WHERE reviewer_id=? OR report_id IN (SELECT id FROM reports WHERE reporter_id=? OR target_id=?
      OR message_id IN (SELECT id FROM messages WHERE user_id=?))`,userId,userId,userId,userId);
  run(db,`UPDATE audit_log SET detail='{"account_erased":true}' WHERE action LIKE 'domain.%'
    AND (actor_id=? OR target_id=? OR (action='domain.report.review' AND target_id IN
      (SELECT id FROM reports WHERE reporter_id=? OR target_id=? OR message_id IN
        (SELECT id FROM messages WHERE user_id=?))))`,userId,userId,userId,userId,userId);
}
