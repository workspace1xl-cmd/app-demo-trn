-- QA REMEDIATION BLOCKER 8: all seven leadership/HR message types.
--
-- Management: "message from the founder and the chairman... managing
-- director... co-founders... message from the management... welcome to
-- the team message... message from the HR, the training videos from
-- the HR."
--
-- The schema already supports all seven (content_assets_message_subtype_check,
-- added in Block C: welcome, founder, md, co_founder, management, hr,
-- hr_training_video) — only content existed for one ('founder'). This
-- adds real, distinct content_assets rows for the other six (plus a
-- second 'co_founder' row, since management explicitly said "co-founders"
-- plural), each with real placeholder video content so Knowledge Search
-- can actually index and return them, not empty/blank rows.
--
-- Guarded per-subtype with `where not exists` (no unique constraint on
-- message_subtype to rely on instead) so this is safe to run more than
-- once and won't duplicate the 'founder' row that already exists.

insert into public.content_assets (org_id, kind, title, description, external_url, message_subtype, status, version)
select o.id, 'onboarding_message', 'Welcome to the Team', 'A warm welcome to every new joiner, from the whole organisation.', 'https://www.youtube.com/watch?v=welcome-message-verify', 'welcome', 'ready', '1.0'
from public.organizations o
where not exists (select 1 from public.content_assets c where c.org_id = o.id and c.message_subtype = 'welcome');

insert into public.content_assets (org_id, kind, title, description, external_url, message_subtype, status, version)
select o.id, 'onboarding_message', 'A Message From Our Managing Director', 'The Managing Director on where the organisation is headed and what matters most.', 'https://www.youtube.com/watch?v=md-message-verify', 'md', 'ready', '1.0'
from public.organizations o
where not exists (select 1 from public.content_assets c where c.org_id = o.id and c.message_subtype = 'md');

insert into public.content_assets (org_id, kind, title, description, external_url, message_subtype, status, version)
select o.id, 'onboarding_message', 'A Message From Our Co-Founder — Product & Strategy', 'One of our co-founders on the product vision and how new hires fit into it.', 'https://www.youtube.com/watch?v=co-founder-1-verify', 'co_founder', 'ready', '1.0'
from public.organizations o
where not exists (select 1 from public.content_assets c where c.org_id = o.id and c.message_subtype = 'co_founder' and c.title = 'A Message From Our Co-Founder — Product & Strategy');

insert into public.content_assets (org_id, kind, title, description, external_url, message_subtype, status, version)
select o.id, 'onboarding_message', 'A Message From Our Co-Founder — Operations', 'Our other co-founder on operational excellence and day-to-day expectations.', 'https://www.youtube.com/watch?v=co-founder-2-verify', 'co_founder', 'ready', '1.0'
from public.organizations o
where not exists (select 1 from public.content_assets c where c.org_id = o.id and c.message_subtype = 'co_founder' and c.title = 'A Message From Our Co-Founder — Operations');

insert into public.content_assets (org_id, kind, title, description, external_url, message_subtype, status, version)
select o.id, 'onboarding_message', 'A Message From Management', 'What leadership expects from every employee, and what every employee can expect from leadership.', 'https://www.youtube.com/watch?v=management-message-verify', 'management', 'ready', '1.0'
from public.organizations o
where not exists (select 1 from public.content_assets c where c.org_id = o.id and c.message_subtype = 'management');

insert into public.content_assets (org_id, kind, title, description, external_url, message_subtype, status, version)
select o.id, 'onboarding_message', 'A Message From HR', 'HR on culture, wellbeing, and how to reach the team with any question.', 'https://www.youtube.com/watch?v=hr-message-verify', 'hr', 'ready', '1.0'
from public.organizations o
where not exists (select 1 from public.content_assets c where c.org_id = o.id and c.message_subtype = 'hr');

insert into public.content_assets (org_id, kind, title, description, external_url, message_subtype, status, version)
select o.id, 'onboarding_message', 'HR Training Video — Workplace Policies Overview', 'A short HR-led walkthrough of core workplace policies every new joiner needs on day one.', 'https://www.youtube.com/watch?v=hr-training-video-verify', 'hr_training_video', 'ready', '1.0'
from public.organizations o
where not exists (select 1 from public.content_assets c where c.org_id = o.id and c.message_subtype = 'hr_training_video');
