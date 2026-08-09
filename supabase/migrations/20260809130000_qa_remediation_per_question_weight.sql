-- QA REMEDIATION BLOCKER 2: per-question pass thresholds.
--
-- Management: "some questions may be required 100% pass marks, some may
-- be required 75%, some might be required 50%."
--
-- The quiz format here is strictly single-select multiple choice
-- (quiz_questions.correct_index) — a single answer is either right or
-- wrong, so a literal "75% correct on one question" has no meaning for
-- an individual attempt. The closest sound, implementable reading:
-- each question carries its own WEIGHT toward the module's overall
-- score, so a 100%-weighted question that's missed hurts the score far
-- more than a 50%-weighted one — i.e. "required pass marks" describes
-- how much that question counts, not a separate per-question grade.
-- Grading changes from a flat correct/total average to a weighted one;
-- module.passing_score (already existed, untouched) is still the single
-- number the resulting score is compared against.
--
-- Defaults to 100 (full weight, today's existing behaviour) so every
-- question ever created before this migration keeps grading exactly as
-- it did — this is additive, not a silent rescoring of history.

alter table public.quiz_questions add column if not exists weight_percent integer not null default 100;

do $$ begin
  alter table public.quiz_questions add constraint quiz_questions_weight_percent_check
    check (weight_percent > 0 and weight_percent <= 100);
exception when duplicate_object then null; end $$;
