import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  nickname: text("nickname").notNull(),
  role: text("role").notNull(),
  timezone: text("timezone").notNull().default("Asia/Seoul"),
  contact: text("contact").notNull().default(""),
  region: text("region").notNull().default(""),
  aidConsent: integer("aid_consent").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});
export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => profiles.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  studyTopic: text("study_topic").notNull(),
  playTopic: text("play_topic").notNull(),
  studyMinutes: integer("study_minutes").notNull(),
  playMinutes: integer("play_minutes").notNull(),
  capacity: integer("capacity").notNull(),
  platform: text("platform").notNull(),
  meetingUrl: text("meeting_url").notNull().default(""),
  timezone: text("timezone").notNull(),
  archived: integer("archived").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});
export const members = sqliteTable(
  "members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id),
    status: text("status").notNull().default("active"),
    joinedAt: integer("joined_at").notNull(),
    careAfter: integer("care_after").notNull().default(0),
    removedAt: integer("removed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("members_user").on(t.userId, t.status),
  ],
);
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    startsAt: integer("starts_at").notNull(),
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("scheduled"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("sessions_group").on(t.groupId, t.startsAt)],
);
export const notices = sqliteTable(
  "absence_notices",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);
export const attendance = sqliteTable(
  "attendance",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id),
    status: text("status").notNull(),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => profiles.id),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id),
    body: text("body").notNull(),
    requestId: text("request_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("messages_idempotency").on(t.userId, t.requestId),
    index("messages_group").on(t.groupId, t.createdAt),
  ],
);
export const proposals = sqliteTable("proposals", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  authorId: text("author_id")
    .notNull()
    .references(() => profiles.id),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: integer("created_at").notNull(),
});
export const votes = sqliteTable(
  "votes",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => proposals.id),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.userId] })],
);
export const bookmarks = sqliteTable(
  "bookmarks",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);
export const careCases = sqliteTable(
  "care_cases",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    targetId: text("target_id")
      .notNull()
      .references(() => profiles.id),
    status: text("status").notNull().default("open"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
  },
  (t) => [
    uniqueIndex("care_one_open")
      .on(t.groupId, t.targetId)
      .where(sql`${t.status} = 'open'`),
  ],
);
export const careRequests = sqliteTable(
  "care_requests",
  {
    caseId: text("case_id")
      .notNull()
      .references(() => careCases.id),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => profiles.id),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.caseId, t.reporterId] })],
);
export const outbox = sqliteTable(
  "aid_outbox",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => careCases.id),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull(),
    leaseUntil: integer("lease_until"),
    lastError: text("last_error"),
    deliveredAt: integer("delivered_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("aid_one_per_case").on(t.caseId)],
);
export const conductCases = sqliteTable(
  "conduct_cases",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    targetId: text("target_id")
      .notNull()
      .references(() => profiles.id),
    status: text("status").notNull().default("open"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("conduct_one_open")
      .on(t.groupId, t.targetId)
      .where(sql`${t.status} = 'open'`),
  ],
);
export const conductReports = sqliteTable(
  "conduct_reports",
  {
    caseId: text("case_id")
      .notNull()
      .references(() => conductCases.id),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => profiles.id),
    category: text("category").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.caseId, t.reporterId] })],
);
export const audit = sqliteTable("moderation_audit", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  caseId: text("case_id")
    .notNull()
    .references(() => conductCases.id),
  targetId: text("target_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  reporters: integer("reporters").notNull(),
  electorate: integer("electorate").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id),
    groupId: text("group_id").references(() => groups.id),
    body: text("body").notNull(),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("notifications_user").on(t.userId, t.createdAt)],
);
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [index("rate_expiry").on(t.windowStart)],
);
