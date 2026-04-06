ALTER TABLE `library` RENAME COLUMN "folder_path" TO "folder_paths";--> statement-breakpoint
UPDATE `library` SET `folder_paths` = json_array(`folder_paths`) WHERE `folder_paths` NOT LIKE '[%';