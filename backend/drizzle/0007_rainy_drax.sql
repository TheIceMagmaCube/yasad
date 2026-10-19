ALTER TABLE `group` ADD `seen_at` integer;--> statement-breakpoint
-- Only a sign-in gives an OIDC group members, so those were sent by the provider; empty ones cannot be told apart.
UPDATE `group` SET `seen_at` = unixepoch() * 1000 WHERE `source` = 'oidc' AND EXISTS (SELECT 1 FROM `user_group` WHERE `user_group`.`group_id` = `group`.`id`);
