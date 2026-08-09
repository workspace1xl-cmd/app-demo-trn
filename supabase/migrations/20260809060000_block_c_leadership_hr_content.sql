-- BUILD PROMPT v5 BLOCK C: Leadership & HR Content Blocks
--
-- Adds "Onboarding Message" as a new Content Library content type, with a
-- sub-type for who it's from (Welcome, Founder, MD, Co-Founder, Management,
-- HR, HR Training Video). Deliberately reuses content_assets rather than a
-- new table: an onboarding message is a document/video/text asset like any
-- other content_assets row (it already supports file uploads AND external
-- links, e.g. a YouTube URL for an HR training video, via
-- 20260807080000_external_content_links.sql) — the only thing genuinely new
-- about it is who it's from, which is exactly what message_subtype records.
--
-- Also lets an onboarding_stage_item (Block B) point at a real content
-- asset instead of only being a bare acknowledge-this-title item — an admin
-- can now assign a specific Welcome Message or HR video into a stage.

alter table public.content_assets drop constraint if exists content_assets_kind_check;
alter table public.content_assets add constraint content_assets_kind_check
  check (kind in ('document','video','sop','mistake_register','template','image','onboarding_message'));

alter table public.content_assets add column if not exists message_subtype text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_assets_message_subtype_check') then
    alter table public.content_assets add constraint content_assets_message_subtype_check
      check (message_subtype is null or message_subtype in ('welcome','founder','md','co_founder','management','hr','hr_training_video'));
  end if;
  -- message_subtype is required for (and only for) kind = 'onboarding_message'
  -- — same "don't let the two columns disagree" pattern as Block B's
  -- item_type/training_module_id check.
  if not exists (select 1 from pg_constraint where conname = 'content_assets_message_subtype_matches_kind') then
    alter table public.content_assets add constraint content_assets_message_subtype_matches_kind
      check (
        (kind = 'onboarding_message' and message_subtype is not null)
        or (kind <> 'onboarding_message' and message_subtype is null)
      );
  end if;
end
$$;

-- BUILD PROMPT v5 BLOCK B integration: a 'content_block' stage item can now
-- reference a real content asset (e.g. the Welcome Message) instead of only
-- carrying its own free-text title. Optional — a content_block item without
-- one still just needs a plain "I've read this" acknowledgment, same as
-- before this migration.
alter table public.onboarding_stage_items add column if not exists content_asset_id uuid references public.content_assets(id);

alter table public.onboarding_stage_items drop constraint if exists onboarding_stage_items_check;
alter table public.onboarding_stage_items add constraint onboarding_stage_items_check
  check (
    (item_type = 'training_module' and training_module_id is not null and content_asset_id is null)
    or (item_type = 'content_block' and training_module_id is null)
    or (item_type = 'custom_task' and training_module_id is null and content_asset_id is null)
  );
