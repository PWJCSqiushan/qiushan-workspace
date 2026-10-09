CREATE TABLE IF NOT EXISTS investment_states (
  owner_id text NOT NULL,
  space text NOT NULL CHECK (space IN ('personal','demo')),
  version integer NOT NULL DEFAULT 0,
  state_json text NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY(owner_id,space)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS investment_operations (
  owner_id text NOT NULL,
  space text NOT NULL CHECK (space IN ('personal','demo')),
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  result_json text NOT NULL,
  result_version integer NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY(owner_id,space,operation_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS investment_operations_created ON investment_operations(owner_id,space,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS investment_backups (
  owner_id text NOT NULL,
  space text NOT NULL CHECK (space IN ('personal','demo')),
  name text NOT NULL,
  version integer NOT NULL,
  payload_json text NOT NULL,
  sha256 text NOT NULL,
  created_at text NOT NULL,
  PRIMARY KEY(owner_id,space,name)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS investment_backups_created ON investment_backups(owner_id,space,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS investment_export_bindings (
  owner_id text NOT NULL,
  space text NOT NULL CHECK (space IN ('personal','demo')),
  snapshot_id text NOT NULL,
  binding_json text NOT NULL,
  PRIMARY KEY(owner_id,space,snapshot_id)
);
