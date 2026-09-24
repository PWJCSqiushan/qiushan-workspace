ALTER TABLE time_plans ADD COLUMN course_metadata TEXT NOT NULL DEFAULT '{}';
ALTER TABLE time_intervals ADD COLUMN course_metadata TEXT NOT NULL DEFAULT '{}';
