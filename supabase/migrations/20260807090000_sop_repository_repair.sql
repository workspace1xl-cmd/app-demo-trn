-- Repairs two real data-integrity defects found in a manual QA pass.
--
-- 1. The original demo seed (20260807045910_onework_core.sql) inserted 22
--    RACI activities referencing SOP-01 through SOP-17, but only ever
--    created SOP documents SOP-01 through SOP-10. Seven activities
--    (Travel Approval, Meeting Room Booking, Visitor Management,
--    ID/Visiting Card Request, Contract/Legal Approval, Marketing Support,
--    Sales Support) pointed staff to SOP codes that never existed.
--
-- 2. SOP-01 (Leave & Attendance) was left in 'archived' status with its
--    JSON `content` column overwritten with the literal string
--    "[object Object]" — the result of a bug in the admin SOP edit form
--    (fixed separately in app/platform/AdminConsole.tsx) that submitted
--    every column from the row being edited, coerced through String(),
--    instead of only the fields the form actually exposes. SOP-01 is
--    still the live procedure referenced by 'Applying for Leave' and
--    'Attendance Regularisation' in the RACI matrix, so it must not stay
--    archived or content-corrupted.

update public.sop_documents
set content = jsonb_build_object(
    'purpose', 'Standardise ' || lower(title),
    'scope', 'All employees',
    'steps', jsonb_build_array('Use the official channel', 'Complete required fields', 'Retain evidence', 'Escalate within the published hierarchy'),
    'controls', jsonb_build_array('Owner approval', 'Version control', 'Audit trail')
  ),
  status = 'effective'
where code = 'SOP-01' and (content = '"[object Object]"'::jsonb or status = 'archived');

insert into public.sop_documents(org_id, code, title, department, owner_role, approver_role, version, status, effective_date, review_date, summary, content)
select o.id, v.code, v.title, v.department, v.department || ' process owner', v.department || ' head', '1.0', 'effective', current_date, current_date + 180,
  'Controlled procedure for ' || lower(v.title),
  jsonb_build_object(
    'purpose', 'Standardise ' || lower(v.title),
    'scope', 'All employees',
    'steps', jsonb_build_array('Use the official channel', 'Complete required fields', 'Retain evidence', 'Escalate within the published hierarchy'),
    'controls', jsonb_build_array('Owner approval', 'Version control', 'Audit trail')
  )
from public.organizations o
cross join (values
  ('SOP-11', 'Travel Approval', 'Administration'),
  ('SOP-12', 'Meeting Room Booking', 'Administration'),
  ('SOP-13', 'Visitor Management', 'Administration'),
  ('SOP-14', 'ID / Visiting Card Request', 'Administration'),
  ('SOP-15', 'Contract / Legal Approval', 'Legal & Compliance'),
  ('SOP-16', 'Marketing Support', 'Marketing'),
  ('SOP-17', 'Sales Support', 'Sales')
) v(code, title, department)
where o.slug = 'example-organisation'
on conflict (org_id, code) do nothing;

insert into public.knowledge_chunks(org_id, source_type, source_id, title, content, metadata)
select s.org_id, 'sop', s.id, s.code || ' · ' || s.title, s.summary, jsonb_build_object('department', s.department, 'version', s.version)
from public.sop_documents s
where s.code in ('SOP-11','SOP-12','SOP-13','SOP-14','SOP-15','SOP-16','SOP-17')
  and not exists (select 1 from public.knowledge_chunks k where k.org_id = s.org_id and k.source_type = 'sop' and k.source_id = s.id);

-- 3. Certificate expiry was computed as refresher_months * 30 days
-- (5 days short of a true year for the default 12-month refresher). The
-- Edge Function calculation is fixed separately; this recomputes expiry
-- for certificates already issued under the old formula, using proper
-- calendar-month arithmetic from the true issue date.
update public.certificates c
set expires_at = (c.issued_at + (m.refresher_months || ' months')::interval)::date
from public.training_modules m
where m.id = c.module_id and m.org_id = c.org_id
  and c.expires_at = (c.issued_at + (m.refresher_months * 30 || ' days')::interval)::date;
