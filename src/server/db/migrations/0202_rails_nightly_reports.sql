-- 0202 (hardening-rails Rail 3): append-only nightly certification-rig report history.
-- One immutable row per rig run — report_date + build_sha + verdict (green/drift/skipped/invalid)
-- + the full certificate JSONB — so the operator can scroll previous nights (Office history browser,
-- Rail 5). Read-side takes the latest row per report_date. Fail-soft: the rig dual-writes JSONL first,
-- this table best-effort. Idempotent (CREATE TABLE / INDEX IF NOT EXISTS); safe to re-apply. Inert until
-- the Rail 3 rig (scripts/rails/cert-rig.cjs) writes its first nightly certificate.

CREATE TABLE IF NOT EXISTS rails_nightly_reports (
  id BIGSERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  build_sha TEXT,
  verdict TEXT NOT NULL,
  certificate JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rails_nightly_reports_date_idx
  ON rails_nightly_reports (report_date DESC, id DESC);
