import {
  rows,
  one,
  run,
  statement,
  changes,
  fail,
  text,
  choice,
  number,
  timezone,
  meetingLink,
  uid,
  requireGroup,
  activeMember,
  absenceCount,
  notify,
} from "./db.mjs";
export async function listGroups(
  db,
  user,
  query = "",
  now = Date.now(),
  scope = "public",
) {
  const gs = await rows(
    db,
    `SELECT g.id,g.owner_id,g.title,g.description,g.category,g.study_topic,g.play_topic,g.study_minutes,g.play_minutes,g.capacity,g.platform,g.timezone,g.archived,g.created_at,p.nickname AS mentor,(SELECT COUNT(*) FROM members m WHERE m.group_id=g.id AND m.status='active' AND m.user_id!=g.owner_id) AS member_count,(SELECT MIN(s.starts_at) FROM sessions s WHERE s.group_id=g.id AND s.status='scheduled' AND s.starts_at>=?) AS next_session,(SELECT status FROM members m WHERE m.group_id=g.id AND m.user_id=?) AS my_status,(SELECT COUNT(*) FROM bookmarks b WHERE b.group_id=g.id AND b.user_id=?) AS saved FROM groups g JOIN profiles p ON p.id=g.owner_id WHERE ${scope === "mine" ? "EXISTS(SELECT 1 FROM members mine WHERE mine.group_id=g.id AND mine.user_id=? AND mine.status='active') OR EXISTS(SELECT 1 FROM bookmarks b WHERE b.group_id=g.id AND b.user_id=?)" : "g.archived=0"} ORDER BY g.created_at DESC LIMIT 200`,
    now,
    user || "",
    user || "",
    ...(scope === "mine" ? [user || "", user || ""] : []),
  );
  const q = query.trim().toLocaleLowerCase();
  return gs.filter(
    (g) =>
      !q ||
      [g.title, g.description, g.study_topic, g.play_topic, g.mentor]
        .join(" ")
        .toLocaleLowerCase()
        .includes(q),
  );
}
export async function groupDetail(db, gid, user, now) {
  const g = await one(
    db,
    `SELECT g.*,p.nickname AS mentor FROM groups g JOIN profiles p ON p.id=g.owner_id WHERE g.id=?`,
    gid,
  );
  if (!g) fail(404, "모임을 찾을 수 없어요.");
  const membership = user
    ? await one(
        db,
        "SELECT * FROM members WHERE group_id=? AND user_id=?",
        gid,
        user,
      )
    : null;
  const active = membership?.status === "active",
    owner = g.owner_id === user;
  const memberCount = await one(
    db,
    "SELECT COUNT(*) AS n FROM members WHERE group_id=? AND status='active' AND user_id!=?",
    gid,
    g.owner_id,
  );
  const publicView = {
    ...g,
    meeting_url: active ? g.meeting_url : "",
    my_status: membership?.status || null,
    member_count: memberCount.n,
    saved: !!(await one(
      db,
      "SELECT 1 FROM bookmarks WHERE group_id=? AND user_id=?",
      gid,
      user || "",
    )),
  };
  const schedule = await rows(
    db,
    `SELECT s.*,(SELECT reason FROM absence_notices n WHERE n.session_id=s.id AND n.user_id=?) AS my_notice,(SELECT status FROM attendance a WHERE a.session_id=s.id AND a.user_id=?) AS my_attendance FROM sessions s WHERE s.group_id=? ORDER BY s.starts_at DESC LIMIT 50`,
    user || "",
    user || "",
    gid,
  );
  if (!active)
    return {
      group: publicView,
      sessions: schedule,
      members: [],
      proposals: [],
      messages: [],
      audit: [],
      attendance: [],
    };
  const members = await rows(
    db,
    `SELECT m.user_id,m.status,m.joined_at,p.nickname,p.role FROM members m JOIN profiles p ON p.id=m.user_id WHERE m.group_id=? ${owner ? "" : "AND m.status='active'"} ORDER BY m.joined_at`,
    gid,
  );
  for (const m of members)
    m.unannounced_absences =
      m.status === "active" ? await absenceCount(db, gid, m.user_id, now) : 0;
  const proposals = await rows(
    db,
    `SELECT p.*,u.nickname,(SELECT COUNT(*) FROM votes v JOIN members m ON m.group_id=p.group_id AND m.user_id=v.user_id AND m.status='active' WHERE v.proposal_id=p.id) AS votes,(SELECT COUNT(*) FROM votes v WHERE v.proposal_id=p.id AND v.user_id=?) AS voted FROM proposals p JOIN profiles u ON u.id=p.author_id WHERE p.group_id=? ORDER BY p.created_at DESC LIMIT 100`,
    user,
    gid,
  );
  const messages = await rows(
    db,
    `SELECT m.id,m.user_id,m.body,m.created_at,p.nickname FROM messages m JOIN profiles p ON p.id=m.user_id WHERE m.group_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,
    gid,
  );
  const log = owner
    ? await rows(
        db,
        `SELECT a.*,p.nickname AS target_name FROM moderation_audit a JOIN profiles p ON p.id=a.target_id WHERE a.group_id=? ORDER BY a.created_at DESC LIMIT 50`,
        gid,
      )
    : [];
  const attendance = owner
    ? await rows(
        db,
        `SELECT a.*,n.reason AS notice FROM attendance a JOIN sessions s ON s.id=a.session_id LEFT JOIN absence_notices n ON n.session_id=a.session_id AND n.user_id=a.user_id WHERE s.group_id=? ORDER BY s.starts_at DESC LIMIT 2500`,
        gid,
      )
    : [];
  const absenceNotices = owner
    ? await rows(
        db,
        `SELECT n.* FROM absence_notices n JOIN sessions s ON s.id=n.session_id WHERE s.group_id=?`,
        gid,
      )
    : [];
  return {
    group: publicView,
    sessions: schedule,
    members,
    proposals,
    messages: messages.reverse(),
    audit: log,
    attendance,
    absenceNotices,
  };
}
export async function createGroup(db, user, data, now) {
  const p = await one(db, "SELECT * FROM profiles WHERE id=?", user);
  if (p?.role !== "mentor")
    fail(403, "프로필에서 멘토를 선택한 뒤 모임을 열어 주세요.");
  const id = uid(),
    title = text(data.title, "모임 이름", 80),
    description = text(data.description, "모임 소개", 2000),
    category = choice(
      data.category,
      ["언어", "디지털", "인문·예술", "생활"],
      "분야",
    ),
    study = text(data.study_topic, "학습 주제", 120),
    play = text(data.play_topic, "여가 주제", 120),
    studyM = number(data.study_minutes, 5, 180, "학습 시간"),
    playM = number(data.play_minutes, 5, 180, "여가 시간"),
    capacity = number(data.capacity, 2, 50, "멘티 정원"),
    platform = choice(
      data.platform,
      ["Zoom", "Discord", "오픈채팅", "텍스트"],
      "진행 방식",
    ),
    url = meetingLink(platform, data.meeting_url),
    tz = timezone(data.timezone || p.timezone);
  if (
    (
      await one(
        db,
        "SELECT COUNT(*) AS n FROM groups WHERE owner_id=? AND archived=0",
        user,
      )
    ).n >= 20
  )
    fail(422, "한 번에 운영할 수 있는 모임은 20개까지예요.");
  await db.batch([
    statement(
      db,
      "INSERT INTO groups(id,owner_id,title,description,category,study_topic,play_topic,study_minutes,play_minutes,capacity,platform,meeting_url,timezone,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      user,
      title,
      description,
      category,
      study,
      play,
      studyM,
      playM,
      capacity,
      platform,
      url,
      tz,
      now,
    ),
    statement(
      db,
      "INSERT INTO members(group_id,user_id,joined_at) VALUES (?,?,?)",
      id,
      user,
      now,
    ),
  ]);
  return { id };
}
export async function groupAction(db, gid, user, action, data, now) {
  if (action === "join") {
    const g = await one(
      db,
      "SELECT * FROM groups WHERE id=? AND archived=0",
      gid,
    );
    if (!g) fail(404, "참여할 수 없는 모임이에요.");
    if (g.owner_id === user || (await activeMember(db, gid, user)))
      return { ok: true };
    const existing = await one(
      db,
      "SELECT status FROM members WHERE group_id=? AND user_id=?",
      gid,
      user,
    );
    if (existing?.status === "removed")
      fail(403, "모임장이 참여 제한을 해제해야 다시 참여할 수 있어요.");
    const r = await run(
      db,
      `INSERT INTO members(group_id,user_id,status,joined_at,care_after) SELECT ?,?,'active',?,? WHERE (SELECT COUNT(*) FROM members WHERE group_id=? AND status='active' AND user_id!=?) < ? AND EXISTS(SELECT 1 FROM groups WHERE id=? AND archived=0) ON CONFLICT(group_id,user_id) DO UPDATE SET status='active',joined_at=excluded.joined_at,care_after=excluded.care_after WHERE members.status='left'`,
      gid,
      user,
      now,
      now,
      gid,
      g.owner_id,
      g.capacity,
      gid,
    );
    if (!changes(r)) fail(409, "정원이 마감됐어요. 화면을 새로고침해 주세요.");
    const p = await one(db, "SELECT nickname FROM profiles WHERE id=?", user);
    await db.batch([
      notify(db, g.owner_id, gid, `${p.nickname}님이 모임에 함께해요.`, now),
    ]);
    return { ok: true };
  }
  if (action === "bookmark") {
    if (!(await one(db, "SELECT 1 FROM groups WHERE id=?", gid)))
      fail(404, "모임을 찾을 수 없어요.");
    if (data.saved === true)
      await run(
        db,
        "INSERT OR IGNORE INTO bookmarks(group_id,user_id) VALUES (?,?)",
        gid,
        user,
      );
    else
      await run(
        db,
        "DELETE FROM bookmarks WHERE group_id=? AND user_id=?",
        gid,
        user,
      );
    return { ok: true };
  }
  const g = await requireGroup(
    db,
    gid,
    user,
    [
      "link",
      "session",
      "cancel-session",
      "attendance",
      "select-topic",
      "archive",
    ].includes(action),
  );
  if (g.archived && action !== "leave") fail(409, "종료된 모임이에요.");
  if (action === "leave") {
    if (g.owner_id === user)
      fail(422, "모임장은 나가기 대신 모임을 종료해 주세요.");
    await run(
      db,
      "UPDATE members SET status='left' WHERE group_id=? AND user_id=? AND status='active'",
      gid,
      user,
    );
    return { ok: true };
  }
  if (action === "link") {
    const platform = choice(
      data.platform,
      ["Zoom", "Discord", "오픈채팅", "텍스트"],
      "진행 방식",
    );
    await run(
      db,
      "UPDATE groups SET platform=?,meeting_url=? WHERE id=?",
      platform,
      meetingLink(platform, data.meeting_url),
      gid,
    );
    return { ok: true };
  }
  if (action === "archive") {
    await run(db, "UPDATE groups SET archived=1 WHERE id=?", gid);
    return { ok: true };
  }
  if (action === "session") {
    const starts = number(
        data.starts_at,
        now - 60000,
        now + 366 * 86400000,
        "모임 시작 시간",
      ),
      note = text(data.note ?? "", "일정 안내", 500, false),
      id = uid();
    await db.batch([
      statement(
        db,
        "INSERT INTO sessions(id,group_id,starts_at,note,created_at) VALUES (?,?,?,?,?)",
        id,
        gid,
        starts,
        note,
        now,
      ),
      statement(
        db,
        "INSERT INTO notifications(id,user_id,group_id,body,created_at) SELECT ?||user_id,user_id,group_id,?,? FROM members WHERE group_id=? AND status='active' AND user_id!=?",
        "session-" + id + "-",
        g.title + "에 새 만남 일정이 등록됐어요.",
        now,
        gid,
        user,
      ),
    ]);
    return { id };
  }
  if (action === "cancel-session") {
    const id = text(data.session_id, "일정", 100);
    const r = await run(
      db,
      "UPDATE sessions SET status='cancelled' WHERE id=? AND group_id=? AND status='scheduled'",
      id,
      gid,
    );
    if (!changes(r)) fail(409, "취소할 수 없는 일정이에요.");
    return { ok: true };
  }
  if (action === "absence") {
    const s = await one(
      db,
      "SELECT * FROM sessions WHERE id=? AND group_id=? AND status='scheduled'",
      text(data.session_id, "일정", 100),
      gid,
    );
    if (!s || s.starts_at <= now)
      fail(422, "시작 전인 일정에만 불참을 미리 알릴 수 있어요.");
    await run(
      db,
      "INSERT INTO absence_notices(session_id,user_id,reason,created_at) VALUES (?,?,?,?) ON CONFLICT(session_id,user_id) DO UPDATE SET reason=excluded.reason",
      s.id,
      user,
      text(data.reason, "불참 안내", 300),
      now,
    );
    return { ok: true };
  }
  if (action === "attendance") {
    const s = await one(
      db,
      "SELECT * FROM sessions WHERE id=? AND group_id=? AND status!='cancelled'",
      text(data.session_id, "일정", 100),
      gid,
    );
    if (!s || s.starts_at > now)
      fail(422, "모임이 시작된 후 출석을 기록해 주세요.");
    if (
      !Array.isArray(data.records) ||
      !data.records.length ||
      data.records.length > 51
    )
      fail(422, "출석 목록을 확인해 주세요.");
    const ids = new Set(),
      statements = [];
    for (const rec of data.records) {
      const target = text(rec.user_id, "참여자", 200);
      if (ids.has(target)) fail(422, "중복된 참여자가 있어요.");
      ids.add(target);
      if (target === g.owner_id || !(await activeMember(db, gid, target)))
        fail(422, "현재 참여 중인 멘티의 출석만 기록할 수 있어요.");
      const m = await one(
        db,
        "SELECT joined_at FROM members WHERE group_id=? AND user_id=?",
        gid,
        target,
      );
      if (m.joined_at > s.starts_at)
        fail(422, "가입 전 일정의 출석은 기록할 수 없어요.");
      let status = choice(
        rec.status,
        ["present", "absent", "excused", "connectivity"],
        "출석 상태",
      );
      if (
        status === "absent" &&
        (await one(
          db,
          "SELECT 1 FROM absence_notices WHERE session_id=? AND user_id=?",
          s.id,
          target,
        ))
      )
        status = "excused";
      statements.push(
        statement(
          db,
          "INSERT INTO attendance(session_id,user_id,status,updated_by,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(session_id,user_id) DO UPDATE SET status=excluded.status,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
          s.id,
          target,
          status,
          user,
          now,
        ),
      );
    }
    await db.batch(statements);
    return { ok: true };
  }
  if (action === "message") {
    const body = text(data.body, "메시지", 3000),
      requestId = text(data.request_id, "요청 식별자", 100);
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))
      fail(422, "요청 식별자를 확인해 주세요.");
    const old = await one(
      db,
      "SELECT id,group_id,body FROM messages WHERE user_id=? AND request_id=?",
      user,
      requestId,
    );
    if (old) {
      if (old.group_id !== gid || old.body !== body)
        fail(409, "다른 메시지에 사용한 요청 식별자예요.");
      return { id: old.id };
    }
    const id = uid();
    await run(
      db,
      `INSERT OR IGNORE INTO messages(id,group_id,user_id,body,request_id,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='active')`,
      id,
      gid,
      user,
      body,
      requestId,
      now,
      gid,
      user,
    );
    const saved = await one(
      db,
      "SELECT id,group_id,body FROM messages WHERE user_id=? AND request_id=?",
      user,
      requestId,
    );
    if (!saved) fail(403, "참여 권한이 변경됐어요.");
    if (saved.group_id !== gid || saved.body !== body)
      fail(409, "다른 메시지에 사용한 요청 식별자예요.");
    return { id: saved.id };
  }
  if (action === "proposal") {
    const id = uid();
    await run(
      db,
      "INSERT INTO proposals(id,group_id,author_id,kind,body,created_at) VALUES (?,?,?,?,?,?)",
      id,
      gid,
      user,
      choice(data.kind, ["study", "play"], "주제 종류"),
      text(data.body, "제안", 200),
      now,
    );
    return { id };
  }
  if (action === "vote") {
    const p = await one(
      db,
      "SELECT * FROM proposals WHERE id=? AND group_id=? AND status='open'",
      text(data.proposal_id, "제안", 100),
      gid,
    );
    if (!p) fail(404, "투표할 수 없는 제안이에요.");
    if (data.voted === true)
      await run(
        db,
        "INSERT OR IGNORE INTO votes(proposal_id,user_id) VALUES (?,?)",
        p.id,
        user,
      );
    else
      await run(
        db,
        "DELETE FROM votes WHERE proposal_id=? AND user_id=?",
        p.id,
        user,
      );
    return { ok: true };
  }
  if (action === "select-topic") {
    const p = await one(
      db,
      "SELECT * FROM proposals WHERE id=? AND group_id=? AND status='open'",
      text(data.proposal_id, "제안", 100),
      gid,
    );
    if (!p) fail(404, "적용할 수 없는 제안이에요.");
    const column = p.kind === "study" ? "study_topic" : "play_topic";
    await db.batch([
      statement(db, `UPDATE groups SET ${column}=? WHERE id=?`, p.body, gid),
      statement(db, "UPDATE proposals SET status='selected' WHERE id=?", p.id),
    ]);
    return { ok: true };
  }
  fail(404, "지원하지 않는 모임 작업이에요.");
}
