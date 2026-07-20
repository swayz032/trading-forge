// scripts/ops/recovery-evidence.cjs — the TYPED SOURCE OF TRUTH for cold-recovery evidence.
//
// ★★ WHY THIS FILE EXISTS: a guard that PARSES free-form markdown cannot close the
// evidence-honesty class, because its governed surface is open-ended by construction.
// Four rounds of patching proved it — freshly-found siblings went 2 -> 3 -> 2 -> 4, i.e. the
// class REGENERATED faster than it closed. Every new row label, column, tier or directory was
// a new ungoverned surface, so each patch governed one more cell while the surface grew.
// That is leg-5's "a source-text grep cannot close a semantic class" raised to the level of
// document structure.
//
// THE INVERSION: the honesty-critical part of the runsheet is a CLOSED, TYPED value per leg.
// The markdown is RENDERED from this source, never hand-edited and parsed back. We govern the
// SCHEMA — finite and closed by construction — instead of policing prose. There is no
// free-form cell left to sneak a claim into, because the cells are generated from enum values.
//
// ★ AND THE HONEST LIMIT, stated rather than implied: KEY FINDINGS ARE FREE TEXT AND ARE NOT
// TOOL-GOVERNED. A finding is human judgement about what a drill taught; it is not a
// completion claim, and policing its prose for honesty would be the open-set trap again. The
// tool governs the STATE. The prose is declared ungoverned-by-design — a guard may have
// finite reach, it may not claim more than it has.
"use strict";

/**
 * The CLOSED set of evidence states. Adding a state is a deliberate edit here; it cannot be
 * introduced by phrasing. `label` is what renders — no leg writes its own words.
 */
const EVIDENCE_STATES = Object.freeze({
  DRILLED:            { label: "DRILLED + RECEIPTED",     drilled: true  },
  WITNESSED_LIVE:     { label: "BUILT + WITNESSED LIVE",  drilled: false },
  DESIGNED_NOT_DRILLED: { label: "DESIGNED — NOT DRILLED", drilled: false },
  PARTIALLY_BUILT:    { label: "PARTIALLY BUILT",         drilled: false },
});

/**
 * Every leg, as DATA. `state` must be a key of EVIDENCE_STATES — that is the whole guard.
 * `receipt` is required exactly when the state is drilled, so "drilled" cannot be asserted
 * without saying where the receipt is.
 * `keyFinding` is FREE TEXT and explicitly ungoverned (see the header).
 */
const LEGS = [
  {
    leg: "db", tier: "—", order: 1, name: "Database", capability: "restore + reach",
    state: "DRILLED", receipt: "docs/disaster-recovery-db.md · AGENT-LOGS 2026-07-02",
    keyFinding: "prod is **PostgreSQL 17.10** — a v16 `pg_dump` REFUSES with `server version mismatch`. Install pg**17**, not \"latest\".",
  },
  {
    leg: "s3", tier: "—", order: 5, name: "Data lake", capability: "DuckDB can read S3",
    state: "WITNESSED_LIVE", receipt: null,
    keyFinding: "a footer-only read **PASSes on a corrupt object**. The gate must force a column decode (`SELECT *`), not `SELECT 1`.",
  },
  {
    leg: "services", tier: "A", order: 2, name: "Services", capability: "API actually serving",
    state: "DESIGNED_NOT_DRILLED", receipt: null,
    keyFinding: "*(none yet — a drill would produce one)*",
  },
  {
    leg: "tasks", tier: "B", order: 3, name: "Scheduled tasks", capability: "expected tasks registered **and enabled**",
    state: "DESIGNED_NOT_DRILLED", receipt: null,
    keyFinding: "★ **3 of 6 are ABSENT on the tower** — `TF-Rails-Divergence`, `TF-Rails-WorktreeTTL`, `TF-CI-Runner`. Found only once the check stopped hand-listing names.",
  },
  {
    leg: "wsl", tier: "C", order: 4, name: "WSL runner", capability: "a configured WSL distro",
    state: "DESIGNED_NOT_DRILLED", receipt: null,
    keyFinding: "★ **the prerequisite no prior recovery note lists.** `TF-CI-Runner` registers a WSL action, so a box with no distro registers it successfully and it does nothing.",
  },
  {
    leg: "secrets", tier: "—", order: 6, name: "Secrets/env", capability: "the right `.env` resolves",
    state: "PARTIALLY_BUILT", receipt: null,
    keyFinding: "boot **fail-OPENs** on missing secrets *by design*; `.env.example` is **not** a recovery manifest.",
  },
];

/** Throws if the data violates the schema. The schema IS the honesty guard. */
function validate(legs = LEGS, states = EVIDENCE_STATES) {
  const valid = Object.keys(states);
  const seen = new Set();
  for (const l of legs) {
    if (!l.leg || seen.has(l.leg)) throw new Error(`duplicate or missing leg id: ${l.leg}`);
    seen.add(l.leg);
    if (!valid.includes(l.state)) {
      throw new Error(`leg "${l.leg}" has state "${l.state}", not one of ${valid.join("|")}`);
    }
    // A drilled claim owes a receipt. This is the one rule that cannot be phrased around:
    // there is no free-text cell in which to assert a drill.
    if (states[l.state].drilled && !l.receipt) {
      throw new Error(`leg "${l.leg}" claims ${l.state} with no receipt`);
    }
    if (!states[l.state].drilled && l.receipt) {
      throw new Error(`leg "${l.leg}" is not drilled but carries a receipt`);
    }
  }
  return true;
}

/** Rendered evidence label for a leg — derived, never hand-written. */
const evidenceLabel = (leg, states = EVIDENCE_STATES) => states[leg.state].label;

/** Legs that assert a drill. Used by the runsheet header and by tests. */
const drilledLegs = (legs = LEGS, states = EVIDENCE_STATES) =>
  legs.filter((l) => states[l.state].drilled).map((l) => l.leg);

module.exports = { EVIDENCE_STATES, LEGS, validate, evidenceLabel, drilledLegs };
