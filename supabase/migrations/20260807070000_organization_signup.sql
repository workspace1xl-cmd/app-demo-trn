-- Self-service organisation signup: any new company can provision its own
-- tenant instead of requiring a manual SQL insert per customer. A new
-- organisation starts with a reusable induction-training curriculum (no
-- company-specific fictional data — no activities, SOPs or mistake-register
-- entries are seeded) so real content is what an administrator adds through
-- the admin console.

create or replace function public.provision_organization(
  p_org_name text,
  p_org_slug text,
  p_admin_full_name text,
  p_admin_email text,
  p_admin_password text
)
returns table(org_id uuid, org_name text, org_slug text, admin_user_id uuid, admin_email text, admin_full_name text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  new_org_id uuid;
  new_admin_id uuid;
  new_department_id uuid;
  new_module_id uuid;
  module_title text;
  clean_slug text;
  clean_name text;
  clean_email text;
begin
  clean_name := btrim(coalesce(p_org_name, ''));
  clean_slug := lower(btrim(coalesce(p_org_slug, '')));
  clean_email := lower(btrim(coalesce(p_admin_email, '')));

  if length(clean_name) < 2 then
    raise exception 'Organisation Name must be at least 2 characters.';
  end if;
  if clean_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'Organisation URL may only contain lowercase letters, numbers and hyphens.';
  end if;
  if length(coalesce(p_admin_full_name, '')) < 2 then
    raise exception 'Full Name must be at least 2 characters.';
  end if;
  if clean_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Enter a valid Email ID.';
  end if;
  if length(coalesce(p_admin_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters.';
  end if;
  if exists (select 1 from public.organizations o where o.slug = clean_slug or o.name = clean_name) then
    raise exception 'An organisation with this name or URL already exists.';
  end if;

  insert into public.organizations(name, slug, settings)
  values (clean_name, clean_slug, jsonb_build_object('passing_score', 80, 'onboarded_via', 'self_signup'))
  returning id into new_org_id;

  -- Starter departments every organisation can rename or extend later.
  insert into public.departments(org_id, name, code)
  select new_org_id, v.name, v.code from (values
    ('Human Resources','HR'),('Information Technology','IT'),('Finance','FIN'),
    ('Operations','OPS'),('Administration','ADM')
  ) v(name, code);

  select id into new_department_id from public.departments d where d.org_id = new_org_id and d.code = 'HR';

  insert into public.app_users(org_id, department_id, email, full_name, role, password_hash)
  values (new_org_id, new_department_id, clean_email, btrim(p_admin_full_name), 'admin', crypt(p_admin_password, gen_salt('bf')))
  returning id into new_admin_id;

  -- Reusable induction curriculum template; content is generic and every
  -- module can be edited, replaced or archived from the admin console.
  for new_module_id, module_title in
    with modules(code, title, objective, duration, sequence) as (
      values
        ('TRN-01','Welcome to the Organisation','Understand the organisation, its history and how it creates value.',8,1),
        ('TRN-02','Vision, Mission & Core Values','Connect daily decisions to the organisation direction.',10,2),
        ('TRN-03','Leadership & Organisation Structure','Know leaders, departments and reporting routes.',9,3),
        ('TRN-04','Culture, Conduct & Expected Behaviour','Apply workplace standards in realistic situations.',12,4),
        ('TRN-05','Code of Ethics','Recognise conflicts, misconduct and speak-up routes.',12,5),
        ('TRN-06','Information Security & Confidentiality','Protect accounts, devices, data and confidential information.',18,6),
        ('TRN-07','Data Privacy & Compliance','Handle personal and regulated data lawfully.',15,7),
        ('TRN-08','Communication Etiquette','Use email, phone and meetings professionally.',16,8),
        ('TRN-09','HR & Office Policies','Find and acknowledge current policies.',12,9),
        ('TRN-10','Leave & Attendance','Use the approved leave and attendance process.',11,10),
        ('TRN-11','Expenses & Reimbursement','Submit complete and timely claims.',10,11),
        ('TRN-12','Asset Allocation, Use & Return','Request, protect and return company assets.',14,12),
        ('TRN-13','IT Support & Access','Use tickets, priority rules and access approval.',12,13),
        ('TRN-14','Procurement & Vendor Onboarding','Follow purchasing and due-diligence controls.',15,14),
        ('TRN-15','Escalation Matrix','Escalate with evidence through the hierarchy.',10,15),
        ('TRN-16','Performance Reviews','Prepare goals, evidence and development actions.',12,16),
        ('TRN-17','Learning & Development','Use role pathways, mentoring and learning opportunities.',8,17),
        ('TRN-18','Employee Benefits','Understand eligibility, enrolment and support.',9,18),
        ('TRN-19','Ownership, Task Closure & Handover','Close work with evidence and accountability.',14,19),
        ('TRN-20','Document & Records Discipline','Name, approve, store and retain records correctly.',13,20),
        ('TRN-21','Meetings & Collaboration','Run purposeful meetings with owners and due dates.',10,21),
        ('TRN-22','Frequently Asked Questions','Resolve common operational questions independently.',8,22)
    )
    insert into public.training_modules(org_id, code, title, objective, duration_minutes, content_type, sequence, status)
    select new_org_id, code, title, objective, duration, 'mixed', sequence, 'published' from modules
    returning id, title
  loop
    insert into public.quiz_questions(org_id, module_id, prompt, options, correct_index, explanation)
    values (
      new_org_id, new_module_id,
      'Which action best demonstrates: ' || module_title || '?',
      '["Use the approved process and documented owner","Ask informally and skip the record","Use a personal channel","Wait without escalating"]'::jsonb,
      0,
      'Use the approved process, official channel and documented owner.'
    );
  end loop;

  return query
    select o.id, o.name, o.slug, u.id, u.email, u.full_name
    from public.organizations o
    join public.app_users u on u.org_id = o.id
    where o.id = new_org_id and u.id = new_admin_id;
end;
$$;

revoke all on function public.provision_organization(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_organization(text, text, text, text, text) to service_role;
