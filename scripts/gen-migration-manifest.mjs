#!/usr/bin/env node
/**
 * Regenerate src/server/db/migrations-hash-manifest.json — the immutability baseline enforced by
 * migration-immutability-guard.test.ts (deep-scan migrations F1, 2026-07-06).
 *
 * Run this ONLY when you have ADDED a new migration (never to "fix" a failing guard on an EXISTING
 * migration — that would defeat the guard; an edited historical migration must be reverted, not re-baselined).
 * The resulting one-line-per-new-file diff is reviewable in the PR.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = join(__dirname, "..", "src", "server", "db", "migrations");
const OUT = join(__dirname, "..", "src", "server", "db", "migrations-hash-manifest.json");

const manifest = {};
for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql")).sort()) {
  const buf = readFileSync(join(MIG_DIR, f));
  const content =
    buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  manifest[f] = createHash("sha256").update(content).digest("hex");
}
writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");
console.log(`migrations-hash-manifest.json regenerated: ${Object.keys(manifest).length} migrations frozen`);
