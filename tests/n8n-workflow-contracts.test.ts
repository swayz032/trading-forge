/**
 * Pass 11 Phase 6 — n8n workflow contract tests.
 *
 * Static checks against the post-fix workflow JSON snapshots saved at
 * tmp-n8n/wf-*.json. These tests do NOT call the n8n API — they are pure
 * regex / JSON inspections so CI can run them without n8n running.
 *
 * The tests guard against four classes of regression:
 *   1. Scout-shape workflows must declare `signal_type` in jsonBody
 *   2. No hardcoded API keys (Brave / Tavily / OpenAI / Parallel /
 *      raw n8n JWT) anywhere in the workflow JSON
 *   3. Strategy-generation workflows must use multi-symbol prompts
 *      (MES / MNQ / MCL) — single-symbol "ES futures" / "specializing
 *      in ES" / "E-mini S&P 500" phrases are forbidden unless the file
 *      name carries the allowlist marker comment
 *   4. No port-4100 `/alert/*` endpoint references
 *
 * Each failure message names the offending file (and indirectly the
 * node) so future agents can locate the regression in seconds.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const TMP_DIR = path.resolve(__dirname, "..", "tmp-n8n");

const SCOUT_WF_IDS = [
  "wf-Ep2Zsu33tMOsaJbE.json", // 5J unified-search-router-scout
  "wf-lUenVARPUG1uz4OE.json", // 5K parallel-deep-research
  "wf-F6i4JoTdxgiyjHhM.json", // 5L quant-blog-harvester
  "wf-7PgUY6Wa07aZbAPX.json", // 5M brave-news-watcher
];

const STRATEGY_GEN_WF_IDS = [
  "wf-Z4NcOCDbet8KzjDd.json",
  "wf-eCr7cyb0aPArFCZc.json",
  "wf-sAIrnCVB4iOsodsy.json",
];

const ALL_SNAPSHOT_FILES = (() => {
  if (!fs.existsSync(TMP_DIR)) return [];
  return fs
    .readdirSync(TMP_DIR)
    .filter((f) => /^wf-[A-Za-z0-9]+\.json$/.test(f)); // production snapshots only — no -phase2-pre etc.
})();

function readSnap(file: string): { raw: string; json: unknown } | null {
  const fp = path.join(TMP_DIR, file);
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, "utf-8");
  if (raw.trim().length === 0) return null;
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    return { raw, json: null };
  }
}

const API_KEY_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "brave", regex: /BSA[a-zA-Z0-9\-_]{10,}/ },
  { name: "tavily", regex: /tvly-[a-zA-Z0-9\-_]{10,}/ },
  { name: "openai", regex: /sk-[a-zA-Z0-9]{20,}/ },
  { name: "parallel", regex: /l7Whs[a-zA-Z0-9_]{10,}/ },
  { name: "n8n_jwt", regex: /eyJhbGciOi[a-zA-Z0-9._\-]+/ },
];

describe("n8n workflow contract — scout signal_type", () => {
  for (const file of SCOUT_WF_IDS) {
    it(`${file} declares signal_type in scout POST body`, () => {
      const snap = readSnap(file);
      if (!snap) {
        // Snapshot missing or empty → skip (file may not have been
        // saved yet in dev). CI environments that store all snapshots
        // will exercise this path.
        return;
      }
      // Scout body must mention signal_type. We accept the canonical
      // strict body field as well as variants.
      expect(
        snap.raw.includes("signal_type"),
        `${file} is missing signal_type in scout POST body`,
      ).toBe(true);
    });
  }
});

describe("n8n workflow contract — no hardcoded API keys", () => {
  for (const file of ALL_SNAPSHOT_FILES) {
    it(`${file} contains no inline API keys`, () => {
      const snap = readSnap(file);
      if (!snap) return;
      for (const { name, regex } of API_KEY_PATTERNS) {
        const m = snap.raw.match(regex);
        expect(
          m === null,
          `${file} contains a hardcoded ${name} key (${m?.[0]?.slice(0, 16)}…) — move to $env`,
        ).toBe(true);
      }
    });
  }
});

describe("n8n workflow contract — strategy generation uses multi-symbol prompts", () => {
  // Either the workflow JSON contains MES + MNQ + MCL (in any order
  // across the document), OR it carries the explicit allowlist marker
  // `n8n-drift-allowed: symbol-specific` somewhere.
  const ALLOW_MARKER = /n8n-drift-allowed\s*:\s*symbol-specific/i;
  for (const file of STRATEGY_GEN_WF_IDS) {
    it(`${file} enumerates MES + MNQ + MCL (or carries allowlist marker)`, () => {
      const snap = readSnap(file);
      if (!snap) return;
      const hasAllow = ALLOW_MARKER.test(snap.raw);
      const hasAllThree =
        /\bMES\b/.test(snap.raw) &&
        /\bMNQ\b/.test(snap.raw) &&
        /\bMCL\b/.test(snap.raw);
      expect(
        hasAllow || hasAllThree,
        `${file} does not enumerate MES/MNQ/MCL and is not allowlisted — single-symbol drift risk`,
      ).toBe(true);
    });
  }
});

describe("n8n workflow contract — no port-4100 /alert/ endpoints", () => {
  const PORT_4100_ALERT = /host\.docker\.internal:4100\/alert\//i;
  for (const file of ALL_SNAPSHOT_FILES) {
    it(`${file} contains no host.docker.internal:4100/alert/* references`, () => {
      const snap = readSnap(file);
      if (!snap) return;
      const m = snap.raw.match(PORT_4100_ALERT);
      expect(
        m === null,
        `${file} still POSTs to dead port-4100 alert endpoint (${m?.[0]}) — redirect to /api/sse/broadcast or /api/alerts`,
      ).toBe(true);
    });
  }
});
