/**
 * Pass 21 (2026-05-12) — rewrite backend URL references in all 30 n8n workflow
 * JSONs so they point at a publicly-reachable Trading Forge backend URL
 * instead of `host.docker.internal:4000` (which was Docker-network magic that
 * only worked when n8n + backend were on the same Docker host).
 *
 * Now that n8n runs on Railway, it can't reach `host.docker.internal`. Workflows
 * must call the tower's backend through a public tunnel (Tailscale Funnel,
 * Cloudflare Tunnel, ngrok, etc.).
 *
 * Usage:
 *   TF_BACKEND_PUBLIC_URL=https://tf.tail123.ts.net npx tsx scripts/rewrite-workflow-backend-urls.ts
 *
 * Replaces every:   http://host.docker.internal:4000  →  $TF_BACKEND_PUBLIC_URL
 *                   https://host.docker.internal:4000 →  $TF_BACKEND_PUBLIC_URL
 *                   http://localhost:4000             →  $TF_BACKEND_PUBLIC_URL
 *
 * Writes the rewritten JSONs back to workflows/n8n/*.json — those then need
 * to be re-imported via scripts/import-workflows-to-railway-n8n.ts to push the
 * updated URLs to Railway.
 *
 * Idempotent — running twice with the same target URL is a no-op.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const TARGET = process.env.TF_BACKEND_PUBLIC_URL;
if (!TARGET) {
  console.error("ERROR: Set TF_BACKEND_PUBLIC_URL env var (e.g. https://tf.tail123.ts.net or https://tf-api.tonio.com)");
  process.exit(1);
}
if (!/^https?:\/\//.test(TARGET)) {
  console.error("ERROR: TF_BACKEND_PUBLIC_URL must include http:// or https://");
  process.exit(1);
}

const WORKFLOWS_DIR = path.resolve("workflows/n8n");
// Path-aware replacements. Tuple = [pattern → suffix to append after TARGET].
// The relay client routes path prefixes to the right tower port; this rewriter
// converts old direct-port URLs into the prefixed form.
//
// Ordering matters — more-specific patterns first.
const PATH_REPLACEMENTS: Array<[RegExp, string]> = [
  // Ollama (port 11434) → relay /__ollama prefix
  [/https?:\/\/host\.docker\.internal:11434/gi, "/__ollama"],
  [/https?:\/\/localhost:11434/gi, "/__ollama"],
  // OpenClaw Discord alert sidecar (port 4100) → relay /__oc prefix
  [/https?:\/\/host\.docker\.internal:4100/gi, "/__oc"],
  [/https?:\/\/localhost:4100/gi, "/__oc"],
  // OpenClaw gateway main (port 18789) → relay /__ocg prefix
  [/https?:\/\/host\.docker\.internal:18789/gi, "/__ocg"],
  [/https?:\/\/localhost:18789/gi, "/__ocg"],
  // Trading Forge API (port 4000) → relay default route (no prefix)
  [/https?:\/\/host\.docker\.internal:4000/g, ""],
  [/http:\/\/localhost:4000/g, ""],
  // Previously-set public tunnel URLs (Cloudflare quick tunnels, Tailscale Funnel)
  [/https?:\/\/[a-z0-9-]+\.trycloudflare\.com/gi, ""],
  [/https?:\/\/[a-z0-9-]+\.tailfeba69\.ts\.net/gi, ""],
];

// n8n self-references (port 5678) must point at Railway-hosted n8n public URL,
// not at the relay (the relay doesn't proxy n8n back to itself).
const N8N_SELF_PATTERNS = [
  /https?:\/\/localhost:5678/gi,
  /https?:\/\/host\.docker\.internal:5678/gi,
];
const N8N_RAILWAY_URL = "https://n8n-production-84ff.up.railway.app";

let totalFiles = 0;
let touchedFiles = 0;
let totalReplacements = 0;

for (const file of fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".json"))) {
  totalFiles++;
  const filePath = path.join(WORKFLOWS_DIR, file);
  const original = fs.readFileSync(filePath, "utf-8");
  let updated = original;
  let fileReplacements = 0;
  // 1. Path-routed rewrites: old port-specific URL → TARGET + path prefix
  for (const [pat, prefix] of PATH_REPLACEMENTS) {
    const before = updated;
    updated = updated.replace(pat, TARGET + prefix);
    if (before !== updated) {
      const matches = before.match(pat);
      fileReplacements += matches?.length ?? 0;
    }
  }
  // 2. n8n self-references → Railway n8n URL
  for (const pat of N8N_SELF_PATTERNS) {
    const before = updated;
    updated = updated.replace(pat, N8N_RAILWAY_URL);
    if (before !== updated) {
      const matches = before.match(pat);
      fileReplacements += matches?.length ?? 0;
    }
  }
  if (fileReplacements > 0) {
    fs.writeFileSync(filePath, updated, "utf-8");
    touchedFiles++;
    totalReplacements += fileReplacements;
    console.log(`  ${file}  — ${fileReplacements} replacements`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`  Files scanned:    ${totalFiles}`);
console.log(`  Files updated:    ${touchedFiles}`);
console.log(`  Total replacements: ${totalReplacements}`);
console.log(`  Target URL:       ${TARGET}`);
console.log(`\nNext step: re-run scripts/import-workflows-to-railway-n8n.ts to push updates to Railway.`);
