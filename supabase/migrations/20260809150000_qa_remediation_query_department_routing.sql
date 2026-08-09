-- QA REMEDIATION BLOCKER 6: query auto-routing / manual assignment to a
-- department.
--
-- Management: "that query goes to the particular department
-- automatically or someone can then assign it to a particular
-- department." Reuses the same signal Knowledge Search already matches
-- queries against — activities.department (a real, existing per-org
-- mapping of topic to department, already maintained by admins) — rather
-- than inventing a separate keyword-routing-rules table from scratch.
-- Auto-routing happens at query-submission time (best-matching
-- activity's department, same ILIKE term-extraction Search already
-- uses); an Admin can always reassign it afterwards from the Feedback
-- Queue, satisfying the "or someone can then assign it" half literally.

alter table public.knowledge_feedback add column if not exists department_id uuid references public.departments(id) on delete set null;
