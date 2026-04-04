ALTER TABLE `indexer` ADD `index_concurrency` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `library` ADD `scan_concurrency` integer DEFAULT 3 NOT NULL;