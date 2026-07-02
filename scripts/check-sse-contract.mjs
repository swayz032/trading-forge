#!/usr/bin/env node
// deepscan6 O10 (2026-07-01): SSE contract visibility check.
//
// The server broadcasts ~178 SSE events via broadcastSSE("<event>", data); the frontend
// declares a typed catalog (the SSEEvent discriminated union in
// Trading_forge_frontend/amber-vision-main/src/types/sse-events.ts). Nothing bound the two,
// so a renamed/added server event could silently stop feeding a dashboard tile.
//
// This derives BOTH sides from source and reports the drift:
//   - server literal broadcasts NOT in the frontend catalog  (frontend can't type/subscribe)
//   - frontend catalog entries with NO literal server broadcast (possible dead tile / dynamic)
//
// ADVISORY (exit 0) — some server events are broadcast via a variable, not a literal, so a
// hard failure would false-positive. The value is that the contract is now VISIBLE + diffable
// in CI. Tighten to blocking once dynamic broadcasts are enumerated.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = join(ROOT, "src", "server");
const CATALOG = join(ROOT, "Trading_forge_frontend", "amber-vision-main", "src", "types", "sse-events.ts");

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

console.log(`[sse-contract] server literal broadcasts: ${serverEvents.size} | frontend catalog types: ${catalogEvents.size}`);
console.log(`[sse-contract] server-only (broadcast but NOT in frontend catalog): ${serverOnly.length}`);
for (const e of serverOnly) console.log(`    + ${e}`);
console.log(`[sse-contract] catalog-only (typed but no literal broadcaster — dynamic or dead): ${catalogOnly.length}`);
for (const e of catalogOnly) console.log(`    - ${e}`);
console.log("[sse-contract] ADVISORY — exit 0. Add missing server events to sse-events.ts so a renamed event can't silently kill a dashboard tile.");
process.exit(0);
