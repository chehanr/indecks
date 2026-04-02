ALTER TABLE `library` ADD `chunk_duration` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `library` ADD `chunk_overlap` integer DEFAULT 5 NOT NULL;