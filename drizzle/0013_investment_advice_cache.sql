CREATE TABLE IF NOT EXISTS investment_advice_cache (
 owner_id text NOT NULL,
 space text NOT NULL CHECK (space IN ('personal','demo')),
 version integer NOT NULL,
 analysis_date text NOT NULL,
 rule_version text NOT NULL,
 advice_json text NOT NULL,
 PRIMARY KEY(owner_id,space)
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS investment_state_update_size
BEFORE UPDATE OF state_json ON investment_states
WHEN length(CAST(NEW.state_json AS BLOB))>2000000
BEGIN SELECT RAISE(ABORT,'INVESTMENT_STATE_TOO_LARGE'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS investment_state_insert_size
BEFORE INSERT ON investment_states
WHEN length(CAST(NEW.state_json AS BLOB))>2000000
BEGIN SELECT RAISE(ABORT,'INVESTMENT_STATE_TOO_LARGE'); END;
