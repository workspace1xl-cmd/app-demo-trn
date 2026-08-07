-- Administrator CRUD and governance support.
-- Adds assignment due dates, an SOP approval workflow, an unresolved-question
-- resolution trail and the privileged functions the Edge API needs to manage
-- employee records. No existing column is dropped or renamed.

-- ---------------------------------------------------------------------------
-- Assignment and due-date management
-- ---------------------------------------------------------------------------
alter table public.enrollments
  add column if not exists due_date date,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by uuid references public.app_users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- SOP editor and approval workflow
-- ---------------------------------------------------------------------------
alter table public.sop_documents
  add column if not exists submitted_by uuid references public.app_users(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by uuid references public.app_users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists review_notes text;

-- ---------------------------------------------------------------------------
-- Unresolved-question governance queue
-- ---------------------------------------------------------------------------
alter table public.knowledge_feedback
  add column if not exists resolution text,
  add column if not exists resolved_by uuid references public.app_users(id) on delete set null,
  add column if not exists resolved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Status vocabularies. Existing seeded rows already satisfy every constraint:
-- enrollments use locked/assigned/in_progress/completed, activities use
-- confirmed, modules use published, SOPs use effective and feedback uses open.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'enrollments_status_check') then
    alter table public.enrollments add constraint enrollments_status_check
      check (status in ('locked','assigned','in_progress','completed','waived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_status_check') then
    alter table public.activities add constraint activities_status_check
      check (status in ('draft','confirmed','archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'training_modules_status_check') then
    alter table public.training_modules add constraint training_modules_status_check
      check (status in ('draft','published','archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sop_documents_status_check') then
    alter table public.sop_documents add constraint sop_documents_status_check
      check (status in ('draft','in_review','approved','effective','archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'knowledge_feedback_status_check') then
    alter table public.knowledge_feedback add constraint knowledge_feedback_status_check
      check (status in ('open','in_review','resolved','dismissed'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Indexes for the new administrator list and filter routes
-- ---------------------------------------------------------------------------
create index if not exists enrollments_org_due_idx on public.enrollments(org_id, due_date) where due_date is not null;
create index if not exists enrollments_assigned_by_idx on public.enrollments(assigned_by);
create index if not exists enrollments_org_status_idx on public.enrollments(org_id, status);
create index if not exists sop_documents_org_status_idx on public.sop_documents(org_id, status);
create index if not exists sop_documents_submitted_by_idx on public.sop_documents(submitted_by);
create index if not exists sop_documents_approved_by_idx on public.sop_documents(approved_by);
create index if not exists knowledge_feedback_org_status_idx on public.knowledge_feedback(org_id, status, created_at desc);
create index if not exists knowledge_feedback_resolved_by_idx on public.knowledge_feedback(resolved_by);
create index if not exists app_users_org_role_idx on public.app_users(org_id, role);
create index if not exists departments_org_idx on public.departments(org_id);
create index if not exists training_modules_org_sequence_idx on public.training_modules(org_id, sequence);

-- ---------------------------------------------------------------------------
-- Privileged employee management. Password hashing stays inside PostgreSQL so
-- no plaintext password is ever handled by application code, and the service
-- role remains the only grantee.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_user(
  p_org_id uuid,
  p_department_id uuid,
  p_email text,
  p_full_name text,
  p_role text,
  p_password text
)
returns table(id uuid, org_id uuid, department_id uuid, email text, full_name text, role text, is_active boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  new_id uuid;
begin
  if p_role not in ('employee','manager','content_admin','admin') then
    raise exception 'Role must be employee, manager, content_admin or admin.';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;
  if p_department_id is not null
     and not exists (select 1 from public.departments d where d.id = p_department_id and d.org_id = p_org_id) then
    raise exception 'Department does not belong to this organisation.';
  end if;

  insert into public.app_users(org_id, department_id, email, full_name, role, password_hash)
  values (p_org_id, p_department_id, lower(btrim(p_email)), btrim(p_full_name), p_role, crypt(p_password, gen_salt('bf')))
  returning app_users.id into new_id;

  return query
    select u.id, u.org_id, u.department_id, u.email, u.full_name, u.role, u.is_active, u.created_at
    from public.app_users u
    where u.id = new_id;
end;
$$;

revoke all on function public.admin_create_user(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_create_user(uuid, uuid, text, text, text, text) to service_role;

create or replace function public.admin_set_password(p_org_id uuid, p_user_id uuid, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  updated_count integer := 0;
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;

  update public.app_users
     set password_hash = crypt(p_password, gen_salt('bf')), updated_at = now()
   where id = p_user_id and org_id = p_org_id;

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    return false;
  end if;

  -- A password change revokes every existing session for that employee.
  delete from public.sessions where user_id = p_user_id and org_id = p_org_id;
  return true;
end;
$$;

revoke all on function public.admin_set_password(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_password(uuid, uuid, text) to service_role;
