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
 *   TF_BACKEND_PUBLIC_URL=https://tf.tail123.ts.net npx tsx scripts/rewrite-workflow-backend-urls.ts            # DRY-RUN (default)
 *   TF_BACKEND_PUBLIC_URL=https://tf.tail123.ts.net npx tsx scripts/rewrite-workflow-backend-urls.ts --apply    # actually rewrite files
 *
 * Replaces every:   http://host.docker.internal:4000  →  $TF_BACKEND_PUBLIC_URL
 *                   https://host.docker.internal:4000 →  $TF_BACKEND_PUBLIC_URL
 *                   http://localhost:4000             →  $TF_BACKEND_PUBLIC_URL
 *
 * Writes the rewritten JSONs back to workflows/n8n/*.json — those then need
 * to be re-imported via scripts/import-workflows-to-railway-n8n.ts to push the
 * updated URLs to Railway.
 *
 * F-4 (deep-scan): like the importer, this OVERWRITES the local workflow JSON in
 * place with no diff and no confirmation. It now DEFAULTS to a dry-run that prints
 * which files WOULD change (and the replacement count) without writing; pass
 * `--apply` to actually rewrite the files. Mirrors the safe default in
 * scripts/wipe-strategy-bucket-fresh-start.ts and the importer above.
 *
 * Idempotent — running twice with the same target URL is a no-op.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

// F-4: dry-run by DEFAULT — an unguarded in-place rewrite silently mutates the
// workflow source of truth. Only `--apply` writes files.
const ARGS = new Set(process.argv.slice(2));
const IS_APPLY = ARGS.has("--apply");
const IS_DRY_RUN = !IS_APPLY;

const TARGET = process.env.TF_BACKEND_PUBLIC_URL;
if (!TARGET) {
  console.error("ERROR: Set TF_BACKEND_PUBLIC_URL env var (e.g. https://tf.tail123.ts.net or https://tf-api.tonio.com)");
  process.exit(1);
}
if (!/^https?:\/\//.test(TARGET)) {
  console.error("ERROR: TF_BACKEND_PUBLIC_URL must include http:// or https://");
  process.exit(1);
}

if (IS_DRY_RUN) {
  console.log("=== DRY-RUN (default) — no files will be modified. Re-run with --apply to rewrite. ===\n");
} else {
  console.log("=== --apply — writing rewritten workflow JSON in place. ===\n");
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
    if (!IS_DRY_RUN) {
      fs.writeFileSync(filePath, updated, "utf-8");
    }
    touchedFiles++;
    totalReplacements += fileReplacements;
    console.log(`  ${IS_DRY_RUN ? "~ WOULD REWRITE " : "  "}${file}  — ${fileReplacements} replacements`);
  }
}

console.log(`\n=== Summary (${IS_DRY_RUN ? "DRY-RUN — no files modified" : "APPLIED"}) ===`);
console.log(`  Files scanned:    ${totalFiles}`);
console.log(`  Files ${IS_DRY_RUN ? "that would change" : "updated"}:    ${touchedFiles}`);
console.log(`  Total replacements: ${totalReplacements}`);
console.log(`  Target URL:       ${TARGET}`);
if (IS_DRY_RUN) {
  console.log(`\nDry-run complete — no files were written. Re-run with --apply to rewrite, then re-run scripts/import-workflows-to-railway-n8n.ts --apply to push updates to Railway.`);
} else {
  console.log(`\nNext step: re-run scripts/import-workflows-to-railway-n8n.ts --apply to push updates to Railway.`);
}
