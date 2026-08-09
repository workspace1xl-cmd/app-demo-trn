-- BUILD PROMPT v5 BLOCK E: SOP Content-Level Linking
--
-- Extends the same "plain URL into SOPGalaxy, not a record OneWork owns"
-- pattern already used on activities.sop_link (see
-- 20260807100000_drop_sop_repository.sql) to three more places: Content
-- Library items, Training Modules, and Rules. Deliberately two columns,
-- not one — sop_url is the actual link, sop_label is what the "View SOP
-- for this" button/link says (defaults to that exact phrase client-side
-- when left blank, so admins aren't forced to type a label for every
-- single item).
--
-- No new table, no ownership, no validation beyond "is it present" — this
-- app still does not run its own SOP repository. That was a deliberate
-- decision made and documented before this block, not something to
-- quietly re-introduce here.

alter table public.content_assets add column if not exists sop_url text;
alter table public.content_assets add column if not exists sop_label text;

alter table public.training_modules add column if not exists sop_url text;
alter table public.training_modules add column if not exists sop_label text;

alter table public.rules add column if not exists sop_url text;
alter table public.rules add column if not exists sop_label text;
