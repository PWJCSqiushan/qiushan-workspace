CREATE TABLE `coordination_state` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`queue_version` integer DEFAULT 0 NOT NULL,
	`ready` integer DEFAULT 0 NOT NULL,
	`coverage` text NOT NULL,
	PRIMARY KEY(`owner_id`, `space`)
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`owner_id` text NOT NULL,
	`space` text NOT NULL,
	`event_id` text NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`owner_id`, `space`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `task_events_date` ON `task_events` (`owner_id`,`space`,`date`);