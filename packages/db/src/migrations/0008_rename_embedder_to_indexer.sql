-- Rename embedder table to indexer
ALTER TABLE `embedder` RENAME TO `indexer`;

-- Rename embedder_id column in chunk table
ALTER TABLE `chunk` RENAME COLUMN `embedder_id` TO `indexer_id`;

-- Rename embedder_id column in job table
ALTER TABLE `job` RENAME COLUMN `embedder_id` TO `indexer_id`;

-- Recreate indexes with new names (drop old, create new)
DROP INDEX IF EXISTS `embedder_library_id_idx`;
CREATE INDEX `indexer_library_id_idx` ON `indexer` (`library_id`);

DROP INDEX IF EXISTS `chunk_embedder_id_idx`;
CREATE INDEX `chunk_indexer_id_idx` ON `chunk` (`indexer_id`);
