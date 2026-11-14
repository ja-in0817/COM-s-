"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Heart,
  Users,
  Plus,
  Search,
  Bookmark,
  Clock,
  CalendarDays,
  ShieldCheck,
  MessageCircle,
  Leaf,
  Sparkles,
  Bell,
  ChevronLeft,
  ExternalLink,
  Check,
  WifiOff,
  RefreshCw,
  Flag,
  LogOut,
  Send,
  Lightbulb,
  ThumbsUp,
  Settings,
  X,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  Gamepad2,
  Globe,
} from "lucide-react";
import { Dialog, type DialogSpec, type Field, type Values } from "./Dialog";
import type {
  Bootstrap,
  Group,
  Detail,
  Member,
  Session,
  Safety,
  Notice,
} from "./types";
const categories = ["전체", "언어", "디지털", "인문·예술", "생활"];
const platforms = ["Zoom", "Discord", "오픈채팅", "텍스트"];
const options = (values: string[]) =>
  values.map((value) => ({ value, label: value }));
const attendanceLabels: Record<string, string> = {
  present: "참여",
  absent: "안내 없는 불참",
  excused: "사전 안내 / 사유 있음",
  connectivity: "통신 장애",
};
function GroupCreationGuidance() {
  return (
    <aside
      className="group-creation-guidance"
      aria-labelledby="group-creation-guidance-title"
    >
      <h3 id="group-creation-guidance-title">연결이 먼저예요</h3>
      <p>
        wargether의 주된 목적은 서로의 연결입니다. 학습과 여가가 부담이나
        압박이 되지 않도록 진행해 주세요. 성과와 참여를 강요하기보다 각자의
        상황과 속도를 존중해 주세요.
      </p>
    </aside>
  );
}
const deliveryLabels: Record<string, string> = {
  pending: "기관 전달 준비",
  unconfigured: "기관 연결 대기",
  awaiting_consent: "본인 동의·연락처 대기",
  waiting_threshold: "유효 요청 3명 대기",
  waiting_eligibility: "출석 정보 재확인 대기",
  sending: "기관에 전달 중",
  retry: "재전송 대기",
  attention: "전달 실패 · 확인 필요",
  delivered: "기관 접수 서버에 전달됨",
  cancelled: "전달 취소",
};
const emptySafety: Safety = { care: [], conduct: [] };
async function api<T = Record<string, unknown>>(
  path: string,
  data?: unknown,
): Promise<T> {
  const r = await fetch("/api/" + path, {
    method: data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  let body: Record<string, unknown>;
  try {
    body = (await r.json()) as Record<string, unknown>;
  } catch {
    throw Error("서버 연결을 확인해 주세요. 응답을 읽을 수 없어요.");
  }
  if (!r.ok)
    throw Error(
      typeof body.error === "string" ? body.error : "요청을 처리하지 못했어요.",
    );
  return body as T;
}
function date(value: number, tz = "Asia/Seoul", short = false) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: tz,
    month: "long",
    day: "numeric",
    weekday: short ? undefined : "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`avatar ${small ? "small" : ""}`} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}
function Empty({
  icon: Icon = Leaf,
  title,
  children,
  action,
}: {
  icon?: typeof Leaf;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null),
    [groups, setGroups] = useState<Group[]>([]),
    [route, setRoute] = useState("/"),
    [detail, setDetail] = useState<Detail | null>(null),
    [safety, setSafety] = useState<Safety>(emptySafety),
    [notices, setNotices] = useState<Notice[]>([]),
    [dialog, setDialog] = useState<DialogSpec | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [online, setOnline] = useState(true),
    [category, setCategory] = useState("전체"),
    [query, setQuery] = useState(""),
    [myFilter, setMyFilter] = useState("participating"),
    [tab, setTab] = useState("board"),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState("");
  const requestId = useRef<string | null>(null),
    draftRef = useRef("");
  const user = bootstrap?.user_id,
    profile = bootstrap?.profile,
    gid = route.startsWith("/groups/") ? route.split("/")[2] : null;
  const go = (path: string) => {
    window.location.hash = path;
  };
  const refresh = useCallback(async () => {
    const [b, g] = await Promise.all([
      api<Bootstrap>("bootstrap"),
      api<{ groups: Group[] }>("groups"),
    ]);
    setBootstrap(b);
    if (b.profile) {
      const mine = await api<{ groups: Group[] }>("groups?scope=mine");
      setGroups([
        ...new Map(
          [...g.groups, ...mine.groups].map((item) => [item.id, item]),
        ).values(),
      ]);
    } else setGroups(g.groups);
    if (b.profile) {
      const [n, s] = await Promise.all([
        api<{ notifications: Notice[] }>("notifications"),
        api<Safety>(
          "safety" + (gid ? "?group=" + encodeURIComponent(gid) : ""),
        ),
      ]);
      setNotices(n.notifications);
      setSafety(s);
    } else {
      setNotices([]);
      setSafety(emptySafety);
    }
    if (gid) setDetail(await api<Detail>("groups/" + encodeURIComponent(gid)));
  }, [gid]);
  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash.replace(/^#/, "") || "/");
      setTab("board");
    };
    change();
    window.addEventListener("hashchange", change);
    const net = () => setOnline(navigator.onLine);
    net();
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    return () => {
      window.removeEventListener("hashchange", change);
      window.removeEventListener("online", net);
      window.removeEventListener("offline", net);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setDetail(null);
    refresh()
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!bootstrap) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        refresh().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [refresh, bootstrap?.user_id]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    requestId.current = null;
    let saved = "";
    try {
      saved = sessionStorage.getItem(`wargether-draft:${user}:${gid}`) || "";
    } catch {}
    setDraft(saved);
    draftRef.current = saved;
  }, [gid, user]);
  const setMessage = (value: string) => {
    setDraft(value);
    draftRef.current = value;
    requestId.current = null;
    try {
      sessionStorage.setItem(`wargether-draft:${user}:${gid}`, value);
    } catch {}
  };
  const signIn = () =>
    setDialog({
      title: "로그인하고 함께해요",
      description:
        "ChatGPT 계정으로 로그인하면 나의 모임과 이야기를 이어갈 수 있어요.",
      content: (
        <a
          className="button full"
          href={
            "/signin-with-chatgpt?return_to=" +
            encodeURIComponent("/" + window.location.hash)
          }
          target="_top"
        >
          ChatGPT로 로그인
          <ArrowUpRight size={17} />
        </a>
      ),
    });
  const profileDialog = (role = profile?.role || "mentee") =>
    setDialog({
      title: profile ? "내 프로필" : "처음 만나는 우리",
      description:
        "닉네임으로 함께해요. 역할은 언제든 바꿀 수 있어요. 연락처는 다른 참여자에게 공개되지 않아요.",
      content: role === "mentor" ? <GroupCreationGuidance /> : undefined,
      fields: [
        {
          key: "nickname",
          label: "닉네임",
          maxLength: 30,
          placeholder: "모임에서 불릴 이름",
        },
        {
          key: "role",
          label: "참여 역할",
          type: "select",
          options: [
            { value: "mentor", label: "멘토 · 모임을 열고 함께 이끌어요" },
            { value: "mentee", label: "멘티 · 함께 배우고 쉬어요" },
          ],
        },
        {
          key: "timezone",
          label: "표시 시간대",
          type: "select",
          options: options([
            "Asia/Seoul",
            "Europe/Kyiv",
            "Europe/Warsaw",
            "Europe/Berlin",
            "Asia/Jerusalem",
            "Asia/Beirut",
            "Europe/London",
            "America/New_York",
            "UTC",
          ]),
        },
        {
          key: "contact",
          label: "안부 연락처",
          required: false,
          placeholder: "이메일 또는 국가번호를 포함한 전화번호",
          help: "기관에 전달할 수 있는 연락처를 직접 입력해 주세요.",
        },
        {
          key: "region",
          label: "현재 지역",
          required: false,
          maxLength: 100,
          placeholder: "국가·도시 정도만 입력해 주세요",
        },
        {
          key: "aid_consent",
          label:
            "서로 다른 3명 이상의 안부 요청이 쌓이면 닉네임·연락처·지역을 연결된 구호기관에 전달하는 데 동의해요. 언제든 철회할 수 있어요.",
          type: "checkbox",
          required: false,
        },
      ],
      initial: {
        nickname: profile?.nickname || "",
        role,
        timezone: profile?.timezone || "Asia/Seoul",
        contact: profile?.contact || "",
        region: profile?.region || "",
        aid_consent: !!profile?.aid_consent,
      },
      submitLabel: profile ? "변경 저장" : "함께 시작하기",
      submit: async (v) => {
        await api("profile", v);
        await refresh();
        setToast("프로필을 저장했어요.");
      },
    });
  const ready = () => {
    if (!user) {
      signIn();
      return false;
    }
    if (!profile) {
      profileDialog();
      return false;
    }
    return true;
  };
  const act = async (action: string, data: unknown = {}, target = gid) => {
    if (!target) throw Error("모임을 선택해 주세요.");
    await api(`groups/${target}/${action}`, data);
    await refresh();
  };
  const run = async (fn: () => Promise<void>, message?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (message) setToast(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ask = (spec: DialogSpec) => {
    if (ready()) setDialog(spec);
  };
  const createGroup = () => {
    if (!user) {
      signIn();
      return;
    }
    if (profile?.role !== "mentor") {
      profileDialog("mentor");
      return;
    }
    setDialog({
      title: "함께할 모임 열기",
      description:
        "배우는 시간과 쉬는 시간을 한 쌍으로 만들어요. 구체적인 주제는 참여자들의 제안으로 바꿀 수 있어요.",
      content: <GroupCreationGuidance />,
      fields: [
        {
          key: "title",
          label: "모임 이름",
          maxLength: 80,
          placeholder: "예: 한국어 한 문장, 그림 한 장",
        },
        {
          key: "description",
          label: "모임 소개",
          type: "textarea",
          maxLength: 2000,
          placeholder: "누구와, 어떤 시간을 보내고 싶은가요?",
        },
        {
          key: "category",
          label: "분야",
          type: "select",
          options: options(categories.slice(1)),
        },
        {
          key: "study_topic",
          label: "학습 활동",
          maxLength: 120,
          placeholder: "함께 배우고 싶은 것",
        },
        {
          key: "study_minutes",
          label: "학습 시간 (분)",
          type: "number",
          min: 5,
          max: 180,
        },
        {
          key: "play_topic",
          label: "여가 활동",
          maxLength: 120,
          placeholder: "함께 즐기고 싶은 것",
        },
        {
          key: "play_minutes",
          label: "여가 시간 (분)",
          type: "number",
          min: 5,
          max: 180,
        },
        {
          key: "capacity",
          label: "멘티 정원",
          type: "number",
          min: 2,
          max: 50,
        },
        {
          key: "platform",
          label: "진행 방식",
          type: "select",
          options: options(platforms),
        },
        {
          key: "meeting_url",
          label: "진행 링크",
          required: false,
          help: "Zoom·Discord·카카오 오픈채팅의 HTTPS 링크만 등록해요. 텍스트 모임은 비워 두세요.",
        },
      ],
      initial: {
        category: "언어",
        study_minutes: "30",
        play_minutes: "20",
        capacity: "8",
        platform: "텍스트",
      },
      submitLabel: "모임 열기",
      submit: async (v) => {
        const r = await api<{ id: string }>("groups", {
          ...v,
          study_minutes: Number(v.study_minutes),
          play_minutes: Number(v.play_minutes),
          capacity: Number(v.capacity),
          meeting_url: v.meeting_url || "",
          timezone: profile?.timezone,
        });
        await refresh();
        go("/groups/" + r.id);
        setToast("모임을 열었어요. 첫 일정을 추가해 보세요.");
      },
    });
  };
  const reportMember = (m: Member, care = false) =>
    ask({
      title: care
        ? `${m.nickname}님의 안부 확인`
        : `${m.nickname}님에 대한 신고`,
      description: care
        ? `서버 출석 기록에서 사전 안내 없는 불참이 ${m.unannounced_absences}일 확인됐어요. 같은 날의 불참은 한 번만 세며, 실제 위험을 확정하는 신고는 아니에요. 근거 날짜 (${detail?.group.timezone}): ${m.absence_dates.join(", ")}.`
        : "구체적인 행동을 적어 주세요. 신고 내용은 모임장이 검토하며, 현재 참여자의 과반수 신고가 있어야 퇴출할 수 있어요.",
      fields: [
        ...(care
          ? []
          : [
              {
                key: "category",
                label: "신고 유형",
                type: "select",
                options: options([
                  "괴롭힘·혐오",
                  "개인정보 침해",
                  "사기·광고",
                  "모임 방해",
                  "기타",
                ]),
              } as Field,
            ]),
        {
          key: "reason",
          label: care ? "안부가 걱정되는 이유" : "신고 사유",
          type: "textarea",
          maxLength: 1000,
        },
      ],
      submitLabel: care ? "안부 확인 요청" : "신고 접수",
      submit: async (v) => {
        await act(care ? "care-request" : "conduct-report", {
          target_id: m.user_id,
          ...v,
        });
        setToast("요청이 접수됐어요.");
      },
    });
  const showAbsenceLog = (m: Member) =>
    setDialog({
      title: `${m.nickname}님의 불참 확인 로그`,
      description: `모임 시간대(${detail?.group.timezone}) 기준 서로 다른 ${m.unannounced_absences}일이에요. 종료된 일정에 모임장이 저장한 기록만 집계하며, 사전 안내·통신 장애·취소 일정은 제외해요.`,
      content: m.absence_logs.length ? (
        <div className="notice-list">
          {m.absence_logs.map((log) => (
            <div className="audit-row" key={log.session_id}>
              <CalendarDays size={19} />
              <div>
                <strong>{log.day} · 안내 없는 불참</strong>
                <p>모임: {date(log.starts_at, detail?.group.timezone)}</p>
                <small className="muted">
                  모임장 {detail?.group.mentor} 기록 ·{" "}
                  {date(log.recorded_at, detail?.group.timezone)}
                </small>
              </div>
            </div>
          ))}
          <p className="tiny muted">
            최근 10건을 표시해요. 같은 날짜의 기록이 여러 개 있어도 1일로
            집계해요.
          </p>
        </div>
      ) : (
        <p className="muted">집계할 수 있는 불참 기록이 없어요.</p>
      ),
    });
  const addSession = () =>
    ask({
      title: "다음 만남 정하기",
      description: `입력 시간은 현재 기기의 시간대(${Intl.DateTimeFormat().resolvedOptions().timeZone})를 기준으로 저장해요. 화면에는 모임의 시간대로 표시돼요.`,
      fields: [
        { key: "starts", label: "시작 날짜와 시간", type: "datetime-local" },
        {
          key: "note",
          label: "안내",
          type: "textarea",
          required: false,
          maxLength: 500,
          placeholder: "준비물이나 함께 나눌 이야기",
        },
      ],
      submitLabel: "일정 등록",
      submit: async (v) => {
        await act("session", {
          starts_at: new Date(String(v.starts)).getTime(),
          note: v.note || "",
        });
        setToast("다음 만남을 등록했어요.");
      },
    });
  const editAttendance = (s: Session) => {
    if (!detail) return;
    const people = detail.members.filter(
      (m) =>
        m.status === "active" &&
        m.user_id !== detail.group.owner_id &&
        m.joined_at <= s.starts_at,
    );
    if (!people.length) {
      setToast("이 일정의 출석을 기록할 참여자가 없어요.");
      return;
    }
    const initial: Values = {};
    for (const m of people)
      initial[m.user_id] =
        detail.attendance.find(
          (a) => a.session_id === s.id && a.user_id === m.user_id,
        )?.status || "";
    ask({
      title: "출석 기록",
      description:
        "확인한 사람만 기록해요. 안내 없는 불참은 예정된 모임 시간이 끝난 뒤에만 저장할 수 있어요. 사전 안내·통신 장애는 안부 요청의 불참 일수에 포함하지 않아요.",
      fields: people.map((m) => ({
        key: m.user_id,
        label:
          m.nickname +
          (detail.absenceNotices?.some(
            (n) => n.session_id === s.id && n.user_id === m.user_id,
          )
            ? " · 사전 안내 있음"
            : ""),
        type: "select",
        required: false,
        options: [
          { value: "", label: "아직 확인하지 않음" },
          ...Object.entries(attendanceLabels).map(([value, label]) => ({
            value,
            label,
          })),
        ],
      })),
      initial,
      submitLabel: "출석 저장",
      submit: async (v) => {
        const records = people
          .filter((m) => v[m.user_id])
          .map((m) => ({ user_id: m.user_id, status: v[m.user_id] }));
        if (!records.length) throw Error("한 명 이상의 출석을 선택해 주세요.");
        await act("attendance", { session_id: s.id, records });
        setToast("출석을 저장했어요.");
      },
    });
  };
  const unread = notices.filter((n) => !n.read_at).length;
  const showNotifications = () => {
    if (!ready()) return;
    setDialog({
      title: "우리의 소식",
      content: (
        <div className="notice-list">
          {notices.length ? (
            notices.map((n) => (
              <button
                key={n.id}
                className="notice-row"
                onClick={() => {
                  if (n.group_id) go("/groups/" + n.group_id);
                  setDialog(null);
                }}
              >
                <span className={!n.read_at ? "unread-dot" : ""} />
                <span>
                  {n.body}
                  <small>{date(n.created_at, profile?.timezone, true)}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <Empty icon={Bell} title="아직 새 소식이 없어요">
              모임의 참여와 안부 소식을 여기에 모아 드릴게요.
            </Empty>
          )}
        </div>
      ),
    });
    api("notifications/read", {})
      .then(refresh)
      .catch((e) => setError(e.message));
  };
  const groupCards = (items: Group[]) =>
    items.length ? (
      <div className="group-grid">
        {items.map((g, i) => (
          <article className="group-card" key={g.id}>
            <div
              className={`card-cover cover-${categories.indexOf(g.category)}`}
            >
              <div className="cover-art">
                {g.category === "디지털" ? (
                  <Globe />
                ) : g.category === "인문·예술" ? (
                  <Sparkles />
                ) : g.category === "생활" ? (
                  <Leaf />
                ) : (
                  <BookOpen />
                )}
                <span />
                <i />
              </div>
              <span className="chip cover-chip">{g.category}</span>
              <button
                className={`save-button ${g.saved ? "saved" : ""}`}
                aria-label={g.saved ? "저장 취소" : "모임 저장"}
                onClick={() => {
                  if (ready())
                    run(() => act("bookmark", { saved: !g.saved }, g.id));
                }}
                disabled={busy}
              >
                <Bookmark size={18} fill={g.saved ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="card-body">
              <div className="row spaced">
                <span className="tiny muted">
                  {g.platform} · 멘토 {g.mentor}
                </span>
                <span className="tiny green">
                  {g.archived
                    ? "종료된 모임"
                    : g.my_status === "active"
                      ? "함께하는 중"
                      : g.member_count >= g.capacity
                        ? "정원 마감"
                        : "함께할 수 있어요"}
                </span>
              </div>
              <a href={"#/groups/" + g.id} className="card-title">
                <h3>{g.title}</h3>
              </a>
              <p className="card-description">{g.description}</p>
              <div className="activity-line">
                <BookOpen size={15} />
                <span>{g.study_topic}</span>
                <small>{g.study_minutes}분</small>
              </div>
              <div className="activity-line play">
                <Gamepad2 size={15} />
                <span>{g.play_topic}</span>
                <small>{g.play_minutes}분</small>
              </div>
              <div className="card-footer">
                <span>
                  <Users size={14} />
                  {g.member_count}/{g.capacity}명
                </span>
                <span>
                  {g.next_session
                    ? date(g.next_session, g.timezone, true)
                    : "첫 만남을 준비 중"}
                </span>
                <a
                  href={"#/groups/" + g.id}
                  aria-label={`${g.title} 자세히 보기`}
                >
                  <ArrowUpRight size={18} />
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>
    ) : (
      <Empty
        title={
          route === "/my"
            ? "아직 함께하는 모임이 없어요"
            : "첫 번째 만남을 기다리고 있어요"
        }
      >
        새로운 모임을 열거나 관심 있는 모임을 찾아보세요.
        <br />
        작은 인사 하나로 함께하는 시간이 시작돼요.
      </Empty>
    );
  const filtered = groups.filter(
    (g) =>
      !g.archived &&
      (category === "전체" || g.category === category) &&
      (!query ||
        [g.title, g.description, g.study_topic, g.play_topic, g.mentor]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())),
  );
  const renderSafety = () => (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">CARE & CONNECTION</span>
          <h1>서로의 안부를 이어요</h1>
          <p className="muted">
            잠시 보이지 않는 동료에게, 함께 건네는 작은 관심.
          </p>
        </div>
        <ShieldCheck className="heading-icon" size={46} />
      </div>
      <div className="care-guide">
        <div>
          <span className="step">01</span>
          <h3>안내 없는 불참 3일</h3>
          <p>
            모임장의 서버 출석 기록으로 확인해요.
            <br />
            서로 다른 날짜만 세고, 사전 안내·통신 장애는 제외해요.
          </p>
        </div>
        <div>
          <span className="step">02</span>
          <h3>서로 다른 3명의 요청</h3>
          <p>
            참여자들이 안부 확인을 요청해요.
            <br />
            중복 요청은 한 번만 세어요.
          </p>
        </div>
        <div>
          <span className="step">03</span>
          <h3>동의한 연락처로 기관 연계</h3>
          <p>
            기관이 연결되면 전달해요.
            <br />
            본인이나 모임장이 안부를 확인해요.
          </p>
        </div>
      </div>
      {!bootstrap?.agency_configured && (
        <div className="alert">
          <AlertCircle size={19} />
          <span>
            <strong>구호기관 수신 채널이 아직 연결되지 않았어요.</strong> 요청은
            서버에 보관되며, 지금은 기관에 전달되지 않아요.
          </span>
        </div>
      )}
      <div className="section-subheading">
        <h2>
          안부 확인{" "}
          <span className="count">
            {safety.care.filter((c) => c.status === "open").length}
          </span>
        </h2>
        <span className="muted tiny">참여 중인 모임의 요청만 보여요</span>
      </div>
      {!profile ? (
        <Empty icon={Heart} title="함께하는 사람들의 안부">
          로그인하고 모임에 참여하면 안부 확인을 이어갈 수 있어요.
        </Empty>
      ) : !safety.care.length ? (
        <Empty icon={Heart} title="현재 확인할 안부가 없어요">
          모임의 참여자 목록에서 안부 확인을 요청할 수 있어요.
        </Empty>
      ) : (
        <div className="care-list">
          {safety.care.map((c) => (
            <article className="panel care-card" key={c.id}>
              <div className="row spaced">
                <div className="row">
                  <Avatar name={c.target_name} />
                  <div>
                    <h3>{c.target_name}님의 안부</h3>
                    <a href={"#/groups/" + c.group_id} className="muted tiny">
                      {c.title} <ArrowUpRight size={12} />
                    </a>
                  </div>
                </div>
                <span
                  className={`chip ${c.status === "resolved" ? "" : "warm"}`}
                >
                  {c.status === "resolved" ? "확인 완료" : "안부를 기다려요"}
                </span>
              </div>
              <div className="care-progress">
                <span>
                  서로 다른 <strong>{c.request_count}명</strong>이 확인을
                  요청했어요
                </span>
                <div className="progress-track">
                  <i
                    style={{
                      width: Math.min(100, (c.request_count / 3) * 100) + "%",
                    }}
                  />
                </div>
              </div>
              <div className="info-line">
                <Heart size={16} />
                {c.status === "resolved"
                  ? "안부 확인 완료"
                  : c.delivery_status
                    ? deliveryLabels[c.delivery_status]
                    : "요청 3명 누적 시 기관 전달 준비"}
              </div>
              {c.delivery_status === "delivered" && (
                <p className="tiny muted">
                  전달 시각: {date(c.delivered_at!, profile?.timezone)} · 기관의
                  현장 확인 완료를 뜻하지 않아요.
                </p>
              )}
              {c.requests.length > 0 && (
                <details className="details">
                  <summary>확인 요청 내용</summary>
                  {c.requests.map((r, i) => (
                    <p key={i}>
                      <strong>{r.nickname}</strong> · {r.reason}
                    </p>
                  ))}
                </details>
              )}
              {c.status === "resolved" && c.resolution && (
                <p className="muted">확인 결과: {c.resolution}</p>
              )}
              <div className="row wrap">
                {c.status === "open" && c.can_resolve && (
                  <button
                    className="button small"
                    onClick={() =>
                      ask({
                        title: "안부 확인 완료",
                        description:
                          "직접 연락했거나 안전을 확인한 내용을 적어 주세요. 완료하면 이전 불참은 다음 안부 요청에 다시 포함하지 않아요.",
                        fields: [
                          {
                            key: "reason",
                            label: "확인 결과",
                            type: "textarea",
                            maxLength: 500,
                          },
                        ],
                        submitLabel: "안부 확인 완료",
                        submit: async (v) => {
                          await act(
                            "resolve-care",
                            { case_id: c.id, ...v },
                            c.group_id,
                          );
                          setToast("안부 확인을 완료했어요.");
                        },
                      })
                    }
                  >
                    <Check size={16} />
                    안부를 확인했어요
                  </button>
                )}
                {c.status === "open" &&
                  c.owner_id === user &&
                  c.delivery_status &&
                  !["delivered", "sending", "cancelled"].includes(
                    c.delivery_status,
                  ) && (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => act("retry-aid", { case_id: c.id }, c.group_id),
                          "전달 상태를 다시 확인했어요.",
                        )
                      }
                    >
                      <RefreshCw size={15} />
                      전달 다시 확인
                    </button>
                  )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="section-subheading">
        <h2>모임 운영 검토</h2>
        <span className="muted tiny">안부 요청과 별도로 처리해요</span>
      </div>
      {safety.conduct.length ? (
        <div className="care-list">
          {safety.conduct.map((c) => (
            <article className="panel care-card" key={c.id}>
              <div className="row spaced">
                <div>
                  <p className="tiny muted">{c.title}</p>
                  <h3>{c.target_name}님 관련 신고</h3>
                </div>
                <span className="chip">
                  {c.status === "open"
                    ? "검토 중"
                    : c.status === "expelled"
                      ? "참여 제한"
                      : "제한 해제"}
                </span>
              </div>
              <p className="muted">
                유효 신고 {c.report_count}명 / 집계 대상 {c.electorate}명 ·
                과반수 기준 {c.threshold}명
              </p>
              {c.reports.length > 0 && (
                <details className="details">
                  <summary>신고 내용 검토</summary>
                  {c.reports.map((r, i) => (
                    <p key={i}>
                      <strong>
                        {r.nickname} · {r.category}
                      </strong>
                      <br />
                      {r.reason}
                    </p>
                  ))}
                </details>
              )}
              {c.can_expel && (
                <button
                  className="button danger small"
                  onClick={() =>
                    ask({
                      title: "신고 검토 후 참여 제한",
                      description:
                        "대상자를 제외한 현재 참여자(모임장 포함)의 과반수 신고를 서버에서 다시 확인해요. 단순한 의견 차이를 이유로 제한하지 않도록 내용을 검토해 주세요.",
                      fields: [
                        {
                          key: "reason",
                          label: "검토 결과 및 제한 이유",
                          type: "textarea",
                          maxLength: 1000,
                        },
                      ],
                      danger: true,
                      submitLabel: "검토 완료 · 참여 제한",
                      submit: async (v) => {
                        await act("expel", { case_id: c.id, ...v }, c.group_id);
                        setToast("참여를 제한하고 검토 기록을 남겼어요.");
                      },
                    })
                  }
                >
                  검토 후 참여 제한
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="quiet-state">
          <ShieldCheck size={20} />
          현재 검토할 신고가 없어요.
        </div>
      )}
    </>
  );
  const renderDetail = () => {
    if (!detail || detail.group.id !== gid)
      return (
        <Empty
          icon={LoaderCircle}
          title={error ? "모임을 불러오지 못했어요" : "모임을 불러오는 중"}
        >
          {error || "잠시만 기다려 주세요."}
        </Empty>
      );
    const { group: g, members, sessions, messages, proposals } = detail,
      owner = g.owner_id === user,
      active = g.my_status === "active";
    const future = sessions
        .filter((s) => s.status === "scheduled" && s.starts_at > Date.now())
        .sort((a, b) => a.starts_at - b.starts_at),
      past = sessions.filter(
        (s) => s.starts_at <= Date.now() || s.status === "cancelled",
      );
    const sessionCard = (s: Session) => (
      <div
        className={`session-card ${s.status === "cancelled" ? "cancelled" : ""}`}
        key={s.id}
      >
        <span className="date-icon">
          <CalendarDays size={22} />
        </span>
        <div className="session-copy">
          <h3>{date(s.starts_at, g.timezone)}</h3>
          <p>{s.note || "함께 배우고 쉬는 시간"}</p>
          <div className="row wrap tiny">
            <span className="muted">{g.timezone}</span>
            {s.status === "cancelled" ? (
              <span className="chip">취소된 일정</span>
            ) : (
              s.my_attendance && (
                <span className="chip">
                  {attendanceLabels[s.my_attendance]}
                </span>
              )
            )}
            {s.my_notice && (
              <span className="chip">불참 안내: {s.my_notice}</span>
            )}
          </div>
        </div>
        <div className="session-actions">
          {active &&
            s.status !== "cancelled" &&
            s.starts_at > Date.now() &&
            !owner && (
              <button
                className="button secondary small"
                onClick={() =>
                  ask({
                    title: "미리 불참 알리기",
                    description:
                      "사전 안내한 불참은 안부 확인을 위한 불참 횟수에서 제외돼요.",
                    fields: [
                      {
                        key: "reason",
                        label: "모임장에게 전할 말",
                        type: "textarea",
                        maxLength: 300,
                      },
                    ],
                    initial: { reason: s.my_notice || "" },
                    submitLabel: "불참 알리기",
                    submit: async (v) => {
                      await act("absence", { session_id: s.id, ...v });
                      setToast("모임장에게 불참을 알렸어요.");
                    },
                  })
                }
              >
                {s.my_notice ? "안내 수정" : "불참 미리 알리기"}
              </button>
            )}
          {owner && s.status !== "cancelled" && s.starts_at <= Date.now() && (
            <button
              className="button secondary small"
              onClick={() => editAttendance(s)}
            >
              출석 기록
            </button>
          )}
          {owner && s.status !== "cancelled" && (
            <button
              className="text-button muted"
              onClick={() =>
                ask({
                  title: "일정을 취소할까요?",
                  description:
                    "취소한 일정의 불참 기록은 안부 확인 횟수에 포함되지 않아요.",
                  submitLabel: "일정 취소",
                  danger: true,
                  submit: async () => {
                    await act("cancel-session", { session_id: s.id });
                    setToast("일정을 취소했어요.");
                  },
                })
              }
            >
              일정 취소
            </button>
          )}
        </div>
      </div>
    );
    return (
      <>
        <a href="#/explore" className="back-link">
          <ChevronLeft size={17} />
          모임 둘러보기
        </a>
        <section className="group-intro panel">
          <div className="group-title-block">
            <div className="row wrap">
              <span className="chip">{g.category}</span>
              <span className="tiny muted">
                {g.platform} · {g.timezone}
              </span>
              {g.archived ? (
                <span className="chip warm">종료된 모임</span>
              ) : null}
            </div>
            <h1>{g.title}</h1>
            <p className="intro-description">{g.description}</p>
            <div className="row">
              <Avatar name={g.mentor} small />
              <span className="tiny">
                멘토 <strong>{g.mentor}</strong>
              </span>
              <span className="divider-dot">·</span>
              <span className="tiny muted">
                멘티 {g.member_count}/{g.capacity}명
              </span>
            </div>
          </div>
          <div className="group-join">
            <div className="paired-topics">
              <div>
                <BookOpen size={19} />
                <small>함께 배우기 · {g.study_minutes}분</small>
                <strong>{g.study_topic}</strong>
              </div>
              <span>+</span>
              <div>
                <Gamepad2 size={19} />
                <small>함께 쉬기 · {g.play_minutes}분</small>
                <strong>{g.play_topic}</strong>
              </div>
            </div>
            {active ? (
              <div className="row wrap">
                <span className="joined-label">
                  <CheckCircle2 size={17} />
                  함께하는 모임이에요
                </span>
                {!owner && (
                  <button
                    className="text-button muted"
                    onClick={() =>
                      ask({
                        title: "모임을 나갈까요?",
                        description:
                          "작성한 글과 제안은 모임에 남아요. 정원이 남아 있으면 다시 참여할 수 있어요.",
                        submitLabel: "모임 나가기",
                        submit: async () => {
                          await act("leave");
                          setToast("모임에서 나왔어요.");
                        },
                      })
                    }
                  >
                    나가기
                  </button>
                )}
              </div>
            ) : (
              <button
                className="button full"
                disabled={
                  busy ||
                  !!g.archived ||
                  g.my_status === "removed" ||
                  g.member_count >= g.capacity
                }
                onClick={() => {
                  if (ready())
                    run(() => act("join"), "모임에 함께하게 됐어요.");
                }}
              >
                {g.my_status === "removed"
                  ? "참여가 제한된 모임"
                  : g.member_count >= g.capacity
                    ? "정원이 마감됐어요"
                    : "이 모임에 함께하기"}
                <ArrowRight size={18} />
              </button>
            )}
          </div>
        </section>
        {active && (
          <div className="meeting-bar">
            <div>
              <span className="status-dot" />
              <strong>
                {g.platform === "텍스트"
                  ? "우리의 모임 게시판에서 만나요"
                  : `${g.platform}에서 함께 만나요`}
              </strong>
              <span className="muted tiny">
                {g.platform === "텍스트"
                  ? "같은 시간에 접속하지 않아도 괜찮아요"
                  : g.meeting_url
                    ? "모임 참여자에게만 공개되는 링크예요"
                    : "모임장이 진행 링크를 준비 중이에요"}
              </span>
            </div>
            <div className="row">
              {g.meeting_url && (
                <a
                  className="button small"
                  href={g.meeting_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  모임 입장
                  <ExternalLink size={15} />
                </a>
              )}
              {owner && (
                <button
                  className="icon-button"
                  aria-label="진행 방식과 링크 수정"
                  onClick={() =>
                    ask({
                      title: "진행 방식과 링크",
                      fields: [
                        {
                          key: "platform",
                          label: "진행 방식",
                          type: "select",
                          options: options(platforms),
                        },
                        {
                          key: "meeting_url",
                          label: "모임 링크",
                          required: false,
                          maxLength: 1000,
                        },
                      ],
                      initial: {
                        platform: g.platform,
                        meeting_url: g.meeting_url || "",
                      },
                      submit: async (v) => {
                        await act("link", {
                          ...v,
                          meeting_url: v.meeting_url || "",
                        });
                        setToast("진행 방식을 저장했어요.");
                      },
                    })
                  }
                >
                  <Settings size={19} />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="tabs" role="tablist" aria-label="모임 메뉴">
          {[
            ["board", "우리의 이야기", MessageCircle],
            ["schedule", "만남 일정", CalendarDays],
            ["topics", "주제 함께 정하기", Lightbulb],
            ["people", "함께하는 사람들", Users],
            ...(owner ? [["manage", "운영 기록", ShieldCheck]] : []),
          ].map(([key, label, Icon]) => {
            const TabIcon = Icon as typeof Users;
            return (
              <button
                key={String(key)}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(String(key))}
              >
                <TabIcon size={16} />
                {String(label)}
              </button>
            );
          })}
        </div>
        {!active && tab !== "schedule" ? (
          <Empty icon={Users} title="참여하면 더 가까워져요">
            모임에 함께하면 게시판, 주제 투표, 참여자 목록을 볼 수 있어요.
          </Empty>
        ) : tab === "board" ? (
          <div className="detail-columns">
            <section className="panel board-panel">
              <div className="section-subheading">
                <h2>우리의 이야기</h2>
                <span className="tiny muted">최근 100개의 이야기</span>
              </div>
              <p className="muted tiny">
                짧은 배움, 오늘의 기분, 작은 놀이. 편한 시간에 글로 이어가요.
              </p>
              {messages.length ? (
                <div className="post-list">
                  {messages.map((m) => (
                    <article className="post" key={m.id}>
                      <Avatar name={m.nickname} small />
                      <div>
                        <div className="row wrap">
                          <strong>{m.nickname}</strong>
                          {m.user_id === user && (
                            <span className="chip mini">나</span>
                          )}
                          <time>{date(m.created_at, g.timezone, true)}</time>
                        </div>
                        <p>{m.body}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty icon={MessageCircle} title="첫 인사를 건네 볼까요?">
                  오늘 함께하고 싶은 이야기나 간단한 자기소개를 남겨 주세요.
                </Empty>
              )}
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!draft.trim() || busy) return;
                  const body = draft;
                  requestId.current ??= crypto.randomUUID();
                  const id = requestId.current;
                  run(async () => {
                    await act("message", { body, request_id: id });
                    setMessage("");
                  }, "이야기를 남겼어요.");
                }}
              >
                <label className="sr-only" htmlFor="message">
                  모임에 전할 이야기
                </label>
                <textarea
                  id="message"
                  value={draft}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={3000}
                  placeholder="오늘의 이야기를 남겨 주세요…"
                  disabled={busy || !!g.archived}
                />
                <div className="row spaced">
                  <small className="muted">
                    {draft.length}/3000 · 이 탭에 작성 중인 글을 보관해요
                  </small>
                  <button
                    className="button small"
                    disabled={busy || !online || !draft.trim() || !!g.archived}
                  >
                    <Send size={15} />
                    보내기
                  </button>
                </div>
              </form>
            </section>
            <aside>
              <div className="panel side-note">
                <span className="round-icon">
                  <Heart size={22} />
                </span>
                <h3>연결은 작은 안부에서</h3>
                <p>
                  매일 잘해야 할 필요는 없어요. 오늘 배운 한 가지, 잠깐 웃었던
                  순간을 나눠 주세요.
                </p>
                <div className="soft-rule" />
                <h4>접속이 어려운 날에는</h4>
                <p>
                  영상 대신 음성이나 글로 함께해요. 예정된 모임에 오기 어렵다면
                  미리 알려 주세요.
                </p>
                <button
                  className="text-button"
                  onClick={() => setTab("schedule")}
                >
                  다음 만남 확인하기 <ArrowRight size={15} />
                </button>
              </div>
            </aside>
          </div>
        ) : tab === "schedule" ? (
          <section className="panel padded">
            <div className="section-subheading">
              <div>
                <h2>다음 만남</h2>
                <p className="muted tiny">
                  모든 일정은 {g.timezone} 기준이에요.
                </p>
              </div>
              {owner && !g.archived && (
                <button className="button small" onClick={addSession}>
                  <Plus size={16} />
                  일정 추가
                </button>
              )}
            </div>
            {future.length ? (
              future.map(sessionCard)
            ) : (
              <Empty icon={CalendarDays} title="다음 만남을 준비하고 있어요">
                모임장이 일정을 등록하면 이곳에서 확인할 수 있어요.
              </Empty>
            )}
            {past.length > 0 && (
              <>
                <h3 className="past-title">지난 만남과 취소된 일정</h3>
                {past.map(sessionCard)}
              </>
            )}
          </section>
        ) : tab === "topics" ? (
          <section className="panel padded">
            <div className="section-subheading">
              <div>
                <h2>무엇을 함께할까요?</h2>
                <p className="muted tiny">
                  원하는 활동을 제안하고 공감해요. 모임장이 확인해 주제에
                  반영해요.
                </p>
              </div>
              <button
                className="button small"
                disabled={!!g.archived}
                onClick={() =>
                  ask({
                    title: "함께할 활동 제안",
                    fields: [
                      {
                        key: "kind",
                        label: "활동 종류",
                        type: "select",
                        options: [
                          { value: "study", label: "함께 배우기" },
                          { value: "play", label: "함께 쉬기" },
                        ],
                      },
                      {
                        key: "body",
                        label: "하고 싶은 활동",
                        type: "textarea",
                        maxLength: 200,
                      },
                    ],
                    initial: { kind: "study" },
                    submitLabel: "제안 남기기",
                    submit: async (v) => {
                      await act("proposal", v);
                      setToast("제안을 남겼어요.");
                    },
                  })
                }
              >
                <Plus size={16} />
                제안하기
              </button>
            </div>
            {proposals.length ? (
              <div className="proposal-list">
                {proposals.map((p) => (
                  <article key={p.id} className="proposal">
                    <span
                      className={`round-icon ${p.kind === "play" ? "apricot" : ""}`}
                    >
                      {p.kind === "study" ? (
                        <BookOpen size={20} />
                      ) : (
                        <Gamepad2 size={20} />
                      )}
                    </span>
                    <div className="proposal-copy">
                      <small className="muted">
                        {p.kind === "study" ? "학습 제안" : "여가 제안"} ·{" "}
                        {p.nickname}
                      </small>
                      <h3>{p.body}</h3>
                    </div>
                    <div className="row wrap">
                      {p.status === "selected" ? (
                        <span className="chip">
                          <Check size={13} />
                          주제에 반영했어요
                        </span>
                      ) : (
                        <>
                          <button
                            className={`button small ${p.voted ? "" : "secondary"}`}
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                act("vote", {
                                  proposal_id: p.id,
                                  voted: !p.voted,
                                }),
                              )
                            }
                            aria-label={`${p.body} 공감 ${p.votes}명`}
                          >
                            <ThumbsUp size={15} />
                            {p.votes}
                          </button>
                          {owner && (
                            <button
                              className="text-button"
                              onClick={() =>
                                ask({
                                  title: "모임 주제로 반영할까요?",
                                  description: p.body,
                                  submitLabel: "주제에 반영",
                                  submit: async () => {
                                    await act("select-topic", {
                                      proposal_id: p.id,
                                    });
                                    setToast("모임 주제를 바꿨어요.");
                                  },
                                })
                              }
                            >
                              주제 반영
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty icon={Lightbulb} title="좋은 시간은 함께 만들어요">
                배우고 싶은 것과 즐기고 싶은 것을 자유롭게 제안해 주세요.
              </Empty>
            )}
          </section>
        ) : tab === "people" ? (
          <section className="panel padded">
            <div className="section-subheading">
              <div>
                <h2>함께하는 사람들</h2>
                <p className="muted tiny">
                  멘토 1명 · 참여 중인 멘티 {g.member_count}명
                </p>
              </div>
              <button
                className="button secondary small"
                onClick={() => go("/care")}
              >
                <Heart size={15} />
                안부 센터
              </button>
            </div>
            <div className="member-list">
              {members.map((m) => (
                <div className="member-row" key={m.user_id}>
                  <Avatar name={m.nickname} />
                  <div className="member-copy">
                    <strong>
                      {m.nickname}{" "}
                      {m.user_id === user && (
                        <span className="tiny muted">(나)</span>
                      )}
                    </strong>
                    <p>
                      {m.user_id === g.owner_id
                        ? "모임장 · 멘토"
                        : m.status === "removed"
                          ? "참여 제한 중"
                          : m.status === "left"
                            ? "모임을 나간 참여자"
                            : "함께하는 멘티"}
                      {m.unannounced_absences > 0 && (
                        <span className="absence-count">
                          {" "}
                          · 안내 없는 불참 {m.unannounced_absences}일
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="row wrap">
                    {m.user_id !== g.owner_id && (
                      <button
                        className="text-button"
                        onClick={() => showAbsenceLog(m)}
                      >
                        불참 로그
                      </button>
                    )}
                    {m.status === "active" &&
                      m.user_id !== user &&
                      m.user_id !== g.owner_id && (
                        <>
                          <button
                            className="button secondary small"
                            disabled={!m.can_request_care}
                            title={
                              m.can_request_care
                                ? "서버에서 3일 이상의 불참 기록을 확인했어요."
                                : "서로 다른 3일의 사전 안내 없는 불참 기록이 필요해요."
                            }
                            onClick={() => reportMember(m, true)}
                          >
                            <Heart size={14} />
                            {m.can_request_care
                              ? "안부 요청"
                              : `안부 요청 (${m.unannounced_absences}/3일)`}
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`${m.nickname}님 행동 신고`}
                            title="괴롭힘·사기 등 행동 신고"
                            onClick={() => reportMember(m)}
                          >
                            <Flag size={17} />
                          </button>
                        </>
                      )}
                    {owner && m.status === "removed" && (
                      <button
                        className="button secondary small"
                        onClick={() =>
                          ask({
                            title: "참여 제한 해제",
                            description:
                              "제한을 해제하면 정원이 남아 있을 때 다시 참여할 수 있어요.",
                            fields: [
                              {
                                key: "reason",
                                label: "해제 이유",
                                type: "textarea",
                                maxLength: 1000,
                              },
                            ],
                            submitLabel: "제한 해제",
                            submit: async (v) => {
                              await act("restore", {
                                target_id: m.user_id,
                                ...v,
                              });
                              setToast("참여 제한을 해제했어요.");
                            },
                          })
                        }
                      >
                        제한 해제
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="panel padded">
            <div className="section-subheading">
              <div>
                <h2>운영 기록</h2>
                <p className="muted tiny">
                  신고 검토와 참여 제한·해제 기록은 서버에 남아요.
                </p>
              </div>
              <button
                className="button secondary small"
                onClick={() => go("/care")}
              >
                신고 검토하기
                <ArrowRight size={15} />
              </button>
            </div>
            {detail.audit.length ? (
              detail.audit.map((a) => (
                <div className="audit-row" key={a.id}>
                  <ShieldCheck size={20} />
                  <div>
                    <strong>
                      {a.target_name} ·{" "}
                      {a.action === "expel" ? "참여 제한" : "제한 해제"}
                    </strong>
                    <p>{a.reason}</p>
                    <small className="muted">
                      {date(a.created_at, g.timezone)}
                      {a.action === "expel"
                        ? ` · 신고 ${a.reporters}/${a.electorate}명`
                        : ""}
                    </small>
                  </div>
                </div>
              ))
            ) : (
              <div className="quiet-state">아직 운영 기록이 없어요.</div>
            )}
            <div className="end-group">
              <div>
                <h3>모임 마무리하기</h3>
                <p className="muted tiny">
                  새 참여와 활동을 중단하고 기존 기록은 남겨요.
                </p>
              </div>
              <button
                className="button secondary small"
                disabled={!!g.archived}
                onClick={() =>
                  ask({
                    title: "모임을 종료할까요?",
                    description:
                      "종료 후 새로운 참여, 일정, 게시글을 추가할 수 없어요. 이 작업은 화면에서 되돌릴 수 없으니 참여자들에게 먼저 알려 주세요.",
                    submitLabel: "모임 종료",
                    danger: true,
                    submit: async () => {
                      await act("archive");
                      setToast("모임을 종료했어요.");
                    },
                  })
                }
              >
                모임 종료
              </button>
            </div>
          </section>
        )}
      </>
    );
  };
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="wordmark" href="#/">
            <span className="brand-symbol">
              <Leaf size={22} />
            </span>
            wargether<span className="brand-dot">.</span>
          </a>
          <nav aria-label="주 메뉴">
            <a className={route === "/" ? "active" : ""} href="#/">
              홈
            </a>
            <a
              className={route === "/explore" || gid ? "active" : ""}
              href="#/explore"
            >
              모임 둘러보기
            </a>
            <a className={route === "/my" ? "active" : ""} href="#/my">
              나의 모임
            </a>
            <a className={route === "/care" ? "active" : ""} href="#/care">
              안부 센터
            </a>
          </nav>
          <div className="header-actions">
            {user ? (
              <>
                <button
                  className="icon-button notification-button"
                  aria-label={`알림 ${unread}개`}
                  onClick={showNotifications}
                >
                  <Bell size={20} />
                  {unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
                </button>
                <button
                  className="profile-button"
                  onClick={() => profileDialog()}
                >
                  <Avatar name={profile?.nickname || "?"} small />
                  <span>{profile?.nickname || "프로필 설정"}</span>
                </button>
              </>
            ) : (
              <a
                className="button small"
                href="/signin-with-chatgpt?return_to=%2F"
                target="_top"
              >
                로그인
                <ArrowUpRight size={15} />
              </a>
            )}
          </div>
        </div>
      </header>
      {!online && (
        <div className="connection-banner">
          <WifiOff size={17} />
          연결이 끊겼어요. 작성 중인 글은 이 탭에 남아 있어요. 다시 연결된 뒤
          보내 주세요.
        </div>
      )}
      <main id="main-content" className="main-container" tabIndex={-1}>
        {error && (
          <div className="alert error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button className="text-button" onClick={() => run(refresh)}>
              다시 시도
            </button>
            <button
              className="icon-button"
              aria-label="오류 닫기"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {loading && !bootstrap ? (
          <div className="initial-loading">
            <LoaderCircle className="spin" size={28} />
            <p>함께할 시간을 준비하고 있어요…</p>
          </div>
        ) : route === "/" ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <span className="hero-eyebrow">
                  <span />
                  혼자 견디지 않아도 괜찮아요
                </span>
                <h1>
                  함께 배우고,
                  <br />
                  함께 쉬며,
                  <br />
                  <em>우리로 이어져요.</em>
                </h1>
                <p>
                  익숙한 일상을 잃은 순간에도, 곁에는 우리가.
                  <br />
                  작은 배움과 즐거운 쉼으로 서로의 내일을 응원해요.
                </p>
                <a className="button" href="#/explore">
                  함께할 모임 찾기
                  <ArrowRight size={18} />
                </a>
                <span className="hero-footnote">
                  <Heart size={14} />
                  전쟁으로 일상이 바뀐 우리를 위한 연결
                </span>
              </div>
              <div className="hero-art">
                <img
                  src="/together.svg"
                  alt="서로 이야기를 나누고 책을 함께 읽는 두 사람의 일러스트"
                  width="500"
                  height="285"
                />
                <span className="floating-label first">
                  <BookOpen size={16} />
                  작은 배움이
                </span>
                <span className="floating-label second">
                  <Heart size={16} />
                  따뜻한 관계로
                </span>
                <span className="art-caption">
                  A LITTLE LEARNING. A LITTLE JOY. TOGETHER.
                </span>
              </div>
            </section>
            <section className="role-section">
              <div className="section-subheading">
                <h2>어떻게 함께하고 싶나요?</h2>
                <span className="muted tiny">역할은 언제든 바꿀 수 있어요</span>
              </div>
              <div className="role-grid">
                <button className="role-card mentor" onClick={createGroup}>
                  <span className="role-icon">
                    <BookOpen size={26} />
                  </span>
                  <span>
                    <small>AS A MENTOR</small>
                    <strong>나의 작은 배움을 나누고 싶어요</strong>
                    <span>학습과 여가를 엮어, 함께할 모임을 열어요.</span>
                  </span>
                  <ArrowUpRight size={22} />
                </button>
                <button
                  className="role-card mentee"
                  onClick={() => {
                    if (user && !profile) profileDialog("mentee");
                    else go("/explore");
                  }}
                >
                  <span className="role-icon">
                    <Sparkles size={26} />
                  </span>
                  <span>
                    <small>AS A MENTEE</small>
                    <strong>함께 배우고, 쉬고 싶어요</strong>
                    <span>
                      마음이 가는 모임에 참여해 우리의 시간을 만들어요.
                    </span>
                  </span>
                  <ArrowUpRight size={22} />
                </button>
              </div>
            </section>
            <section className="home-groups">
              <div className="section-subheading">
                <div>
                  <span className="eyebrow">FIND YOUR PEOPLE</span>
                  <h2>지금, 함께할 수 있는 모임</h2>
                </div>
                <a className="text-button" href="#/explore">
                  모두 보기
                  <ArrowRight size={16} />
                </a>
              </div>
              {groupCards(groups.filter((g) => !g.archived).slice(0, 3))}
            </section>
            <section className="together-strip">
              <span className="strip-icon">
                <Heart size={34} />
              </span>
              <div>
                <h2>모임이 끝나도, 안부는 이어져요.</h2>
                <p>
                  함께 배우고 놀던 동료가 보이지 않는다면, 서로의 안부를
                  확인해요.
                </p>
              </div>
              <a className="button secondary" href="#/care">
                안부 센터
                <ArrowUpRight size={16} />
              </a>
            </section>
          </>
        ) : route === "/explore" || route === "/my" ? (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {route === "/my"
                    ? "YOUR LITTLE COMMUNITY"
                    : "LEARN. PLAY. BELONG."}
                </span>
                <h1>
                  {route === "/my"
                    ? "함께하는 나의 모임"
                    : "우리의 시간을 찾아요"}
                </h1>
                <p className="muted">
                  {route === "/my"
                    ? "익숙한 얼굴들과 이어가는 작은 배움과 쉼."
                    : "관심 있는 배움과 즐거운 놀이, 둘 다 함께할 사람들."}
                </p>
              </div>
              <button className="button" onClick={createGroup}>
                <Plus size={18} />
                모임 열기
              </button>
            </div>
            {route === "/my" ? (
              <>
                <div className="tabs">
                  {[
                    ["participating", "참여 중"],
                    ["hosting", "내가 여는 모임"],
                    ["saved", "저장한 모임"],
                  ].map(([k, label]) => (
                    <button
                      key={k}
                      className={myFilter === k ? "active" : ""}
                      onClick={() => setMyFilter(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!profile ? (
                  <Empty icon={Users} title="나의 모임을 이어가세요">
                    로그인 후 프로필을 설정하면 참여하는 모임을 모아 볼 수
                    있어요.
                    <br />
                    <button
                      className="button"
                      onClick={() => {
                        if (user) profileDialog();
                        else signIn();
                      }}
                    >
                      시작하기
                      <ArrowRight size={16} />
                    </button>
                  </Empty>
                ) : (
                  groupCards(
                    groups.filter((g) =>
                      myFilter === "saved"
                        ? g.saved
                        : myFilter === "hosting"
                          ? g.owner_id === user
                          : g.my_status === "active",
                    ),
                  )
                )}
              </>
            ) : (
              <>
                <div className="explore-toolbar">
                  <div className="category-pills">
                    {categories.map((c) => (
                      <button
                        className={category === c ? "selected" : ""}
                        key={c}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <label className="search-field">
                    <Search size={18} />
                    <input
                      aria-label="모임 검색"
                      placeholder="어떤 시간을 함께하고 싶나요?"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                <div className="list-meta">
                  <strong>{filtered.length}개의 모임</strong>
                  <span>배움과 쉼이 함께하는 곳</span>
                </div>
                {groupCards(filtered)}
              </>
            )}
          </>
        ) : route === "/care" ? (
          renderSafety()
        ) : gid ? (
          renderDetail()
        ) : (
          <Empty title="찾는 페이지가 없어요">
            위의 메뉴에서 함께할 모임을 찾아 주세요.
          </Empty>
        )}
      </main>
      <footer className="site-footer">
        <div>
          <a className="wordmark" href="#/">
            wargether<span className="brand-dot">.</span>
          </a>
          <p>함께 배우고, 함께 쉬는 우리.</p>
        </div>
        <div className="footer-right">
          <span>작은 연결이 우리의 일상을 지켜요.</span>
          <div>
            {user && (
              <a href="/signout-with-chatgpt?return_to=%2F" target="_top">
                <LogOut size={13} />
                로그아웃
              </a>
            )}
            <button
              className="text-button"
              onClick={() =>
                setDialog({
                  title: "함께하는 공간의 약속",
                  content: (
                    <div className="policy-copy">
                      <p>
                        서로의 상황을 존중하고, 배우거나 쉬는 방식이 달라도
                        재촉하지 않아요.
                      </p>
                      <p>
                        닉네임을 사용하고 정확한 위치, 신분증, 민감한 개인정보를
                        게시판에 올리지 않아요. 게시글과 참여 기록은 모임
                        참여자에게 보일 수 있어요.
                      </p>
                      <p>
                        연락처·지역은 본인 프로필에 보관하며, 본인의 동의와 서로
                        다른 3명의 안부 요청이 있을 때 연결된 기관에 최소한으로
                        전달해요. 프로필에서 동의를 철회할 수 있어요.
                      </p>
                      <p>
                        이 서비스는 긴급 구조 시스템이 아니에요. 안부 확인
                        요청은 위험이 확정됐다는 뜻이 아니며, 기관 전달이 구조나
                        현장 확인을 보장하지 않아요.
                      </p>
                      <p>
                        현재 기관 연결 상태:{" "}
                        {bootstrap?.agency_configured
                          ? "수신 채널 연결됨"
                          : "수신 채널 미연결 · 외부 전송 없음"}
                      </p>
                    </div>
                  ),
                })
              }
            >
              공간의 약속
            </button>
          </div>
        </div>
      </footer>
      {dialog && <Dialog spec={dialog} close={() => setDialog(null)} />}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
