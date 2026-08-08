-- BUILD PROMPT v5, item A3: real reports-to hierarchy.
--
-- Department is not a reporting line — multiple managers can share a
-- department, and people report across departments constantly. The
-- Manager Dashboard (BUILD PROMPT v4 item 4) was built on department_id
-- as a stand-in because no reporting relationship existed yet; this adds
-- the real one and the dashboard is switched over in the same deploy that
-- ships this migration (see supabase/functions/onework-api/index.ts).
--
-- Self-referencing FK, nullable (most orgs will have some unassigned
-- reports during rollout — that's a real state, not an error).
-- `on delete set null` rather than cascade: deleting a manager's account
-- must not cascade-delete every person who reported to them.
alter table public.app_users add column if not exists manager_id uuid references public.app_users(id) on delete set null;
create index if not exists app_users_manager_idx on public.app_users(manager_id);

-- A user cannot be their own manager, directly. (Cycles of length >1 are
-- still possible at the DB level — real org charts occasionally have data
-- errors — so the API additionally caps hierarchy traversal depth rather
-- than relying solely on this constraint.)
alter table public.app_users add constraint app_users_manager_not_self check (manager_id is distinct from id);
