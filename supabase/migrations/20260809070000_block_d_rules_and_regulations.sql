-- BUILD PROMPT v5 BLOCK D: Rules & Regulations Module
--
-- Versioned rules with per-employee-per-version read tracking, a
-- suggest-a-change flow (using the same 5-state lifecycle Block G's
-- Suggestion & Query Engine will later use org-wide: Submitted -> Under
-- Review -> Accepted/Rejected -> Implementation Pending -> Implemented —
-- this table intentionally does not wait for Block G, since a rule needs
-- this flow on its own; Block G may later generalise/absorb it), and a
-- real server-side gating chain: an employee cannot attempt a training
-- module's quiz while any mandatory rule that applies to them is unread.
--
-- Department scope: rules.department_id is nullable — null means
-- "applies to the whole organisation", not "applies to nobody". This
-- mirrors the department-optional convention already used elsewhere
-- (e.g. candidates.department_id).
--
-- Versioning: a rule's live content lives in rule_versions, not on the
-- rule row itself. rules.published_version_id points at the version
-- currently in force; editing a rule creates a NEW version rather than
-- mutating the old one, so read-tracking (which is per version) stays
-- honest — a "you've read this" record from version 1 never silently
-- covers version 2's changed content.

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  title text not null,
  category text not null default 'general',
  is_mandatory boolean not null default true,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  published_version_id uuid, -- FK added below, after rule_versions exists (circular reference)
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.rules(id) on delete cascade,
  version integer not null,
  body text not null,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(rule_id, version)
);

alter table public.rules add constraint rules_published_version_id_fkey
  foreign key (published_version_id) references public.rule_versions(id) on delete set null;

-- One row per employee per version they've actually opened/acknowledged.
-- Reading version 1 does not carry forward to version 2 — see header note.
create table public.rule_reads (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.rule_versions(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique(rule_version_id, user_id)
);

create table public.rule_change_suggestions (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.rules(id) on delete cascade,
  suggested_by uuid not null references public.app_users(id) on delete cascade,
  suggestion_text text not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'accepted', 'rejected', 'implementation_pending', 'implemented')),
  -- A rejection with no stated reason is a defect, not an edge case — same
  -- rule as everywhere else rejection reasons are mandatory in this app.
  rejection_reason text,
  target_implementation_date date,
  reviewed_by uuid references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'rejected' or rejection_reason is not null)
);

create index rules_org_idx on public.rules(org_id, status);
create index rule_versions_rule_idx on public.rule_versions(rule_id, version desc);
create index rule_reads_user_idx on public.rule_reads(user_id);
create index rule_change_suggestions_rule_idx on public.rule_change_suggestions(rule_id, status);

alter table public.rules enable row level security;
alter table public.rule_versions enable row level security;
alter table public.rule_reads enable row level security;
alter table public.rule_change_suggestions enable row level security;

create policy rules_deny_anon on public.rules for all to anon using (false) with check (false);
create policy rules_deny_authenticated on public.rules for all to authenticated using (false) with check (false);
create policy rule_versions_deny_anon on public.rule_versions for all to anon using (false) with check (false);
create policy rule_versions_deny_authenticated on public.rule_versions for all to authenticated using (false) with check (false);
create policy rule_reads_deny_anon on public.rule_reads for all to anon using (false) with check (false);
create policy rule_reads_deny_authenticated on public.rule_reads for all to authenticated using (false) with check (false);
create policy rule_change_suggestions_deny_anon on public.rule_change_suggestions for all to anon using (false) with check (false);
create policy rule_change_suggestions_deny_authenticated on public.rule_change_suggestions for all to authenticated using (false) with check (false);

-- BUILD PROMPT v5 BLOCK B follow-through: Block B's migration deliberately
-- left 'rules_ack' out of onboarding_stage_items.item_type, with a comment
-- promising it once this module existed. It exists now. Unlike
-- content_block/custom_task, rules_ack completion is DERIVED (like
-- training_module) rather than a manual acknowledgment: "done" means the
-- employee has read every mandatory rule that applies to them (org-wide +
-- their department). No content_asset_id/training_module_id needed.
alter table public.onboarding_stage_items drop constraint if exists onboarding_stage_items_check;
alter table public.onboarding_stage_items add constraint onboarding_stage_items_check
  check (
    (item_type = 'training_module' and training_module_id is not null and content_asset_id is null)
    or (item_type = 'content_block' and training_module_id is null)
    or (item_type in ('custom_task', 'rules_ack') and training_module_id is null and content_asset_id is null)
  );
alter table public.onboarding_stage_items drop constraint if exists onboarding_stage_items_item_type_check;
alter table public.onboarding_stage_items add constraint onboarding_stage_items_item_type_check
  check (item_type in ('training_module', 'content_block', 'custom_task', 'rules_ack'));
