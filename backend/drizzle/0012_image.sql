CREATE TABLE `image` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size` integer NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `image_sha256_unique` ON `image` (`sha256`);--> statement-breakpoint
CREATE INDEX `image_created_at_idx` ON `image` (`created_at`);