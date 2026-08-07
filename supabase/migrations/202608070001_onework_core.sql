create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, code text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,name), unique(org_id,code)
);

create table public.app_users (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid references public.departments(id), email text not null, full_name text not null, role text not null default 'employee',
  password_hash text not null, is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,email), check(role in ('employee','manager','content_admin','admin'))
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade, token_hash text not null unique,
  expires_at timestamptz not null, created_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, department text not null, responsible_role text not null, current_person text not null default 'Organisation to confirm',
  backup_person text not null default 'Department backup', contact_details text not null, sla text not null,
  escalation_level_1 text not null, escalation_level_2 text not null, related_documents jsonb not null default '[]'::jsonb,
  sop_link text, training_module_link text, process_steps jsonb not null default '[]'::jsonb, status text not null default 'confirmed',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(org_id,name)
);

create table public.sop_documents (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null, title text not null, department text not null, owner_role text not null, approver_role text not null,
  version text not null default '1.0', status text not null default 'draft', effective_date date, review_date date,
  summary text not null, content jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,code)
);

create table public.training_modules (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null, title text not null, objective text not null, duration_minutes integer not null check(duration_minutes>0),
  content_type text not null default 'text', content jsonb not null default '{}'::jsonb, passing_score integer not null default 80 check(passing_score between 0 and 100),
  refresher_months integer not null default 12, sequence integer not null, is_mandatory boolean not null default true,
  status text not null default 'published', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,code), unique(org_id,sequence)
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  module_id uuid not null references public.training_modules(id) on delete cascade, prompt text not null, options jsonb not null,
  correct_index integer not null, explanation text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade, module_id uuid not null references public.training_modules(id) on delete cascade,
  status text not null default 'locked', progress_percent integer not null default 0 check(progress_percent between 0 and 100),
  best_score integer, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(org_id,user_id,module_id)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade, module_id uuid not null references public.training_modules(id) on delete cascade,
  score integer not null, passed boolean not null, answers jsonb not null, created_at timestamptz not null default now()
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade, module_id uuid not null references public.training_modules(id) on delete cascade,
  certificate_number text not null unique, issued_at date not null default current_date, expires_at date, created_at timestamptz not null default now(), unique(org_id,user_id,module_id)
);

create table public.knowledge_feedback (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade, query text not null, reason text not null,
  status text not null default 'open', routed_to text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.app_users(id) on delete set null, action text not null, entity_type text not null,
  entity_id uuid, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null, source_id uuid not null, title text not null, content text not null,
  embedding vector(1536), metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index activities_org_department_idx on public.activities(org_id,department);
create index activities_name_trgm_idx on public.activities using gin(name gin_trgm_ops);
create index sops_title_trgm_idx on public.sop_documents using gin(title gin_trgm_ops);
create index modules_title_trgm_idx on public.training_modules using gin(title gin_trgm_ops);
create index knowledge_chunks_org_idx on public.knowledge_chunks(org_id,source_type);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks using hnsw (embedding vector_cosine_ops) where embedding is not null;
create index audit_events_org_created_idx on public.audit_events(org_id,created_at desc);

alter table public.organizations enable row level security;
alter table public.departments enable row level security;
alter table public.app_users enable row level security;
alter table public.sessions enable row level security;
alter table public.activities enable row level security;
alter table public.sop_documents enable row level security;
alter table public.training_modules enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.enrollments enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.certificates enable row level security;
alter table public.knowledge_feedback enable row level security;
alter table public.audit_events enable row level security;
alter table public.knowledge_chunks enable row level security;

create or replace function public.authenticate_onework_user(p_email text, p_password text, p_org_slug text)
returns table(id uuid, org_id uuid, full_name text, email text, role text)
language sql security definer set search_path=public,extensions as $$
  select u.id,u.org_id,u.full_name,u.email,u.role from public.app_users u
  join public.organizations o on o.id=u.org_id
  where lower(u.email)=lower(p_email) and o.slug=p_org_slug and o.status='active' and u.is_active
    and u.password_hash=crypt(p_password,u.password_hash) limit 1;
$$;
revoke all on function public.authenticate_onework_user(text,text,text) from public,anon,authenticated;
grant execute on function public.authenticate_onework_user(text,text,text) to service_role;

create or replace function public.match_knowledge(p_org_id uuid,p_query_embedding vector(1536),p_limit integer default 8)
returns table(id uuid,source_type text,source_id uuid,title text,content text,similarity float)
language sql stable security definer set search_path=public as $$
  select k.id,k.source_type,k.source_id,k.title,k.content,1-(k.embedding <=> p_query_embedding) similarity
  from public.knowledge_chunks k where k.org_id=p_org_id and k.embedding is not null
  order by k.embedding <=> p_query_embedding limit greatest(1,least(p_limit,20));
$$;
revoke all on function public.match_knowledge(uuid,vector,integer) from public,anon,authenticated;
grant execute on function public.match_knowledge(uuid,vector,integer) to service_role;

insert into public.organizations(name,slug,settings) values ('Example Organisation','example-organisation','{"brand":"OneWork","passing_score":80}'::jsonb);

insert into public.departments(org_id,name,code)
select o.id,v.name,v.code from public.organizations o cross join (values
('Human Resources','HR'),('Information Technology','IT'),('Finance','FIN'),('Procurement','PROC'),('Administration','ADM'),('Legal & Compliance','LEGAL'),('Marketing','MKT'),('Sales','SALES'),('Operations','OPS')) v(name,code)
where o.slug='example-organisation';

insert into public.app_users(org_id,department_id,email,full_name,role,password_hash)
select o.id,d.id,v.email,v.full_name,v.role,crypt(v.password,gen_salt('bf')) from public.organizations o
cross join (values ('employee@company.com','Asha Sharma','employee','Demo123!','Operations'),('admin@company.com','Company Admin','admin','Admin123!','Human Resources')) v(email,full_name,role,password,department)
join public.departments d on d.org_id=o.id and d.name=v.department where o.slug='example-organisation';

insert into public.training_modules(org_id,code,title,objective,duration_minutes,content_type,sequence)
select o.id,v.code,v.title,v.objective,v.duration,'mixed',v.sequence from public.organizations o cross join (values
('TRN-01','Welcome to the Organisation','Understand the organisation, its history and how it creates value',8,1),
('TRN-02','Vision, Mission & Core Values','Connect daily decisions to the organisation direction',10,2),
('TRN-03','Leadership & Organisation Structure','Know leaders, departments and reporting routes',9,3),
('TRN-04','Culture, Conduct & Expected Behaviour','Apply workplace standards in realistic situations',12,4),
('TRN-05','Code of Ethics','Recognise conflicts, misconduct and speak-up routes',12,5),
('TRN-06','Information Security & Confidentiality','Protect accounts, devices, data and confidential information',18,6),
('TRN-07','Data Privacy & Compliance','Handle personal and regulated data lawfully',15,7),
('TRN-08','Communication Etiquette','Use email, WhatsApp, phone and meetings professionally',16,8),
('TRN-09','HR & Office Policies','Find and acknowledge current policies',12,9),
('TRN-10','Leave & Attendance','Use the approved leave and attendance process',11,10),
('TRN-11','Expenses & Reimbursement','Submit complete and timely claims',10,11),
('TRN-12','Asset Allocation, Use & Return','Request, protect and return company assets',14,12),
('TRN-13','IT Support & Access','Use tickets, priority rules and access approval',12,13),
('TRN-14','Procurement & Vendor Onboarding','Follow purchasing and due-diligence controls',15,14),
('TRN-15','Escalation Matrix','Escalate with evidence through the hierarchy',10,15),
('TRN-16','Performance Reviews','Prepare goals, evidence and development actions',12,16),
('TRN-17','Learning & Development','Use role pathways, mentoring and learning opportunities',8,17),
('TRN-18','Employee Benefits','Understand eligibility, enrolment and support',9,18),
('TRN-19','Ownership, Task Closure & Handover','Close work with evidence and accountability',14,19),
('TRN-20','Document & Records Discipline','Name, approve, store and retain records correctly',13,20),
('TRN-21','Meetings & Collaboration','Run purposeful meetings with owners and due dates',10,21),
('TRN-22','Frequently Asked Questions','Resolve common operational questions independently',8,22)
) v(code,title,objective,duration,sequence) where o.slug='example-organisation';

insert into public.quiz_questions(org_id,module_id,prompt,options,correct_index,explanation)
select m.org_id,m.id,'Which action best demonstrates: '||m.title||'?','["Use the approved process and documented owner","Ask informally and skip the record","Use a personal channel","Wait without escalating"]'::jsonb,0,'Use the approved process, official channel and documented owner.' from public.training_modules m;

insert into public.enrollments(org_id,user_id,module_id,status,progress_percent,best_score,completed_at)
select m.org_id,u.id,m.id,case when m.sequence<=2 then 'completed' when m.sequence=3 then 'in_progress' else 'locked' end,
case when m.sequence<=2 then 100 when m.sequence=3 then 42 else 0 end,case when m.sequence=1 then 90 when m.sequence=2 then 85 end,
case when m.sequence<=2 then now() end from public.training_modules m join public.app_users u on u.org_id=m.org_id and u.email='employee@company.com';

insert into public.certificates(org_id,user_id,module_id,certificate_number,issued_at,expires_at)
select m.org_id,u.id,m.id,'OW-WPB-2026-0001',current_date-20,current_date+345 from public.training_modules m join public.app_users u on u.org_id=m.org_id and u.email='employee@company.com' where m.code='TRN-01';

insert into public.activities(org_id,name,department,responsible_role,contact_details,sla,escalation_level_1,escalation_level_2,sop_link,training_module_link,backup_person,related_documents,process_steps)
select o.id,v.name,v.department,v.role,v.contact,v.sla,v.l1,v.l2,v.sop,v.module,v.department||' backup',jsonb_build_array(v.sop||' form or checklist'),
jsonb_build_array('Open the official request channel','Provide required information and evidence','Track the published SLA','Escalate through the documented hierarchy')
from public.organizations o cross join (values
('Applying for Leave','Human Resources','HR Executive','hr-helpdesk@company.com','2 business days','HR Manager','Head of HR','SOP-01','TRN-10'),
('Attendance Regularisation','Human Resources','HR Executive','hr-helpdesk@company.com','2 business days','HR Manager','Head of HR','SOP-01','TRN-10'),
('Payroll Query','Human Resources','Payroll Specialist','payroll@company.com','3 business days','HR Manager','Head of HR','SOP-06','TRN-09'),
('Employee Referral','Human Resources','Talent Acquisition Lead','careers@company.com','5 business days','HR Manager','Head of HR','SOP-09','TRN-03'),
('Exit Process & Asset Return','Human Resources','HR Operations Lead','hr-helpdesk@company.com','As per notice','HR Manager','Head of HR','SOP-05','TRN-12'),
('Laptop / Asset Request','Information Technology','IT Asset Coordinator','it-support@company.com','3 business days','IT Manager','Head of IT','SOP-02','TRN-12'),
('Damaged Equipment','Information Technology','IT Service Desk','it-support@company.com','4 business hours','IT Manager','Head of IT','SOP-03','TRN-13'),
('IT Support Ticket','Information Technology','IT Support Engineer','it-support@company.com','1 business day','IT Manager','Head of IT','SOP-03','TRN-13'),
('New Software Access','Information Technology','IT Administrator','it-support@company.com','2 business days','IT Manager','Head of IT','SOP-04','TRN-13'),
('Password / Email Issue','Information Technology','IT Service Desk','it-support@company.com','4 business hours','IT Manager','Head of IT','SOP-03','TRN-06'),
('Expense Reimbursement','Finance','Accounts Payable Specialist','expenses@company.com','Next pay cycle','Finance Manager','CFO','SOP-10','TRN-11'),
('Finance Approval','Finance','Finance Business Partner','finance@company.com','3 business days','Finance Manager','CFO','SOP-07','TRN-11'),
('Purchase Request','Procurement','Procurement Executive','procurement@company.com','5 business days','Procurement Manager','COO','SOP-07','TRN-14'),
('Vendor Onboarding','Procurement','Vendor Management Lead','vendors@company.com','10 business days','Procurement Manager','COO','SOP-08','TRN-14'),
('Travel Approval','Administration','Travel Coordinator','travel@company.com','3 business days','Admin Manager','COO','SOP-11','TRN-09'),
('Meeting Room Booking','Administration','Facilities Coordinator','facilities@company.com','Same day','Admin Manager','COO','SOP-12','TRN-21'),
('Visitor Management','Administration','Front Office Executive','reception@company.com','1 business day','Admin Manager','COO','SOP-13','TRN-09'),
('ID / Visiting Card Request','Administration','Admin Executive','admin@company.com','5 business days','Admin Manager','COO','SOP-14','TRN-09'),
('Contract / Legal Approval','Legal & Compliance','Legal Counsel','legal@company.com','7 business days','Legal Manager','General Counsel','SOP-15','TRN-07'),
('Recruitment Request','Human Resources','Talent Acquisition Lead','careers@company.com','5 business days','HR Manager','Head of HR','SOP-09','TRN-03'),
('Marketing Support','Marketing','Marketing Operations Lead','marketing@company.com','5 business days','Marketing Head','COO','SOP-16','TRN-15'),
('Sales Support','Sales','Sales Operations Lead','salesops@company.com','3 business days','Sales Head','COO','SOP-17','TRN-15')
) v(name,department,role,contact,sla,l1,l2,sop,module) where o.slug='example-organisation';

insert into public.sop_documents(org_id,code,title,department,owner_role,approver_role,version,status,effective_date,review_date,summary,content)
select o.id,v.code,v.title,v.department,v.department||' process owner',v.department||' head','1.0','effective',current_date,current_date+180,'Controlled procedure for '||lower(v.title),
jsonb_build_object('purpose','Standardise '||lower(v.title),'scope','All employees','steps',jsonb_build_array('Use the official channel','Complete required fields','Retain evidence','Escalate within the published hierarchy'),'controls',jsonb_build_array('Owner approval','Version control','Audit trail'))
from public.organizations o cross join (values
('SOP-01','Leave & Attendance','Human Resources'),('SOP-02','Asset Request, Allocation & Return','Information Technology'),('SOP-03','IT Support & Incident Triage','Information Technology'),('SOP-04','Software Access & Permissions','Information Technology'),('SOP-05','Employee Exit & Handover','Human Resources'),('SOP-06','Payroll Query Resolution','Human Resources'),('SOP-07','Purchase & Finance Approval','Finance / Procurement'),('SOP-08','Vendor Onboarding & Changes','Procurement'),('SOP-09','Recruitment & Referral','Human Resources'),('SOP-10','Expense Reimbursement','Finance')) v(code,title,department) where o.slug='example-organisation';

insert into public.knowledge_chunks(org_id,source_type,source_id,title,content,metadata)
select a.org_id,'activity',a.id,a.name,a.name||'. Owner: '||a.responsible_role||'. Contact: '||a.contact_details||'. SLA: '||a.sla||'. Escalation: '||a.escalation_level_1||' then '||a.escalation_level_2,jsonb_build_object('sop',a.sop_link,'training',a.training_module_link) from public.activities a;
insert into public.knowledge_chunks(org_id,source_type,source_id,title,content,metadata)
select s.org_id,'sop',s.id,s.code||' · '||s.title,s.summary,jsonb_build_object('department',s.department,'version',s.version) from public.sop_documents s;
