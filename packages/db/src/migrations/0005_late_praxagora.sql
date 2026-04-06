DROP INDEX "account_userId_idx";--> statement-breakpoint
DROP INDEX "session_token_unique";--> statement-breakpoint
DROP INDEX "session_userId_idx";--> statement-breakpoint
DROP INDEX "user_email_unique";--> statement-breakpoint
DROP INDEX "verification_identifier_idx";--> statement-breakpoint
DROP INDEX "chunk_video_id_idx";--> statement-breakpoint
DROP INDEX "chunk_indexer_id_idx";--> statement-breakpoint
DROP INDEX "chunk_embedding_status_idx";--> statement-breakpoint
DROP INDEX "indexer_library_id_idx";--> statement-breakpoint
DROP INDEX "job_status_idx";--> statement-breakpoint
DROP INDEX "job_library_id_idx";--> statement-breakpoint
DROP INDEX "job_type_status_idx";--> statement-breakpoint
DROP INDEX "library_status_idx";--> statement-breakpoint
DROP INDEX "video_library_id_idx";--> statement-breakpoint
DROP INDEX "video_status_idx";--> statement-breakpoint
ALTER TABLE `indexer` ALTER COLUMN "chunk_overlap" TO "chunk_overlap" integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `chunk_video_id_idx` ON `chunk` (`video_id`);--> statement-breakpoint
CREATE INDEX `chunk_indexer_id_idx` ON `chunk` (`indexer_id`);--> statement-breakpoint
CREATE INDEX `chunk_embedding_status_idx` ON `chunk` (`embedding_status`);--> statement-breakpoint
CREATE INDEX `indexer_library_id_idx` ON `indexer` (`library_id`);--> statement-breakpoint
CREATE INDEX `job_status_idx` ON `job` (`status`);--> statement-breakpoint
CREATE INDEX `job_library_id_idx` ON `job` (`library_id`);--> statement-breakpoint
CREATE INDEX `job_type_status_idx` ON `job` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `library_status_idx` ON `library` (`status`);--> statement-breakpoint
CREATE INDEX `video_library_id_idx` ON `video` (`library_id`);--> statement-breakpoint
CREATE INDEX `video_status_idx` ON `video` (`status`);--> statement-breakpoint
ALTER TABLE `indexer` ALTER COLUMN "downscale_fps" TO "downscale_fps" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `library` ADD `exclude_patterns` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `library` ADD `scan_modified_after` integer;--> statement-breakpoint
ALTER TABLE `library` ADD `scan_modified_before` integer;