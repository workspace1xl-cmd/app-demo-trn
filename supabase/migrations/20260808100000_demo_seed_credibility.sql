-- BUILD PROMPT v5 item A2 — the demo data itself was making a working
-- product look broken: every RACI row read "Organisation to confirm"
-- (100% of nodes red, every gap warning firing everywhere), the Manager
-- Dashboard's department-proxy team was a single person, the exec trend
-- chart had at most a couple of points, and the notification bell was
-- always empty. This is a data-only migration against the existing demo
-- org (slug='example-organisation') — no schema change, fully idempotent,
-- safe to re-run. It never touches a real customer tenant: everything is
-- scoped by that slug.

do $$
declare
  v_org_id uuid;
  v_manager_id uuid;
  v_admin_id uuid;
  v_employee_id uuid;
  v_karan_id uuid;
  v_sneha_id uuid;
  v_vikram_id uuid;
  v_isha_id uuid;
begin
  select id into v_org_id from public.organizations where slug = 'example-organisation';
  if v_org_id is null then
    return; -- nothing to refresh against (e.g. a fresh env that hasn't run the core seed yet)
  end if;

  select id into v_admin_id from public.app_users where org_id = v_org_id and email = 'admin@company.com';
  select id into v_manager_id from public.app_users where org_id = v_org_id and email = 'manager@company.com';
  select id into v_employee_id from public.app_users where org_id = v_org_id and email = 'employee@company.com';

  -- Real reports-to hierarchy: manager reports to admin (demonstrates
  -- skip-level rollup), employee reports to manager.
  if v_manager_id is not null and v_admin_id is not null then
    update public.app_users set manager_id = v_admin_id where id = v_manager_id and manager_id is distinct from v_admin_id;
  end if;
  if v_employee_id is not null and v_manager_id is not null then
    update public.app_users set manager_id = v_manager_id where id = v_employee_id and manager_id is distinct from v_manager_id;
  end if;

  -- Four more direct reports across three departments, so "My team" shows
  -- a real, multi-department team instead of one person. Idempotent via
  -- ON CONFLICT on the (org_id, email) unique constraint.
  insert into public.app_users(org_id, department_id, email, full_name, role, password_hash, manager_id)
  select v_org_id, d.id, v.email, v.full_name, 'employee', crypt('Demo123!', gen_salt('bf')), v_manager_id
  from (values
    ('karan.mehta@company.com', 'Karan Mehta', 'Information Technology'),
    ('sneha.iyer@company.com', 'Sneha Iyer', 'Information Technology'),
    ('vikram.rao@company.com', 'Vikram Rao', 'Finance'),
    ('isha.kapoor@company.com', 'Isha Kapoor', 'Operations')
  ) as v(email, full_name, department_name)
  join public.departments d on d.org_id = v_org_id and d.name = v.department_name
  where v_manager_id is not null
  on conflict (org_id, email) do update set manager_id = excluded.manager_id, department_id = excluded.department_id;

  select id into v_karan_id from public.app_users where org_id = v_org_id and email = 'karan.mehta@company.com';
  select id into v_sneha_id from public.app_users where org_id = v_org_id and email = 'sneha.iyer@company.com';
  select id into v_vikram_id from public.app_users where org_id = v_org_id and email = 'vikram.rao@company.com';
  select id into v_isha_id from public.app_users where org_id = v_org_id and email = 'isha.kapoor@company.com';

  -- One curriculum-progress profile per new employee (progressively
  -- deeper than the last), giving the Manager Dashboard's per-member
  -- column real variance instead of four identical rows.
  insert into public.enrollments(org_id, user_id, module_id, status, progress_percent, best_score, completed_at, updated_at)
  select v_org_id, e.user_id, m.id,
    case when m.sequence <= e.threshold then 'completed' when m.sequence = e.threshold + 1 then 'in_progress' else 'locked' end,
    case when m.sequence <= e.threshold then 100 when m.sequence = e.threshold + 1 then 42 else 0 end,
    case when m.sequence = 1 and m.sequence <= e.threshold then 90 when m.sequence = 2 and m.sequence <= e.threshold then 85 end,
    case when m.sequence <= e.threshold then now() - ((e.threshold - m.sequence) || ' days')::interval end,
    -- Karan's in-progress row is additionally backdated 9 days so the
    -- existing "learning_reminder" trigger (7+ days untouched) actually
    -- fires — see the matching Asha Sharma update below.
    case when e.user_id = v_karan_id and m.sequence = e.threshold + 1 then now() - interval '9 days' else now() end
  from (values (v_karan_id, 2), (v_sneha_id, 4), (v_vikram_id, 6), (v_isha_id, 8)) as e(user_id, threshold)
  join public.training_modules m on m.org_id = v_org_id and m.status = 'published'
  where e.user_id is not null
  on conflict (org_id, user_id, module_id) do nothing;

  -- Karan's overdue due_date (Manager Dashboard's overdue count) and
  -- Asha Sharma's existing in-progress row backdated the same way, so
  -- the notification bell has something real to show for both the
  -- employee login and the manager's team, not just a schema that could
  -- theoretically produce a notification.
  update public.enrollments set due_date = current_date - 3
  where org_id = v_org_id and user_id in (v_karan_id, v_employee_id) and status = 'in_progress';
  update public.enrollments set updated_at = now() - interval '9 days'
  where org_id = v_org_id and user_id = v_employee_id and status = 'in_progress';

  -- Two certificates expiring within a week — the other trigger
  -- (certificate_expiry) that was otherwise unreachable in the demo.
  insert into public.certificates(org_id, user_id, module_id, certificate_number, issued_at, expires_at)
  select v_org_id, v_vikram_id, m.id, 'OW-WPB-2026-0002', current_date - 357, current_date + 4
  from public.training_modules m where m.org_id = v_org_id and m.sequence = 1 and v_vikram_id is not null
  on conflict (certificate_number) do nothing;
  insert into public.certificates(org_id, user_id, module_id, certificate_number, issued_at, expires_at)
  select v_org_id, v_isha_id, m.id, 'OW-WPB-2026-0003', current_date - 360, current_date + 6
  from public.training_modules m where m.org_id = v_org_id and m.sequence = 2 and v_isha_id is not null
  on conflict (certificate_number) do nothing;

  -- Named ownership on ~85% of RACI rows, ~15% deliberately left as the
  -- unassigned placeholder so gap detection has a believable minority to
  -- flag instead of firing on literally everything.
  update public.activities a set current_person = v.current_person, backup_person = v.backup_person
  from (values
    ('Applying for Leave', 'Meera Krishnan', 'Ritika Bose'),
    ('Attendance Regularisation', 'Meera Krishnan', 'Ritika Bose'),
    ('Payroll Query', 'Arjun Malhotra', 'Meera Krishnan'),
    ('Employee Referral', 'Ritika Bose', 'Meera Krishnan'),
    ('Laptop / Asset Request', 'Karan Mehta', 'Sneha Iyer'),
    ('Damaged Equipment', 'Sneha Iyer', 'Karan Mehta'),
    ('IT Support Ticket', 'Karan Mehta', 'Sneha Iyer'),
    ('New Software Access', 'Sneha Iyer', 'Karan Mehta'),
    ('Expense Reimbursement', 'Vikram Rao', 'Neha Kapoor'),
    ('Finance Approval', 'Neha Kapoor', 'Vikram Rao'),
    ('Purchase Request', 'Devika Suresh', 'Neha Kapoor'),
    ('Vendor Onboarding', 'Devika Suresh', 'Vikram Rao'),
    ('Travel Approval', 'Farhan Sheikh', 'Devika Suresh'),
    ('Meeting Room Booking', 'Farhan Sheikh', 'Devika Suresh'),
    ('Visitor Management', 'Ananya Das', 'Farhan Sheikh'),
    ('ID / Visiting Card Request', 'Ananya Das', 'Farhan Sheikh'),
    ('Recruitment Request', 'Ritika Bose', 'Meera Krishnan'),
    ('Marketing Support', 'Priya Nair', 'Ananya Das'),
    ('Sales Support', 'Priya Nair', 'Ananya Das')
    -- Deliberately excluded (stay unassigned): Exit Process & Asset
    -- Return, Password / Email Issue, Contract / Legal Approval.
  ) as v(name, current_person, backup_person)
  where a.org_id = v_org_id and a.name = v.name;

  -- 75 days of readiness history so the Exec View trend chart draws a
  -- real line on first open. A gentle upward trend with light
  -- day-to-day noise, not a perfectly straight line.
  insert into public.readiness_snapshots(org_id, score, components, captured_at)
  select v_org_id,
    greatest(0, least(100, round(28 + ((75 - d) / 75.0) * 40 + sin(d * 0.6) * 3)))::int,
    jsonb_build_array(jsonb_build_object('key', 'training', 'label', 'Org-wide training completion', 'percent', greatest(0, least(100, round(28 + ((75 - d) / 75.0) * 40 + sin(d * 0.6) * 3)))::int)),
    current_date - d
  from generate_series(75, 0, -1) as d
  on conflict (org_id, captured_at) do nothing;
end $$;
