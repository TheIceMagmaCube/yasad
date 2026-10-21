CREATE TABLE `link_status` (
	`link_id` text NOT NULL,
	`source` text NOT NULL,
	`state` text,
	`reason` text,
	`http_status` integer,
	`checked_at` integer,
	`due_at` integer DEFAULT 0 NOT NULL,
	`claim_id` text,
	`claimed_until` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`link_id`, `source`),
	FOREIGN KEY (`link_id`) REFERENCES `link`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `link_status_source_due_at_idx` ON `link_status` (`source`,`due_at`);--> statement-breakpoint
ALTER TABLE `link` ADD `check_enabled` integer DEFAULT false NOT NULL;