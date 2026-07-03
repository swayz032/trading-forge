/**
 * check-extraction-cert.ts (2026-07-03) — extraction-pipeline certification lock.
 *
 * The 6-video gate (46/46 probes, golds psH 7/7 + l-2 100%, 2026-07-02) certified a SPECIFIC pipeline:
 * the gate prompt + runner (atomize-transcript.ts) + compression (predicate-compression.ts) + scoring
 * (graph-fidelity.ts) + model. This session proved a single prompt line shifts gemma's entire labeling
 * distribution — so ANY change to these surfaces requires re-running the gate, not a code review.
 *
 * FAST CHECK (this script, run in CI / before any corpus extraction): recompute the surface hashes and
 * compare against certification-lock.json. Mismatch = the pipeline is NO LONGER the certified one →
 * exit 1 with instructions to re-run the full gate (2 golds + 6 audit videos + 46-probe scoring) and,
 * on pass, update the lock via --relock.
 *
 * Usage:
 *   npx tsx scripts/check-extraction-cert.ts            # verify (exit 0 = certified pipeline intact)
 *   npx tsx scripts/check-extraction-cert.ts --relock   # AFTER a passing gate re-run: write new lock
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";

const SURFACES = [
  "scripts/atomize-transcript.ts",
  "src/server/lib/predicate-compression.ts",
  "src/server/lib/graph-compiler.ts",
  "src/server/lib/graph-to-engine.ts",
  "src/server/lib/decision-atom.ts",
  "src/server/lib/clause-segmenter.ts",
];
const LOCK = "certification-lock.json";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

function currentHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of SURFACES) out[f] = sha(readFileSync(f, "utf-8").replace(/\r\n/g, "\n"));
  const src = readFileSync("scripts/atomize-transcript.ts", "utf-8");
  const m = src.match(/const PROMPT = `([\s\S]*?)`;/);
  out["<gate-prompt>"] = m ? sha(m[1]) : "PROMPT_NOT_FOUND";
  return out;
}

const cur = currentHashes();
if (process.argv.includes("--relock")) {
  writeFileSync(LOCK, JSON.stringify({
    certified_gate: "6-video-46of46-2026-07-02",
    relocked_at_commit: process.env.LOCK_COMMIT ?? "run git rev-parse --short HEAD",
    note: "Only --relock after a PASSING full gate re-run (2 golds + 6 audit videos). Never relock to silence a mismatch.",
    hashes: cur,
  }, null, 1));
  console.log("LOCK WRITTEN — ensure the full gate passed before trusting this.");
  process.exit(0);
}
if (!existsSync(LOCK)) { console.error("NO LOCK FILE — run --relock after a passing gate."); process.exit(1); }
const lock = JSON.parse(readFileSync(LOCK, "utf-8"));
const drift = Object.keys(cur).filter((k) => lock.hashes[k] !== cur[k]);
if (drift.length) {
  console.error(`EXTRACTION CERT DRIFT — pipeline differs from the certified surface on:\n  ${drift.join("\n  ")}`);
  console.error("\nThe corpus pipeline is NO LONGER certified. Re-run the gate (golds psH + l-2 must hold");
  console.error("100% + the 6 audit videos must pass their probe suites), then --relock. Do NOT extract");
  console.error("corpus videos on an uncertified pipeline.");
  process.exit(1);
}
console.log(`EXTRACTION CERT OK — pipeline matches ${lock.certified_gate} (${Object.keys(cur).length} surfaces)`);
process.exit(0);
