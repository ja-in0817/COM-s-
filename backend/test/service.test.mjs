import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./database.mjs";
import { handleApi } from "../service.mjs";
import { drainOutbox } from "../outbox.mjs";
const start = 1800000000000;
async function fixture(capacity = 10) {
  const db = database();
  const ctx = { db, now: start, agency: {} };
  const api = async (user, path, data, options = {}) => {
    const r = await handleApi(
      new Request("https://wargether.test/api/" + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          origin: "https://wargether.test",
          "content-type": "application/json",
          ...options.headers,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      { ...ctx, userId: user },
    );
    return { status: r.status, body: await r.json() };
  };
  for (const u of ["owner", "a", "b", "c", "d", "outsider"]) {
    assert.equal(
      (
        await api(u, "profile", {
          nickname: u,
          role: u === "owner" ? "mentor" : "mentee",
          timezone: "Asia/Seoul",
          contact: u === "a" ? "a@example.test" : "",
          aid_consent: u === "a",
        })
      ).status,
      200,
    );
  }
  const g = await api("owner", "groups", {
    title: "함께 배우고 쉬기",
    description: "작은 모임",
    category: "언어",
    study_topic: "쉬운 한국어",
    play_topic: "이야기 놀이",
    study_minutes: 20,
    play_minutes: 20,
    capacity,
    platform: "Discord",
    meeting_url: "https://discord.gg/test",
    timezone: "Asia/Seoul",
  });
  assert.equal(g.status, 200);
  const gid = g.body.id;
  const act = (u, action, data = {}) => api(u, `groups/${gid}/${action}`, data);
  return { db, ctx, api, act, gid };
}
async function join(f, users = ["a", "b", "c", "d"]) {
  for (const u of users) assert.equal((await f.act(u, "join")).status, 200);
}
async function missed(f, target = "a", n = 3) {
  for (let i = 0; i < n; i++) {
    const t = f.ctx.now + 1000;
    const s = await f.act("owner", "session", {
      starts_at: t,
      note: "이번 모임",
    });
    assert.equal(s.status, 200);
    f.ctx.now = t + 1000;
    const r = await f.act("owner", "attendance", {
      session_id: s.body.id,
      records: [{ user_id: target, status: "absent" }],
    });
    assert.equal(r.status, 200);
  }
}
const care = (f, u, target = "a") =>
  f.act(u, "care-request", {
    target_id: target,
    reason: "연락이 닿지 않아요.",
  });
const report = (f, u, target = "a") =>
  f.act(u, "conduct-report", {
    target_id: target,
    category: "모임 방해",
    reason: "반복적인 모임 방해를 확인했어요.",
  });
test("authentication, CSRF, validation and private group data", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.act(null, "join")).status, 401);
    assert.equal(
      (
        await f.api(
          "a",
          `groups/${f.gid}/join`,
          {},
          { headers: { origin: "https://evil.test" } },
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.act("a", "session", { starts_at: start + 1000 })).status,
      403,
    );
    assert.equal(
      (
        await f.act("owner", "link", {
          platform: "Zoom",
          meeting_url: "https://zoom.us.evil.test/j/1",
        })
      ).status,
      422,
    );
    assert.equal(
      (await f.api(null, `groups/${f.gid}`)).body.group.meeting_url,
      "",
    );
    await join(f, ["a"]);
    assert.equal(
      (await f.api("a", `groups/${f.gid}`)).body.group.meeting_url,
      "https://discord.gg/test",
    );
    const g = (await f.api("a", `groups/${f.gid}`)).body;
    assert.ok(g.members.every((m) => !("contact" in m)));
    assert.equal(
      (await f.act("a", "attendance", { session_id: "x", records: [] })).status,
      403,
    );
    assert.equal((await care(f, "a", "a")).status, 422);
  } finally {
    f.db.close();
  }
});
test("concurrent joins respect capacity and duplicate joins do not consume seats", async () => {
  const f = await fixture(2);
  try {
    const results = await Promise.all(
      ["a", "b", "c", "d"].map((u) => f.act(u, "join")),
    );
    assert.equal(results.filter((r) => r.status === 200).length, 2);
    assert.equal(
      (await f.api(null, `groups/${f.gid}`)).body.group.member_count,
      2,
    );
    const joined = ["a", "b", "c", "d"][
      results.findIndex((r) => r.status === 200)
    ];
    assert.equal((await f.act(joined, "join")).status, 200);
  } finally {
    f.db.close();
  }
});
test("messages are idempotent, account scoped, and not visible to outsiders", async () => {
  const f = await fixture();
  try {
    await join(f, ["a"]);
    const args = { body: "함께 읽어요!", request_id: "same-request-id" };
    const rs = await Promise.all([
      f.act("a", "message", args),
      f.act("a", "message", args),
    ]);
    assert.deepEqual(
      rs.map((r) => r.status),
      [200, 200],
    );
    assert.equal(rs[0].body.id, rs[1].body.id);
    assert.equal(
      (await f.act("a", "message", { ...args, body: "다른 글" })).status,
      409,
    );
    assert.equal(
      (await f.api("outsider", `groups/${f.gid}`)).body.messages.length,
      0,
    );
    assert.equal((await f.act("outsider", "message", args)).status, 403);
    assert.equal((await f.api("a", `groups/${f.gid}`)).body.messages.length, 1);
  } finally {
    f.db.close();
  }
});
test("advance notice and connectivity issues do not count as unexplained absences", async () => {
  const f = await fixture();
  try {
    await join(f, ["a"]);
    for (const status of ["absent", "connectivity"]) {
      const s = await f.act("owner", "session", {
        starts_at: f.ctx.now + 1000,
      });
      if (status === "absent")
        assert.equal(
          (
            await f.act("a", "absence", {
              session_id: s.body.id,
              reason: "인터넷이 어려워요",
            })
          ).status,
          200,
        );
      f.ctx.now += 2000;
      assert.equal(
        (
          await f.act("owner", "attendance", {
            session_id: s.body.id,
            records: [{ user_id: "a", status }],
          })
        ).status,
        200,
      );
    }
    const g = (await f.api("a", `groups/${f.gid}`)).body;
    assert.equal(
      g.members.find((m) => m.user_id === "a").unannounced_absences,
      0,
    );
    assert.equal((await care(f, "owner")).status, 422);
  } finally {
    f.db.close();
  }
});
test("three distinct welfare requests create one durable delivery; resolving resets eligibility", async () => {
  const f = await fixture();
  try {
    await join(f);
    await missed(f);
    const first = await care(f, "owner");
    assert.equal(first.status, 200);
    await care(f, "owner");
    await care(f, "b");
    let s = (await f.api("owner", "safety")).body;
    assert.equal(s.care[0].request_count, 2);
    assert.equal(s.care[0].delivery_status, null);
    await care(f, "c");
    s = (await f.api("owner", "safety")).body;
    assert.equal(s.care[0].request_count, 3);
    assert.equal(s.care[0].delivery_status, "unconfigured");
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM aid_outbox").get().n,
      1,
    );
    assert.equal((await f.api("outsider", "safety")).body.care.length, 0);
    assert.equal(
      (
        await f.act("b", "resolve-care", {
          case_id: first.body.id,
          reason: "확인",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.act("a", "resolve-care", {
          case_id: first.body.id,
          reason: "현재 안전합니다.",
        })
      ).status,
      200,
    );
    assert.equal((await care(f, "owner")).status, 422);
    await missed(f);
    await care(f, "owner");
    s = (await f.api("owner", "safety")).body;
    assert.equal(s.care.length, 2);
    assert.equal(s.care.find((c) => c.status === "open").request_count, 1);
  } finally {
    f.db.close();
  }
});
test("strict majority, organizer-only removal, rejoin block, audited restoration", async () => {
  const f = await fixture();
  try {
    await join(f);
    let r = await report(f, "owner");
    await report(f, "b");
    await report(f, "b");
    let s = (await f.api("owner", "safety")).body.conduct[0];
    assert.equal(s.report_count, 2);
    assert.equal(s.electorate, 4);
    assert.equal(s.can_expel, false);
    assert.equal(
      (
        await f.act("owner", "expel", {
          case_id: r.body.id,
          reason: "검토 완료",
        })
      ).status,
      409,
    );
    await report(f, "c");
    assert.equal(
      (await f.act("b", "expel", { case_id: r.body.id, reason: "검토 완료" }))
        .status,
      403,
    );
    assert.equal(
      (
        await f.act("owner", "expel", {
          case_id: r.body.id,
          reason: "반복 방해 증거 확인",
        })
      ).status,
      200,
    );
    assert.equal((await f.act("a", "join")).status, 403);
    assert.equal(
      (
        await f.act("a", "message", {
          body: "글",
          request_id: "new-request-id",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.act("owner", "restore", {
          target_id: "a",
          reason: "이의 검토 후 해제",
        })
      ).status,
      200,
    );
    assert.equal((await f.act("a", "join")).status, 200);
    assert.equal(
      f.db.raw.prepare("SELECT COUNT(*) n FROM moderation_audit").get().n,
      2,
    );
  } finally {
    f.db.close();
  }
});
test("majority is recomputed using current members, not departed reporters", async () => {
  const f = await fixture();
  try {
    await join(f);
    const r = await report(f, "owner");
    await report(f, "b");
    await report(f, "c");
    await f.act("c", "leave");
    await f.act("outsider", "join");
    assert.equal(
      (await f.act("owner", "expel", { case_id: r.body.id, reason: "재검토" }))
        .status,
      409,
    );
    assert.equal(
      (await f.api("owner", "safety")).body.conduct[0].report_count,
      2,
    );
  } finally {
    f.db.close();
  }
});
test("webhook respects consent, retries errors, uses stable idempotency key, never sends twice after success", async () => {
  const f = await fixture();
  try {
    await join(f);
    await missed(f);
    await care(f, "owner");
    await care(f, "b");
    await care(f, "c");
    const calls = [];
    const config = {
      url: "https://agency.example.test/intake",
      token: "test-token",
    };
    f.db.raw.prepare("UPDATE profiles SET aid_consent=0 WHERE id='a'").run();
    await drainOutbox(
      f.db,
      config,
      async () => {
        throw Error("must not send");
      },
      f.ctx.now,
    );
    assert.equal(
      f.db.raw.prepare("SELECT status FROM aid_outbox").get().status,
      "awaiting_consent",
    );
    f.db.raw.prepare("UPDATE profiles SET aid_consent=1 WHERE id='a'").run();
    const send = async (url, options) => {
      calls.push(options);
      return new Response("", { status: calls.length === 1 ? 503 : 202 });
    };
    await drainOutbox(f.db, config, send, f.ctx.now);
    assert.equal(
      f.db.raw.prepare("SELECT status FROM aid_outbox").get().status,
      "retry",
    );
    await drainOutbox(f.db, config, send, f.ctx.now);
    assert.equal(calls.length, 1);
    f.ctx.now += 61000;
    await Promise.all([
      drainOutbox(f.db, config, send, f.ctx.now),
      drainOutbox(f.db, config, send, f.ctx.now),
    ]);
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].headers["Idempotency-Key"],
      calls[1].headers["Idempotency-Key"],
    );
    const payload = JSON.parse(calls[1].body);
    assert.equal(payload.contact, "a@example.test");
    assert.ok(!("reason" in payload));
    assert.equal(
      f.db.raw.prepare("SELECT status FROM aid_outbox").get().status,
      "delivered",
    );
    await drainOutbox(f.db, config, send, f.ctx.now + 999999);
    assert.equal(calls.length, 2);
  } finally {
    f.db.close();
  }
});
test("proposal votes are distinct and only organizer can adopt a topic", async () => {
  const f = await fixture();
  try {
    await join(f, ["a", "b"]);
    const p = await f.act("a", "proposal", {
      kind: "play",
      body: "함께 그림 그리기",
    });
    await f.act("a", "vote", { proposal_id: p.body.id, voted: true });
    await f.act("a", "vote", { proposal_id: p.body.id, voted: true });
    await f.act("b", "vote", { proposal_id: p.body.id, voted: true });
    assert.equal(
      (await f.api("a", `groups/${f.gid}`)).body.proposals[0].votes,
      2,
    );
    assert.equal(
      (await f.act("a", "select-topic", { proposal_id: p.body.id })).status,
      403,
    );
    assert.equal(
      (await f.act("owner", "select-topic", { proposal_id: p.body.id })).status,
      200,
    );
    assert.equal(
      (await f.api("a", `groups/${f.gid}`)).body.group.play_topic,
      "함께 그림 그리기",
    );
  } finally {
    f.db.close();
  }
});
test("archived groups retain member access but reject new participation and posts", async () => {
  const f = await fixture();
  try {
    await join(f, ["a"]);
    await f.act("owner", "archive");
    assert.equal((await f.api("a", "groups")).body.groups.length, 0);
    assert.equal((await f.api("a", "groups?scope=mine")).body.groups.length, 1);
    assert.equal((await f.act("b", "join")).status, 404);
    assert.equal(
      (
        await f.act("a", "message", {
          body: "test",
          request_id: "archive-test-id",
        })
      ).status,
      409,
    );
  } finally {
    f.db.close();
  }
});
test("corrected attendance prevents queued agency delivery", async () => {
  const f = await fixture();
  try {
    await join(f);
    await missed(f);
    await care(f, "owner");
    await care(f, "b");
    await care(f, "c");
    f.db.raw
      .prepare("UPDATE attendance SET status='connectivity' WHERE user_id='a'")
      .run();
    let calls = 0;
    await drainOutbox(
      f.db,
      { url: "https://agency.example.test", token: "test" },
      async () => {
        calls++;
        return new Response("");
      },
      f.ctx.now,
    );
    assert.equal(calls, 0);
    assert.equal(
      f.db.raw.prepare("SELECT status FROM aid_outbox").get().status,
      "waiting_eligibility",
    );
  } finally {
    f.db.close();
  }
});
test("cross-group IDs cannot modify schedules or votes", async () => {
  const f = await fixture();
  try {
    await join(f, ["a"]);
    const other = await f.api("owner", "groups", {
      title: "다른 모임",
      description: "다른 멤버십",
      category: "생활",
      study_topic: "요리",
      play_topic: "퀴즈",
      study_minutes: 10,
      play_minutes: 10,
      capacity: 5,
      platform: "텍스트",
    });
    const s = await f.api("owner", `groups/${other.body.id}/session`, {
      starts_at: f.ctx.now + 10000,
    });
    assert.equal(
      (await f.act("a", "absence", { session_id: s.body.id, reason: "안내" }))
        .status,
      422,
    );
    const p = await f.api("owner", `groups/${other.body.id}/proposal`, {
      kind: "play",
      body: "이야기",
    });
    assert.equal(
      (await f.act("a", "vote", { proposal_id: p.body.id, voted: true }))
        .status,
      404,
    );
  } finally {
    f.db.close();
  }
});
test("closed welfare case cancels undelivered messages even after group archive", async () => {
  const f = await fixture();
  try {
    await join(f);
    await missed(f);
    const c = await care(f, "owner");
    await care(f, "b");
    await care(f, "c");
    await f.act("owner", "archive");
    assert.equal(
      (
        await f.act("a", "resolve-care", {
          case_id: c.body.id,
          reason: "안전해요",
        })
      ).status,
      200,
    );
    let calls = 0;
    await drainOutbox(
      f.db,
      { url: "https://agency.example.test", token: "test" },
      async () => {
        calls++;
        return new Response("");
      },
      f.ctx.now,
    );
    assert.equal(calls, 0);
    assert.equal(
      f.db.raw.prepare("SELECT status FROM aid_outbox").get().status,
      "cancelled",
    );
  } finally {
    f.db.close();
  }
});
