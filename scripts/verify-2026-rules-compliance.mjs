#!/usr/bin/env node
/**
 * verify-2026-rules-compliance.mjs
 *
 * CI lint that enforces drift-detection between:
 *   - Canonical 2026 rule docs (docs/prop-firm-rules-2026-mffu.md, ...-topstep.md)
 *   - Python firm config       (src/engine/firm_config.py)
 *   - TypeScript firm config   (src/shared/firm-config.ts)
 *
 * Reads the YAML "Canonical Values" block in each doc, compares against the
 * MFFU + Topstep entries in both Python and TS configs, and exits non-zero
 * on any mismatch.
 *
 * Usage:
 *   node scripts/verify-2026-rules-compliance.mjs
 *
 *   Or via npm script:
 *   npm run check:2026-compliance
 *
 * Exit codes:
 *   0 — all values aligned
 *   1 — drift detected (lists offending fields)
 *   2 — required input file missing or malformed
 *
 * CI integration:
 *   Add to your CI pipeline (GitHub Actions / Railway build hook) as:
 *     - run: npm run check:2026-compliance
 *   This check is fast (<1s) and pure-FS — no DB connection required.
 *   It should run AFTER build and BEFORE deploy.
 *
 * Boot-time sanity gate recommendation:
 *   This script SHOULD be called at server startup (src/server/index.ts) as a
 *   pre-flight check. When skipped, a mis-aligned firm_config.py/firm-config.ts
 *   can silently serve incorrect compliance thresholds until the next CI run.
 *   Recommended pattern:
 *     import { execFileSync } from "child_process";
 *     try {
 *       execFileSync("node", ["scripts/verify-2026-rules-compliance.mjs"],
 *                    { stdio: "pipe" });
 *     } catch (err) {
 *       logger.error({ err }, "2026 compliance drift detected — review firm configs before trading");
 *       // Do NOT process.exit() — allow server to start, but log the gap.
 *     }
 *   The check is advisory at boot (does not block server start) because a
 *   mis-aligned config should surface as a WARNING, not prevent health checks
 *   and operator debugging from working.
 *
 * Owner: Trading Forge Architect (Pass 1 Track 3 — 2026 Rules Compliance Audit).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MFFU_DOC      = path.join(ROOT, "docs", "prop-firm-rules-2026-mffu.md");
const TOPSTEP_DOC   = path.join(ROOT, "docs", "prop-firm-rules-2026-topstep.md");
const PY_CONFIG     = path.join(ROOT, "src", "engine", "firm_config.py");
const TS_CONFIG     = path.join(ROOT, "src", "shared", "firm-config.ts");

// ─── Parse helpers ─────────────────────────────────────────────────────────

/** Extract the YAML "Canonical Values" block fenced as ```yaml … ```. */
function readCanonicalYaml(docPath) {
  if (!fs.existsSync(docPath)) {
    console.error(`MISSING canonical doc: ${docPath}`);
    process.exit(2);
  }
  const md = fs.readFileSync(docPath, "utf8");
  // Find first fenced ```yaml block AFTER the "Canonical Values" header.
  const headerIdx = md.indexOf("## Canonical Values");
  if (headerIdx === -1) {
    console.error(`MISSING "## Canonical Values" header in ${docPath}`);
    process.exit(2);
  }
  const after = md.slice(headerIdx);
  const fence = after.match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!fence) {
    console.error(`MISSING fenced yaml block under Canonical Values in ${docPath}`);
    process.exit(2);
  }
  // Minimal YAML parser — flat key:value pairs only (no nesting).
  const out = {};
  for (const raw of fence[1].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-z0-9_]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    // Strip trailing inline YAML comment (# ...) before type-coercing the value
    let val = m[2].trim().replace(/\s+#.*$/, "").trim();
    if (val === "null") {
      out[key] = null;
    } else if (val === "true" || val === "false") {
      out[key] = val === "true";
    } else if (/^-?\d+(\.\d+)?$/.test(val)) {
      out[key] = Number(val);
    } else {
      // Quoted string OR bareword
      out[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

/** Slice the FIRM_RULES["<firmId>"]: { … } literal out of firm_config.py.
 *
 * Anchors to "FIRM_RULES" so the smaller FIRM_COMMISSIONS / FIRM_CONTRACT_CAPS
 * dicts don't accidentally match first.
 */
function readPythonFirmEntry(firmKey) {
  if (!fs.existsSync(PY_CONFIG)) {
    console.error(`MISSING ${PY_CONFIG}`);
    process.exit(2);
  }
  const py = fs.readFileSync(PY_CONFIG, "utf8");
  const anchorIdx = py.indexOf("FIRM_RULES");
  if (anchorIdx === -1) {
    console.error(`MISSING FIRM_RULES anchor in ${PY_CONFIG}`);
    process.exit(2);
  }
  const after = py.slice(anchorIdx);
  // Match the multi-line block — body ends at "    }," with the dict-closing
  // indent (4 spaces). FIRM_COMMISSIONS and CAPS use a different layout so
  // we additionally require the body to contain "account_size" — only
  // FIRM_RULES entries have that field.
  const re = new RegExp(`"${firmKey}"\\s*:\\s*\\{([\\s\\S]*?account_size[\\s\\S]*?)\\n\\s*\\},`);
  const m = after.match(re);
  if (!m) {
    console.error(`MISSING entry "${firmKey}" in FIRM_RULES (${PY_CONFIG})`);
    process.exit(2);
  }
  return parsePyDictBody(m[1]);
}

function parsePyDictBody(body) {
  const out = {};
  for (const raw of body.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    // Strip trailing inline comment
    line = line.replace(/\s+#.*$/, "");
    // Strip trailing comma
    line = line.replace(/,\s*$/, "");
    const m = line.match(/^"([a-z0-9_]+)"\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val === "None") {
      out[key] = null;
    } else if (val === "True" || val === "False") {
      out[key] = val === "True";
    } else if (/^-?\d[\d_]*(\.\d+)?$/.test(val)) {
      out[key] = Number(val.replace(/_/g, ""));
    } else {
      out[key] = val.replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

/** Slice the FIRMS.<firmId>.accountTypes["50k"] literal out of firm-config.ts. */
function readTsFirmEntry(firmId) {
  if (!fs.existsSync(TS_CONFIG)) {
    console.error(`MISSING ${TS_CONFIG}`);
    process.exit(2);
  }
  const ts = fs.readFileSync(TS_CONFIG, "utf8");
  // Find "<firmId>: {" then drill into accountTypes "50k"
  const re = new RegExp(`${firmId}\\s*:\\s*\\{[\\s\\S]*?accountTypes\\s*:\\s*\\{[\\s\\S]*?"50k"\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\},?\\s*\\n\\s*\\},`);
  const m = ts.match(re);
  if (!m) {
    console.error(`MISSING entry "${firmId}" in ${TS_CONFIG}`);
    process.exit(2);
  }
  return parseTsObjectBody(m[1]);
}

function parseTsObjectBody(body) {
  const out = {};
  // tokens like `key: value,` (value may contain commas inside arrays/objects — flat only here)
  // strip block comments
  body = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const raw of body.split(/\n/)) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    // Match multiple "key: value,"  on one line
    const parts = line.split(/,(?![^[{]*[\]}])/);
    for (const rawPart of parts) {
      const p = rawPart.trim();
      if (!p) continue;
      const m = p.match(/^([A-Za-z0-9_]+)\s*:\s*(.+?)\s*,?\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (val === "null") {
        out[key] = null;
      } else if (val === "true" || val === "false") {
        out[key] = val === "true";
      } else if (/^-?\d[\d_]*(\.\d+)?$/.test(val)) {
        out[key] = Number(val.replace(/_/g, ""));
      } else {
        out[key] = val.replace(/^["']|["']$/g, "");
      }
    }
  }
  return out;
}

// ─── Field map: doc YAML key → (python key, ts key) ────────────────────────

// Top-level firm_config field name mapping.
// Some YAML keys (e.g. consistency_rule_pct) need translation.
const FIELD_MAP_COMMON = {
  account_size:           { py: "account_size",          ts: "accountSize" },
  monthly_fee:            { py: "monthly_fee",           ts: "monthlyFee" },
  activation_fee:         { py: "activation_fee",        ts: "activationFee" },
  ongoing_monthly_fee:    { py: "ongoing_monthly_fee",   ts: "ongoingMonthlyFee" },
  profit_target:          { py: "profit_target",         ts: "profitTarget" },
  max_drawdown:           { py: "max_drawdown",          ts: "maxDrawdown" },
  max_contracts:          { py: "max_contracts",         ts: "maxContracts" },
  trailing:               { py: "trailing",              ts: "trailing" },
  payout_split:           { py: "payout_split",          ts: "payoutSplit" },
  min_payout_days:        { py: "min_payout_days",       ts: "minPayoutDays" },
  min_trading_days:       { py: "min_trading_days",      ts: "minTradingDays" },
  daily_loss_limit:       { py: "daily_loss_limit",      ts: "dailyLossLimit" },
  overnight_ok:           { py: "overnight_ok",          ts: "overnightOk" },
  weekend_ok:             { py: "weekend_ok",            ts: "weekendOk" },
  commission_per_side:    { py: null,                    ts: "commissionPerSide" }, // PY tracks via FIRM_COMMISSIONS
};

const FIELD_MAP_MFFU = {
  payout_cycle_days:                          { py: "payout_cycle_days",                          ts: "payoutCycleDays" },
};

const FIELD_MAP_TOPSTEP = {
  platform_lockdown_date:                     { py: "platform_lockdown_date",                     ts: "platformLockdownDate" },
  required_platform:                          { py: "required_platform",                          ts: "requiredPlatform" },
  allows_vps:                                 { py: "allows_vps",                                 ts: "allowsVps" },
  allows_vpn:                                 { py: "allows_vpn",                                 ts: "allowsVpn" },
  allows_remote_desktop:                      { py: "allows_remote_desktop",                      ts: "allowsRemoteDesktop" },
  multi_account_within_user_allowed:          { py: "multi_account_within_user_allowed",          ts: "multiAccountWithinUserAllowed" },
  copy_trades_within_user_allowed:            { py: "copy_trades_within_user_allowed",            ts: "copyTradesWithinUserAllowed" },
};

// ─── Staleness check (non-fatal WARN) ────────────────────────────────────────

/**
 * Emit a non-fatal WARN when a doc's "Last reviewed:" date is more than
 * STALENESS_WARN_DAYS days ago. This does NOT fail CI (exits 0 regardless),
 * but surfaces future staleness before it becomes a compliance gap.
 */
const STALENESS_WARN_DAYS = 30;

function warnIfStale(docPath) {
  if (!fs.existsSync(docPath)) return; // readCanonicalYaml will catch missing files
  const md = fs.readFileSync(docPath, "utf8");
  const m = md.match(/>\s*Last reviewed:\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) {
    console.warn(`WARN verify-2026-rules-compliance: no "Last reviewed:" date found in ${path.basename(docPath)}`);
    return;
  }
  const reviewedDate = new Date(m[1]);
  const ageMs = Date.now() - reviewedDate.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  if (ageDays > STALENESS_WARN_DAYS) {
    console.warn(
      `WARN verify-2026-rules-compliance: ${path.basename(docPath)} last reviewed ${m[1]} ` +
      `(${ageDays} days ago — exceeds ${STALENESS_WARN_DAYS}-day staleness threshold). ` +
      `Re-verify firm rules before next promotion cycle.`,
    );
  }
}

// ─── Comparison ───────────────────────────────────────────────────────────

function compareFirm({ docKey, pyKey, tsKey, firmName, fieldMaps }) {
  const docVals = readCanonicalYaml(docKey);
  const py = readPythonFirmEntry(pyKey);
  const ts = readTsFirmEntry(tsKey);

  const drift = [];

  for (const fieldMap of fieldMaps) {
    for (const [yamlKey, mapping] of Object.entries(fieldMap)) {
      // consistency_rule_pct YAML maps to 0.50 in TS but "mffu_50pct" in PY — handle separately
      if (yamlKey === "consistency_rule_pct") {
        const docVal = docVals[yamlKey];
        // Python uses string label: "mffu_50pct" or null
        const pyVal = py.consistency_rule;
        const tsVal = ts.consistencyRule;
        if (docVal === null) {
          if (pyVal !== null) drift.push({ firm: firmName, field: yamlKey, layer: "py", expected: null, found: pyVal });
          if (tsVal !== null) drift.push({ firm: firmName, field: yamlKey, layer: "ts", expected: null, found: tsVal });
        } else {
          if (typeof tsVal === "number" && Math.abs(tsVal - docVal) > 1e-9) {
            drift.push({ firm: firmName, field: yamlKey, layer: "ts", expected: docVal, found: tsVal });
          }
          // For PY, accept any string containing the percent (e.g. "mffu_50pct" for 0.50)
          const pct = Math.round(docVal * 100);
          if (typeof pyVal !== "string" || !pyVal.includes(`${pct}pct`)) {
            drift.push({ firm: firmName, field: yamlKey, layer: "py", expected: `*${pct}pct*`, found: pyVal });
          }
        }
        continue;
      }

      if (!(yamlKey in docVals)) continue;
      const docVal = docVals[yamlKey];
      if (mapping.py) {
        const pyVal = py[mapping.py];
        if (!equiv(pyVal, docVal)) {
          drift.push({ firm: firmName, field: yamlKey, layer: "py", expected: docVal, found: pyVal });
        }
      }
      if (mapping.ts) {
        const tsVal = ts[mapping.ts];
        if (!equiv(tsVal, docVal)) {
          drift.push({ firm: firmName, field: yamlKey, layer: "ts", expected: docVal, found: tsVal });
        }
      }
    }
  }

  return drift;
}

function equiv(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return String(a) === String(b);
}

// ─── Main ─────────────────────────────────────────────────────────────────

function main() {
  // Non-fatal staleness warnings — fires before drift checks so they always
  // surface even when the CI gate itself is green.
  warnIfStale(MFFU_DOC);
  warnIfStale(TOPSTEP_DOC);

  let drift = [];

  drift.push(...compareFirm({
    docKey: MFFU_DOC,
    pyKey: "mffu_50k",
    tsKey: "mffu",
    firmName: "MFFU",
    fieldMaps: [FIELD_MAP_COMMON, FIELD_MAP_MFFU],
  }));

  drift.push(...compareFirm({
    docKey: TOPSTEP_DOC,
    pyKey: "topstep_50k",
    tsKey: "topstep",
    firmName: "Topstep",
    fieldMaps: [FIELD_MAP_COMMON, FIELD_MAP_TOPSTEP],
  }));

  if (drift.length === 0) {
    console.log("verify-2026-rules-compliance: OK — MFFU + Topstep aligned with canonical 2026 docs");
    process.exit(0);
  }

  console.error("verify-2026-rules-compliance: DRIFT DETECTED");
  console.error("");
  for (const d of drift) {
    console.error(
      `  [${d.firm}] field="${d.field}" layer="${d.layer}" expected=${JSON.stringify(d.expected)} found=${JSON.stringify(d.found)}`,
    );
  }
  console.error("");
  console.error("Fix: update the offending file (firm_config.py / firm-config.ts) OR the canonical doc (whichever is correct).");
  console.error("Reference: docs/prop-firm-rules-2026-mffu.md, docs/prop-firm-rules-2026-topstep.md");
  process.exit(1);
}

main();
