CREATE TABLE `backup_runs` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`id` text NOT NULL,
	`status` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text,
	`error` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `space`, `id`)
);
--> statement-breakpoint
CREATE TABLE `change_log` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`seq` integer NOT NULL,
	`operation_id` text NOT NULL,
	`kind` text NOT NULL,
	`dto_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `space`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `daily_completions` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`task_id` text NOT NULL,
	`beijing_date` text NOT NULL,
	`completed` integer NOT NULL,
	`version` integer NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `space`, `task_id`, `beijing_date`)
);
--> statement-breakpoint
CREATE TABLE `migration_runs` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_hash` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `space`, `run_id`)
);
--> statement-breakpoint
CREATE TABLE `owners` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_subject` ON `owners` (`subject`);--> statement-breakpoint
CREATE TABLE `mutation_receipts` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`operation_id` text NOT NULL,
	`client_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`result_seq` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `space`, `operation_id`)
);
--> statement-breakpoint
CREATE TABLE `snapshots_v2` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `space`, `id`)
);
--> statement-breakpoint
CREATE INDEX `snapshot_lookup` ON `snapshots_v2` (`owner_id`,`space`,`created_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`flow` text NOT NULL,
	`status` text NOT NULL,
	`deleted_at` text,
	`updated_at` text NOT NULL,
	`payload` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `space`, `task_id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`owner_id`, `space`)
);
--> statement-breakpoint
CREATE TABLE `workspaces_v2` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`schema_version` integer DEFAULT 2 NOT NULL,
	PRIMARY KEY(`owner_id`, `space`)
);
