CREATE TABLE `embedder` (
	`id` text PRIMARY KEY NOT NULL,
	`library_id` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`instruction` text,
	`is_default` integer DEFAULT false NOT NULL,
	`chunk_duration` integer DEFAULT 30 NOT NULL,
	`chunk_overlap` integer DEFAULT 5 NOT NULL,
	`downscale_fps` integer DEFAULT 5 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `library`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `embedder_library_id_idx` ON `embedder` (`library_id`);
--> statement-breakpoint
INSERT INTO `embedder` (`id`, `library_id`, `name`, `base_url`, `api_key`, `model`, `dimensions`, `instruction`, `is_default`, `chunk_duration`, `chunk_overlap`, `downscale_fps`)
SELECT
	lower(hex(randomblob(11))),
	`id`,
	'Default',
	`embedding_base_url`,
	`embedding_api_key`,
	`embedding_model`,
	`embedding_dimensions`,
	`embedding_instruction`,
	1,
	`chunk_duration`,
	`chunk_overlap`,
	`downscale_fps`
FROM `library`
WHERE `embedding_base_url` IS NOT NULL AND `embedding_model` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `chunk` ADD `embedder_id` text REFERENCES embedder(id) ON DELETE CASCADE;
--> statement-breakpoint
UPDATE `chunk` SET `embedder_id` = (
	SELECT e.`id` FROM `embedder` e
	JOIN `video` v ON e.`library_id` = v.`library_id`
	WHERE v.`id` = `chunk`.`video_id`
	LIMIT 1
);
--> statement-breakpoint
CREATE INDEX `chunk_embedder_id_idx` ON `chunk` (`embedder_id`);
--> statement-breakpoint
ALTER TABLE `library` DROP COLUMN `embedding_instruction`;--> statement-breakpoint
ALTER TABLE `library` DROP COLUMN `embedding_base_url`;--> statement-breakpoint
ALTER TABLE `library` DROP COLUMN `embedding_api_key`;--> statement-breakpoint
ALTER TABLE `library` DROP COLUMN `embedding_model`;--> statement-breakpoint
ALTER TABLE `library` DROP COLUMN `embedding_dimensions`;--> statement-breakpoint
ALTER TABLE `library` DROP COLUMN `chunk_duration`;--> statement-breakpoint
ALTER TABLE `library` DROP COLUMN `chunk_overlap`;--> statement-breakpoint
ALTER TABLE `library` DROP COLUMN `downscale_fps`;
