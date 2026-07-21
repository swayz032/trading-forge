# RATIFY PACKET — TOOTH-1 BUILD (Leg A compile-fidelity + §4 calibration-battery FRAMEWORK)

Date: 2026-07-21 · Worktree: `wt-h1-wave4-20260712` (branch `h1-wave4-sealed12-driver`)
Anchors: `docs/designs/survivor-forensics-preregistration-2026-07-19.md` (sha256
`7fe3995b825d381452064858faebc5c92c162e9baf92dffd62ca1713c19e88f7`, frozen at R-070) —
Leg A (§1-A, R-040 pin 2(iv)) + §4 CALIBRATION BATTERY.

Class: **AUTONOMOUS** (pre-live, pre-candidacy; new additive modules; no live default,
no frozen-ref re-baseline, no operator data touched). Independent grade is the gate.

---

## 1. What & why now (receipts)

The survivor-forensics pre-reg (frozen R-070) requires a **compile-fidelity forensics gate
(Tooth-1)** to exist BEFORE the first survivor candidacy, and a **§4 calibration battery**
("can-this-detector-lie audit") to run before its first live use. The reserved slot is on
disk and points at nothing:

- `src/engine/battery/passage_ledger.py:107-110` — `compile_fidelity_forensics` GateClass,
  `reserved=True`, location string `"RESERVED — … spec_producer.py:35, no gate function
  exists yet"`.
- `src/engine/extraction/spec_producer.py:35` (docstring) — names "the survivor-forensics
  compile-fidelity leg (follow-on)" as EXPLICITLY OUT OF SCOPE for the producer.

No `forensics/` package, no `leg_a`/`tooth1`/`compile_fidelity` module exists anywhere under
`src/` (grep: 0 hits). This packet builds it.

Per-condition compile data already exists and is the detector's input:
- `spec_family_bindings.py:739-764` `ConditionBinding` — per-condition record
  `{condition_id,type,role,object,bindable,primitive,approximation,executed,reason,session_zone}`.
- `spec_family_bindings.py:2632-2659` `BindingPlan` + `compile_binding_plan(spec)` — PURE,
  no market data; the live authority for the `approximation` flag (re-derived from the code
  path, never trusted from the spec record — §1-A(ii)).
- `spec_producer.py:239` `_HOUSE_DEFAULT_EXIT = "house-default (trader taught none)"`;
  `spec_producer.py:576-581` stamps `framework_overlay.exit` only when the exit is untaught.

## 2. Blast radius

- **Additive only.** Two new modules under a new `src/engine/forensics/` package + two new
  test files. No existing module's behavior changes.
- **One touched existing file:** `passage_ledger.py:107-110` — the reserved GateClass
  location string is updated to name the real detector (§6 mandate: "the RESERVED slot is
  replaced by the real invocation site at build time"). `reserved=True` is KEPT (honest: no
  live candidacy invocation runs yet — eligible set is empty). Predicate-preserving: the row
  is still `reserved`, still `verdict`-less, still the same key/stage/class.
- **No frozen ref invalidated.** The 77 sealed corpus untouched; `2/21/4`, the resolver, and
  every flag untouched. No candidacy threshold pinned (T1 is a later ruling).
- Downstream: nothing consumes the new modules yet (inert until survivor candidacy exists).

## 3. The exact change, scope-locked

IN:
- `src/engine/forensics/__init__.py` (new, package marker).
- `src/engine/forensics/compile_fidelity.py` (new) — Leg A detector: categorical
  per-condition verdict over (i)–(vi); Phase-1 seal (deterministic, hashable table) +
  Phase-2 fresh-reader countersign HARNESS (accepts external countersignatures, fail-closed
  when absent). Fail-closed on any missing input (artifact/spec/binding/certificate).
- `src/engine/forensics/calibration_battery.py` (new) — §4 FRAMEWORK: 7 mutation SLOTS
  (m1–m7) as an interface the independent grader fills; per-slot conviction + anti-vacuity
  companion requirement; a hard `CALIBRATED` vs `HARNESS_DEMONSTRATED_ON_PLACEHOLDERS`
  status gate so a placeholder can never masquerade as a real calibration.
- `src/engine/tests/test_compile_fidelity_leg_a.py` (new) — red-proofs (revival probes).
- `src/engine/tests/test_calibration_battery_framework.py` (new) — framework demonstration
  + doer≠grader guard.
- `src/engine/battery/passage_ledger.py:107-110` — location-string update only (above).

OUT (explicitly):
- **The m1–m7 mutations themselves.** Grader-authored (doer≠grader, §4). I ship only clearly
  labelled `FRAMEWORK_DEMONSTRATION_PLACEHOLDER` synthetic mutations to exercise the harness.
- **The `load_bearing`/`non_lb_disposition` spec-artifact field** (§0). It does not exist in
  `ConditionBinding.to_dict()` / the `.spec.json` schema today. Per §0 "No field → treated as
  `true`," the detector reads it if present and defaults to load-bearing otherwise — so the
  detector is correct WITHOUT the field. Adding it to `spec_producer` is deferred (a separate
  additive spec-artifact change, not needed for a correct-at-candidacy detector). NAMED as a
  finding, not silently skipped.
- **Candidacy-time numeric bars** (T1). Leg A(ii) is categorical (no threshold) by design.
- The resolver, `2/21/4`, any flag, the 77 sealed corpus.
- Legs B/C/D engine code (protocol, not engine — §6); only Leg A + §4 are built here. Leg A's
  Phase-2 countersign is the one fresh-eyes seam and is built as an ACCEPTING harness, not a
  fabricated reader.

## 4. Verification plan (empirical, ships with the change)

- **Red-proof R1 (inert state):** run Leg A over every `.spec.json` in
  `docs/replay-results/h1-scripts/claude-rung-v32/shakedown_specs/` and assert EVERY spec
  returns categorical BLOCK, with 0 passing Leg A(ii). COMPUTED count reported (the brief's
  "0 of 11" claim is verified against the actual corpus, not asserted).
- **Anti-vacuity for the detector itself (R2):** a SYNTHETIC known-good fixture (all
  load-bearing conditions bind `approximation=False`, house-exit correctly stamped, cert
  chain supplied) must PASS Leg A whole — proving the detector is not a constant-BLOCK stub
  (a detector that always blocks would trivially "pass" R1).
- **Fail-closed (R3):** missing spec / missing certificate / empty binding → BLOCK, never
  skip or exception-as-pass.
- **Phase seal (R4):** Phase-1 seal is deterministic (same artifact → same table hash);
  Phase-2 countersign fail-closes when countersignatures are absent or incomplete.
- **Battery harness (R5):** the harness convicts a placeholder mutant AND its anti-vacuity
  companion (clean spec) passes the same check the mutant fails → distinguishes mutant from
  clean. All 7 slots present as an interface; an unfilled slot fail-closes the calibration.
- **Doer≠grader guard (R6):** a placeholder-populated battery reports status
  `HARNESS_DEMONSTRATED_ON_PLACEHOLDERS`, NEVER `CALIBRATED`. Only all-7 grader-authored,
  non-placeholder slots can yield `CALIBRATED`.
- All tests run under system `python` from this worktree; `compile_binding_plan` is pure
  (no `data_cache` needed). Counts reported COMPUTED with the command that produced them.

## 5. Rollback

Pure additions: `git rm` the two new modules + two new test files + this doc, and revert the
one-line `passage_ledger.py` location string. No flag, no migration, no live default, no
frozen hash involved — clean revert, nothing downstream depends on the new code.

---

## Required NEXT WAVE (calibration is INCOMPLETE without it)

This packet delivers the DETECTOR + FRAMEWORK + the independent grade of THOSE. The
calibration is **complete only** once an INDEPENDENT grader authors the live m1–m7 mutations
against this harness and the detector convicts each with its anti-vacuity companion. Until
then the battery status is `HARNESS_DEMONSTRATED_ON_PLACEHOLDERS`. Mutation authoring is the
grader's, by pre-reg §4 (doer≠grader) — the gate's builder does not author them.
