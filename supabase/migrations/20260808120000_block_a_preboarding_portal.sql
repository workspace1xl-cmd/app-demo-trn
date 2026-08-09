-- BUILD PROMPT v5 BLOCK A: Pre-Joining Portal.
--
-- A candidate never gets an app_users row (they don't have an account
-- yet) — `candidates` is deliberately its own table, not app_users with
-- a status flag, because a candidate has none of the fields a real
-- employee needs (password_hash, role, manager_id) and giving them a
-- row in app_users would mean every employee-facing query has to
-- remember to filter candidates back out. `invite_token` is the only
-- credential: this is a public, unauthenticated surface by design (a
-- candidate has no account to log into yet), so every public route is
-- token-scoped rather than session-scoped.
--
-- Honesty note (ties to the linked task): the spec's "Full list of
-- Common rules & regulations" on the preview page can't be wired to a
-- real Rules module yet — that's Block D, not built in this migration.
-- org_preboarding_content covers only the welcome/expectations blocks
-- Block A explicitly calls its own ("admin-editable content blocks");
-- the rules list is deferred and the UI says so rather than faking it.
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  full_name text not null,
  email text not null,
  invite_token uuid not null default gen_random_uuid() unique,
  status text not null default 'invited' check (status in ('invited','acknowledged','joined')),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(org_id, email)
);
create index candidates_org_idx on public.candidates(org_id);
create index candidates_token_idx on public.candidates(invite_token);

create table public.preboarding_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade unique,
  acknowledged_at timestamptz not null default now(),
  ip_address text,
  user_agent text
);

-- One row per org per content block (welcome / expectations_from_you /
-- expectations_from_us), admin-editable, upserted rather than versioned
-- — Block A's own scope is simpler than Block D's versioned Rules
-- module, deliberately not sharing that machinery yet.
create table public.org_preboarding_content (
  org_id uuid not null references public.organizations(id) on delete cascade,
  block_key text not null check (block_key in ('welcome','expectations_from_you','expectations_from_us')),
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (org_id, block_key)
);

alter table public.candidates enable row level security;
alter table public.preboarding_acknowledgments enable row level security;
alter table public.org_preboarding_content enable row level security;
-- Same convention as every other table: all real access goes through
-- the Edge Function's service_role client (including the public/token
-- routes — the Edge Function itself is always privileged internally,
-- regardless of whether the caller is authenticated), never direct
-- anon/authenticated table access.
create policy candidates_deny_anon on public.candidates for all to anon, authenticated using (false) with check (false);
create policy preboarding_acknowledgments_deny_anon on public.preboarding_acknowledgments for all to anon, authenticated using (false) with check (false);
create policy org_preboarding_content_deny_anon on public.org_preboarding_content for all to anon, authenticated using (false) with check (false);

-- Seed the demo org's default preboarding content so the public preview
-- page has real (if generic) copy on first load rather than blank
-- fields the first time an admin opens the editor.
insert into public.org_preboarding_content(org_id, block_key, body)
select o.id, v.block_key, v.body
from public.organizations o
cross join (values
  ('welcome', 'Welcome — we''re glad you''re considering joining us. This page gives you a clear picture of what to expect before you accept, so there are no surprises on day one.'),
  ('expectations_from_you', 'We expect punctuality, ownership of your responsibilities once assigned, and honest communication when something is blocking you. Full role-specific expectations are shared once your department is confirmed.'),
  ('expectations_from_us', 'You can expect a structured onboarding path, a named point of contact for every question, and transparency about how your role fits the wider organisation.')
) v(block_key, body)
where o.slug = 'example-organisation'
on conflict (org_id, block_key) do nothing;
