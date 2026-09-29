-- WF-02/WF-05: catálogo vetorial de assets e Creative Plans.
-- Idempotente: pode rodar de novo via db/migrate.sh.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands (id),
  file_path text NOT NULL,
  sha256 text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  width integer,
  height integer,
  orientation text,
  category text,
  analysis_json jsonb NOT NULL,
  analysis_text text NOT NULL,
  embedding vector(768) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_brand_sha256_uniq UNIQUE (brand_id, sha256)
);

CREATE INDEX IF NOT EXISTS assets_brand_id_idx ON assets (brand_id);
CREATE INDEX IF NOT EXISTS assets_brand_active_idx ON assets (brand_id, is_active);

CREATE TABLE IF NOT EXISTS creative_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  version integer NOT NULL,
  plan_json jsonb NOT NULL,
  model_provider text NOT NULL,
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creative_plans_job_version_uniq UNIQUE (job_id, version)
);

CREATE INDEX IF NOT EXISTS creative_plans_job_id_idx ON creative_plans (job_id);
