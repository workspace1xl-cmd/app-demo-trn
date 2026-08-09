-- BUILD PROMPT v5 BLOCK B: Onboarding Home / Journey Engine
--
-- Gives every new employee a stage-gated "onboarding home" instead of
-- dropping them straight into the standard dashboard. Admins configure
-- an ordered list of stages per org; each stage holds an ordered list
-- of items. An item is either:
--   'training_module'  -- completion is DERIVED from the existing
--                          enrollments table (status = 'completed').
--                          We never duplicate that state here.
--   'content_block'     -- a read-and-acknowledge item (e.g. a message
--                          from Block C once it exists). Completion is
--                          an explicit employee acknowledgment.
--   'custom_task'        -- a manual task with no other system backing
--                          it (e.g. "Set up your laptop"). Completion
--                          is an explicit employee acknowledgment.
--
-- We deliberately do NOT add a 'rules_ack' item type yet: Rules &
-- Regulations (Block D) doesn't exist. Adding the type now would let
-- an admin configure a stage that can never be completed. When Block D
-- ships, this constraint gets a follow-up migration that adds it.
--
-- Stage/overall completion is computed on read, not cached on the user
-- row -- there is exactly one source of truth (employee_item_progress
-- + enrollments), so there is nothing that can drift out of sync.

create table public.onboarding_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  sequence integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, sequence)
);

create table public.onboarding_stage_items (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.onboarding_stages(id) on delete cascade,
  item_type text not null check (item_type in ('training_module', 'content_block', 'custom_task')),
  -- Only meaningful for item_type = 'training_module': the training_modules.id
  -- whose enrollment completion drives this item's status.
  training_module_id uuid references public.training_modules(id) on delete cascade,
  title text not null,
  description text not null default '',
  sequence integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (item_type = 'training_module' and training_module_id is not null)
    or (item_type <> 'training_module' and training_module_id is null)
  ),
  unique(stage_id, sequence)
);

-- Explicit employee acknowledgment for 'content_block' / 'custom_task'
-- items. 'training_module' items never get a row here -- their status
-- always comes straight from enrollments.
create table public.employee_item_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  item_id uuid not null references public.onboarding_stage_items(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique(user_id, item_id)
);

create index onboarding_stages_org_idx on public.onboarding_stages(org_id, sequence);
create index onboarding_stage_items_stage_idx on public.onboarding_stage_items(stage_id, sequence);
create index employee_item_progress_user_idx on public.employee_item_progress(user_id);

alter table public.onboarding_stages enable row level security;
alter table public.onboarding_stage_items enable row level security;
alter table public.employee_item_progress enable row level security;

create policy onboarding_stages_deny_anon on public.onboarding_stages for all to anon using (false) with check (false);
create policy onboarding_stages_deny_authenticated on public.onboarding_stages for all to authenticated using (false) with check (false);
create policy onboarding_stage_items_deny_anon on public.onboarding_stage_items for all to anon using (false) with check (false);
create policy onboarding_stage_items_deny_authenticated on public.onboarding_stage_items for all to authenticated using (false) with check (false);
create policy employee_item_progress_deny_anon on public.employee_item_progress for all to anon using (false) with check (false);
create policy employee_item_progress_deny_authenticated on public.employee_item_progress for all to authenticated using (false) with check (false);

-- Seed a sensible default 3-stage journey for the demo org so the
-- feature isn't an empty shell the first time anyone opens it.
insert into public.onboarding_stages (org_id, name, description, sequence)
select o.id, v.name, v.description, v.sequence
from public.organizations o
cross join (values
  (1, 'Getting started', 'The basics before anything else.'),
  (2, 'Learn the ropes', 'Complete your first assigned training.'),
  (3, 'You''re set', 'Final housekeeping before you''re fully onboarded.')
) as v(sequence, name, description)
where o.slug = 'example-organisation'
on conflict (org_id, sequence) do nothing;

insert into public.onboarding_stage_items (stage_id, item_type, title, description, sequence)
select s.id, 'custom_task', 'Set up your workstation', 'Confirm your laptop, email and access badges are ready.', 1
from public.onboarding_stages s
join public.organizations o on o.id = s.org_id
where o.slug = 'example-organisation' and s.sequence = 1
on conflict (stage_id, sequence) do nothing;

insert into public.onboarding_stage_items (stage_id, item_type, training_module_id, title, description, sequence)
select s.id, 'training_module', tm.id, tm.title, 'Complete this to move on to the next stage.', 1
from public.onboarding_stages s
join public.organizations o on o.id = s.org_id
join public.training_modules tm on tm.org_id = o.id
where o.slug = 'example-organisation' and s.sequence = 2
order by tm.created_at
limit 1
on conflict (stage_id, sequence) do nothing;

insert into public.onboarding_stage_items (stage_id, item_type, title, description, sequence)
select s.id, 'custom_task', 'Meet your manager', 'Have a short introductory call with your manager.', 1
from public.onboarding_stages s
join public.organizations o on o.id = s.org_id
where o.slug = 'example-organisation' and s.sequence = 3
on conflict (stage_id, sequence) do nothing;
