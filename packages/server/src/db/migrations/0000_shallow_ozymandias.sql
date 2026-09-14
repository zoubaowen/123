CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'github' NOT NULL,
	`external_user_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`scope` text,
	`username` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_id_provider_idx` ON `accounts` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `admin_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_user_id` text,
	`details` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_logs_admin_user_id_idx` ON `admin_logs` (`admin_user_id`);--> statement-breakpoint
CREATE INDEX `admin_logs_target_user_id_idx` ON `admin_logs` (`target_user_id`);--> statement-breakpoint
CREATE INDEX `admin_logs_action_idx` ON `admin_logs` (`action`);--> statement-breakpoint
CREATE INDEX `admin_logs_created_at_idx` ON `admin_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `community_works` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_name` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`preview_url` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`file_urls` text DEFAULT '[]' NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`liked_by` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cw_user_id_idx` ON `community_works` (`user_id`);--> statement-breakpoint
CREATE INDEX `cw_created_at_idx` ON `community_works` (`created_at`);--> statement-breakpoint
CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'remote' NOT NULL,
	`base_url` text,
	`oauth_client_id` text,
	`oauth_client_secret` text,
	`command` text,
	`args` text,
	`env` text,
	`headers` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `cron_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`cron_expression` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`repo_url` text,
	`selected_agent` text DEFAULT 'codebuddy',
	`selected_model` text,
	`last_run_at` integer,
	`next_run_at` integer,
	`locked_by` text,
	`locked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`type` text NOT NULL,
	`url` text,
	`path` text,
	`qr_code_url` text,
	`page_path` text,
	`app_id` text,
	`label` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployments_task_id_idx` ON `deployments` (`task_id`);--> statement-breakpoint
CREATE INDEX `deployments_task_type_path_idx` ON `deployments` (`task_id`,`type`,`path`);--> statement-breakpoint
CREATE TABLE `env_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`env_id` text,
	`env_alias` text,
	`env_region` text,
	`cos_tag_value` text,
	`policy_hash` text,
	`cam_username` text,
	`cam_secret_id` text,
	`cam_secret_key` text,
	`policy_id` integer,
	`claimed_by_user_id` text,
	`claimed_by_task_id` text,
	`claimed_at` integer,
	`fail_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `env_pool_status_idx` ON `env_pool` (`status`);--> statement-breakpoint
CREATE TABLE `keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keys_user_id_provider_idx` ON `keys` (`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `local_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `miniprogram_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`app_id` text NOT NULL,
	`private_key` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_user_id_key_idx` ON `settings` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`prompt` text NOT NULL,
	`title` text,
	`repo_url` text,
	`env_id` text,
	`selected_agent` text DEFAULT 'claude',
	`selected_model` text,
	`selected_runtime` text,
	`mode` text DEFAULT 'default' NOT NULL,
	`install_dependencies` integer DEFAULT false,
	`max_duration` integer DEFAULT 300,
	`keep_alive` integer DEFAULT false,
	`enable_browser` integer DEFAULT false,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0,
	`logs` text,
	`error` text,
	`branch_name` text,
	`sandbox_id` text,
	`sandbox_session_id` text,
	`sandbox_cwd` text,
	`sandbox_mode` text,
	`agent_session_id` text,
	`sandbox_url` text,
	`preview_url` text,
	`pr_url` text,
	`pr_number` integer,
	`pr_status` text,
	`pr_merge_commit_sha` text,
	`mcp_server_list` text,
	`skill_settings` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_user_deleted_created_idx` ON `tasks` (`user_id`,`deleted_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_deleted_status_created_idx` ON `tasks` (`deleted_at`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_user_pr_repo_idx` ON `tasks` (`user_id`,`pr_number`,`repo_url`);--> statement-breakpoint
CREATE TABLE `user_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scope` text DEFAULT 'user' NOT NULL,
	`task_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`env_id` text,
	`env_alias` text,
	`env_region` text,
	`cos_tag_value` text,
	`policy_hash` text,
	`cam_username` text,
	`cam_secret_id` text,
	`cam_secret_key` text,
	`policy_id` integer,
	`fail_step` text,
	`fail_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`access_token` text DEFAULT '' NOT NULL,
	`refresh_token` text,
	`scope` text,
	`username` text NOT NULL,
	`email` text,
	`name` text,
	`avatar_url` text,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`disabled_reason` text,
	`disabled_at` integer,
	`disabled_by` text,
	`api_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_provider_external_id_idx` ON `users` (`provider`,`external_id`);