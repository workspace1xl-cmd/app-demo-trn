-- BUILD PROMPT v4 item 6: Exec/org health view.
--
-- Org-wide readiness has no history until something captures it over time —
-- this table is that capture, one row per org per day. Deliberately NOT
-- computed by a second SQL formula here (a raw-SQL reimplementation of
-- training + cert-currency + RACI-coverage blending would inevitably drift
-- from the Edge Function's scoreFromComponents()) — instead it's captured
-- lazily and idempotently (unique org_id+captured_at) from
-- /api/v1/admin/exec and /api/v1/admin/analytics using that exact same
-- function, the same way notification_outbox reminders are enqueued
-- lazily in the FastAPI mirror. One formula, one place it can disagree
-- with itself: nowhere.
create table public.readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  score integer not null,
  components jsonb not null default '[]'::jsonb,
  captured_at date not null default current_date,
  unique(org_id, captured_at)
);
create index readiness_snapshots_org_idx on public.readiness_snapshots(org_id, captured_at desc);
alter table public.readiness_snapshots enable row level security;
create policy readiness_snapshots_deny_anon on public.readiness_snapshots for all to anon using (false) with check (false);
create policy readiness_snapshots_deny_authenticated on public.readiness_snapshots for all to authenticated using (false) with check (false);
