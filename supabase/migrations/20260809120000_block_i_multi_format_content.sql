-- BUILD PROMPT v5 BLOCK I: Multi-format content support
--
-- Content Library already supports video/image/document (etc.) with
-- either a file upload or an external embed URL (20260807080000) — this
-- block extends that support to two places that couldn't use it yet:
--   1. 'audio' as a genuine content_assets.kind (training modules and
--      onboarding messages can now attach a real audio file/link).
--   2. Rules can now attach a real content_assets row (video/audio/image/
--      document), not just the plain-URL sop_link-style reference from
--      Block E — rules.attachment_asset_id, same "link to a real asset"
--      pattern Block C already established for onboarding_stage_items.

alter table public.content_assets drop constraint if exists content_assets_kind_check;
alter table public.content_assets add constraint content_assets_kind_check
  check (kind in ('document','video','audio','sop','mistake_register','template','image','onboarding_message'));

alter table public.rules add column if not exists attachment_asset_id uuid references public.content_assets(id);
