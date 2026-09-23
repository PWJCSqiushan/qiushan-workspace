ALTER TABLE `time_plans` ADD COLUMN `attendance` text CHECK (`attendance` IS NULL OR `attendance` IN ('on_time','late_under_5','late_over_5','absent','excused'));
