#!/usr/bin/env node
// deepscan6 O10 (2026-07-01): SSE contract visibility check.
// deepscan12 Track R (2026-07-02): Added hard-fail gate for safety-critical server-only events.
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

// Frontend catalog: type: "event" discriminants in the SSEEvent union.
const catalogEvents = new Set();
try {
  const cat = readFileSync(CATALOG, "utf8");
  const catRe = /type:\s*["']([a-zA-Z0-9:_.-]+)["']/g;
  let m;
  while ((m = catRe.exec(cat)) !== null) catalogEvents.add(m[1]);
} catch {
  console.error(`[sse-contract] catalog not found at ${CATALOG} — skipping (frontend not present?)`);
  process.exit(0);
}

const serverOnly = [...serverEvents].filter((e) => !catalogEvents.has(e)).sort();
const catalogOnly = [...catalogEvents].filter((e) => !serverEvents.has(e)).sort();

// Separate safety-critical missing events from advisory ones.
const safetyCriticalMissing = serverOnly.filter((e) => SAFETY_RE.test(e));
const advisoryMissing = serverOnly.filter((e) => !SAFETY_RE.test(e));

// Separate known-dynamic catalog-only entries from unknown ones.
const dynamicCatalogOnly = catalogOnly.filter((e) => DYNAMIC_BROADCAST_ALLOWLIST.has(e));
const unknownCatalogOnly = catalogOnly.filter((e) => !DYNAMIC_BROADCAST_ALLOWLIST.has(e));

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

console.log(`[sse-contract] catalog-only unknown (investigate — dead or needs allowlist): ${unknownCatalogOnly.length}`);
for (const e of unknownCatalogOnly) console.log(`    - ${e}`);

if (advisoryMissing.length > 0) {
  console.log("\n[sse-contract] ADVISORY — exit 0. Add non-safety server events to sse-events.ts to prevent silent tile failures.");
}
process.exit(0);
