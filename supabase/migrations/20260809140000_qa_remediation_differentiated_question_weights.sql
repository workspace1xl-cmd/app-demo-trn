-- QA REMEDIATION BLOCKER 2 (data): differentiated per-question weights,
-- actually populated on real content, not just a schema field nobody set.
--
-- Every training module was seeded (20260807045910_onework_core.sql)
-- with exactly one generic templated question — there is nothing to
-- "differentiate" within a single-question module, so a real
-- demonstration of this fix needs more than one question per module.
-- This adds two module-specific questions to each of the three modules
-- QA tested, alongside the existing seeded question, with real
-- differentiated weights (100 / 75 / 50) — not filler text.
--
-- quiz_questions has no unique constraint on (module_id, prompt), so a
-- plain INSERT here would silently duplicate rows on re-run — each
-- insert is guarded with `where not exists (...)` keyed on prompt text
-- so this migration is safe to run more than once.

-- TRN-03: Leadership & Organisation Structure. Existing seeded question
-- keeps its default weight (100, unchanged). Two new questions added at
-- 75 and 50.
insert into public.quiz_questions(org_id, module_id, prompt, options, correct_index, explanation, weight_percent)
select m.org_id, m.id,
  'Who is the correct first point of escalation when your manager is unavailable and a decision cannot wait?',
  '["Your manager''s manager, through the documented escalation route","A colleague in a different department","Nobody — wait until your manager is back","Post about it in a general chat channel"]'::jsonb,
  0, 'Escalation follows the documented reporting line, not an informal workaround.', 75
from public.training_modules m
where m.code = 'TRN-03'
  and not exists (select 1 from public.quiz_questions q where q.module_id = m.id and q.prompt = 'Who is the correct first point of escalation when your manager is unavailable and a decision cannot wait?');

insert into public.quiz_questions(org_id, module_id, prompt, options, correct_index, explanation, weight_percent)
select m.org_id, m.id,
  'Where should you look to confirm who owns a specific business activity or process?',
  '["The Responsibility Matrix","Ask around informally until someone knows","Guess based on job title","There is no reliable way to find this"]'::jsonb,
  0, 'The Responsibility Matrix is the single source of truth for ownership.', 50
from public.training_modules m
where m.code = 'TRN-03'
  and not exists (select 1 from public.quiz_questions q where q.module_id = m.id and q.prompt = 'Where should you look to confirm who owns a specific business activity or process?');

-- TRN-04: Culture, Conduct & Expected Behaviour. This module's core
-- topic (professional conduct) gets the heaviest new question.
insert into public.quiz_questions(org_id, module_id, prompt, options, correct_index, explanation, weight_percent)
select m.org_id, m.id,
  'You notice a colleague being treated unfairly in a meeting. What is the expected response?',
  '["Raise it through the appropriate channel — your manager or HR","Say nothing, it is not your concern","Discuss it publicly on a team channel","Confront the other person directly in the meeting"]'::jsonb,
  0, 'Conduct concerns are raised through the proper channel, protecting everyone involved.', 100
from public.training_modules m
where m.code = 'TRN-04'
  and not exists (select 1 from public.quiz_questions q where q.module_id = m.id and q.prompt = 'You notice a colleague being treated unfairly in a meeting. What is the expected response?');

insert into public.quiz_questions(org_id, module_id, prompt, options, correct_index, explanation, weight_percent)
select m.org_id, m.id,
  'Which of these best reflects the organisation''s expected standard of dress and conduct in client-facing settings?',
  '["Whatever the department''s published guidance specifies","Whatever is most comfortable regardless of setting","There is no standard, use personal judgement only","Only follow the standard if a client explicitly asks"]'::jsonb,
  0, 'Department-published guidance is the standard, not personal judgement alone.', 50
from public.training_modules m
where m.code = 'TRN-04'
  and not exists (select 1 from public.quiz_questions q where q.module_id = m.id and q.prompt = 'Which of these best reflects the organisation''s expected standard of dress and conduct in client-facing settings?');

-- TRN-09: HR & Office Policies. Leave/attendance policy accuracy is the
-- highest-stakes topic in this module, so it carries full weight.
insert into public.quiz_questions(org_id, module_id, prompt, options, correct_index, explanation, weight_percent)
select m.org_id, m.id,
  'Where do you find the authoritative source for leave entitlement and approval process?',
  '["The published HR & Office Policies documentation","Whatever your manager remembers verbally","Ask a colleague what they did last time","There is no documented policy"]'::jsonb,
  0, 'The published HR policy documentation is authoritative, not verbal recollection.', 100
from public.training_modules m
where m.code = 'TRN-09'
  and not exists (select 1 from public.quiz_questions q where q.module_id = m.id and q.prompt = 'Where do you find the authoritative source for leave entitlement and approval process?');

insert into public.quiz_questions(org_id, module_id, prompt, options, correct_index, explanation, weight_percent)
select m.org_id, m.id,
  'What is the correct action if you will be more than 30 minutes late with no prior notice option?',
  '["Notify your manager as soon as possible through the documented channel","Wait until you arrive to explain in person","Do nothing, arriving is enough","Ask a colleague to inform your manager verbally, informally"]'::jsonb,
  0, 'Prompt, direct notification through the documented channel is expected.', 75
from public.training_modules m
where m.code = 'TRN-09'
  and not exists (select 1 from public.quiz_questions q where q.module_id = m.id and q.prompt = 'What is the correct action if you will be more than 30 minutes late with no prior notice option?');
