-- Card designs get a public URL slug: /cards/<category>/<slug>.
-- See docs/adr/0163-catalog-urls-and-category-pages.md.
--
-- The backfill deliberately mirrors `slugifyCardName()` / `uniqueCardSlug()` in
-- packages/shared-types/src/card-category.ts, because the app assigns slugs to
-- *new* designs with those functions and the two must not disagree. The helper
-- below was verified row-for-row against the TypeScript implementation
-- (including accents, ampersands, apostrophes and names that slugify to nothing)
-- before this migration was written.

-- 1. The column, nullable for now so existing rows can be filled in.
ALTER TABLE "card_designs" ADD COLUMN "slug" TEXT;

-- 2. Slugify helper. Accent folding uses translate() over Latin-1 rather than
--    the unaccent extension, which isn't guaranteed to be installed on the
--    managed database and would make this migration fail at deploy time.
CREATE OR REPLACE FUNCTION kudos_slugify_tmp(input TEXT) RETURNS TEXT AS $slugify$
  SELECT rtrim(
    left(
      trim(both '-' from
        regexp_replace(
          regexp_replace(
            replace(
              lower(translate(
                coalesce(input, ''),
                'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
                'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
              )),
              '&', ' and '
            ),
            '[''’]', '', 'g'
          ),
          '[^a-z0-9]+', '-', 'g'
        )
      ),
      80
    ),
    '-'
  )
$slugify$ LANGUAGE sql IMMUTABLE;

-- 3. Backfill, oldest design first so the ordering (and therefore which row
--    keeps the unsuffixed slug) is deterministic and reproducible. The loop
--    mirrors uniqueCardSlug(): base, base-2, base-3, … until free. Checking
--    against the table rather than only against same-named rows also catches a
--    cross-collision, e.g. a design literally named "Classic Birthday 2".
DO $backfill$
DECLARE
  design RECORD;
  base TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR design IN
    SELECT id, name, sku, external_id FROM "card_designs" ORDER BY created_at, id
  LOOP
    base := kudos_slugify_tmp(design.name);

    -- A name of only symbols slugifies to nothing; fall back to the product code,
    -- then to the Airtable record id, then to the design's own id. Every design
    -- ends up with a usable, unique slug rather than a failed migration.
    IF base = '' THEN
      base := kudos_slugify_tmp(design.sku);
    END IF;
    IF base = '' THEN
      base := kudos_slugify_tmp(design.external_id);
    END IF;
    IF base = '' THEN
      base := 'card-' || left(replace(design.id::text, '-', ''), 8);
    END IF;

    candidate := base;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM "card_designs" WHERE "slug" = candidate) LOOP
      suffix := suffix + 1;
      candidate := base || '-' || suffix;
    END LOOP;

    UPDATE "card_designs" SET "slug" = candidate WHERE id = design.id;
  END LOOP;
END
$backfill$;

DROP FUNCTION kudos_slugify_tmp(TEXT);

-- 4. Now every row has one, enforce it.
CREATE UNIQUE INDEX "card_designs_slug_key" ON "card_designs"("slug");
ALTER TABLE "card_designs" ALTER COLUMN "slug" SET NOT NULL;
