/**
 * audit-unregistered-strategies.ts — reproducible exposure audit for the eligibility-overlay
 * unregistered-strategy bypass (deep-scan A/C-1 follow-up).
 *
 * Run:  npx tsx scripts/audit-unregistered-strategies.ts
 * Needs: DATABASE_URL in .env (read-only SELECT on `strategies`).
 *
 * Prints how many strategies are UNREGISTERED (name not in playbook_router.ALL_STRATS → would
 * bypass the eligibility overlay) and how many of THOSE are in a live (PAPER+) lifecycle state
 * — the real active exposure. This is the committed, credential-free-runnable second source for
 * the exposure figure that the doer-only DB read could not independently corroborate.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { loadAllStratsNormalized, classifyRegistrationExposure } from "../src/server/lib/eligibility-registration.js";

function readDatabaseUrl(): string {
  // prefer process env; fall back to .env in repo root
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  const env = readFileSync(new URL("../.env", import.meta.url), "utf-8");
  const m = env.match(/^DATABASE_URL=(.*)$/m);
  if (!m) throw new Error("DATABASE_URL not found in process.env or .env");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

async function main(): Promise<void> {
  const allStrats = loadAllStratsNormalized();
  console.log(`ALL_STRATS (normalized) entries: ${allStrats.size}`);

  const sql = postgres(readDatabaseUrl(), { ssl: "require", max: 1, idle_timeout: 5, connect_timeout: 20 });
  try {
    const rows = await sql<{ name: string; lifecycle_state: string | null }[]>`
      SELECT name, lifecycle_state FROM strategies
    `;
    const exposure = classifyRegistrationExposure(
      rows.map((r) => ({ name: r.name, lifecycleState: r.lifecycle_state })),
      allStrats,
    );

    console.log(`\ntotal strategies: ${exposure.total}`);
    console.log("per lifecycle_state  (unregistered / total):");
    for (const [st, v] of Object.entries(exposure.byState).sort()) {
      console.log(`  ${st.padEnd(16)} ${String(v.unregistered).padStart(3)} / ${v.total}`);
    }
    console.log(`\nTOTAL unregistered (would bypass overlay): ${exposure.unregistered} of ${exposure.total}`);
    console.log(`LIVE (PAPER+) unregistered — ACTIVE exposure: ${exposure.liveUnregistered}`);
    if (exposure.liveUnregistered > 0) {
      console.log("  " + exposure.liveUnregisteredNames.slice(0, 30).join("\n  "));
    } else {
      console.log("  (none — the eligibility-overlay bypass has ZERO active live/paper exposure)");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error("audit-unregistered-strategies FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
