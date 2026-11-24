CREATE TABLE `sparelink_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sparelink_audit_record_idx` ON `sparelink_audit` (`record_id`);--> statement-breakpoint
CREATE TABLE `sparelink_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sparelink_records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`manufacturer` text NOT NULL,
	`manufacturer_key` text NOT NULL,
	`part_number` text NOT NULL,
	`part_key` text NOT NULL,
	`category` text NOT NULL,
	`quantity` integer NOT NULL,
	`condition` text NOT NULL,
	`region` text NOT NULL,
	`deadline` text,
	`lead_time_days` integer,
	`description` text DEFAULT '' NOT NULL,
	`company_name` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`is_test` integer DEFAULT false NOT NULL,
	`consent_version` text NOT NULL,
	`submission_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sparelink_records_owner_idx` ON `sparelink_records` (`owner_id`,`kind`);--> statement-breakpoint
CREATE INDEX `sparelink_records_match_idx` ON `sparelink_records` (`manufacturer_key`,`part_key`,`status`);--> statement-breakpoint
CREATE INDEX `sparelink_records_catalog_idx` ON `sparelink_records` (`kind`,`review_status`,`is_test`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `sparelink_records_submission_idx` ON `sparelink_records` (`owner_id`,`kind`,`submission_key`);