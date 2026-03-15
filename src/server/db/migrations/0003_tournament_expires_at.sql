-- Add expiresAt TTL column to tournament_results
-- L3 remediation: tournament results without this column never auto-expire
ALTER TABLE "tournament_results" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
