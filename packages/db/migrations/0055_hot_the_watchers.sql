-- Data-only: bring documents archived BEFORE the archive slice into the archive.
--
-- `status = 'archived'` was reachable through the ordinary status command until this release,
-- and 0054 added `archived_at` without a backfill. The new code makes `archived_at` — not the
-- status — the source of truth: the опись filters on it, the retention sweep requires it, and
-- `assertArchivable` refuses a document that is already at status 'archived'. Those rows would
-- therefore sit outside the archive with no endpoint able to file them.
--
-- The filing date is taken as `updated_at` (the status change that archived them) falling back
-- to `created_at`, and the term is derived from the case exactly as `planRetention` does today:
-- permanent → no deadline, no stated term → no deadline. `archived_by` stays NULL — nobody
-- knows who did it, and inventing a name in an archive is worse than admitting the gap.
UPDATE "app"."documents" AS d
SET
  "archived_at" = s."filed_at",
  "retention_until" = CASE
    WHEN COALESCE(s."is_permanent", false) THEN NULL
    WHEN COALESCE(s."retention_months", 0) <= 0 THEN NULL
    ELSE s."filed_at" + make_interval(months => s."retention_months")
  END,
  "retention_months" = CASE
    WHEN COALESCE(s."is_permanent", false) THEN s."retention_months"
    WHEN COALESCE(s."retention_months", 0) <= 0 THEN NULL
    ELSE s."retention_months"
  END,
  "is_permanent" = COALESCE(s."is_permanent", false)
FROM (
  SELECT
    doc."id" AS "id",
    COALESCE(doc."updated_at", doc."created_at") AS "filed_at",
    n."retention_months" AS "retention_months",
    n."is_permanent" AS "is_permanent"
  FROM "app"."documents" doc
  LEFT JOIN "app"."nomenclature" n
    ON n."index" = doc."case_index" AND n."deleted_at" IS NULL
  WHERE doc."status" = 'archived' AND doc."archived_at" IS NULL AND doc."deleted_at" IS NULL
) AS s
WHERE d."id" = s."id";
