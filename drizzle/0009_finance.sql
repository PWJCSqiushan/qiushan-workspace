CREATE TABLE finance_heads(owner_id TEXT NOT NULL,space TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,last_operation_id TEXT,PRIMARY KEY(owner_id,space));
--> statement-breakpoint
CREATE TABLE finance_entities(owner_id TEXT NOT NULL,space TEXT NOT NULL,collection TEXT NOT NULL,entity_id TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,occurred_at TEXT,related_id TEXT,source_key TEXT,data_json TEXT NOT NULL,PRIMARY KEY(owner_id,space,collection,entity_id));
--> statement-breakpoint
CREATE INDEX finance_entities_date ON finance_entities(owner_id,space,collection,occurred_at);
--> statement-breakpoint
CREATE INDEX finance_entities_related ON finance_entities(owner_id,space,related_id);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_source_unique ON finance_entities(owner_id,space,source_key) WHERE source_key IS NOT NULL;
--> statement-breakpoint
CREATE TABLE finance_postings(owner_id TEXT NOT NULL,space TEXT NOT NULL,transaction_id TEXT NOT NULL,ordinal INTEGER NOT NULL,account TEXT NOT NULL,cents INTEGER NOT NULL,PRIMARY KEY(owner_id,space,transaction_id,ordinal));
--> statement-breakpoint
CREATE INDEX finance_postings_account ON finance_postings(owner_id,space,account);
--> statement-breakpoint
CREATE TABLE finance_changes(cursor INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL,space TEXT NOT NULL,version INTEGER NOT NULL,operation_id TEXT NOT NULL,collection TEXT NOT NULL,entity_id TEXT NOT NULL,data_json TEXT);
--> statement-breakpoint
CREATE INDEX finance_changes_scope ON finance_changes(owner_id,space,cursor);
--> statement-breakpoint
CREATE TABLE finance_history(owner_id TEXT NOT NULL,space TEXT NOT NULL,history_id TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0,redo_invalidated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,space,history_id));
--> statement-breakpoint
CREATE TABLE finance_receipts(owner_id TEXT NOT NULL,space TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,result_version INTEGER NOT NULL DEFAULT 0,result_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,PRIMARY KEY(owner_id,space,operation_id));
--> statement-breakpoint
CREATE TABLE finance_backup_runs(owner_id TEXT NOT NULL,space TEXT NOT NULL,id TEXT NOT NULL,status TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT,error TEXT,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,space,id));
