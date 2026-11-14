import { one, rows, run, fail, text, choice, timezone } from "./db.mjs";
import {
  listGroups,
  groupDetail,
  createGroup,
  groupAction,
} from "./groups.mjs";
import { safetyOverview, safetyAction } from "./safety.mjs";
import { drainOutbox, agencyConfigured } from "./outbox.mjs";
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};
export async function handleApi(request, context) {
  const { db, userId: user = null, agency = {}, fetcher = fetch } = context;
  const now = context.now ?? Date.now();
  try {
    const url = new URL(request.url),
      path = url.pathname
        .replace(/^\/api\/?/, "")
        .split("/")
        .filter(Boolean),
      method = request.method;
    let data = {};
    if (!["GET", "POST"].includes(method))
      fail(405, "지원하지 않는 요청 방식이에요.");
    if (method === "POST") {
      const origin = request.headers.get("origin");
      if (origin !== url.origin) fail(403, "같은 사이트에서 요청해 주세요.");
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        fail(415, "JSON 요청이 필요해요.");
      if (!user) fail(401, "로그인이 필요해요.");
      const reader = request.body?.getReader();
      let size = 0,
        chunks = [];
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 32768) {
            await reader.cancel();
            fail(413, "요청이 너무 커요.");
          }
          chunks.push(value);
        }
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        data = JSON.parse(new TextDecoder().decode(body));
      } catch {
        fail(400, "요청 내용을 읽을 수 없어요.");
      }
      if (!data || Array.isArray(data) || typeof data !== "object")
        fail(400, "요청 형식이 올바르지 않아요.");
      const window = Math.floor(now / 60000) * 60000;
      const rate = await one(
        db,
        "INSERT INTO rate_limits(key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count",
        user,
        window,
      );
      if (rate.count > 60)
        fail(429, "요청이 많아요. 잠시 후 다시 시도해 주세요.");
    }
    let result;
    if (method === "GET" && path[0] === "health") {
      await one(db, "SELECT 1 AS ok");
      result = {
        ok: true,
        storage: "persistent",
        agency_configured: agencyConfigured(agency),
      };
    } else if (method === "GET" && path[0] === "bootstrap") {
      result = {
        user_id: user,
        profile: user
          ? await one(db, "SELECT * FROM profiles WHERE id=?", user)
          : null,
        agency_configured: agencyConfigured(agency),
      };
    } else if (method === "GET" && path[0] === "groups" && path.length === 1) {
      result = {
        groups: await listGroups(
          db,
          user,
          url.searchParams.get("q") || "",
          now,
          url.searchParams.get("scope") === "mine" ? "mine" : "public",
        ),
      };
    } else if (method === "GET" && path[0] === "groups" && path.length === 2) {
      result = await groupDetail(db, path[1], user, now);
    } else {
      if (!user) fail(401, "로그인이 필요해요.");
      if (method === "POST" && path[0] === "profile") {
        const nickname = text(data.nickname, "닉네임", 30),
          role = choice(data.role, ["mentor", "mentee"], "역할"),
          tz = timezone(data.timezone || "Asia/Seoul"),
          contact = text(data.contact ?? "", "연락처", 200, false),
          region = text(data.region ?? "", "지역", 100, false),
          consent = data.aid_consent === true ? 1 : 0;
        if (consent && !contact)
          fail(422, "기관 연락에 동의하려면 연락처를 입력해 주세요.");
        await run(
          db,
          "INSERT INTO profiles(id,nickname,role,timezone,contact,region,aid_consent,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,role=excluded.role,timezone=excluded.timezone,contact=excluded.contact,region=excluded.region,aid_consent=excluded.aid_consent",
          user,
          nickname,
          role,
          tz,
          contact,
          region,
          consent,
          now,
        );
        result = { ok: true };
      } else {
        if (!(await one(db, "SELECT 1 FROM profiles WHERE id=?", user)))
          fail(409, "먼저 프로필을 설정해 주세요.");
        if (method === "POST" && path[0] === "groups" && path.length === 1)
          result = await createGroup(db, user, data, now);
        else if (
          method === "POST" &&
          path[0] === "groups" &&
          path.length === 3
        ) {
          const [_, gid, action] = path;
          if (
            [
              "care-request",
              "conduct-report",
              "resolve-care",
              "expel",
              "restore",
              "retry-aid",
            ].includes(action)
          ) {
            result = await safetyAction(db, gid, user, action, data, now);
            if (["care-request", "retry-aid"].includes(action))
              await drainOutbox(db, agency, fetcher, now, gid);
          } else result = await groupAction(db, gid, user, action, data, now);
        } else if (method === "GET" && path[0] === "safety")
          result = await safetyOverview(
            db,
            user,
            url.searchParams.get("group"),
          );
        else if (method === "GET" && path[0] === "notifications")
          result = {
            notifications: await rows(
              db,
              "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
              user,
            ),
          };
        else if (
          method === "POST" &&
          path[0] === "notifications" &&
          path[1] === "read"
        ) {
          await run(
            db,
            "UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL",
            now,
            user,
          );
          result = { ok: true };
        } else fail(404, "요청한 기능을 찾을 수 없어요.");
      }
    }
    return new Response(JSON.stringify(result), { headers });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500)
      console.error("API failure", { message: error.message });
    return new Response(
      JSON.stringify({
        error:
          status === 500
            ? "서버에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요."
            : error.message,
      }),
      { status, headers },
    );
  }
}
