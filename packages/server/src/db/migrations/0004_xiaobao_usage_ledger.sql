CREATE TABLE `xiaobao_usage_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`reserved_units` integer NOT NULL,
	`settled_units` integer,
	`status` text NOT NULL,
	`credit_cost_reserved` integer NOT NULL,
	`credit_cost_settled` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`settled_at` integer,
	CONSTRAINT "xiaobao_usage_reservations_category_check" CHECK("xiaobao_usage_reservations"."category" IN ('model', 'tool', 'sandbox', 'media')),
	CONSTRAINT "xiaobao_usage_reservations_status_check" CHECK("xiaobao_usage_reservations"."status" IN ('reserved', 'settled', 'released')),
	CONSTRAINT "xiaobao_usage_reservations_reserved_units_check" CHECK(typeof("xiaobao_usage_reservations"."reserved_units") = 'integer' AND "xiaobao_usage_reservations"."reserved_units" > 0),
	CONSTRAINT "xiaobao_usage_reservations_settled_units_check" CHECK("xiaobao_usage_reservations"."settled_units" IS NULL OR (typeof("xiaobao_usage_reservations"."settled_units") = 'integer' AND "xiaobao_usage_reservations"."settled_units" >= 0)),
	CONSTRAINT "xiaobao_usage_reservations_credit_cost_reserved_check" CHECK(typeof("xiaobao_usage_reservations"."credit_cost_reserved") = 'integer' AND "xiaobao_usage_reservations"."credit_cost_reserved" >= 0),
	CONSTRAINT "xiaobao_usage_reservations_credit_cost_settled_check" CHECK("xiaobao_usage_reservations"."credit_cost_settled" IS NULL OR (typeof("xiaobao_usage_reservations"."credit_cost_settled") = 'integer' AND "xiaobao_usage_reservations"."credit_cost_settled" >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xiaobao_usage_reservations_task_category_unique` ON `xiaobao_usage_reservations` (`task_id`,`category`);--> statement-breakpoint
CREATE INDEX `xiaobao_usage_reservations_user_id_idx` ON `xiaobao_usage_reservations` (`user_id`);--> statement-breakpoint
CREATE INDEX `xiaobao_usage_reservations_status_idx` ON `xiaobao_usage_reservations` (`status`);