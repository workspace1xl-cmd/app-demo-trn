-- BUILD PROMPT v5 BLOCK H: Knowledge Search default state
--
-- "Backed by real query-frequency logging" — audit_events already logs
-- every search (action = 'knowledge.search', details->>'query') from the
-- existing /api/v1/search route; that's real query-frequency data, not a
-- new table duplicating it. This migration only adds the index that makes
-- grouping/counting those rows fast at scale — Top Searches, Trending
-- This Week and Popular in Your Department are all just different
-- filters/windows over the same log, computed in the API layer.
--
-- "Recently Added" is a different kind of empty-state block — genuinely
-- new content (training modules, content library items), not searches —
-- and needs no new schema at all; it's the existing created_at columns
-- on training_modules/content_assets, most-recent-first.

create index if not exists audit_events_org_action_created_idx
  on public.audit_events(org_id, action, created_at desc)
  where action = 'knowledge.search';
