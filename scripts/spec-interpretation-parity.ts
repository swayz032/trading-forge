/**
 * LEDGER E — ENGINE INTERPRETATION FIDELITY (2026-06-30, operator/GPT).
 *
 * The fifth ledger (A transcript / B decision / C graph / D handoff / E interpretation): proves the Python
 * engine interprets the compiled EngineStrategySpec EXACTLY as the compiler defines it — "the engine is just
 * another deterministic backend for the compiler."
 *
 * Method (mirrors the check:ts-python-exit-parity precedent):
 *   1. Build fixture graphs through the REAL canonical path: compileGraph → densifySpine → compileToEngineSpec.
 *      Fixtures cover every structural feature: linear spine, AND confluence cluster, OR branches, invalidation
 *      veto, framework exclusion, orphan-densification, and a mixed large graph.
 *   2. Sweep truth assignments over the spec's condition ids — EXHAUSTIVE (2^n) for n ≤ 12, else 2048
 *      deterministic 64-bit-LCG-sampled masks (generated once in TS; Python only consumes them).
 *   3. Evaluate every assignment with the TS reference (spec-semantics.ts), write {spec, ids, masks, ts
 *      decisions} JSON, then spawn ONE python subprocess running src/engine/spec_interpreter.py over the same
 *      inputs and compare armed + blocked_by EXACTLY.
 *
 * Exit 0 = 100% agreement on every assignment of every fixture (LEDGER E: INTERPRETED FAITHFULLY).
 * Exit 1 = any mismatch (interpretation drift — fix TS + Python + this harness in the SAME commit).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/spec-interpretation-parity.ts
 */
import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileGraph } from "../src/server/lib/graph-compiler.js";
import type { AtomType, DecisionAtom } from "../src/server/lib/decision-atom.js";
import { SPAN } from "../src/server/lib/state-machine-ir.js";
import { densifySpine } from "../src/server/lib/spine-density.js";
import { compileToEngineSpec, type EngineStrategySpec } from "../src/server/lib/graph-to-engine.js";
import { evaluateSpec } from "../src/server/lib/spec-semantics.js";

// ── deterministic fixture builder: atoms laid out in a constructed transcript (gaps drive OR/exception marks) ──
interface Piece { type: AtomType; object: string; gapBefore: string }
function buildFixture(pieces: Piece[]): { atoms: DecisionAtom[]; transcript: string } {
  let transcript = "";
  const atoms: DecisionAtom[] = [];
  pieces.forEach((p, i) => {
    transcript += p.gapBefore;
    const start = transcript.length;
    transcript += p.object;
    atoms.push({
      id: `${p.type}:${p.object.replace(/\s+/g, "_")}#${i}`,
      type: p.type, temporal_kind: "event", object: p.object, object_canonical: p.object,
      depends_on: [], provenance: SPAN(p.object, start, start + p.object.length),
    });
  });
  return { atoms, transcript };
}

const FIXTURES: Array<{ name: string; pieces: Piece[] }> = [
  { name: "linear_spine", pieces: [
    { type: "WAIT_SESSION", object: "new york session", gapBefore: "" },
    { type: "WAIT_STRUCTURE", object: "structure break", gapBefore: " then wait for the " },
    { type: "WAIT_RETEST", object: "retest of the level", gapBefore: " then the " },
    { type: "ENTER", object: "enter long", gapBefore: " then " },
  ]},
  { name: "and_confluence", pieces: [
    { type: "WAIT_BIAS", object: "bearish bias", gapBefore: "" },
    { type: "WAIT_STRUCTURE", object: "liquidity sweep", gapBefore: " and the " },
    { type: "VERIFY_STRUCTURE", object: "supply zone", gapBefore: " and the " },
    { type: "WAIT_STRUCTURE", object: "discount fib", gapBefore: " with the " },
    { type: "ENABLE_ENTRY", object: "short position", gapBefore: " then take the " },
  ]},
  { name: "or_branches", pieces: [
    { type: "WAIT_STRUCTURE", object: "ema cross", gapBefore: "" },
    { type: "WAIT_CONFIRMATION", object: "cci confirmation", gapBefore: " then a " },
    { type: "WAIT_CONFIRMATION", object: "engulfing candle", gapBefore: " or alternatively an " },
    { type: "ENTER", object: "enter the trade", gapBefore: " then " },
  ]},
  { name: "invalidation_veto", pieces: [
    { type: "WAIT_STRUCTURE", object: "range break", gapBefore: "" },
    { type: "ENTER", object: "go long", gapBefore: " then " },
    { type: "INVALIDATE", object: "close back inside the range", gapBefore: " unless price " },
  ]},
  { name: "framework_excluded", pieces: [
    { type: "WAIT_STRUCTURE", object: "breakout of the high", gapBefore: "" },
    { type: "ENTER", object: "buy", gapBefore: " then " },
    { type: "EXIT_HINT", object: "take profit at the target", gapBefore: " and " },
  ]},
  { name: "orphan_densified", pieces: [
    { type: "WAIT_SESSION", object: "london session", gapBefore: "" },
    { type: "WAIT_STRUCTURE", object: "sweep of the low", gapBefore: " then the " },
    { type: "FILTER", object: "vwap confluence", gapBefore: ". separately the " }, // orphan → densify attaches
    { type: "ENABLE_ENTRY", object: "long entry", gapBefore: " then take the " },
  ]},
  { name: "mixed_large", pieces: [
    { type: "WAIT_SESSION", object: "new york open", gapBefore: "" },
    { type: "WAIT_BIAS", object: "bullish daily bias", gapBefore: " with a " },
    { type: "WAIT_STRUCTURE", object: "asian sweep", gapBefore: " then the " },
    { type: "VERIFY_STRUCTURE", object: "market structure shift", gapBefore: " and a " },
    { type: "WAIT_RETEST", object: "fvg retest", gapBefore: " then the " },
    { type: "WAIT_CONFIRMATION", object: "displacement candle", gapBefore: " then a " },
    { type: "WAIT_CONFIRMATION", object: "smt divergence", gapBefore: " or a " },
    { type: "ENTER", object: "enter long", gapBefore: " then " },
    { type: "INVALIDATE", object: "sweep of the opposite side", gapBefore: " unless a " },
  ]},
];

// ── deterministic 64-bit LCG (masks generated in TS only; Python just consumes) ──
function* lcgMasks(bits: number, count: number): Generator<bigint> {
  let x = 0x1234_5678_9abc_def0n;
  const M = (1n << 64n) - 1n;
  for (let i = 0; i < count; i++) {
    x = (6364136223846793005n * x + 1442695040888963407n) & M;
    yield x & ((1n << BigInt(bits)) - 1n);
  }
}

interface FixtureOut { name: string; spec: EngineStrategySpec; ids: string[]; masks: string[]; ts: Array<{ armed: boolean; blocked_by: string[] }> }

const out: FixtureOut[] = [];
for (const f of FIXTURES) {
  const { atoms, transcript } = buildFixture(f.pieces);
  const spec = compileToEngineSpec(densifySpine(compileGraph(atoms, transcript))); // the CANONICAL path
  const ids = [...spec.entry_conditions.map((c) => c.id), ...spec.invalidations.map((c) => c.id)].sort();
  const n = ids.length;
  const masks: bigint[] = n <= 12
    ? Array.from({ length: 1 << n }, (_, i) => BigInt(i))
    : [...lcgMasks(n, 2048)];
  const ts = masks.map((m) => {
    const satisfied = new Set(ids.filter((_, bit) => (m >> BigInt(bit)) & 1n ? true : false));
    return evaluateSpec(spec, satisfied);
  });
  out.push({ name: f.name, spec, ids, masks: masks.map((m) => m.toString()), ts });
  console.log(`[fixture] ${f.name}: ${n} conditions, ${masks.length} assignments (${n <= 12 ? "exhaustive" : "LCG-sampled"})`);
}

const dir = mkdtempSync(join(tmpdir(), "ledger-e-"));
const fixturePath = join(dir, "fixtures.json");
writeFileSync(fixturePath, JSON.stringify(out));

const pythonScript = `
import json, sys
sys.path.insert(0, ".")
from src.engine.spec_interpreter import evaluate_spec

with open(${JSON.stringify(fixturePath.replace(/\\/g, "/"))}, encoding="utf-8") as f:
    fixtures = json.load(f)

total = mismatches = 0
for fx in fixtures:
    ids, agree = fx["ids"], 0
    for mask_s, ts_dec in zip(fx["masks"], fx["ts"]):
        mask = int(mask_s)
        satisfied = [ids[b] for b in range(len(ids)) if (mask >> b) & 1]
        py = evaluate_spec(fx["spec"], satisfied)
        total += 1
        if py["armed"] == ts_dec["armed"] and py["blocked_by"] == ts_dec["blocked_by"]:
            agree += 1
        else:
            mismatches += 1
            if mismatches <= 3:
                print(f"MISMATCH {fx['name']} mask={mask_s}: py={py} ts={ts_dec}")
    print(f"[python] {fx['name']}: {agree}/{len(fx['masks'])} agree")
print(f"TOTAL {total} assignments, {mismatches} mismatches")
sys.exit(0 if mismatches == 0 else 1)
`;

let r = spawnSync("python", ["-c", pythonScript], { cwd: process.cwd(), encoding: "utf-8", timeout: 120_000 });
if (r.error) r = spawnSync("python3", ["-c", pythonScript], { cwd: process.cwd(), encoding: "utf-8", timeout: 120_000 });
process.stdout.write(r.stdout ?? "");
if (r.status !== 0) process.stderr.write(r.stderr ?? "");

const totalAssignments = out.reduce((s, f) => s + f.masks.length, 0);
console.log(`\nLEDGER E — engine interpretation fidelity: ${r.status === 0 ? `INTERPRETED FAITHFULLY (${out.length} fixtures, ${totalAssignments} assignments, TS==Python on all)` : "VIOLATED — interpretation drift"}`);
process.exit(r.status === 0 ? 0 : 1);
