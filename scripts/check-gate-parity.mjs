#!/usr/bin/env node
// deepscan18 D-D1 (2026-07-05): PAPER → DEPLOY_READY cron-vs-manual gate-parity net.
//
// WHY THIS EXISTS
// ---------------
// The PAPER → DEPLOY_READY promotion decision is implemented TWICE:
//
//   1. CRON path  — the ~1600-line inline gate stack inside
//      lifecycle-service.ts::checkAutoPromotions (the autonomous sweep).
//   2. MANUAL path — lifecycle-service.ts::_promoteStrategyInner runs a few inline
//      gates and then DELEGATES the rest to the pure evaluator
//      lib/paper-to-deploy-ready-gates.ts::evaluatePaperToDeployReadyGates
//      (this is the PATCH /:id/lifecycle + n8n + Carter promotion path).
//
// These two paths are HAND-SYNCED. There is no compiler check that a gate present on
// one path also fires on the other. Twice this bit us: A-1 (DSL guards) and A7 (signal
// correlation) shipped CRON-ONLY and survived to production — a correctly-signed manual
// promotion of an unguarded / signal-duplicate strategy reached live capital until a
// manual audit caught it (deep-scan #17). This check is the automated net that would
// have caught both at CI time.
//
// WHAT IT DOES
// ------------
// It statically enumerates the promotion-gate identifiers invoked on each path and
// asserts a canonical registry against them:
//
//   * Every HARD gate in the registry MUST appear on BOTH paths.  (the core net)
//   * Every documented one-path DIVERGENCE MUST still hold (the gate is present on its
//     declared path and its rationale is version-controlled here).
//   * Every gate-like token found in a region MUST be accounted for by the registry
//     (reverse scan) — so a brand-new `evaluateXxxGate` added to one path but not the
//     other, or not mirrored, HARD-FAILS until it is registered + mirrored.
//
// Comments are stripped before token scanning so a gate name mentioned in a "we removed
// this" comment (e.g. the F-5 note about the standalone WFE gate) is not counted as a
// live call.
//
// DESIGN NOTE (robustness over cleverness): a static enumerator was chosen over a pglite
// end-to-end "run one strategy through both paths and diff the fired gate set" test. The
// cron path pulls MC runs, a Python survival-twin subprocess, walk-forward blobs, frozen
// policy, composite-shadow DB rows, etc.; a live dual-path run would be enormous and
// flaky. The gate identity that actually drifts is the SET OF GATE CALLS, and that is
// exactly what this enumerates — deterministically, with no DB, no Python, no network.
//
// EXIT BEHAVIOUR: exit 1 (HARD FAIL) on any parity violation or if a source region
// cannot be located (a broken check must fail loudly, never silently pass). Intended to
// join the CI hard gates (system-map:check / production-isolation / 2026-compliance).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIFECYCLE = join(ROOT, "src", "server", "services", "lifecycle-service.ts");
const EVALUATOR = join(ROOT, "src", "server", "lib", "paper-to-deploy-ready-gates.ts");

// ─── Comment stripping ────────────────────────────────────────────────────────
// Remove /* … */ block comments and // line comments (preserving `://` in URLs) so a
// gate name mentioned in a comment ("F-5 REMOVED the standalone WFE gate …") is not
// mistaken for a live call. String literals are preserved — audit-action identities
// like "lifecycle.b15_parameter_robustness_blocked" must survive.
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Strip `// …` to EOL, but not when preceded by `:` (keeps https:// intact).
  return noBlock.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

// ─── Region extraction (anchor-delimited, line-number independent) ────────────
function sliceBetween(src, startAnchor, endAnchor, label) {
  const start = src.indexOf(startAnchor);
  if (start === -1) {
    fail(
      `Region anchor NOT FOUND for ${label}: start anchor\n    ${JSON.stringify(startAnchor)}\n` +
        `  The gate-parity check cannot locate this promotion path. If the code was ` +
        `refactored, update the anchor in scripts/check-gate-parity.mjs — do NOT let ` +
        `this check silently pass.`,
    );
  }
  const end = src.indexOf(endAnchor, start + startAnchor.length);
  if (end === -1) {
    fail(
      `Region anchor NOT FOUND for ${label}: end anchor\n    ${JSON.stringify(endAnchor)}\n` +
        `  Update the anchor in scripts/check-gate-parity.mjs.`,
    );
  }
  return src.slice(start, end);
}

const errors = [];
function fail(msg) {
  errors.push(msg);
}

const lifecycleRaw = readFileSync(LIFECYCLE, "utf8");
const evaluatorRaw = readFileSync(EVALUATOR, "utf8");

// Region anchors are matched against RAW source (several anchors are section-header
// COMMENTS — e.g. "Gate 3: PAPER" — which would vanish if we stripped comments first).
// Comments are stripped AFTER slicing, per region, so a gate name in a "we removed this"
// comment is never counted as a live call.

// MANUAL path spans two regions:
//   A = the _promoteStrategyInner PAPER→DEPLOY_READY inline block (compliance-drift,
//       A-1 DSL guards, A7 signal correlation, on-demand survival-twin, slippage, BIF
//       cpcv pre-check) BEFORE it delegates to the evaluator.
//   B = the evaluatePaperToDeployReadyGates evaluator body (the delegated gates).
const regionManualA = stripComments(
  sliceBetween(
    lifecycleRaw,
    'if (fromState === "PAPER" && toState === "DEPLOY_READY" && !options.skipPaperToDeployReadyEvaluator)',
    "Pass 5 Track C: SHADOW",
    "MANUAL path — _promoteStrategyInner PAPER→DEPLOY_READY block",
  ),
);
const regionManualB = stripComments(
  sliceBetween(
    evaluatorRaw,
    "export function evaluatePaperToDeployReadyGates(",
    "On-demand B14 Survival Twin replay resolver",
    "MANUAL path — evaluatePaperToDeployReadyGates evaluator",
  ),
);
const manualSrc = regionManualA + "\n" + regionManualB;

// CRON path = the checkAutoPromotions PAPER→DEPLOY_READY loop.
const regionCron = stripComments(
  sliceBetween(
    lifecycleRaw,
    "Gate 3: PAPER",
    "return promoted;",
    "CRON path — checkAutoPromotions PAPER→DEPLOY_READY loop",
  ),
);

// ─── Gate identity vocabulary ─────────────────────────────────────────────────
// A token is "gate-like" if it matches the evaluate*Gate / check*Gate naming
// convention OR is one of the known non-conforming gate helpers below. The reverse
// scan requires every gate-like token found in a region to be registered — so a new
// `evaluateXxxGate` on only one path is caught.
const GATE_NAME_RE = /\b(?:evaluate|check)[A-Za-z0-9]*Gate\b/g;
const EXPLICIT_GATE_TOKENS = [
  "evaluatePromotionGates", // orchestrator (WFE-0.80 / CPCV / WRC / SPA) — ends in "Gates"
  "evaluateCompositeShadow",
  "evaluateFrozenPolicyDriftAtPromotion",
  "resolveSurvivalTwinOnDemand",
  "resolveComplianceDriftForPromotion",
];

function gateTokensIn(src) {
  const found = new Set();
  let m;
  GATE_NAME_RE.lastIndex = 0;
  while ((m = GATE_NAME_RE.exec(src)) !== null) {
    // Ignore the delegation wrapper itself — it is not a gate.
    if (m[0] === "evaluatePaperToDeployReadyGates") continue;
    found.add(m[0]);
  }
  for (const t of EXPLICIT_GATE_TOKENS) {
    if (src.includes(t)) found.add(t);
  }
  return found;
}

const foundManual = gateTokensIn(manualSrc);
const foundCron = gateTokensIn(regionCron);

// ─── Canonical PAPER → DEPLOY_READY gate registry ─────────────────────────────
// HARD gates MUST fire on BOTH paths. Identity is the gate helper call, or (for the
// two gates with no dedicated helper) the canonical block audit-action string.
const HARD_GATES = [
  { id: "compliance_drift", token: "resolveComplianceDriftForPromotion" },
  { id: "a1_dsl_guards", token: "evaluateDslGuardsGate" },
  { id: "a7_signal_correlation", token: "checkSignalCorrelationGate" },
  { id: "b14_survival_twin", token: "resolveSurvivalTwinOnDemand" },
  { id: "b14_ci", token: "evaluateB14CiGate" },
  // B15 is inline on both paths (no shared helper) — identity is its block audit action.
  { id: "b15_param_robustness", token: "lifecycle.b15_parameter_robustness_blocked", audit: true },
  { id: "parameter_drift", token: "evaluateParameterDriftGate" },
  { id: "dsr_walk_forward", token: "evaluateDsrWalkForwardGate" },
  { id: "slippage_survival", token: "evaluateSlippageSurvivalGate" },
  { id: "bif", token: "evaluateBifGate" },
  { id: "orchestrator", token: "evaluatePromotionGates" },
  { id: "frozen_policy", token: "evaluateFrozenPolicyDriftAtPromotion" },
];

// DOCUMENTED one-path divergences. These are allowed to appear on only one path;
// the rationale is version-controlled here so the exemption is deliberate, not silent.
// A divergence gate must still be PRESENT on its declared path (a stale entry fails).
const DIVERGENCES = [
  {
    id: "wfe_standalone",
    token: "evaluateWfeGate",
    onPath: "manual",
    reason:
      "F-5 (2026-06-23): the standalone 0.70 WFE gate was REMOVED from the cron path " +
      "because it double-evaluated with the orchestrator's 0.80 WFE floor " +
      "(evaluatePromotionGates), which IS on both paths and is STRICTER. The manual " +
      "evaluator still runs the 0.70 standalone as an extra layer. No hole: the cron " +
      "enforces the stricter 0.80 floor via the orchestrator.",
  },
  {
    id: "composite_shadow",
    token: "evaluateCompositeShadow",
    onPath: "cron",
    reason:
      "Observability-only (Wave 28 Pass B) — NEVER blocks a promotion. The cron pre-" +
      "fetches the shadow eval via evaluateCompositeShadow; the manual path passes " +
      "compositeShadow:null and the evaluator inlines a no-opinion shadow result. No " +
      "hole because the shadow gate has no block path on either side.",
  },
  {
    id: "b10_mrp",
    token: "lifecycle.mrp_soft_gate_advisory",
    audit: true,
    onPath: "cron",
    reason:
      "B10 MRP is a SOFT advisory gate (NEVER blocks; the hard gate is deferred pending " +
      "30-day MRP data). Cron-only advisory logging; its absence on the manual path " +
      "cannot create a bypass because the gate has no block path.",
  },
];

// Presence helpers. Audit-action identities are matched against the raw region text
// (they are string literals, not gate-name tokens) so they survive the vocabulary set.
function presentIn(gate, tokenSet, rawRegionSrc) {
  return gate.audit ? rawRegionSrc.includes(gate.token) : tokenSet.has(gate.token);
}

// ─── Forward check: every HARD gate on BOTH paths ─────────────────────────────
for (const g of HARD_GATES) {
  const inManual = presentIn(g, foundManual, manualSrc);
  const inCron = presentIn(g, foundCron, regionCron);
  if (!inManual || !inCron) {
    const missing = [];
    if (!inManual) missing.push("MANUAL (_promoteStrategyInner + evaluatePaperToDeployReadyGates)");
    if (!inCron) missing.push("CRON (checkAutoPromotions)");
    fail(
      `HARD gate parity BROKEN: '${g.id}' (identity ${JSON.stringify(g.token)}) is MISSING ` +
        `from the ${missing.join(" and ")} path(s).\n` +
        `  Every HARD PAPER→DEPLOY_READY gate must fire on BOTH the cron sweep AND the ` +
        `manual PATCH path, or a correctly-signed promotion can bypass it to live capital ` +
        `(exactly the A-1 / A7 incidents). Mirror the gate onto the missing path.`,
    );
  }
}

// ─── Divergence check: each documented divergence must still hold ─────────────
for (const d of DIVERGENCES) {
  const set = d.onPath === "manual" ? foundManual : foundCron;
  const raw = d.onPath === "manual" ? manualSrc : regionCron;
  if (!presentIn(d, set, raw)) {
    fail(
      `DIVERGENCE stale: '${d.id}' (identity ${JSON.stringify(d.token)}) is registered as a ` +
        `documented ${d.onPath}-only divergence but was NOT found on the ${d.onPath} path.\n` +
        `  Either the gate was removed (delete this divergence entry) or it moved (update ` +
        `it). Reason on file: ${d.reason}`,
    );
  }
}

// ─── Reverse scan: every gate-like token must be registered ───────────────────
const registeredTokens = new Set([
  ...HARD_GATES.map((g) => g.token),
  ...DIVERGENCES.map((d) => d.token),
]);
for (const [pathLabel, set] of [["MANUAL", foundManual], ["CRON", foundCron]]) {
  for (const tok of set) {
    if (!registeredTokens.has(tok)) {
      fail(
        `UNREGISTERED gate token '${tok}' found on the ${pathLabel} PAPER→DEPLOY_READY path.\n` +
          `  A gate-like helper is invoked that the parity registry does not know about. ` +
          `Add it to HARD_GATES (and MIRROR it onto the sibling path) in ` +
          `scripts/check-gate-parity.mjs, or to DIVERGENCES with a documented rationale if ` +
          `it is intentionally one-path. Leaving it unregistered means the parity net has a ` +
          `blind spot.`,
      );
    }
  }
}

// ─── TESTING → PAPER (cron legacy fast-track) HARD-gate coverage ──────────────
// DS#20 T-A2 (Band A F-2): the above net covers ONLY the PAPER→DEPLOY_READY edge.
// The checkAutoPromotions "Gate 2: TESTING → PAPER" legacy fast-track reimplements its
// gate stack INLINE (it does NOT delegate to a shared evaluator), so a TESTING-stage
// HARD gate can be present on the manual _promoteStrategyInner path yet silently MISSING
// from the cron fast-track — exactly how the PBO overfit gate (Wave 29 A.2, a documented
// §12 HARD gate with "no PBO-bypass path") shipped cron-absent and could auto-promote an
// overfit strategy to PAPER in vacation mode (Band A F-1). This asserts every canonical
// TESTING-stage HARD gate appears in the cron Gate-2 region.
const regionCronTesting = stripComments(
  sliceBetween(
    lifecycleRaw,
    "Gate 2: TESTING → PAPER",
    "Gate 2.5",
    "CRON path — checkAutoPromotions TESTING→PAPER legacy fast-track",
  ),
);
const foundCronTesting = gateTokensIn(regionCronTesting);
const TESTING_TO_PAPER_HARD_GATES = [
  { id: "t2p_pbo", token: "evaluatePboGate" },
  { id: "t2p_b14_ci", token: "evaluateB14CiGate" },
  { id: "t2p_wfe", token: "evaluateWfeGate" },
  { id: "t2p_parameter_drift", token: "evaluateParameterDriftGate" },
  { id: "t2p_dsr_walk_forward", token: "evaluateDsrWalkForwardGate" },
];
for (const g of TESTING_TO_PAPER_HARD_GATES) {
  if (!presentIn(g, foundCronTesting, regionCronTesting)) {
    fail(
      `TESTING→PAPER cron gate coverage BROKEN: '${g.id}' (identity ${JSON.stringify(g.token)}) ` +
        `is MISSING from the checkAutoPromotions "Gate 2: TESTING → PAPER" legacy fast-track.\n` +
        `  This autonomous (vacation-mode) path reimplements its gate stack inline; a TESTING-stage ` +
        `HARD gate absent here can auto-promote a strategy to PAPER that the manual path would BLOCK ` +
        `(exactly the PBO Band A F-1 incident). Mirror the gate into the cron Gate-2 loop.`,
    );
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────
const hardCount = HARD_GATES.length;
const divCount = DIVERGENCES.length;
const t2pCount = TESTING_TO_PAPER_HARD_GATES.length;

if (errors.length > 0) {
  console.error("\n❌ check:gate-parity — PAPER→DEPLOY_READY cron-vs-manual gate parity BROKEN\n");
  for (const e of errors) console.error("  • " + e + "\n");
  console.error(
    `Enumerated: MANUAL {${[...foundManual].sort().join(", ")}}\n` +
      `            CRON   {${[...foundCron].sort().join(", ")}}`,
  );
  console.error(
    `\nRegistry: ${hardCount} HARD gates (must be on both paths) + ${divCount} documented ` +
      `divergences.\n`,
  );
  process.exit(1);
}

console.log(
  `✅ check:gate-parity — PAPER→DEPLOY_READY parity OK: all ${hardCount} HARD gates fire on ` +
    `BOTH the cron sweep and the manual PATCH path; ${divCount} documented divergences hold; ` +
    `no unregistered gate tokens. TESTING→PAPER: all ${t2pCount} TESTING-stage HARD gates ` +
    `present in the cron legacy fast-track.`,
);
console.log(
  `   HARD: ${HARD_GATES.map((g) => g.id).join(", ")}\n` +
    `   DIVERGENCE: ${DIVERGENCES.map((d) => `${d.id}(${d.onPath})`).join(", ")}\n` +
    `   TESTING→PAPER: ${TESTING_TO_PAPER_HARD_GATES.map((g) => g.id).join(", ")}`,
);
process.exit(0);
