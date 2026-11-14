import { rows, one, run, absenceCount } from "./db.mjs";
export function agencyConfigured(agency = {}) {
  try {
    return new URL(agency.url).protocol === "https:" && !!agency.token;
  } catch {
    return false;
  }
}
export async function drainOutbox(
  db,
  agency = {},
  fetcher = fetch,
  now = Date.now(),
  groupId = null,
) {
  const items = await rows(
    db,
    `SELECT o.*,c.group_id,c.target_id,c.status AS case_status,p.nickname,p.contact,p.region,p.aid_consent,(SELECT COUNT(*) FROM care_requests r JOIN members m ON m.group_id=c.group_id AND m.user_id=r.reporter_id AND m.status='active' WHERE r.case_id=c.id) AS request_count FROM aid_outbox o JOIN care_cases c ON c.id=o.case_id JOIN profiles p ON p.id=c.target_id WHERE o.status IN ('pending','retry','unconfigured','awaiting_consent','waiting_threshold','waiting_eligibility','sending') AND o.next_attempt_at<=? AND (o.lease_until IS NULL OR o.lease_until<?) ${groupId ? "AND c.group_id=?" : ""} ORDER BY o.created_at LIMIT 5`,
    ...[now, now, ...(groupId ? [groupId] : [])],
  );
  for (const o of items) {
    if (o.case_status !== "open") {
      await run(
        db,
        "UPDATE aid_outbox SET status='cancelled',lease_until=NULL WHERE id=? AND status!='delivered'",
        o.id,
      );
      continue;
    }
    let waiting = null;
    if ((await absenceCount(db, o.group_id, o.target_id, now)) < 3)
      waiting = "waiting_eligibility";
    else if (o.request_count < 3) waiting = "waiting_threshold";
    else if (!o.aid_consent || !o.contact) waiting = "awaiting_consent";
    else if (!agencyConfigured(agency)) waiting = "unconfigured";
    if (waiting) {
      await run(
        db,
        "UPDATE aid_outbox SET status=?,lease_until=NULL WHERE id=? AND (lease_until IS NULL OR lease_until<?)",
        waiting,
        o.id,
        now,
      );
      continue;
    }
    const claim = await one(
      db,
      "UPDATE aid_outbox SET status='sending',lease_until=?,attempts=attempts+1 WHERE id=? AND status NOT IN ('delivered','cancelled','attention') AND (lease_until IS NULL OR lease_until<?) RETURNING attempts",
      now + 30000,
      o.id,
      now,
    );
    if (!claim) continue;
    try {
      const latest = await one(
        db,
        "SELECT c.status,p.aid_consent,p.contact,p.region FROM care_cases c JOIN profiles p ON p.id=c.target_id WHERE c.id=?",
        o.case_id,
      );
      if (latest.status !== "open" || !latest.aid_consent || !latest.contact) {
        await run(
          db,
          "UPDATE aid_outbox SET status=?,lease_until=NULL WHERE id=?",
          latest.status !== "open" ? "cancelled" : "awaiting_consent",
          o.id,
        );
        continue;
      }
      // Attendance can be corrected while the outbox lease is being acquired.
      // Re-read the persisted three-day eligibility immediately before delivery.
      if ((await absenceCount(db, o.group_id, o.target_id, now)) < 3) {
        await run(
          db,
          "UPDATE aid_outbox SET status='waiting_eligibility',lease_until=NULL WHERE id=?",
          o.id,
        );
        continue;
      }
      const response = await fetcher(agency.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${agency.token}`,
          "Idempotency-Key": o.id,
        },
        body: JSON.stringify({
          event: "wargether.welfare_check_requested",
          version: 1,
          request_id: o.id,
          case_id: o.case_id,
          nickname: o.nickname,
          contact: latest.contact,
          region: latest.region,
          distinct_requests: o.request_count,
          created_at: new Date(o.created_at).toISOString(),
          notice:
            "Repeated unexplained absence; welfare check requested, danger not confirmed.",
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await run(
        db,
        "UPDATE aid_outbox SET status='delivered',delivered_at=?,lease_until=NULL,last_error=NULL WHERE id=?",
        now,
        o.id,
      );
    } catch (err) {
      const status = claim.attempts >= 5 ? "attention" : "retry";
      await run(
        db,
        "UPDATE aid_outbox SET status=?,lease_until=NULL,next_attempt_at=?,last_error=? WHERE id=?",
        status,
        now + Math.min(3600000, 60000 * 2 ** Math.min(claim.attempts - 1, 6)),
        /^HTTP \d{3}$/.test(err.message) ? err.message : "NETWORK_OR_TIMEOUT",
        o.id,
      );
    }
  }
}
