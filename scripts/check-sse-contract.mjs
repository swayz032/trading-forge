#!/usr/bin/env node
// deepscan6 O10 (2026-07-01): SSE contract visibility check.
// deepscan12 Track R (2026-07-02): Added hard-fail gate for safety-critical server-only events.
// DS#20 T-E1 (2026-07-05): Added n8n-emitted allowlist bucket — see NOTE below.
//
// The server broadcasts SSE events via broadcastSSE("<event>", data); the frontend
// declares a typed catalog (the SSEEvent discriminated union in
// Trading_forge_frontend/amber-vision-main/src/types/sse-events.ts). Nothing bound the two,
// so a renamed/added server event could silently stop feeding a dashboard tile.
//
// This derives BOTH sides from source and reports the drift:
//   - server literal broadcasts NOT in the frontend catalog  (frontend can't type/subscribe)
//   - frontend catalog entries with NO literal server broadcast (possible dead tile / dynamic)
//
// NOTE (DS#20 T-E1): a THIRD source of truth exists — n8n workflows also POST
// to /api/sse/broadcast with an arbitrary `body.type`, so some catalog events are
// never emitted by a broadcastSSE("...") literal in src/server/ at all (n8n is the
// sole emitter). Before this fix those events sat in "catalog-only unknown
// (investigate)" forever, indistinguishable from an actually-dead tile — and an
// n8n-side rename would silently break the frontend with NO drift reported. We now
// also scan workflows/n8n/*.json for the `type: '<namespace>:<event>'` JS-object-
// literal shape n8n Code/HTTP-Request nodes embed in their JSON body strings, and
// bucket frontend-catalog events found there as "n8n-emitted, verified live" — a
// distinct bucket from "unknown". A catalog event that is NEITHER a TS literal
// broadcast NOR an n8n-emitted type still falls into "unknown/dead".
//
// EXIT BEHAVIOUR:
//   exit 1 (HARD FAIL) — any safety-critical event (matching SAFETY_RE below) is
//     server-only (broadcast but NOT in frontend catalog). These events represent
//     immediate trading risk (kill-switch, DLL breach, outage, position breach) and
//     MUST be handled in the frontend with sticky persistent toasts. Silence is a
//     production safety gap.
//   exit 0 (ADVISORY) — non-safety drift remains advisory because some server events
//     are broadcast via a variable (not a literal) and would false-positive here.
//     The value is that the contract is VISIBLE + diffable in CI.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = join(ROOT, "src", "server");
const CATALOG = join(ROOT, "Trading_forge_frontend", "amber-vision-main", "src", "types", "sse-events.ts");
const N8N_DIR = join(ROOT, "workflows", "n8n");

// ─── Safety-critical pattern ──────────────────────────────────────────────────
// Events whose names match this pattern represent immediate trading risk. If any
// such event is server-only (broadcast but not in the frontend catalog) we HARD
// FAIL so CI catches the gap before it reaches production.
//
// Pattern rationale (per-token):
//   kill_switch  — kill-switch layer fired / DLL force-close / RL kill-switch engaged
//   dll          — daily loss limit force-close events
//   halt         — trading halted by kill-switch layer
//   breach       — position stop-breach / prop-firm limit breach
//   outage       — exchange outage detected (entry blocked)
//   degraded     — broker circuit-breaker opened (routing degraded)
//   autopause    — DD velocity auto-pause triggered
const SAFETY_RE = /kill_switch|dll|halt|breach|outage|degraded|autopause/;

// ─── Known-dynamic catalog entries ───────────────────────────────────────────
// Events that ARE in the frontend catalog (sse-events.ts discriminated union)
// but have NO literal broadcastSSE("event-name", ...) call in src/server/ —
// because they are broadcast via a constant reference instead of a string literal.
//
// The script regex only matches literal strings; constant references are invisible
// to it. Entries here mark known-dynamic broadcasts so "catalog-only unknown"
// only contains genuinely surprising entries.
//
// To add: verify the broadcast site uses a constant, confirm the constant value
//   matches the catalog event name, add with a comment pointing at the constant.
// To remove: if the broadcast is converted to a literal, remove it here.
const DYNAMIC_BROADCAST_ALLOWLIST = new Set([
  // broker-router.ts — BROKER_ORDER_ROUTED_EVENT constant = "broker:order_routed"
  // All ~15 fill-result paths call broadcastSSE(BROKER_ORDER_ROUTED_EVENT, ...)
  "broker:order_routed",
  // src/server/routes/sse.ts — lifecycle gate events emitted via LIFECYCLE_GATE_EVENTS
  // constants in lifecycle-service.ts (broadcastSSE(LIFECYCLE_GATE_EVENTS.X, ...))
  "lifecycle:promoted",
  // deepscan17-wave2 (2026-07-05) — src/server/routes/sse.ts WAVE29_EVENTS constant.
  // lifecycle-service.ts calls broadcastSSE(WAVE29_EVENTS.PBO_EVALUATED, ...) and
  // broadcastSSE(WAVE29_EVENTS.SHADOW_DIVERGENCE_EVALUATED, ...) — verified both
  // constants resolve to these exact literals; no other WAVE29_EVENTS member needs
  // an entry here because the other 4 (SHADOW_LOGGED / RL_AB_ROUTED /
  // RL_TRAINING_COMPLETED / RL_KILL_SWITCH_ENGAGED) are ALSO broadcast via a
  // separate literal string call site elsewhere, so the literal-matching regex
  // already finds them.
  "lifecycle:pbo_evaluated",
  "lifecycle:shadow_divergence_evaluated",
  // deepscan17-wave2 (2026-07-05) — src/server/routes/sse.ts PAPER_EXIT_EVENTS
  // constant, consumed exclusively via PAPER_EXIT_EVENTS.* in
  // paper-execution-service.ts. VERIFIED the real constant values are
  // "paper:tp1_filled" etc. (NO ":exit:" infix) — the frontend catalog
  // previously typed these as "paper:exit:tp1_filled" etc., a real name
  // mismatch (not just a checker gap) that made the events untypeable on the
  // frontend; corrected in sse-events.ts in the same pass that added this
  // allowlist entry set.
  "paper:tp1_filled",
  "paper:tp2_filled",
  "paper:be_stop_moved",
  "paper:trail_tightened",
  "paper:time_stop_flattened",
  "paper:handler_error",
]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (e === "node_modules" || e === "__tests__" || e === "dist") continue;
      walk(p, out);
    } else if (e.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

// Server: broadcastSSE("event", ...) — literal first arg only.
const serverEvents = new Set();
const serverRe = /broadcastSSE\(\s*["'`]([a-zA-Z0-9:_.-]+)["'`]/g;
for (const f of walk(SERVER_DIR)) {
  const txt = readFileSync(f, "utf8");
  let m;
  while ((m = serverRe.exec(txt)) !== null) serverEvents.add(m[1]);
}

// ─── n8n-emitted events (DS#20 T-E1) ──────────────────────────────────────────
// n8n workflows POST to /api/sse/broadcast with an arbitrary body.type — these
// events never appear as a broadcastSSE("...") literal in src/server/ because
// n8n is the sole emitter. Scan the top-level workflow export JSON files
// (non-recursive — deliberately excludes workflows/n8n/_archived/, which holds
// superseded workflow versions we don't want counted as "verified live") for the
// `type: '<namespace>:<event>'` shape n8n Code/HTTP-Request nodes embed inside
// their JSON-stringified body (single- or double-quoted, "type" key itself may
// or may not be quoted since it's a JS object literal, not JSON, at that point).
const n8nEmittedEvents = new Set();
const n8nTypeRe = /\btype['"]?\s*:\s*['"]([a-z0-9_]+:[a-z0-9_-]+)['"]/gi;
let n8nFiles = [];
try {
  n8nFiles = readdirSync(N8N_DIR).filter((f) => f.endsWith(".json"));
} catch {
  // workflows/n8n not present (e.g. a partial checkout) — n8n-emitted bucket
  // stays empty and previously-n8n-only events fall back to "unknown".
}
for (const f of n8nFiles) {
  const p = join(N8N_DIR, f);
  let st;
  try { st = statSync(p); } catch { continue; }
  if (!st.isFile()) continue;
  let txt;
  try { txt = readFileSync(p, "utf8"); } catch { continue; }
  let m;
  while ((m = n8nTypeRe.exec(txt)) !== null) n8nEmittedEvents.add(m[1].toLowerCase());
}

// Frontend catalog: type: "event" discriminants in the SSEEvent union.
//
// deepscan17-wave2 (2026-07-05) fix: the old regex scanned the WHOLE file, so
// it also matched `type:` fields on unrelated interfaces that happen to share
// the field name "type" — e.g. `BacktestTruthinessFailureData.type: "invariant"
// | "parity" | "parity_skip"` (a data-shape field, not an SSE discriminant)
// leaked in as a phantom "invariant" catalog-only-unknown entry. Scoping the
// scan to the `export type SSEEvent =` ... `;` block only (the actual
// discriminated union) eliminates that whole class of false positive without
// needing a per-string allowlist entry.
const catalogEvents = new Set();
try {
  const cat = readFileSync(CATALOG, "utf8");
  // Strip `//` line comments before depth-scanning — a comment that happens to
  // contain a brace or semicolon (e.g. a code example, or a file path like
  // "foo.ts:123") would otherwise desync the brace-depth counter below.
  // Replaced with equal-length spaces so all character offsets stay aligned
  // with the original text (needed because unionStart/indexOf are computed
  // against `cat`, not the stripped copy).
  const catNoComments = cat.replace(/\/\/[^\n]*/g, (s) => " ".repeat(s.length));
  const unionStart = catNoComments.indexOf("export type SSEEvent =");
  if (unionStart === -1) {
    console.error(`[sse-contract] could not find "export type SSEEvent =" in ${CATALOG} — catalog parse aborted`);
    process.exit(1);
  }
  // Each union member is `| { type: "..."; data: ... }` — the `;` between
  // `type` and `data` is INSIDE the object literal, so a naive indexOf(";")
  // would truncate after the first member. Brace-depth-scan for the real
  // terminating `;` (depth 0, i.e. outside every `{...}`) instead.
  let depth = 0;
  let unionEnd = -1;
  for (let i = unionStart; i < catNoComments.length; i++) {
    const ch = catNoComments[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ";" && depth === 0) { unionEnd = i; break; }
  }
  const unionBlock = unionEnd === -1 ? catNoComments.slice(unionStart) : catNoComments.slice(unionStart, unionEnd);
  const catRe = /type:\s*["']([a-zA-Z0-9:_.-]+)["']/g;
  let m;
  while ((m = catRe.exec(unionBlock)) !== null) catalogEvents.add(m[1]);
} catch {
  console.error(`[sse-contract] catalog not found at ${CATALOG} — skipping (frontend not present?)`);
  process.exit(0);
}

const serverOnly = [...serverEvents].filter((e) => !catalogEvents.has(e)).sort();
const catalogOnly = [...catalogEvents].filter((e) => !serverEvents.has(e)).sort();

// Separate safety-critical missing events from advisory ones.
const safetyCriticalMissing = serverOnly.filter((e) => SAFETY_RE.test(e));
const advisoryMissing = serverOnly.filter((e) => !SAFETY_RE.test(e));

// Separate known-dynamic catalog-only entries, n8n-emitted entries, and unknown ones.
// DS#20 T-E1: n8n-emitted check runs BEFORE the "unknown" fallback so an event that
// is only ever emitted by n8n (never a TS literal, never a constant-reference
// allowlist entry) gets its own explicit "verified live" bucket instead of sitting
// in "unknown" forever.
const dynamicCatalogOnly = catalogOnly.filter((e) => DYNAMIC_BROADCAST_ALLOWLIST.has(e));
const n8nEmittedCatalogOnly = catalogOnly.filter(
  (e) => !DYNAMIC_BROADCAST_ALLOWLIST.has(e) && n8nEmittedEvents.has(e.toLowerCase()),
);
const unknownCatalogOnly = catalogOnly.filter(
  (e) => !DYNAMIC_BROADCAST_ALLOWLIST.has(e) && !n8nEmittedEvents.has(e.toLowerCase()),
);

console.log(`[sse-contract] server literal broadcasts: ${serverEvents.size} | frontend catalog types: ${catalogEvents.size}`);

// ── Safety-critical hard-fail gate ───────────────────────────────────────────
if (safetyCriticalMissing.length > 0) {
  console.error(`\n[sse-contract] HARD FAIL — ${safetyCriticalMissing.length} safety-critical server event(s) are broadcast but NOT in the frontend catalog:`);
  console.error("[sse-contract] These events represent immediate trading risk (kill-switch, DLL breach, exchange");
  console.error("[sse-contract] outage, position breach, broker degradation, DD autopause). The frontend MUST");
  console.error("[sse-contract] handle them with sticky persistent toasts. Add to sse-events.ts + dispatchSideEffects.");
  for (const e of safetyCriticalMissing) console.error(`    !! ${e}`);
  console.error("");
  process.exit(1);
}

console.log("[sse-contract] Safety gate PASS — 0 safety-critical events missing from frontend catalog.");

// ── Advisory reporting ────────────────────────────────────────────────────────
console.log(`[sse-contract] server-only advisory (non-safety, not in catalog): ${advisoryMissing.length}`);
for (const e of advisoryMissing) console.log(`    + ${e}`);

console.log(`[sse-contract] catalog-only allowlisted (dynamic broadcast via constant): ${dynamicCatalogOnly.length}`);
for (const e of dynamicCatalogOnly) console.log(`    ~ ${e}`);

console.log(`[sse-contract] catalog-only n8n-emitted, verified live (workflows/n8n/*.json): ${n8nEmittedCatalogOnly.length}`);
for (const e of n8nEmittedCatalogOnly) console.log(`    n ${e}`);

console.log(`[sse-contract] catalog-only unknown (investigate — dead or needs allowlist): ${unknownCatalogOnly.length}`);
for (const e of unknownCatalogOnly) console.log(`    - ${e}`);

if (advisoryMissing.length > 0) {
  console.log("\n[sse-contract] ADVISORY — exit 0. Add non-safety server events to sse-events.ts to prevent silent tile failures.");
}
process.exit(0);
