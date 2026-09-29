-- WF-04 Creative Briefing: marcas e jobs.
-- Idempotente: pode rodar de novo via db/migrate.sh.

CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  workspace_path text,
  canva_team_id text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES brands (id),
  status text NOT NULL,
  content_type text NOT NULL,
  brief_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_brand_id_idx ON jobs (brand_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);

INSERT INTO brands (slug, name, workspace_path, status)
VALUES ('exemplo', 'Marca Exemplo', '/workspace/clients/exemplo', 'active')
ON CONFLICT (slug) DO NOTHING;
