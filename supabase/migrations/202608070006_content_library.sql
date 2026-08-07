-- Content library: uploadable documents, video tutorials, controlled SOP files,
-- the common-mistake register and bulk import jobs.
--
-- Placeholder rows are marked is_seed = true so that when the organisation
-- survey is finished the real upload cleanly replaces the mock content without
-- touching anything an administrator has since created.

-- ---------------------------------------------------------------------------
-- Uploaded assets (documents, videos, SOP files, templates, register sheets)
-- ---------------------------------------------------------------------------
create table if not exists public.content_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('document','video','sop','mistake_register','template','image')),
  title text not null,
  description text,
  department text,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  version text not null default '1.0',
  status text not null default 'pending'
    check (status in ('pending','uploaded','processing','ready','failed','archived')),
  processing_error text,
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, storage_path)
);

-- ---------------------------------------------------------------------------
-- Common-mistake register. Mock entries now, survey upload later.
-- ---------------------------------------------------------------------------
create table if not exists public.mistake_register (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  title text not null,
  description text not null,
  correct_practice text not null,
  category text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  department text,
  module_id uuid references public.training_modules(id) on delete set null,
  source_asset_id uuid references public.content_assets(id) on delete set null,
  status text not null default 'active' check (status in ('draft','active','archived')),
  is_seed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, code)
);

-- ---------------------------------------------------------------------------
-- Video tutorials, documents and templates attached to a training module
-- ---------------------------------------------------------------------------
create table if not exists public.module_resources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.training_modules(id) on delete cascade,
  asset_id uuid not null references public.content_assets(id) on delete cascade,
  resource_type text not null check (resource_type in ('video','document','template','reference')),
  sequence integer not null default 1 check (sequence > 0),
  created_at timestamptz not null default now(),
  unique(org_id, module_id, asset_id)
);

-- ---------------------------------------------------------------------------
-- Bulk import jobs for survey spreadsheets and document packs
-- ---------------------------------------------------------------------------
create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('mistake_register','sop','activity','employee','module')),
  source_asset_id uuid references public.content_assets(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  failed_rows integer not null default 0,
  replaced_seed boolean not null default false,
  errors jsonb not null default '[]'::jsonb,
  requested_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Row-level security: the Edge Function service role is the only writer.
-- ---------------------------------------------------------------------------
alter table public.content_assets enable row level security;
alter table public.mistake_register enable row level security;
alter table public.module_resources enable row level security;
alter table public.import_jobs enable row level security;

do $$
declare
  target text;
begin
  foreach target in array array['content_assets','mistake_register','module_resources','import_jobs'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = target and policyname = 'deny direct access'
    ) then
      execute format(
        'create policy "deny direct access" on public.%I for all to anon, authenticated using (false) with check (false)',
        target
      );
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists content_assets_org_kind_idx on public.content_assets(org_id, kind, created_at desc);
create index if not exists content_assets_org_status_idx on public.content_assets(org_id, status);
create index if not exists content_assets_uploaded_by_idx on public.content_assets(uploaded_by);
create index if not exists content_assets_title_trgm_idx on public.content_assets using gin(title extensions.gin_trgm_ops);
create index if not exists mistake_register_org_idx on public.mistake_register(org_id, status, category);
create index if not exists mistake_register_module_idx on public.mistake_register(module_id);
create index if not exists mistake_register_source_idx on public.mistake_register(source_asset_id);
create index if not exists mistake_register_title_trgm_idx on public.mistake_register using gin(title extensions.gin_trgm_ops);
create index if not exists module_resources_module_idx on public.module_resources(module_id);
create index if not exists module_resources_asset_idx on public.module_resources(asset_id);
create index if not exists import_jobs_org_idx on public.import_jobs(org_id, created_at desc);
create index if not exists import_jobs_asset_idx on public.import_jobs(source_asset_id);
create index if not exists import_jobs_requested_by_idx on public.import_jobs(requested_by);

-- ---------------------------------------------------------------------------
-- Private storage bucket for uploaded documents and video tutorials.
-- No storage policy is created, so anon and authenticated hold no access at
-- all; the Edge Function service role signs every upload and download.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onework-content',
  'onework-content',
  false,
  524288000,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'text/plain',
    'application/json',
    'image/png',
    'image/jpeg',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

-- ---------------------------------------------------------------------------
-- Mock common-mistake register. Every row is is_seed = true and is replaced in
-- one transaction by the first real survey upload.
-- ---------------------------------------------------------------------------
insert into public.mistake_register (org_id, code, title, description, correct_practice, category, severity, module_id, is_seed)
select o.id, v.code, v.title, v.description, v.correct_practice, v.category, v.severity, m.id, true
from public.organizations o
cross join (values
  ('MIS-001','Using a personal email ID for official work','Official correspondence sent from a personal email account.','Use only the organisation-issued email account for all official communication.','Communication','high','TRN-06'),
  ('MIS-002','Sharing a personal mobile number as the official contact','A personal number is given to vendors or clients instead of the official channel.','Publish only the official contact number or helpdesk channel.','Communication','medium','TRN-08'),
  ('MIS-003','Using a personal laptop without approval','Company data is processed on an unapproved personal device.','Request an approved company asset before handling organisation data.','Information Security','critical','TRN-12'),
  ('MIS-004','Collecting assets outside the authorised process','Assets are handed over informally with no record.','Collect every asset through the documented allocation process and sign the record.','Asset Management','high','TRN-12'),
  ('MIS-005','Incorrect use of Reply All','Recipients who need visibility are dropped, or everyone is copied unnecessarily.','Use Reply All only when every recipient genuinely needs the update.','Communication','low','TRN-08'),
  ('MIS-006','Missing or outdated email signature','Emails carry an old designation, old number or no signature at all.','Keep the approved signature template current and remove superseded details.','Communication','low','TRN-08'),
  ('MIS-007','Ignoring file naming conventions','Files are saved with ad-hoc names that cannot be found later.','Apply the published naming convention to every document.','Records','medium','TRN-20'),
  ('MIS-008','Saving documents outside approved locations','Work is stored on a desktop or personal drive.','Save all work in the approved company location only.','Records','high','TRN-20'),
  ('MIS-009','Storing company data on personal devices','Organisation data is copied to personal phones or drives.','Keep all organisation data inside approved systems.','Information Security','critical','TRN-06'),
  ('MIS-010','Using informal channels for official requests','Requests are made over personal chat instead of the official channel.','Raise every request through the official channel so it is tracked.','Process','medium','TRN-15'),
  ('MIS-011','Bypassing the document approval workflow','Documents are issued before the required approval.','Complete the documented approval workflow before release.','Governance','high','TRN-20'),
  ('MIS-012','Messaging individuals instead of raising a ticket','Support requests are sent directly to a person and are lost.','Raise a ticket so the request is queued, tracked and measured against the SLA.','Process','medium','TRN-13'),
  ('MIS-013','Skipping the escalation hierarchy','Issues are escalated to senior leadership without the first level.','Escalate through the documented hierarchy with evidence at each level.','Process','medium','TRN-15'),
  ('MIS-014','Leaving a workstation unlocked','An unattended desk leaves the system signed in.','Lock the system every time you leave your desk.','Information Security','high','TRN-06'),
  ('MIS-015','Weak password practice and no MFA','Passwords are reused or shared and MFA is not enabled.','Use a unique strong password and enable MFA wherever it is available.','Information Security','critical','TRN-06'),
  ('MIS-016','Poor meeting etiquette','Meetings run without an agenda, owner or recorded actions.','Circulate an agenda, record decisions and assign owners with due dates.','Collaboration','low','TRN-21'),
  ('MIS-017','Work is not documented','Decisions and steps are held only in memory or private chat.','Document the work so any colleague can continue it.','Records','medium','TRN-19'),
  ('MIS-018','Closing tasks without evidence','A task is marked complete before the output is verified.','Close a task only with the agreed evidence attached.','Ownership','medium','TRN-19'),
  ('MIS-019','Unclear ownership of an activity','No named owner, so the activity stalls between teams.','Confirm the named owner and backup in the responsibility matrix.','Ownership','high','TRN-19'),
  ('MIS-020','Sharing confidential information without authorisation','Confidential material is forwarded outside the approved group.','Share confidential information only with the authorised recipients.','Information Security','critical','TRN-07')
) v(code, title, description, correct_practice, category, severity, module_code)
left join public.training_modules m on m.org_id = o.id and m.code = v.module_code
where o.slug = 'example-organisation'
on conflict (org_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- Replace every placeholder register entry with real survey data in one call.
-- ---------------------------------------------------------------------------
create or replace function public.replace_seed_mistake_register(p_org_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed_count integer := 0;
begin
  delete from public.mistake_register where org_id = p_org_id and is_seed;
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.replace_seed_mistake_register(uuid) from public, anon, authenticated;
grant execute on function public.replace_seed_mistake_register(uuid) to service_role;
