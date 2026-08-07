-- Allow a video tutorial or reference document to be a plain external link
-- (a YouTube URL, for example) instead of requiring a file upload. An asset
-- now needs either a storage_path (uploaded file) or an external_url
-- (external link), not necessarily both.

alter table public.content_assets
  alter column storage_path drop not null,
  alter column file_name drop not null,
  alter column mime_type drop not null,
  add column if not exists external_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_assets_has_source') then
    alter table public.content_assets add constraint content_assets_has_source
      check (storage_path is not null or external_url is not null);
  end if;
end
$$;

-- storage_path is unique only when present; an external-link asset has no
-- storage_path so the existing unique(org_id, storage_path) constraint would
-- otherwise collide once more than one external asset exists per org.
alter table public.content_assets drop constraint if exists content_assets_org_id_storage_path_key;
create unique index if not exists content_assets_org_storage_path_idx
  on public.content_assets(org_id, storage_path) where storage_path is not null;
