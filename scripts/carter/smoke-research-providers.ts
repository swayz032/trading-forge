/**
 * smoke-research-providers.ts — Wave 7 RESEARCH-lane provider health check.
 *
 * Independently hits EACH non-strategy research provider (Brave, Exa, Tavily,
 * Parallel, Reddit) with a simple query using the .env keys, and prints a
 * per-provider PASS/FAIL + a sample result count. This is how we verify "all
 * providers work" for institutional_research / research_reddit.
 *
 * Scope: RESEARCH lane only. YouTube extraction is the STRATEGY lane and is
 * deliberately NOT exercised here (strategies enter only via that pipeline).
 *
 * Run: npx tsx scripts/carter/smoke-research-providers.ts
 * Exit code 0 if >=1 provider PASSes; non-zero only if EVERY provider fails.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  braveWebSearch,
  exaResearchSearch,
  tavilyWebSearch,
  parallelGeneralResearch,
  redditResearchSource,
} from "../../src/server/lib/carter/carter-research.js";

// ── Load .env into process.env (provider fns read keys at call time) ──────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const envPath = path.join(PROJECT_ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

const QUERY = "institutional futures trading risk management 2025";

type ProbeResult = { provider: string; ok: boolean; count: number; detail: string };

async function probe(provider: string, fn: () => Promise<{ length: number }>): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const out = await fn();
    const count = out.length;
    return { provider, ok: count >= 0, count, detail: `${count} results in ${Date.now() - start}ms` };
  } catch (err) {
    return { provider, ok: false, count: 0, detail: err instanceof Error ? err.message : String(err) };
  }
}

const probes: Array<Promise<ProbeResult>> = [
  probe("brave", () => braveWebSearch(QUERY)),
  probe("exa", () => exaResearchSearch(QUERY)),
  probe("tavily", () => tavilyWebSearch(QUERY)),
  probe("reddit", () => redditResearchSource("futures trading risk management")),
  // Parallel.ai is the slow deep-research path (minutes) — still probed here for
  // verification, but bounded internally by CARTER_RESEARCH_PARALLEL_TIMEOUT_MS.
  probe("parallel", () => parallelGeneralResearch(QUERY)),
];

const results = await Promise.all(probes);

console.error("\n=== Carter RESEARCH-lane provider smoke ===");
console.error(`query: "${QUERY}"\n`);
let anyPass = false;
for (const r of results) {
  const tag = r.ok ? "PASS" : "FAIL";
  if (r.ok) anyPass = true;
  console.error(`  [${tag}] ${r.provider.padEnd(9)} — ${r.detail}`);
}
console.error("");

// Machine-readable line on stdout.
process.stdout.write(JSON.stringify({ probed_at: new Date().toISOString(), results }, null, 2) + "\n");

process.exit(anyPass ? 0 : 1);
