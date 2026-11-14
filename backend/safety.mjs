import {
  rows,
  one,
  run,
  statement,
  changes,
  fail,
  text,
  choice,
  uid,
  requireGroup,
  activeMember,
  absenceCount,
  absencesSql,
  notify,
} from "./db.mjs";
const validCare = `SELECT COUNT(*) FROM care_requests r JOIN care_cases c ON c.id=r.case_id JOIN members m ON m.group_id=c.group_id AND m.user_id=r.reporter_id AND m.status='active' WHERE r.case_id=?`;
const validReports = `SELECT COUNT(*) FROM conduct_reports r JOIN conduct_cases c ON c.id=r.case_id JOIN members m ON m.group_id=c.group_id AND m.user_id=r.reporter_id AND m.status='active' WHERE r.case_id=? AND r.reporter_id!=c.target_id`;
export async function safetyOverview(db, user, gid) {
  const args = gid ? [user, gid] : [user];
  const filter = gid ? " AND c.group_id=?" : "";
  const care = await rows(
    db,
    `SELECT c.*,g.title,g.owner_id,p.nickname AS target_name,o.status AS delivery_status,o.attempts,o.delivered_at,(SELECT COUNT(*) FROM care_requests r JOIN members m ON m.group_id=c.group_id AND m.user_id=r.reporter_id AND m.status='active' WHERE r.case_id=c.id) AS request_count FROM care_cases c JOIN groups g ON g.id=c.group_id JOIN profiles p ON p.id=c.target_id LEFT JOIN aid_outbox o ON o.case_id=c.id WHERE EXISTS(SELECT 1 FROM members m WHERE m.group_id=c.group_id AND m.user_id=? AND m.status='active')${filter} ORDER BY c.created_at DESC LIMIT 100`,
    ...args,
  );
  for (const c of care) {
    c.requested = !!(await one(
      db,
      "SELECT 1 FROM care_requests WHERE case_id=? AND reporter_id=?",
      c.id,
      user,
    ));
    c.can_resolve = c.owner_id === user || c.target_id === user;
    c.requests =
      c.owner_id === user || c.target_id === user
        ? await rows(
            db,
            "SELECT r.reason,r.created_at,p.nickname FROM care_requests r JOIN profiles p ON p.id=r.reporter_id WHERE r.case_id=? ORDER BY r.created_at",
            c.id,
          )
        : [];
  }
  const conduct = await rows(
    db,
    `SELECT c.*,g.title,g.owner_id,p.nickname AS target_name,(SELECT COUNT(*) FROM conduct_reports r JOIN members m ON m.group_id=c.group_id AND m.user_id=r.reporter_id AND m.status='active' WHERE r.case_id=c.id AND r.reporter_id!=c.target_id) AS report_count,(SELECT COUNT(*) FROM members m WHERE m.group_id=c.group_id AND m.status='active' AND m.user_id!=c.target_id) AS electorate FROM conduct_cases c JOIN groups g ON g.id=c.group_id JOIN profiles p ON p.id=c.target_id WHERE EXISTS(SELECT 1 FROM members m WHERE m.group_id=c.group_id AND m.user_id=? AND m.status='active')${filter} AND (g.owner_id=? OR c.target_id=? OR EXISTS(SELECT 1 FROM conduct_reports r WHERE r.case_id=c.id AND r.reporter_id=?)) ORDER BY c.created_at DESC LIMIT 100`,
    ...args,
    user,
    user,
    user,
  );
  for (const c of conduct) {
    c.threshold = Math.floor(c.electorate / 2) + 1;
    c.can_expel =
      c.owner_id === user &&
      c.status === "open" &&
      c.report_count >= c.threshold;
    c.reports =
      c.owner_id === user
        ? await rows(
            db,
            "SELECT r.category,r.reason,r.created_at,p.nickname FROM conduct_reports r JOIN profiles p ON p.id=r.reporter_id WHERE r.case_id=? ORDER BY r.created_at",
            c.id,
          )
        : [];
  }
  return { care, conduct };
}
export async function safetyAction(db, gid, user, action, data, now) {
  const g = await requireGroup(
    db,
    gid,
    user,
    ["expel", "restore", "retry-aid"].includes(action),
  );
  if (g.archived && !["resolve-care", "retry-aid"].includes(action))
    fail(409, "종료된 모임이에요.");
  if (action === "care-request" || action === "conduct-report") {
    const target = text(data.target_id, "대상 참여자", 200);
    if (target === user) fail(422, "본인을 신고할 수 없어요.");
    if (target === g.owner_id)
      fail(422, "이 기능은 모임 참여자를 대상으로 해요.");
    if (!(await activeMember(db, gid, target)))
      fail(422, "현재 모임에 참여 중인 사람만 선택할 수 있어요.");
    const reason = text(
      data.reason,
      action === "care-request" ? "확인을 요청하는 이유" : "신고 사유",
      1000,
    );
    const id = uid();
    if (action === "care-request") {
      if ((await absenceCount(db, gid, target, now)) < 3)
        fail(
          422,
          "사전 안내 없는 불참이 3회 누적되어야 안부 확인을 요청할 수 있어요.",
        );
      await db.batch([
        statement(
          db,
          `INSERT OR IGNORE INTO care_cases(id,group_id,target_id,created_at) SELECT ?,?,?,? WHERE (${absencesSql})>=3 AND EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='active') AND EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='active')`,
          id,
          gid,
          target,
          now,
          gid,
          target,
          now,
          gid,
          user,
          gid,
          target,
        ),
        statement(
          db,
          `INSERT OR IGNORE INTO care_requests(case_id,reporter_id,reason,created_at) SELECT id,?,?,? FROM care_cases WHERE group_id=? AND target_id=? AND status='open' AND EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='active') AND (${absencesSql})>=3`,
          user,
          reason,
          now,
          gid,
          target,
          gid,
          user,
          gid,
          target,
          now,
        ),
        statement(
          db,
          `INSERT OR IGNORE INTO aid_outbox(id,case_id,status,next_attempt_at,created_at) SELECT ?,c.id,'pending',?,? FROM care_cases c WHERE c.group_id=? AND c.target_id=? AND c.status='open' AND (SELECT COUNT(*) FROM care_requests r JOIN members m ON m.group_id=c.group_id AND m.user_id=r.reporter_id AND m.status='active' WHERE r.case_id=c.id)>=3`,
          uid(),
          now,
          now,
          gid,
          target,
        ),
      ]);
      const c = await one(
        db,
        "SELECT id FROM care_cases WHERE group_id=? AND target_id=? AND status='open'",
        gid,
        target,
      );
      if (!c) fail(409, "참여 상태나 출석이 변경됐어요. 다시 확인해 주세요.");
      await db.batch([
        notify(
          db,
          g.owner_id,
          gid,
          "새 안부 확인 요청이 있어요. 안부 센터에서 확인해 주세요.",
          now,
          `care-${c.id}-${user}`,
        ),
        notify(
          db,
          target,
          gid,
          "모임에서 안부를 기다리고 있어요. 안전하다면 안부 센터에서 알려 주세요.",
          now,
          `care-target-${c.id}`,
        ),
      ]);
      return { id: c.id };
    }
    const category = choice(
      data.category,
      ["괴롭힘·혐오", "개인정보 침해", "사기·광고", "모임 방해", "기타"],
      "신고 유형",
    );
    await db.batch([
      statement(
        db,
        "INSERT OR IGNORE INTO conduct_cases(id,group_id,target_id,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='active')",
        id,
        gid,
        target,
        now,
        gid,
        target,
      ),
      statement(
        db,
        "INSERT OR IGNORE INTO conduct_reports(case_id,reporter_id,category,reason,created_at) SELECT id,?,?,?,? FROM conduct_cases WHERE group_id=? AND target_id=? AND status='open' AND EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='active')",
        user,
        category,
        reason,
        now,
        gid,
        target,
        gid,
        user,
      ),
    ]);
    const c = await one(
      db,
      "SELECT id FROM conduct_cases WHERE group_id=? AND target_id=? AND status='open'",
      gid,
      target,
    );
    if (!c) fail(409, "참여 상태가 변경됐어요.");
    await db.batch([
      notify(
        db,
        g.owner_id,
        gid,
        "운영 검토가 필요한 신고가 접수됐어요.",
        now,
        `conduct-${c.id}-${user}`,
      ),
    ]);
    return { id: c.id };
  }
  if (action === "resolve-care") {
    const c = await one(
      db,
      "SELECT * FROM care_cases WHERE id=? AND group_id=? AND status='open'",
      text(data.case_id, "안부 요청", 100),
      gid,
    );
    if (!c) fail(409, "이미 확인했거나 존재하지 않는 요청이에요.");
    if (user !== g.owner_id && user !== c.target_id)
      fail(403, "본인이나 모임장이 안부 확인을 완료할 수 있어요.");
    const reason = text(data.reason, "확인 결과", 500);
    await db.batch([
      statement(
        db,
        "UPDATE care_cases SET status='resolved',resolved_at=?,resolved_by=?,resolution=? WHERE id=? AND status='open'",
        now,
        user,
        reason,
        c.id,
      ),
      statement(
        db,
        "UPDATE members SET care_after=? WHERE group_id=? AND user_id=?",
        now,
        gid,
        c.target_id,
      ),
      statement(
        db,
        "UPDATE aid_outbox SET status='cancelled' WHERE case_id=? AND status NOT IN ('delivered','sending')",
        c.id,
      ),
      notify(
        db,
        g.owner_id,
        gid,
        "안부 확인이 완료됐어요.",
        now,
        `resolved-${c.id}`,
      ),
    ]);
    return { ok: true };
  }
  if (action === "expel") {
    const c = await one(
      db,
      "SELECT * FROM conduct_cases WHERE id=? AND group_id=? AND status='open'",
      text(data.case_id, "신고", 100),
      gid,
    );
    if (!c) fail(409, "처리할 수 없는 신고예요.");
    if (c.target_id === g.owner_id) fail(422, "모임장을 퇴출할 수 없어요.");
    const reason = text(data.reason, "검토 결과", 1000),
      auditId = uid();
    // Eligibility and membership change share one SQLite transaction. An exact half is insufficient.
    const result = await db.batch([
      statement(
        db,
        `INSERT INTO moderation_audit(id,group_id,case_id,target_id,actor_id,action,reason,reporters,electorate,created_at) SELECT ?,?,?,?,?,'expel',?,(${validReports}),(SELECT COUNT(*) FROM members WHERE group_id=? AND status='active' AND user_id!=?),? WHERE (${validReports})*2>(SELECT COUNT(*) FROM members WHERE group_id=? AND status='active' AND user_id!=?) AND EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='active') AND EXISTS(SELECT 1 FROM conduct_cases WHERE id=? AND status='open')`,
        auditId,
        gid,
        c.id,
        c.target_id,
        user,
        reason,
        c.id,
        gid,
        c.target_id,
        now,
        c.id,
        gid,
        c.target_id,
        gid,
        c.target_id,
        c.id,
      ),
      statement(
        db,
        "UPDATE members SET status='removed',removed_at=? WHERE group_id=? AND user_id=? AND EXISTS(SELECT 1 FROM moderation_audit WHERE id=?)",
        now,
        gid,
        c.target_id,
        auditId,
      ),
      statement(
        db,
        "UPDATE conduct_cases SET status='expelled' WHERE id=? AND EXISTS(SELECT 1 FROM moderation_audit WHERE id=?)",
        c.id,
        auditId,
      ),
      statement(
        db,
        "INSERT INTO notifications(id,user_id,group_id,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM moderation_audit WHERE id=?)",
        uid(),
        c.target_id,
        gid,
        `모임장이 신고를 검토해 참여를 제한했어요. 검토 결과: ${reason}`,
        now,
        auditId,
      ),
    ]);
    if (!changes(result[0]))
      fail(
        409,
        "현재 참여자 기준 과반수 신고가 필요해요. 대상자를 제외하고 모임장을 포함해 집계해요.",
      );
    return { ok: true };
  }
  if (action === "restore") {
    const target = text(data.target_id, "참여자", 200),
      reason = text(data.reason, "제한 해제 이유", 1000);
    const c = await one(
      db,
      "SELECT * FROM conduct_cases WHERE group_id=? AND target_id=? AND status='expelled' ORDER BY created_at DESC LIMIT 1",
      gid,
      target,
    );
    if (!c) fail(409, "해제할 수 있는 참여 제한이 없어요.");
    const aid = uid();
    const r = await db.batch([
      statement(
        db,
        "INSERT INTO moderation_audit(id,group_id,case_id,target_id,actor_id,action,reason,reporters,electorate,created_at) SELECT ?,?,?,?,?,'restore',?,0,0,? WHERE EXISTS(SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='removed')",
        aid,
        gid,
        c.id,
        target,
        user,
        reason,
        now,
        gid,
        target,
      ),
      statement(
        db,
        "UPDATE members SET status='left',removed_at=NULL WHERE group_id=? AND user_id=? AND EXISTS(SELECT 1 FROM moderation_audit WHERE id=?)",
        gid,
        target,
        aid,
      ),
      statement(
        db,
        "UPDATE conduct_cases SET status='restored' WHERE id=? AND EXISTS(SELECT 1 FROM moderation_audit WHERE id=?)",
        c.id,
        aid,
      ),
    ]);
    if (!changes(r[0])) fail(409, "이미 해제된 제한이에요.");
    await db.batch([
      notify(
        db,
        target,
        gid,
        "참여 제한이 해제됐어요. 정원이 남아 있으면 다시 참여할 수 있어요.",
        now,
      ),
    ]);
    return { ok: true };
  }
  if (action === "retry-aid") {
    const c = await one(
      db,
      "SELECT c.id FROM care_cases c WHERE c.id=? AND c.group_id=? AND c.status='open'",
      text(data.case_id, "안부 요청", 100),
      gid,
    );
    if (!c) fail(404, "진행 중인 요청이 없어요.");
    await run(
      db,
      "UPDATE aid_outbox SET next_attempt_at=?,status='pending' WHERE case_id=? AND status NOT IN ('delivered','sending','cancelled')",
      now,
      c.id,
    );
    return { ok: true };
  }
  fail(404, "지원하지 않는 안전 작업이에요.");
}
