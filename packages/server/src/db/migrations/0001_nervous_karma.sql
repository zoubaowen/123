CREATE TABLE `credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`description` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ct_user_id_idx` ON `credit_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `ct_type_idx` ON `credit_transactions` (`type`);--> statement-breakpoint
CREATE INDEX `ct_created_at_idx` ON `credit_transactions` (`created_at`);--> statement-breakpoint
CREATE TABLE `daily_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`task_count` integer DEFAULT 0 NOT NULL,
	`sandbox_duration` integer DEFAULT 0 NOT NULL,
	`credits_consumed` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `du_user_date_unique` ON `daily_usage` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `du_date_idx` ON `daily_usage` (`date`);--> statement-breakpoint
CREATE TABLE `sms_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`code` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sms_codes_phone_idx` ON `sms_codes` (`phone`);--> statement-breakpoint
CREATE INDEX `sms_codes_expires_idx` ON `sms_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`credits_per_period` integer DEFAULT 0 NOT NULL,
	`period_days` integer DEFAULT 30 NOT NULL,
	`price_cents` integer DEFAULT 0 NOT NULL,
	`max_tasks_per_day` integer,
	`max_sandbox_duration` integer,
	`features` text,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sp_active_idx` ON `subscription_plans` (`active`);--> statement-breakpoint
CREATE TABLE `user_credits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`frozen_balance` integer DEFAULT 0 NOT NULL,
	`lifetime_balance` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_credits_user_id_unique` ON `user_credits` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_credits_user_id_idx` ON `user_credits` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_period_start` integer NOT NULL,
	`current_period_end` integer NOT NULL,
	`auto_renew` integer DEFAULT true NOT NULL,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `us_user_id_idx` ON `user_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `us_status_idx` ON `user_subscriptions` (`status`);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `users` ADD `phone_verified` integer DEFAULT false;