ALTER TABLE time_sync_requests ADD COLUMN connection_id text;
--> statement-breakpoint
UPDATE time_sync_requests SET status='coalesced' WHERE status='queued' AND rowid NOT IN (SELECT MIN(rowid) FROM time_sync_requests WHERE status='queued' GROUP BY owner_id,space);
--> statement-breakpoint
CREATE UNIQUE INDEX time_sync_one_pending ON time_sync_requests(owner_id,space) WHERE status IN ('queued','running');
--> statement-breakpoint
CREATE TABLE time_garmin_runtime (
 owner_id text NOT NULL, space text NOT NULL, connection_id text NOT NULL,
 heartbeat_at text NOT NULL, helper_status text NOT NULL, error_code text,
 PRIMARY KEY(owner_id,space,connection_id)
);
