CREATE TABLE `time_heads` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `version` integer NOT NULL DEFAULT 0,
  `last_operation_id` text,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`owner_id`,`space`)
);
--> statement-breakpoint
CREATE TABLE `time_categories` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `category_id` text NOT NULL,
  `name` text NOT NULL,
  `color` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1,
  `ordinal` integer NOT NULL,
  PRIMARY KEY (`owner_id`,`space`,`category_id`)
);
--> statement-breakpoint
CREATE TABLE `time_intervals` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `interval_id` text NOT NULL,
  `start_at` text NOT NULL,
  `end_at` text NOT NULL,
  `category_id` text NOT NULL,
  `note` text,
  `source_key` text,
  `manual` integer NOT NULL DEFAULT 1,
  `estimated` integer NOT NULL DEFAULT 0,
  `version` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`owner_id`,`space`,`interval_id`)
);
--> statement-breakpoint
CREATE INDEX `time_intervals_range` ON `time_intervals` (`owner_id`,`space`,`start_at`,`end_at`);
--> statement-breakpoint
CREATE INDEX `time_intervals_source` ON `time_intervals` (`owner_id`,`space`,`source_key`);
--> statement-breakpoint
CREATE TABLE `time_plans` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `plan_id` text NOT NULL,
  `start_at` text NOT NULL,
  `end_at` text NOT NULL,
  `category_id` text NOT NULL,
  `note` text,
  `source_key` text,
  `status` text NOT NULL,
  `manual` integer NOT NULL DEFAULT 0,
  `estimated` integer NOT NULL DEFAULT 0,
  `version` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`owner_id`,`space`,`plan_id`)
);
--> statement-breakpoint
CREATE INDEX `time_plans_range` ON `time_plans` (`owner_id`,`space`,`start_at`,`end_at`);
--> statement-breakpoint
CREATE INDEX `time_plans_source` ON `time_plans` (`owner_id`,`space`,`source_key`);
--> statement-breakpoint
CREATE TABLE `time_timers` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `timer_id` text NOT NULL,
  `start_at` text NOT NULL,
  `category_id` text NOT NULL,
  `note` text,
  `version` integer NOT NULL DEFAULT 1,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`owner_id`,`space`)
);
--> statement-breakpoint
CREATE TABLE `time_imports` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `import_id` text NOT NULL,
  `source` text NOT NULL,
  `status` text NOT NULL,
  `source_hash` text,
  `item_count` integer NOT NULL,
  `accepted` integer,
  `skipped` integer,
  `created_at` text NOT NULL,
  `payload` text NOT NULL DEFAULT '{}',
  PRIMARY KEY (`owner_id`,`space`,`import_id`)
);
--> statement-breakpoint
CREATE TABLE `time_sources` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `source_key` text NOT NULL,
  `kind` text NOT NULL,
  `status` text NOT NULL,
  `manual` integer NOT NULL DEFAULT 0,
  `record_id` text,
  `payload` text NOT NULL DEFAULT '{}',
  `updated_at` text NOT NULL,
  PRIMARY KEY (`owner_id`,`space`,`source_key`)
);
--> statement-breakpoint
CREATE TABLE `time_corrections` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `correction_id` text NOT NULL,
  `operation_id` text NOT NULL,
  `kind` text NOT NULL,
  `before_json` text NOT NULL,
  `after_json` text NOT NULL,
  `undone` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  PRIMARY KEY (`owner_id`,`space`,`correction_id`)
);
--> statement-breakpoint
CREATE TABLE `time_receipts` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `operation_id` text NOT NULL,
  `request_hash` text NOT NULL,
  `result_json` text NOT NULL DEFAULT '{}',
  `result_version` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL,
  PRIMARY KEY (`owner_id`,`space`,`operation_id`)
);
--> statement-breakpoint
CREATE TABLE `time_garmin_connections` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `connection_id` text NOT NULL,
  `token_hash` text NOT NULL,
  `status` text NOT NULL,
  `scopes` text NOT NULL,
  `created_at` text NOT NULL,
  `revoked_at` text,
  `last_sync_at` text,
  PRIMARY KEY (`owner_id`,`space`,`connection_id`)
);
--> statement-breakpoint
CREATE INDEX `time_garmin_token` ON `time_garmin_connections` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `time_sync_requests` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `request_id` text NOT NULL,
  `status` text NOT NULL,
  `requested_at` text NOT NULL,
  `completed_at` text,
  PRIMARY KEY (`owner_id`,`space`,`request_id`)
);
--> statement-breakpoint
CREATE TABLE `time_backup_runs` (
  `owner_id` text NOT NULL,
  `space` text NOT NULL,
  `id` text NOT NULL,
  `status` text NOT NULL,
  `bytes` integer NOT NULL DEFAULT 0,
  `sha256` text,
  `error` text,
  `created_at` text NOT NULL,
  PRIMARY KEY (`owner_id`,`space`,`id`)
);
