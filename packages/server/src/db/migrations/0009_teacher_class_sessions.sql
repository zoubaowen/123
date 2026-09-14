CREATE TABLE `class_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`started_by_user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_minutes` integer,
	`point_limit` integer NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`mcp_servers` text DEFAULT '[]' NOT NULL,
	`student_count` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `course_lessons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_sessions_active_class_unique` ON `class_sessions` (`class_id`) WHERE "class_sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX `class_sessions_class_started_idx` ON `class_sessions` (`class_id`,`started_at`);