CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `category_group` (
	`category_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`category_id`, `group_id`),
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_source_name_idx` ON `group` (`source`,`name`);--> statement-breakpoint
CREATE TABLE `link` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`icon` text,
	`keywords` text DEFAULT '[]' NOT NULL,
	`position` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `link_category_id_idx` ON `link` (`category_id`);--> statement-breakpoint
CREATE TABLE `link_group` (
	`link_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`link_id`, `group_id`),
	FOREIGN KEY (`link_id`) REFERENCES `link`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade
);
