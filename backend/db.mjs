export const statement = (db, sql, ...args) => db.prepare(sql).bind(...args);
export const rows = async (db, sql, ...args) =>
  (await statement(db, sql, ...args).all()).results;
export const one = (db, sql, ...args) => statement(db, sql, ...args).first();
export const run = (db, sql, ...args) => statement(db, sql, ...args).run();
export const changes = (r) => r?.meta?.changes ?? r?.changes ?? 0;
export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export function text(value, label, max = 200, required = true) {
  if (typeof value !== "string") fail(422, `${label}을 확인해 주세요.`);
  const s = value.trim();
  if ((required && !s) || s.length > max)
    fail(422, `${label}은 ${required ? "1" : "0"}~${max}자로 입력해 주세요.`);
  return s;
}
export function choice(value, allowed, label) {
  if (!allowed.includes(value)) fail(422, `${label}을 확인해 주세요.`);
  return value;
}
export function number(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(422, `${label}은 ${min}~${max} 사이의 정수여야 해요.`);
  return value;
}
export function timezone(value) {
  const s = text(value, "시간대", 60);
  try {
    new Intl.DateTimeFormat("ko", { timeZone: s }).format();
  } catch {
    fail(422, "올바른 시간대를 선택해 주세요.");
  }
  return s;
}
export function meetingLink(platform, value) {
  const s = text(value ?? "", "진행 링크", 1000, false);
  if (!s) return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    fail(422, "올바른 진행 링크를 입력해 주세요.");
  }
  const h = u.hostname.toLowerCase();
  const ok =
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (!u.port || u.port === "443") &&
    (platform === "Zoom"
      ? h === "zoom.us" ||
        h.endsWith(".zoom.us") ||
        h === "zoom.com" ||
        h.endsWith(".zoom.com")
      : platform === "Discord"
        ? (h === "discord.gg" && u.pathname.length > 1) ||
          ((h === "discord.com" || h === "www.discord.com") &&
            /^\/(invite|channels)\/.+/.test(u.pathname))
        : platform === "오픈채팅"
          ? h === "open.kakao.com"
          : false);
  if (!ok) fail(422, "선택한 플랫폼의 HTTPS 초대 링크를 입력해 주세요.");
  return u.href;
}
export const uid = () => crypto.randomUUID();
export const activeMember = async (db, gid, user) =>
  !!(await one(
    db,
    "SELECT 1 FROM members WHERE group_id=? AND user_id=? AND status='active'",
    gid,
    user,
  ));
export async function requireGroup(db, gid, user, owner = false) {
  const g = await one(db, "SELECT * FROM groups WHERE id=?", gid);
  if (!g) fail(404, "모임을 찾을 수 없어요.");
  if (owner ? g.owner_id !== user : !(await activeMember(db, gid, user)))
    fail(
      403,
      owner
        ? "모임장만 사용할 수 있어요."
        : "이 모임의 참여자만 사용할 수 있어요.",
    );
  return g;
}
export const absencesSql = `SELECT COUNT(*) FROM attendance a JOIN sessions s ON s.id=a.session_id JOIN members m ON m.group_id=s.group_id AND m.user_id=a.user_id LEFT JOIN absence_notices n ON n.session_id=a.session_id AND n.user_id=a.user_id WHERE s.group_id=? AND a.user_id=? AND a.status='absent' AND s.status!='cancelled' AND s.starts_at<=? AND s.starts_at>m.care_after AND s.starts_at>=m.joined_at AND n.user_id IS NULL`;
export const absenceCount = async (db, gid, user, now) =>
  Number(Object.values(await one(db, absencesSql, gid, user, now))[0]);
export const notify = (db, user, gid, body, now, id = uid()) =>
  statement(
    db,
    "INSERT OR IGNORE INTO notifications(id,user_id,group_id,body,created_at) VALUES (?,?,?,?,?)",
    id,
    user,
    gid,
    body,
    now,
  );
