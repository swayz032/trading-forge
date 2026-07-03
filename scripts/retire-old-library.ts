/**
 * retire-old-library.ts (2026-07-02, HMAC contract fixed 2026-07-02 — Band B B5 verification)
 * — retire the OLD thin-extraction library after the compiler re-extraction.
 *
 * Operator directive: "make sure we deleted the old library once we do the full re-extraction." The 6-video
 * audit proved the old extractions have WRONG/INVERTED mechanisms on 5 of 6 videos (crossover-for-retest,
 * breakout-for-never-breakout, order_block-for-volume-profile, BOS-for-SFP...) — backtesting them never tested
 * the educators' strategies.
 *
 * Implementation: CANDIDATE → GRAVEYARD via the audited API path (PATCH /api/strategies/:id/lifecycle) —
 * GRAVEYARD is the terminal state with zero outbound transitions, so retired rows can never re-enter the
 * conveyor. This is the system's own "delete": atomic, audited (audit_log + lifecycle_transitions), FK-safe.
 * Targets ONLY the IDs frozen in docs/designs/old-library-snapshot-2026-07-02.json (117 rows snapshotted
 * BEFORE any re-extracted strategies exist) — new rows are structurally untouchable by this script.
 *
 * CONTRACT-DRIFT FIX (Band B verification, 2026-07-02): this script previously sent
 * `{ to, reason, actor }`, but the route (src/server/routes/strategies.ts PATCH /:id/lifecycle,
 * hardened in commit e984ede "Pass 5: Lifecycle Gate Coverage + Engine Authority") requires an
 * HMAC-SHA256-signed `{ fromState, toState, timestamp, signature }` body — the script has been
 * NON-FUNCTIONAL since the day it was written (it postdates the HMAC hardening by 9 days). Every
 * --apply call would have hit 503 (secret unset) or 401 (missing/invalid signature) on all 117
 * rows. Fixed here to construct the real signed request; --apply still requires the operator to
 * have `ADMIN_PROMOTE_HMAC_SECRET` set in the environment this script runs in (same secret the
 * API server uses) — the script does not (and must not) invent or read the secret from anywhere
 * else. Dry-run mode (default) makes ZERO network calls and is unaffected by this fix.
 *
 * Usage:
 *   npx tsx scripts/retire-old-library.ts            # dry run — prints the plan, mutates nothing
 *   npx tsx scripts/retire-old-library.ts --apply    # executes (run ONLY after re-extraction + operator go;
 *                                                     #   requires ADMIN_PROMOTE_HMAC_SECRET in env)
 */
import { readFileSync } from "fs";
import { createHmac } from "node:crypto";

const API = process.env.TF_API_BASE ?? "http://localhost:4000";
const APPLY = process.argv.includes("--apply");
// Auth for the now-gated /api surface (deep-scan #13 auth hardening). Office admin
// cookie (operator auth path) or Bearer API_KEY; empty when neither is set (open dev).
const AUTH_HEADERS: Record<string, string> = process.env.TF_ADMIN_COOKIE
  ? { Cookie: `slumhouse_admin_sid=${process.env.TF_ADMIN_COOKIE}` }
  : process.env.API_KEY
    ? { Authorization: `Bearer ${process.env.API_KEY}` }
    : {};
const REASON = "old-extractor thin library retired post-re-extraction (6-video audit 2026-07-02: mechanisms wrong/inverted on 5 of 6; entry_sequence null across all)";

function signLifecycleRequest(strategyId: string, fromState: string, toState: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  // MUST match the route's expected payload exactly: `${timestamp}:${strategyId}:${fromState}:${toState}`
  // (src/server/routes/strategies.ts:612).
  const payload = `${timestamp}:${strategyId}:${fromState}:${toState}`;
  const signature = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return { timestamp, signature };
}

async function main(): Promise<number> {
  const snap = JSON.parse(readFileSync("docs/designs/old-library-snapshot-2026-07-02.json", "utf-8"));
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${snap.count} strategies from snapshot ${snap.snapshot_at}`);

  let secret: string | undefined;
  if (APPLY) {
    secret = process.env.ADMIN_PROMOTE_HMAC_SECRET;
    if (!secret || secret.length === 0 || secret === "your-secret-here") {
      console.error(
        "ADMIN_PROMOTE_HMAC_SECRET is not set (or is the placeholder) in this script's environment. " +
          "The lifecycle route will refuse every request with 503 admin_promote_hmac_not_configured. " +
          "Set the same secret the API server uses before re-running with --apply.",
      );
      return 1;
    }
  }

  let ok = 0, skipped = 0, failed = 0;
  for (const s of snap.strategies) {
    if (s.state === "GRAVEYARD") { skipped++; continue; }
    if (!APPLY) { console.log(`  would retire: ${s.name} (${s.state} -> GRAVEYARD)`); ok++; continue; }
    try {
      const fromState = s.state;
      const toState = "GRAVEYARD";
      const { timestamp, signature } = signLifecycleRequest(s.id, fromState, toState, secret as string);
      const r = await fetch(`${API}/api/strategies/${s.id}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...AUTH_HEADERS },
        body: JSON.stringify({ fromState, toState, timestamp, signature, reason: REASON }),
      });
      if (r.ok) { ok++; console.log(`  retired: ${s.name}`); }
      else { failed++; console.log(`  FAILED ${s.name}: ${r.status} ${(await r.text()).slice(0, 120)}`); }
    } catch (e) { failed++; console.log(`  ERROR ${s.name}: ${String(e).slice(0, 120)}`); }
  }
  console.log(`\n${APPLY ? "retired" : "planned"}=${ok} already_graveyard=${skipped} failed=${failed}`);
  return failed > 0 ? 1 : 0;
}

main().then((c) => process.exit(c));
