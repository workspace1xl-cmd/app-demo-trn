-- BUILD PROMPT v5 BLOCK G: Suggestion & Query Engine
--
-- Reuses knowledge_feedback (the Feedback Queue) as the single unified
-- "submissions" surface for both queries and suggestions, rather than
-- forking a parallel table — it already has org/user scoping, RLS, an
-- admin resolution trail (resolution/resolved_by/resolved_at) and a
-- routed_to field for auto-routing. type distinguishes the two:
--   'query'      -- the existing "I asked something and it needs a human"
--                   escalation flow. Untouched: still open/in_review/
--                   resolved/dismissed, exactly as before this migration.
--   'suggestion' -- new. Uses the 5-state lifecycle Block D's
--                   rule_change_suggestions already established
--                   (submitted -> under_review -> accepted/rejected ->
--                   implementation_pending -> implemented) — the same
--                   vocabulary app-wide, not a second one invented here.
--                   Block D's table is left as-is (it's rule-specific,
--                   with its own admin review screen already shipped);
--                   this is the general-purpose version for anything
--                   that isn't tied to a specific rule.
--
-- The status column becomes a superset of both vocabularies rather than
-- forcing a breaking rename of the four values every existing Feedback
-- Queue query/UI/audit-log entry already depends on.

alter table public.knowledge_feedback add column if not exists type text not null default 'query';
alter table public.knowledge_feedback add column if not exists target_implementation_date date;
alter table public.knowledge_feedback add column if not exists rejection_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'knowledge_feedback_type_check') then
    alter table public.knowledge_feedback add constraint knowledge_feedback_type_check
      check (type in ('query', 'suggestion'));
  end if;
end
$$;

alter table public.knowledge_feedback drop constraint if exists knowledge_feedback_status_check;
alter table public.knowledge_feedback add constraint knowledge_feedback_status_check
  check (status in ('open', 'in_review', 'resolved', 'dismissed', 'submitted', 'under_review', 'accepted', 'rejected', 'implementation_pending', 'implemented'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'knowledge_feedback_rejection_reason_required') then
    alter table public.knowledge_feedback add constraint knowledge_feedback_rejection_reason_required
      check (status <> 'rejected' or rejection_reason is not null);
  end if;
end
$$;

create index if not exists knowledge_feedback_org_type_idx on public.knowledge_feedback(org_id, type, status);

-- BUILD PROMPT v5 BLOCK G: notification integration — a submitter gets a
-- real in-app notification when their submission's status changes, using
-- the same notification_outbox table the bell dropdown already reads
-- (see 20260807120000_notification_read_state.sql's header comment for
-- why this is reused rather than a parallel table).
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('learning_reminder', 'certificate_expiry', 'knowledge_feedback', 'submission_update'));
