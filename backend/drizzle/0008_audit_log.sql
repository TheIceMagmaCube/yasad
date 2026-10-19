CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`actor_id` text,
	`actor_name` text,
	`actor_email` text,
	`action` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text,
	`object_label` text,
	`related_type` text,
	`related_id` text,
	`related_label` text,
	`before` text,
	`after` text,
	`details` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_object_type_idx` ON `audit_log` (`object_type`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_object_id_idx` ON `audit_log` (`object_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_related_id_idx` ON `audit_log` (`related_id`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);