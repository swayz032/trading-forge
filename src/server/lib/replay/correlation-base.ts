/**
 * correlation-base.ts
 *
 * Pure-functional deterministic correlation-base computation.
 *
 * FIX (Finding MED — Wave A Critic, Finding #4):
 *   The previous implementation of replay-grade-critique.ts set
 *   `correlationBase = \`replay-critique-\${new Date().toISOString()}\``,
 *   which embeds a wall-clock timestamp.  Two runs on the same dataset
 *   produced different correlation IDs, making audit trail de-duplication
 *   impossible and preventing replay comparison.
 *
 *   Fix: `computeCorrelationBase(positionIds)` returns
 *     sha256(positionIds.sort().join(",")).slice(0, 16)
 *   which is purely a function of the input set, not of wall-clock time.
 *
 * This module is intentionally PURE:
 *   - No I/O, no DB access, no Date.now()
 *   - Only `node:crypto` (built-in, zero-install)
 *   - Safe to import in tests without triggering the Express boot graph
 *
 * Source: Wave A Critic Fix 4, 2026-06-22
 */

import * as crypto from "node:crypto";

/**
 * Compute a deterministic 16-char hex correlation base from a set of
 * position IDs.
 *
 * The IDs are sorted before hashing, so the same set in any order
 * produces the same output.  An empty set produces a valid, stable hash
 * (sha256 of the empty string).
 *
 * @param positionIds - Array of position UUID strings (order-independent)
 * @returns 16-char lowercase hex string
 */
export function computeCorrelationBase(positionIds: string[]): string {
  const sorted = [...positionIds].sort();
  const joined = sorted.join(",");
  return crypto.createHash("sha256").update(joined).digest("hex").slice(0, 16);
}
