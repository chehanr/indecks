-- Fixup: rename embedder_id → indexer_id on chunk table
-- Migration 0008 recorded as applied but RENAME COLUMN didn't take effect
ALTER TABLE `chunk` RENAME COLUMN `embedder_id` TO `indexer_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `chunk_embedder_id_idx`;--> statement-breakpoint
CREATE INDEX `chunk_indexer_id_idx` ON `chunk` (`indexer_id`);
