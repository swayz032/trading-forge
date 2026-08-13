# AR-1116 (WORKER) — AR-1115 §7 STEPS 1–4 COMPLETE / PRODUCTION FAIL-CLOSED REFUSAL LANDED / BOTH PRODUCTION-PATH PROOFS RED-PROOFED / DEAD CAUSAL HELPER RETIRED WITH ITS REFUSALS MEASURED FIRST / §9.2–§9.4 STILL OPEN / PERFORMANCE BLOCKED

**Seat:** Claude Code, engineering worker
**Date:** 2026-08-13
**Governing ruling:** AR-1115 (`ee6a0516` on `origin/external-advisor/gpt-rulings`)
**Baseline pin at seating:** `25229a80d05c48950d95d86994fb9dc04b6cc71c` — IDENTICAL to the head AR-1115 inspected. No stale-premise gap.
**Implementation pin:** `d8fa19580da49fbfd4490ccaa0f2c5a326619939`
**On `origin/h1-wave4-sealed12-driver`:** YES — verified two non-overlapping paths + negative control (§8).

---

## 0. SEATING NOTE — THE RULING CHANGED UNDER ME, AND THE EAR IS WHY I SAW IT

I seated against **AR-1113 §9.2** (`SVKM-REAL-PERSIST-1`) and had begun its pre-flight
when the GPT-branch ear fired: `04752599 -> ee6a0516`. That was **AR-1115**, which
re-ordered the queue and put a different unit in front of §9.2. I stopped the §9.2
pre-flight and re-ran it against AR-1115.

**Two facts from the abandoned §9.2 pre-flight are still worth having**, because you will
want them when §9.2 opens (§7 below): the producer exists and is `BUILT-UNREACHABLE`, and
the certified records are on disk. I did not act on either.

---

## 1. WHAT I DID — AR-1115 §7 STEPS 1–4

| §7 step | Status |
|---|---|
| 1. missing/incomplete 5m data → hard refusal on the source-role production path | **DONE** |
| 2. one production incomplete-window red-proof + one production causality mutation | **DONE** |
| 3. migrate dead-helper assertions, remove the duplicate causal implementation | **DONE** |
| 4. same bounded regression population, compare failure membership | **DONE — zero regressions** |
| 5. proceed to §9.2 / §9.3 | **NOT STARTED** (this report is the boundary) |
| 6. keep performance blocked | **HELD** |

### 1.1 §3.1 — the production refusal

`spec_condition_compiler._h_opening_range` had **two** `continue` sites, and both were the
defect you named, not one:

```python
if not session_bars:              continue   # the source frame covers no bar for this session
if not state.opening_range_complete: continue   # the window cannot complete
```

Both now refuse **when and only when a source-owned role contract is driving the run**:

```python
source_role_driven = self.source_timeframe_roles is not None
```

`_resolve_opening_range_source` has already refused every non-sVkm combination by the time
this line is reached, so `roles is not None` here means *the authorised sVkm contract is
running* — it is not a second, weaker admission test. Legacy/no-role execution keeps
`continue` byte-identically. The refusal type is `FamilyMetaEnforcementError`, the same
one the resolver above it already raises. **The condition sits around the existing
branches; no new architecture, per your §3.1.**

### 1.2 §3.2 — the two proofs, on the handler that runs

New `tests/test_svkm_role_execution.py` §9. Every test calls `_h_opening_range` directly.

**A. incomplete-window refusal** — a correctly-labelled, correctly-spaced 5m frame that
simply lacks the 09:30 candle. Plus the absent-session half. Plus **two controls the
refusals are worthless without**: a positive witness (same setup, 09:30 bar present →
runs, `or_high` 100.50 off the 5m frame) and a legacy control (no roles → still all-False).

**B. causality mutation** — 1m execution bars held constant; information *inside* the
09:30 5m candle moves `or_high` 100.50 → 133.00.

The vacuity trap here is real and I guarded it explicitly: with no pre-lock bars,
*"no pre-lock bar leaked"* is true of everything. So the test asserts **`lock_idx == 5`
first** — the pre-lock window is non-empty — before asserting availability is byte-identical
across the mutation.

### 1.3 §3.3 — the helper is gone, and I measured before deleting

`build_causal_opening_range` / `CausalOpeningRange`: **zero non-test callers**
`[MEASURED HERE]`. Deleted. `RoleFrame`, `parse_minutes`, `assert_svkm_role_combination`,
`SourceRoleExecutionError` survive — exactly your §3.3 list.

🛑 **I did not reason about which of its refusals had production twins. I ran them.**
Deleting a safety assertion with no production twin is a regression wearing the word
*cleanup*, so I wrote a probe that fed each case to `_h_opening_range`:

| helper refusal | production behaviour `[MEASURED HERE]` | disposition |
|---|---|---|
| duplicated 09:30 bar | **REFUSES** (`verify_spacing`) | migrated → `test_PRODUCTION_a_duplicated_0930_source_bar_REFUSES` |
| frame labelled for the wrong role | **REFUSES** (label check) | migrated → `test_PRODUCTION_a_frame_labelled_for_the_wrong_role_REFUSES` |
| naive ET stamps read as UTC | **REFUSES** — via the new §3.1 refusal | migrated → `test_PRODUCTION_naive_ET_stamps_mislabelled_as_UTC_REFUSE` |
| missing 09:30 candle | **REFUSES** — via the new §3.1 refusal | covered by §9.A |
| two frames in different zones | **ACCEPTS**, `or_high` 100.50, `lock_idx` 5 — the correct taught range | **NOT migrated**, see below |

**The one I did not migrate, and why.** The helper refused two frames whose timestamps
were *expressed* in different zones. Its own docstring called that *"deliberately stricter
than the instants require."* Production converts with `astimezone()` and recovers the
taught session date, so the same instants in UTC yield the identical range — there is no
defect to catch. That was representation strictness, not a safety property.

⭐ Worth your attention: **the real defect that zone test was protecting against — naive ET
wall-clock stamps localised as UTC, which select a candle four hours off with every
downstream number still plausible — is now caught by the §3.1 refusal I added in this
same unit.** The migration is real, not bookkeeping.

---

## 2. RED-PROOF — RE-RUN AGAINST THE FINAL STATE, NOT THE MID-EDIT STATE

Isolated worktree, **module path witnessed** as `C:\ab1115\src\engine\spec_condition_compiler.py`.
Ablations applied by a script that asserts its anchor matched **exactly once** and that the
bytes changed, then restores and asserts the restore.

I ran the ablations twice. The first pass was before the §3.3 deletion; **red paths decay,
so the numbers below are the re-run against the committed final state** — the earlier pass
is not what I am reporting.

| arm | result |
|---|---|
| control (fix present) | **20 passed** |
| §3.1 refusal ablated (`source_role_driven = False`) | **3 failed** — both refusals + the mislabelled-UTC migration, all `DID NOT RAISE` |
| production lock ablated (`ts_list[i] >= lock` → `True`) | **1 failed** — `lock_idx` collapses `5 → 0` |

★ **In both ablations the positive witness and the legacy control stayed GREEN.** The
ablations discriminate; they do not break everything and call that a red-proof.

Ablation B's failure signature is the leak itself: `lock_idx == 0` means the 09:30 bar was
gated available before the candle defining its range had closed. The vacuity guard fired
exactly as designed.

---

## 3. REGRESSION — §7 STEP 4

AR-1114's import-closure population, **rebuilt from its stated rule rather than a copied
list** (a copied list silently keeps a file the baseline no longer has). **39 files,
membership identical on both trees.**

| | mine (`d8fa1958`) | baseline (`25229a80`, clean) |
|---|---|---|
| passed | 794 | 799 |
| failed | **2** | **2** |

```
--- REGRESSIONS I CAUSED ---
        (empty)
--- COMMON (pre-existing on BOTH) ---
test_flag_off_parameterized_refusal.py::test_the_canonical_population_matches_its_committed_manifest_by_member
test_opening_range_grammar_firebreak.py::test_existing_parameter_acceptance_guards_stay_green
```

**Failure membership IDENTICAL — zero regressions.** The `-5` passed accounts exactly:
**13 helper tests deleted, 8 production tests added.** I state the arithmetic because a
passed-count drop with no accounting is indistinguishable from a test that silently
vanished.

---

## 4. 🛑 DISCLOSURES

1. **The full engine suite is still not a usable instrument, and I did not re-litigate it.**
   AR-1114 measured ~9% of collection after one hour. I did not re-run it. **No
   repository-wide green is claimed by this report.** Everything outside the 39-file
   closure is UNMEASURED and named here as such.
2. **My first heredoc mangled the test file** (shell ate the backticks) and my first draft
   referenced `state.status`, **a field that does not exist** — it is
   `opening_range_window_status`. Both were caught by measurement before commit, not by
   review. I mention them because your §2 judges whether my controls are trustworthy, and
   a clean-looking second attempt hides the fact that the first one was wrong.
3. **SYSTEM-INVENTORY independently agrees the helper is gone** — regenerated, it now
   contains **zero** mentions of `build_causal_opening_range` / `CausalOpeningRange`. That
   is a different method reaching my self-report's conclusion, not a restatement of it.
4. **The deletion left orphaned section banners and a stale module docstring**, which I
   cleaned in the same commit. The module docstring had claimed *"this file contributes the
   ROLE BINDING and the CAUSAL GATE"* — false the moment the helper died. It now says where
   the causal gate actually lives.
5. **No real market data was used. Every proof is fixture-level.**
6. **I did not dispatch the grader.** AR-1115 §4 places the independent grade after §9.4
   (*"Only after that should the independent grade/performance gate be considered"*), so it
   is not yet pre-authorised. Say the word and I dispatch it without a round-trip.

---

## 5. WHAT I DID NOT DO

- **§9.2 real persistence** — UNSTARTED. Not claimed.
- **§9.3 source/candidate pairing** — UNSTARTED.
- **§9.4 end-to-end A–G** — UNSTARTED.
- **§9.7 independent grade** — not dispatched (§4.6).
- **Performance** — BLOCKED, untouched.

---

## 6. §9.1 — WHAT I BELIEVE IS NOW CLOSED, AND WHAT IS YOURS TO RULE

Your §7 forbids calling §9.1 closed *"until the production refusal and production causality
proofs are green."* Both are green and both are red-proofed against the final state (§2).

**I am not grading my own work: that is a claim, and §9.1's closure is your call.**

---

## 7. TWO MEASURED FACTS FOR §9.2, CARRIED FORWARD SO THE NEXT UNIT DOES NOT RE-DERIVE THEM

From the abandoned §9.2 pre-flight. **I built nothing on either.**

1. **The producer exists and is unreachable.** `src/engine/extraction/spec_producer.py`
   (1,138 lines) carries `produce_spec_artifact_from_record` — its docstring calls itself
   *"the public production compile boundary."* SYSTEM-INVENTORY marks its members
   *"defining module is not reachable from any measured entry point"*, and its only
   non-test callers are `docs/replay-results/` scripts and `forensics/compile_fidelity.py`.
   **So §9.2's chain has a producer, but that producer is not wired into anything that
   runs.** Whether §9.2 means *run it as the producer of record* or *wire it* is a fork I
   did not resolve.
2. **The certified records are on disk**, 13 of them, at
   `docs/replay-results/h1-sealed-read-frozen/SEALED-READ/phase_b/`, keyed by video ID.
   `[relevant: the sVkm/golden two-source split]` — a §9.2 fixture must be joined to the
   **video ID**, not to vocabulary.
3. **`produce_spec_artifact` emits no `source_timeframe_roles` today** — `[MEASURED]` a
   grep for `timeframe` in that file returns only classifier-confidence lines. So §9.2 is a
   producer change, not only a persistence change.

---

## 8. VERIFICATION OF DELIVERY

```
git ls-remote origin refs/heads/h1-wave4-sealed12-driver
  d8fa19580da49fbfd4490ccaa0f2c5a326619939

gh api repos/swayz032/trading-forge/commits/d8fa1958   (independent of local git)
  d8fa19580da49fbfd4490ccaa0f2c5a326619939  AR-1115 sections 3.1/3.2/3.3: ...

NEGATIVE CONTROL — a SHA that must not exist:
  gh api .../commits/d8fa1958ffff...  ->  422 "No commit found for SHA"
```

The negative control is there because an API that answers `200` to everything would have
made the two positives meaningless.

---

## 9. FILES

| file | change |
|---|---|
| `src/engine/spec_condition_compiler.py` | §3.1 production refusal at both `continue` sites; one stale comment corrected |
| `src/engine/svkm_role_execution.py` | §3.3 helper deleted (399 → 261 lines); docstring's false causal-gate claim corrected |
| `src/engine/tests/test_svkm_role_execution.py` | §9.A/B/C added (8 tests); 13 helper tests + `_build` removed |
| `docs/designs/SYSTEM-INVENTORY.md` | regenerated (pre-push freshness gate) |
