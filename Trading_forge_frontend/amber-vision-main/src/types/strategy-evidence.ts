/**
 * Strategy Evidence — type contracts for cross-validation provenance display.
 *
 * Mirrors the backend response shape from GET /api/strategies/:id/evidence
 * introduced in Pass 19 Track B. See:
 *   src/server/routes/strategies.ts → strategyRoutes.get("/:id/evidence")
 *   docs/superpowers/specs/2026-05-11-cross-source-strategy-validation-design.md
 */

import type {
  PendingBucketStatus,
  PendingMarket,
  PendingSourceProvider,
} from "./pending-buckets";

export interface EvidenceBucket {
  id: string;
  fingerprint_hash: string;
  market: PendingMarket | string;
  entry_archetype: string;
  exit_type: string;
  source_count: number;
  distinct_providers: number;
  status: PendingBucketStatus | string;
  first_seen_at: string;
  last_seen_at: string;
  graduated_at: string | null;
}

export interface EvidenceMention {
  id: string;
  source_provider: PendingSourceProvider;
  source_url: string;
  is_cross_validation_result: boolean;
  cross_validator_confidence: number | null;
  created_at: string;
}

export interface StrategyEvidenceResponse {
  cross_validated: boolean;
  bucket: EvidenceBucket | null;
  mentions: EvidenceMention[];
  fallback_source_note?: string;
}
