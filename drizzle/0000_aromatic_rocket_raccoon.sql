CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`space` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
