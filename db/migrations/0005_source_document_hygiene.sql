-- =============================================================================
-- Two fixes to source documents.
--
-- 1. Re-running an import created a NEW document row every time and repointed
--    facts at it, abandoning the previous one. Eleven of nineteen documents
--    were already orphaned after a handful of runs, and it would have grown
--    without bound. A unique constraint on (company, title) makes the importer
--    able to upsert instead.
--
-- 2. The location CHECK required a file path or a URL, so naming a document
--    you have not filed yet was impossible — and the entry form worked around
--    it by inventing a OneDrive path that pointed at nothing. A fabricated
--    path is worse than an absent one: it looks like provenance. The
--    constraint now allows a document that has only a title.
-- =============================================================================

-- Repoint anything referencing a duplicate at the oldest document with the
-- same (company, title), then remove the leftovers.
WITH ranked AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY company_id, title ORDER BY id
           ) AS keep_id
      FROM source_documents
)
UPDATE fiscal_periods p
   SET source_document_id = r.keep_id
  FROM ranked r
 WHERE p.source_document_id = r.id
   AND r.id <> r.keep_id;

WITH ranked AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY company_id, title ORDER BY id
           ) AS keep_id
      FROM source_documents
)
UPDATE financial_facts f
   SET source_document_id = r.keep_id
  FROM ranked r
 WHERE f.source_document_id = r.id
   AND r.id <> r.keep_id;

DELETE FROM source_documents d
 WHERE EXISTS (
       SELECT 1 FROM source_documents older
        WHERE older.company_id IS NOT DISTINCT FROM d.company_id
          AND older.title = d.title
          AND older.id < d.id
 );

-- Documents nothing points at, left behind by earlier runs.
DELETE FROM source_documents d
 WHERE NOT EXISTS (SELECT 1 FROM fiscal_periods p WHERE p.source_document_id = d.id)
   AND NOT EXISTS (SELECT 1 FROM financial_facts f WHERE f.source_document_id = d.id);

ALTER TABLE source_documents
    ADD CONSTRAINT source_documents_company_title_unique UNIQUE (company_id, title);

ALTER TABLE source_documents
    DROP CONSTRAINT IF EXISTS source_documents_has_location;

COMMENT ON COLUMN source_documents.onedrive_path IS
    'Where the file actually is. Leave null until it is filed — never invent a path, because a path that points at nothing reads as provenance.';
