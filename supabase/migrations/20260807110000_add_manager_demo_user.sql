-- BUILD PROMPT v4 item 4 (Manager Dashboard): seed a demo "manager" account
-- in the existing example org so the feature is reachable without an admin
-- having to hand-create one. Idempotent — safe to re-run.
insert into public.app_users(org_id,department_id,email,full_name,role,password_hash)
select o.id,d.id,'manager@company.com','Rohan Verma','manager',crypt('Manager123!',gen_salt('bf'))
from public.organizations o
join public.departments d on d.org_id=o.id and d.name='Operations'
where o.slug='example-organisation'
and not exists (select 1 from public.app_users u where u.org_id=o.id and u.email='manager@company.com');
