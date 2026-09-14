CREATE TABLE `xiaobao_runtime_checkpoints` (
	`task_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
