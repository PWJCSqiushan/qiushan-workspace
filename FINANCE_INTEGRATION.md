# Finance module integration checklist

The finance module is independent from task and time data. This release adds `/finance`, authenticated `/api/finance/*`, local bill/campus OCR review, category codes, drilldown charts, and self-hosted Chinese display typography with Geist numerals.

## Release contents and privacy

Only application code, synthetic tests, dependencies and licensed font/OCR assets belong in this repository. Statements, receipts, merchant/category private configuration, review drafts, authentication bindings and account backups do not. Campus test fixtures use synthetic dates and amounts. The finance preview accepts private configuration via environment variables; those input files must remain outside Git.

## Before production integration

1. Export and verify existing task, time and finance backups. Preserve any device outbox and review drafts.
2. Apply D1 migrations `0009_finance.sql` and `0010_finance_restore_guard.sql` to the existing database, after confirming the prior migrations. Do not replace that database.
3. Build with the deployment's private bindings. Keep authentication enabled, retain time reconciliation and scheduled backups; finance is included in scheduled backups.
4. Preview `/finance` and authenticated finance sync/restore on the intended environment. Verify the deployed personal ledger before importing a separately approved private backup. A deployment is not a data migration.
5. Restore only to the matching owner and space with an expected version and preview. Do not overwrite existing records or guess opening balances. Historical analysis-only records count toward consumption but not current account balances.
6. Review drafts are browser-local. Copy or export them separately; the regular server backup does not carry IndexedDB drafts. The local data-and-backup panel can safely copy demo drafts after the corresponding transaction IDs exist in personal, refusing different existing drafts.
7. Verify task/time regression, logged-out denial, finance totals, idempotency and offline retries before marking production integration complete.

## Validation

Finance regression: 72 tests. Type checking and production build are required on the release tree. Typography checked at 1366×768 and 1024×768 in dark theme, 1920×1080 in light theme; no full-page vertical overflow in the chart workspace. Chinese chart labels use Smiley Sans shards, English and numbers Geist. No production data is embedded in assets.