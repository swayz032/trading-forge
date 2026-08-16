---
name: extraction-campaign
description: >-
  Use when working on ANY part of the extraction system — corpus measurements,
  exam/battery runs, gate certifications, fidelity/classifier/demotion lanes,
  extractor builds, H1/H2 reads, null-cal, Mode A/B — BEFORE planning,
  dispatching agents, launching batteries, resuming a run, or reading any
  verdict. Loads the frozen campaign docs and enforces the campaign's minted
  laws (engagement evidence, provenance, read-order, pre-registration, flag
  law, anti-goalpost, claim scoping) plus battery operations and tripwire
  handling.
---

# Extraction Campaign Protocol — load → laws → operate → read

## Overview

Every rule below was bought by a documented incident in the corpus-v3 /
re-baseline campaign (2026-07-04 → 07-10): four dormant default-ON features
shipped behind green CI; two OOM battery deaths; a resume manifest that
counted error-records as completed (session-relay facts, 2026-07-10); and one
full tripwire arc — a "12/12 flips" alarm that was first caught as a broken
join by an implausibility check, re-derived to 7 real flips, then resolved as
an already-receipted fix's unconditional half having silently zeroed 7
strategies' trading. Each law names its incident. Violating one means
re-buying it.

## Mission-load (before anything else)

- **Current state:** advisor memory `project_rebaseline_05_exam_in_flight_2026_07_10`
  (or its successor) + the campaign backup ref **`corpus-v3-gate3-cert-2026-07-06`**
  (campaign artifacts land there FF-only; `hardening/phase-0` has carried a
  concurrent session's in-flight state — verify before assuming it is landable).
- **Frozen docs** (read the ones your task touches; they outrank memory):
  - `docs/designs/extraction-campaign-plan-2026-07-07.md` — the decision tree
    (Phase 0 debt → H1 fidelity instrument → H2 read → branch).
  - `docs/designs/h2-source-thesis-preregistration-2026-07-07.md` — H2 frozen
    rule: SURVIVOR read at any N (≥1 robust survivor = every gate + fidelity
    certificate, then survivor-forensics, then small-real-capital graduation);
    RATE read only at N≥30 (≥5% scale / 1–5% marginal / 0 → pivot source-agnostic).
  - `docs/designs/re-baseline-preregistration-2026-07-07.md` — the 0.5 exam:
    expected = downward equity shifts + classifiable count changes; anomaly =
    zero↔nonzero flips, unclassifiable counts, upward shifts. Directional +
    classifiability criterion — NO %-band.
  - `docs/designs/extraction-mission-scoped-2026-07-07.md` — conveyor is
    HALF-built (judging trustworthy, ingestion scaffolded); H1 gates H2;
    0-survivors-at-high-fidelity = source-thesis falsified → pivot (machinery
    transfers intact).
  - `docs/designs/corpus-v3-gate1-respecification-2026-07-05.md` — the full
    ruling chain (~900 lines; classifier track CLOSED, escape SPENT, landing =
    (b) productionize demotion; surface-gradient finding = the Phase-1
    extractor target).
- **Instrument changes** found while working: stage a packet (skill
  `ratify-packet`) — a campaign task is never authorization to edit engine,
  gate, classifier, or measurement code.

## The Laws (each with the incident that minted it)

| # | Law | Statement | Minting incident |
|---|-----|-----------|------------------|
| 1 | **Engagement evidence** | "X exists / is default-ON" is an incomplete claim until "X is actually invoked in production" — feed-existence + engagement evidence (counters, per-run engagement counts), for every X. Parity tests pass vacuously when both sides are dead. | Four dormancies in one campaign: EVENT_PRODUCT_SCOPE unwired; VIX-margin unfed; `request.fill_model` never populated; event_calendar unfed (6 confirmed applications incl. Mode-B overlay engagement + decision-variance checks). |
| 2 | **Provenance** | An input's provenance = engine **generation × path × engaged-config** — never generation alone. Every battery artifact stamps `dataset_hash` / S3 etags (standing equipment; G0 shipped without one and the data-change hypothesis could not be cleanly closed). | Sealed-verdict ruling: exam arms ran a different macro path than the null arm; the pre-flight had checked generation only. |
| 3 | **Read-order** | Validity before verdict, always; reference before validity where a reference exists. Verdict numbers are read ONCE, from the first validity-passing run ("re-run once" caps verdict READS, not runs). Control gates unseal target reads (controls → gate → primary → secondary). | Gate 3's crash-masked first run; the NEUTRAL adjudication's control gate. |
| 4 | **Pre-registration** | Decision rules are written before the numbers exist. Ambiguous terms are pinned at freeze time; a term found un-pinned later resolves to the strictest reading available at pre-registration time — never the convenient one. Magnitudes are NEVER compared cross-generation (directional criteria exist for exactly that reason). | The "confident" pin (medium-or-better, set against the author's own thumb); the 0.5 exam frozen BEFORE the 7/8/9 batch landed. |
| 5 | **Flag law** | The flag gates the FEATURE, never the FIX. Every packet declares which parts of a change are flag-gated and which are unconditional; unconditional parts that can move trade counts ship a materiality count receipt at land time. | OR-branches fix (2026-07-05): honoring was flag-gated OFF, but its unconditional direction-correctness components zeroed 7 v2-traded specs — caught by the flip tripwire 5 days later, not by a receipt. |
| 6 | **Anti-goalpost** | Every fix gets a direction check (a legitimate fix usually pushes the gate TOWARD fail — the opposite signature of goalpost-moving). Spent escapes stay spent: a licensed single-shot that escalates or fails CLOSES its track; later evidence may revise FINDINGS but never reopens the TRACK (falsification-insulation asymmetry). | Pass-3 escalated unfired → classifier track closed; the NEUTRAL adjudication falsified the boundary hypothesis without reopening anything. |
| 7 | **Claim scoping** | Every result sentence carries its scope: corpus + battery + engine + data snapshot (+ effective-N where trades are counted). Proxy measurements declare the proxy IN the artifact, and the declaration travels with every downstream citation. | Result-claim-scoping rule + the F-5 review-time-proxy arc ("measured on the object-string proxy — scoped, not laundered"). |

## Battery operations

- **Schedule by timeframe weight.** 1m specs (≥2M-bar windows) run **SOLO —
  full stop** (two OOM deaths on 2026-07-10, both from concurrent 1m specs;
  duo is unproven). Partition heterogeneous queues into phases by weight;
  never let heavy stragglers share slots with the bulk.
- **Pre-commit fallbacks BEFORE launch:** what happens on OOM (drop
  concurrency / re-queue solo), on freeze (one-shot rule: fall back once,
  permanently — no oscillating), on a third failure (stop, escalate). Decided
  before the run, not during it.
- **Manifest hygiene before ANY resume.** This runner's resume logic counts
  error-records as "completed" (null-cal cred-less incident, session-relay
  fact). Post-kill: inspect the manifest, keep only clean completions, delete
  error/partial rows for specs that must re-run, trim any truncated final
  jsonl line. Then verify the resumed run's pending arithmetic explicitly
  (N total = complete + pending).
- **Kill-verification = process tree, not PID.** A `taskkill` reporting
  "PID not found" may mean the process already died (OOM) — verify zero
  battery processes AND read the log tail before attributing the death.
- **Epoch accounting.** Same engine bytes + same engaged env across restarts
  = NOT an epoch boundary, but the validity block records the launch table
  (PIDs, concurrency, row counts per epoch) anyway. Any engine-byte or
  env-semantics change mid-battery = STOP (common-engine principle violated
  inside a stage).
- **Validity-block standing fields:** registration/engagement pre-check,
  per-spec engagement + decision-variance evidence, zero-pair classification
  cross-checked against the prior baseline (zero↔nonzero flips are ANOMALY,
  not scope — ANOMALY criterion 1 of the 0.5 pre-reg), expected-abort counts
  with exact signatures (e.g. the 26 expected MCL INDETERMINATEs, whose
  signature is the 46 zero/negative-price bars of the April-2020 WTI
  negative-settle event, 2020-04-20 14:00 → 04-21 09:15 ET), effective-N
  scope line, dataset/snapshot stamps, epoch table.

## Tripwire handling

- **Verify the alarm instrument before raising the alarm.** Implausibly
  uniform numbers (12/12 identical, 44 specs at exactly 8 trades, 0 idioms in
  a trading corpus) mean: suspect your join/field-extraction FIRST. Two
  campaign alarms were broken instruments; both were caught by the
  implausibility check before they reached the record.
- **Route anomalies by pre-committed rules only.** If the routing rule wasn't
  pre-committed, write the decision rule BEFORE looking further at the
  numbers, then apply it mechanically.
- **Cause-trace cheapest-and-likeliest first — and check landed-fix receipts
  before bisecting.** The G0→G4 flip resolved by READING the OR-branches fix
  artifacts already on disk; the answer to "what changed" is often already
  receipted. Free checks (file listings, doc reads, counters the engine
  already emits — e.g. `result["dsl_guards"]`) run before any compute.

## Sibling skills (pointers, not copies — single-source enforcement)

Duplicate-enforcement is a named architectural liability in this codebase;
duplicating protocol text across skills is the documentation version of the
same disease. This skill owns ONLY the campaign laws above. For:

| Situation | Skill |
|---|---|
| Any change touching instrument code (engine/gates/classifier/measurement) | `ratify-packet` |
| Any score, band, verdict, or readiness claim | `grading-integrity` |
| Any worktree, landing, or multi-session work | `worktree-session` |
| Extraction-quality judgment on any gemma probe/run | `transcript-audit` |
| Any failure/debugging (hangs, 401s, crash-loops, false-greens) | `tf-debugging` |
| Audit waves / fix waves / re-certification cycles | `deep-scan` |
| Any SQL migration | `migration-author` |

## Rationalizations (all invalid, all already tried)

| Excuse | Reality |
|---|---|
| "The flag is off, so the fix can't affect the exam" | The OR-fix's unconditional half zeroed 7 specs with the flag off. Flag gates the feature, never the fix. |
| "Parity passes, so both engines work" | Parity passes vacuously when both sides are dead. Four dormancies shipped exactly this way. |
| "It's just a resume" | The resume logic counts error-records as completed. Manifest hygiene first, every time. |
| "The alarm number is huge, so it must be real" | Both huge campaign alarms were broken joins. Verify the instrument first. |
| "We're mid-exam, no time for the pre-check" | The Step-0 pre-checks caught an inert fix before a line was written. Pre-checks are the fast path. |
| "This engine tweak is part of the campaign task" | Instrument code waits for its ratification packet regardless of campaign momentum. |
| "The verdict looks done, read it now" | Validity first, verdict once. A crash-masked verdict cost a full re-run cycle. |
| "One more iteration / one more re-derivation" | Escapes are spent when their pre-registration says so. Track-closure is not reversible by good news. |
