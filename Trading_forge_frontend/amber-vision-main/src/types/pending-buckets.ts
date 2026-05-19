/**
 * Pending Validation Watchlist — type contracts.
 *
 * Mirrors backend `strategy_pending_buckets` + `strategy_pending_mentions`
 * tables introduced in migration 0103 (Pass 18 cross-source validation).
 * See: docs/superpowers/specs/2026-05-11-cross-source-strategy-validation-design.md
 */

export type PendingBucketStatus =
  | "pending"
  | "graduating"
  | "graduated"
  | "expired"
  | "killed";

export type PendingMarket = "MES" | "MNQ" | "MCL";

export type PendingSourceProvider =
  | "youtube"
  | "reddit"
  | "tavily"
  | "brave"
  | "parallel"
  | "scrapingbee"
  | "apify"
  | "tf_search"
  | string;

export interface PendingBucket {
  id: string;
  fingerprintHash: string;
  market: PendingMarket;
  entryArchetype: string;
  exitType: string;
  sourceCount: number;
  distinctProviders: number;
  status: PendingBucketStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  graduatedAt: string | null;
  graduatedStrategyId: string | null;
  /** Distinct provider tokens, surfaced by the list endpoint for chip rendering. */
  providers: PendingSourceProvider[];
  /** Pass 20 concept-fingerprint label — canonical snake_case (e.g. "9_21_ema_pullback"). */
  conceptName?: string | null;
  /** Pass 20 layer-coverage map: {web,youtube,reddit} → boolean. */
  layerCoverageJson?: { web?: boolean; youtube?: boolean; reddit?: boolean } | null;
}

export interface PendingMention {
  id: string;
  bucketId: string;
  sourceProvider: PendingSourceProvider;
  sourceUrl: string;
  crossValidatorConfidence: number | null;
  isCrossValidationResult: boolean;
  createdAt: string;
}

export interface PendingBucketsResponse {
  data: PendingBucket[];
  total: number;
}

export interface PendingMentionsResponse {
  data: PendingMention[];
}

export interface PendingBucketActionResponse {
  ok: boolean;
  status: PendingBucketStatus;
  strategyId?: string | null;
}
