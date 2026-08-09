-- BUILD PROMPT v5 BLOCK F: Assessment Engine
--
-- Real attempt caps, not just a passing_score threshold (which already
-- existed on training_modules before this block). Adds:
--   1. An org-wide default max attempts, with a per-module override.
--   2. A genuine block: exceed the cap without passing and the employee
--      is locked out of further attempts until an admin resets them —
--      not just a client-side "try again" loop with no real limit.
--   3. attempts_reset_at, so a reset genuinely clears the counter
--      (attempts before the reset timestamp don't count towards a new
--      cap) rather than the block being permanent once tripped, or a
--      reset requiring the attempt history itself to be deleted.
--
-- quiz_attempts already exists (from the original schema) and needed no
-- changes — attempts-used is computed by counting rows created after
-- enrollments.attempts_reset_at, not by adding a redundant counter
-- column that could drift out of sync with the real attempt log.

alter table public.organizations add column if not exists default_max_quiz_attempts integer not null default 3;
alter table public.training_modules add column if not exists max_attempts integer;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'training_modules_max_attempts_check') then
    alter table public.training_modules add constraint training_modules_max_attempts_check check (max_attempts is null or max_attempts > 0);
  end if;
end
$$;

alter table public.enrollments add column if not exists onboarding_blocked boolean not null default false;
alter table public.enrollments add column if not exists attempts_reset_at timestamptz;
