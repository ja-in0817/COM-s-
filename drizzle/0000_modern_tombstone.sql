CREATE TABLE `attendance` (
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `user_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `moderation_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`case_id` text NOT NULL,
	`target_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`reporters` integer NOT NULL,
	`electorate` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `conduct_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `care_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`target_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolution` text,
	`resolved_by` text,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `care_one_open` ON `care_cases` (`group_id`,`target_id`) WHERE "care_cases"."status" = 'open';--> statement-breakpoint
CREATE TABLE `care_requests` (
	`case_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`case_id`, `reporter_id`),
	FOREIGN KEY (`case_id`) REFERENCES `care_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conduct_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`target_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conduct_one_open` ON `conduct_cases` (`group_id`,`target_id`) WHERE "conduct_cases"."status" = 'open';--> statement-breakpoint
CREATE TABLE `conduct_reports` (
	`case_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`category` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`case_id`, `reporter_id`),
	FOREIGN KEY (`case_id`) REFERENCES `conduct_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reporter_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`study_topic` text NOT NULL,
	`play_topic` text NOT NULL,
	`study_minutes` integer NOT NULL,
	`play_minutes` integer NOT NULL,
	`capacity` integer NOT NULL,
	`platform` text NOT NULL,
	`meeting_url` text DEFAULT '' NOT NULL,
	`timezone` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`joined_at` integer NOT NULL,
	`care_after` integer DEFAULT 0 NOT NULL,
	`removed_at` integer,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `members_user` ON `members` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_idempotency` ON `messages` (`user_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `messages_group` ON `messages` (`group_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `absence_notices` (
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `user_id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`group_id` text,
	`body` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `aid_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_until` integer,
	`last_error` text,
	`delivered_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `care_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aid_one_per_case` ON `aid_outbox` (`case_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`nickname` text NOT NULL,
	`role` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Seoul' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`aid_consent` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`author_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_expiry` ON `rate_limits` (`window_start`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_group` ON `sessions` (`group_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `votes` (
	`proposal_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `user_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
