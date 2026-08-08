-- The item-A2 demo seed migration backdated a couple of enrollment rows
-- and near-expiry certificates specifically so the notification bell has
-- something real to show — but notification_outbox is only populated by
-- public.enqueue_onework_reminders(), which runs on a nightly pg_cron
-- schedule (2:30am). Without this, the bell stays empty until tonight's
-- run, even though the underlying data already qualifies. One-off,
-- idempotent (the function's own "not already enqueued today" guards
-- apply), safe to leave in the migration history.
select public.enqueue_onework_reminders();
