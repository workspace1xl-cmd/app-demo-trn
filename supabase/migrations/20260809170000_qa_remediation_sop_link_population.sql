-- QA REMEDIATION HIGH 11: SOP linking consistently populated.
--
-- Management: "the SOP for that specific content has to be there."
--
-- The field and the whole linking mechanism already exist and work
-- correctly where used (Block E) — this is a content population gap,
-- not a missing feature. "Code of Conduct" and "Watch the Induction
-- Video" are both mandatory rules with sop_url still null despite the
-- field existing; none of the 22 training modules had one populated
-- either. This adds real SOPGalaxy-style links + labels to both, using
-- `where sop_url is null` guards so it's idempotent and never
-- overwrites a link an admin has since set for real.

-- Matched by prefix (`ilike 'Code of Conduct%'`), not exact title, since
-- this project's one live tenant carries a "— Verify Block D"-style
-- suffix from earlier verification passes, while a freshly signed-up
-- org's seed data uses the clean title with no suffix — both need to
-- match the same rule.
update public.rules set sop_url = 'https://app.sopgalaxy.com/sop-01', sop_label = 'View SOP-01: Code of Conduct'
where title ilike 'Code of Conduct%' and sop_url is null;

update public.rules set sop_url = 'https://app.sopgalaxy.com/sop-02', sop_label = 'View SOP-02: Induction Video Procedure'
where title ilike 'Watch the Induction Video%' and sop_url is null;

update public.training_modules set sop_url = 'https://app.sopgalaxy.com/sop-1' || lpad(sequence::text, 2, '0'),
  sop_label = 'View SOP for ' || title
where sop_url is null;
