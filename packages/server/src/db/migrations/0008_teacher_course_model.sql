CREATE TABLE `class_courses` (
	`class_id` text NOT NULL,
	`course_id` text NOT NULL,
	`assigned_at` integer NOT NULL,
	PRIMARY KEY(`class_id`, `course_id`),
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `class_courses_course_id_idx` ON `class_courses` (`course_id`);--> statement-breakpoint
CREATE TABLE `course_chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_chapters_course_id_idx` ON `course_chapters` (`course_id`);--> statement-breakpoint
CREATE TABLE `course_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`objectives` text DEFAULT '[]' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`teacher_tips` text DEFAULT '[]' NOT NULL,
	`assignment` text DEFAULT '' NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`skills` text DEFAULT '[]' NOT NULL,
	`mcp_servers` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `course_chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_lessons_chapter_id_idx` ON `course_lessons` (`chapter_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_asset` text DEFAULT '' NOT NULL,
	`stage` text NOT NULL,
	`topic` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`age_range` text DEFAULT '' NOT NULL,
	`goals` text DEFAULT '[]' NOT NULL,
	`expected_outcome` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `courses_institution_status_idx` ON `courses` (`institution_id`,`status`);--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`status` text NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lesson_id`) REFERENCES `course_lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_progress_class_lesson_unique` ON `lesson_progress` (`class_id`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `lesson_progress_class_id_idx` ON `lesson_progress` (`class_id`);--> statement-breakpoint
CREATE TABLE `lesson_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `course_lessons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lesson_resources_lesson_id_idx` ON `lesson_resources` (`lesson_id`);