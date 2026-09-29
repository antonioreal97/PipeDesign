-- Migra o catálogo vazio de text-embedding-3-small (1536) para
-- EmbeddingGemma local (768). Vetores de modelos distintos não são compatíveis.

DO $$
DECLARE
  current_dimensions integer;
  asset_count bigint;
BEGIN
  SELECT a.atttypmod
    INTO current_dimensions
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = current_schema()
     AND c.relname = 'assets'
     AND a.attname = 'embedding'
     AND a.attnum > 0;

  IF current_dimensions IS NULL OR current_dimensions = 768 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO asset_count FROM assets;
  IF asset_count > 0 THEN
    RAISE EXCEPTION 'assets contém % registro(s) com vetores de % dimensões; reindexe os assets antes de migrar para EmbeddingGemma (768)', asset_count, current_dimensions;
  END IF;

  ALTER TABLE assets ALTER COLUMN embedding TYPE vector(768);
END $$;
