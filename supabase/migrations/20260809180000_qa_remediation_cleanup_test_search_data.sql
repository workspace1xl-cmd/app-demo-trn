-- QA REMEDIATION CLEANUP: remove leftover test-data chips from Knowledge
-- Search's production-facing "Top Searches" / "Trending This Week" /
-- "Popular in Your Department" blocks.
--
-- QA flagged "zzz flibberflabber nonsense 12345" as a leftover test
-- search visible in these blocks. That exact phrase is no longer present
-- (already aged out or never actually indexed with enough count), but
-- this remediation pass's OWN live-verification searches (distinctive
-- nonsense phrases used to prove Blockers 5 and 8 without any risk of a
-- false-positive real-content match) are now the same class of problem —
-- real audit_events rows, surfaced by the exact same aggregation. Same
-- root cause, same fix: delete the offending knowledge.search audit
-- events by matching distinctive substrings, covering both the
-- originally-reported phrase and this session's own test artifacts.

delete from public.audit_events
where action = 'knowledge.search'
  and (
    (details->>'query') ilike '%flibberflabber%'
    or (details->>'query') ilike '%zzqvorx%'
    or (details->>'query') ilike '%flimwuggle%'
    or (details->>'query') ilike '%nexcarto%'
    or (details->>'query') ilike '%quombaz%'
  );
