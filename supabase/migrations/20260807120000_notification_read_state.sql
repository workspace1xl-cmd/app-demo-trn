-- BUILD PROMPT v4 item 5: in-app notification centre.
--
-- notification_outbox already exists (added for the n8n email pipeline,
-- populated nightly by enqueue_onework_reminders() for learning_reminder
-- and certificate_expiry) — reused here as the single source of truth
-- rather than building a parallel table. `status`/`sent_at` are the EMAIL
-- delivery state and must stay untouched by in-app interaction; `read_at`
-- is added as a separate column so "I saw this in the bell dropdown" never
-- collides with "the email actually went out".
--
-- Honesty note (carried from the earlier notification_dismissals design):
-- this ships the two triggers that are genuinely computable today
-- (overdue/stale training, certificate expiry). "RACI ownership
-- reassigned" and "readiness score dropped below a threshold" are not —
-- activities.current_person has no link to a real app_users row yet, and
-- there's no readiness snapshot history to diff against. Both are deferred
-- to the exec-view snapshot table (item 6), which needs that history
-- anyway.
alter table public.notification_outbox add column if not exists read_at timestamptz;
create index if not exists notification_outbox_unread_idx on public.notification_outbox(org_id,user_id) where read_at is null;
