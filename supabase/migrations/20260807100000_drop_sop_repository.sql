-- SOP body/versioning/document management is no longer built here — SOPGalaxy
-- (https://app.sopgalaxy.com/) owns SOP documents. OneWork keeps only a
-- plain URL field on each Responsibility Matrix row (activities.sop_link,
-- already nullable free text — no schema change needed there) pointing
-- into it. This removes the former in-house SOP repository (metadata table
-- + draft/in_review/effective/archived approval workflow) rather than
-- leaving it running in parallel with nothing left calling it.

-- knowledge_chunks references sop_documents rows by id via a polymorphic
-- (source_type, source_id) pair with no foreign key, so dropping the table
-- won't cascade-clean these — delete them explicitly first.
delete from public.knowledge_chunks where source_type = 'sop';

drop table if exists public.sop_documents;
