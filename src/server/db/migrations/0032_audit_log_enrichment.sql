-- Migration: 0032_audit_log_enrichment
-- Adds errorMessage and decisionAuthority columns to audit_log table.
-- decisionAuthority values: "gate" | "human" | "agent" | "scheduler" | "n8n"

ALTER TABLE "audit_log"
  ADD COLUMN IF NOT EXISTS "error_message" text,
  ADD COLUMN IF NOT EXISTS "decision_authority" text;

CREATE INDEX IF NOT EXISTS "audit_decision_authority_idx"
  ON "audit_log" ("decision_authority");
