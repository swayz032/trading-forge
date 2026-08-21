# AR-1397 — WORKER 1 — AR-1386A STAGE C0 FAIL-CLOSED CLOSURE

**Date:** 2026-08-21
**Worker:** worker-1 (lane `compiler-factory`)
**Authority:** AR-1386A §7 (worker order), on AR-1385A §§6-7
**Branch:** `claude/worker1-h1-20260815`
**Graded pin:** `39d60f49d4e96b6000e6f645feffb4d60a34ac95`
**Independent grade:** **VERIFIED 7/10** (`accuracy-validator`, 3 adversarial rounds, ≥2
non-overlapping data paths per claim). **No self-assigned band appears in this report.**

---

## 0. DISPOSITION IN ONE PARAGRAPH

AR-1386A found that Stage C0 was implemented but not closed: unresolved/conflicting visual meaning
could still report ready, and a dependency-bearing RED receipt compiled if its readiness field was
removed. Both are closed, along with three further fail-open routes the independent grader found in
my own repairs across two further rounds. The independent band moved **5 → 6 → 6 → 7**, with the
grader holding at 6 twice because a live route to `COMPILED` with an unsatisfied dependency still
existed. That route is now closed in every shape either of us could construct. **One residual
remains open by design and is named in §7 — it needs a ruling, not more code.**

---

## 1. COMMIT PINS

| Pin | What landed |
|---|---|
| `0fba478c` | pre-packet head; the head AR-1386A names as inspected |
| `7d50c19d` | onboarding: §2b peer handshake suspended (operator closed Worker 2, 2026-08-21) |
| `73ebace9` | AR-1386A §§3-6 repairs (semantic gating, readiness seam, blocker causes, sorted refs, tests) |
| `b506c3d2` | inventory refresh — **grader round 1: BOUNDED 6/10, NOT CLOSED** |
| `945c38f3` | grader round-1 findings F-1…F-5 repaired |
| `f8776f36` | inventory refresh — **grader round 2: BOUNDED 6/10, NOT CLOSED** (G-1, G-2 open) |
| `1c800d16` | grader round-2 findings G-1, G-2, H5, F-3 production path repaired |
| `2b52c07c` | inventory refresh |
| `cf18b04a` | `GATING_AXES` made load-bearing in BOTH projection and seam |
| **`39d60f49`** | inventory refresh — **GRADED PIN, VERIFIED 7/10** |

**Changed paths across the packet:**
```
src/engine/extraction/source_graph_projection.py
src/engine/extraction/svkm_v2_1_compile.py
src/engine/tests/test_external_dependency_projection.py
src/engine/tests/test_svkm_v2_1_compile.py        <-- declared scope expansion, see §6
docs/designs/SYSTEM-INVENTORY.md                  <-- generated, hook-forced
.claude/skills/worker-1-compiler-onboarding/SKILL.md  <-- operator order, unrelated to C0
```
`src/server/` was NOT touched. The `system-map:check` registry drift remains the separately owned
CI hand-off AR-1386A §7 names.

---

## 2. RED → GREEN

Every repair had a failing test before it. Measured, not asserted.

**AR-1386A §§3-6 (round 0)** — 11 RED at `0fba478c` + constants, all GREEN at `73ebace9`:
```
test_AR1397_1_unresolved_or_conflicting_semantics_cannot_report_ready[VISUAL_UNRESOLVED]
test_AR1397_1_unresolved_or_conflicting_semantics_cannot_report_ready[SOURCE_CONFLICT]
test_AR1397_1b_the_semantic_block_is_nonterminal_and_named_honestly
test_AR1397_1c_conflicting_semantics_are_named_apart_from_unresolved_ones
test_AR1397_2_dependency_bearing_receipt_with_readiness_removed_is_refused
test_AR1397_2b_readiness_without_any_dependency_record_is_refused_as_inconsistent
test_AR1397_2d_terminal_wording_comes_from_the_structured_blocker
test_AR1397_3_reason_names_the_actual_blocking_axis_not_access_by_default
test_AR1397_3b_mixed_causes_preserve_every_cause_code
test_AR1397_3c_proven_unavailable_still_outranks_every_other_cause
test_AR1397_4b_receipt_identity_is_order_independent
                                            -> 11 failed, 68 passed  ->  79 passed
```
**Grader rounds 1-2** — the grader independently re-derived RED-ness by exec'ing the pre-repair
blobs in memory: **11 of 13** round-1 tests RED against the old `svkm_v2_1_compile`; the only two
green were `F1b` and `F3b`, which are the intended discriminating controls.

**Suite counts at the graded pin `39d60f49`** (worker-measured and grader-reproduced):
```
test_external_dependency_projection.py   105 passed      (59 at AR-1386A -> +46)
test_source_graph_projection.py           31 passed
test_svkm_v2_1_compile.py                 24 passed      (23 at the graded pin; +1 is the
                                                          inertness positive control, §7.5)
test_source_vertical_join.py              28 passed
test_spine_a_compile_entry_point.py       16 passed
test_compile_fidelity_leg_a.py            31 passed
ruff (4 changed files)                    All checks passed!
```

---

## 3. THE STRUCTURED TRUTH TABLE

729-row cross-product over (4 access axes × 3 states) × 3 implementation × 3 semantic. Expected
values derived from AR-1386A's prose, not from the implementation. Run by the grader in rounds 1-3
and independently by me after the `GATING_AXES` refactor:

```
rows: 729   blocked: 728   ready: 1   violations: 0
ready row: (VERIFIED, VERIFIED, VERIFIED, VERIFIED) + VALIDATED + MULTIMODAL_RESOLVED
```

Checked on every blocked row: `reason ∈ cause_codes`; `cause_codes` equals the ruling-derived
expected set; `unverified_axes` equals the expected axis set; `terminal` is True **iff** some access
axis is `UNAVAILABLE`; `terminal ⟹ reason == UNSUPPORTED_CAPABILITY_REFUSAL`.

| Blocking condition | `reason` | `terminal` |
|---|---|---|
| any access axis `UNAVAILABLE` | `UNSUPPORTED_CAPABILITY_REFUSAL` | true |
| any access axis `UNVERIFIED` | `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` | false |
| `implementation_status != VALIDATED` | `EXTERNAL_DEPENDENCY_IMPLEMENTATION_UNVALIDATED` | false |
| `semantic_status == VISUAL_UNRESOLVED` | `EXTERNAL_DEPENDENCY_SEMANTIC_UNRESOLVED` | false |
| `semantic_status == SOURCE_CONFLICT` | `EXTERNAL_DEPENDENCY_SEMANTIC_CONFLICT` | false |
| mixed | highest-precedence cause; **all** causes in `cause_codes` | per above |

---

## 4. THE ATTACK LEDGER

Every attack either grader round produced, replayed at the graded pin through the **real** entry
point (`build_certified_record`) on the **real** nine-node certified receipt with the **real** E8
fixture records:

```
A1  deps + readiness DELETED                          refused  RECEIPT_HASH_MISMATCH / READINESS_ABSENT
A2  deps blocked + readiness SET to READY             refused  EXTERNAL_DEPENDENCY_READINESS_CONTRADICTED
A3  A2 without structured_blocker                     refused  EXTERNAL_DEPENDENCY_READINESS_CONTRADICTED
A8  deps key RENAMED, readiness dropped               refused  RECEIPT_HASH_MISMATCH
C1  deps as a DICT keyed by dependency_id             refused  EXTERNAL_DEPENDENCY_READINESS_CONTRADICTED
C2  deps as a non-empty STRING                        refused  EXTERNAL_DEPENDENCY_READINESS_CONTRADICTED
C3  deps as int                                       refused  EXTERNAL_DEPENDENCY_READINESS_CONTRADICTED
H5  stamp REMOVED                                     refused  RECEIPT_HASH_ABSENT
H6  stamp blanked to ""                               refused  RECEIPT_HASH_UNREADABLE
H7  stamp set to None                                 refused  RECEIPT_HASH_UNREADABLE
H8  stamp set to a list                               refused  RECEIPT_HASH_UNREADABLE
--- DISCRIMINATING CONTROL ---
    untouched real receipt                            COMPILED 1 strategy
```

Each of A2, C1, C2, C3 was **also** replayed re-stamped, so the tamper gate could not mask the
derivation. All four still refuse at the backstop.

---

## 5. WHAT WAS ACTUALLY WRONG, ROUND BY ROUND

**Round 0 — AR-1386A's two counterexamples.**
`semantic_status` had a closed vocabulary but gated nothing, so an unresolved or conflicting
*meaning* reached ready with the provider merely reachable. And `_refuse_if_not_compile_ready`
keyed on `readiness is not None`, so deleting the key laundered a RED receipt into `COMPILED`.

**Round 1 — F-1, the same fail-open one spelling cheaper.** I blocked *deleting* the readiness
field and still *believed* it when set. The grader set `compile_readiness=READY` over records
reading every access axis `UNVERIFIED` and got `COMPILED 1`. Readiness is now **re-derived** from
the records the seam already holds. Also closed: F-2 (the zero-call guard was network-only under a
name claiming otherwise), F-3, F-4 (a test with no path to red), F-5.

**Round 2 — G-1 and G-2.** G-1: my re-derivation returned `{}` for any non-list container, and an
empty return means *nothing blocks* — so reshaping `external_dependencies` into a dict evaporated
the whole backstop. **G-2 was introduced by my own repair**: the new hash check returned early on a
blank or wrong-typed stamp, which is this packet's signature defect committed inside the fix for it.
The grader also caught that my A8 replay line was over-broad — true of a receipt my *test* stamped,
false of the real one, because `run_certified_projection` never stamped the record. The hash gate
was a no-op on the only production path.

**Round 3 — the drift pin was a caption.** Asked whether `GATING_AXES` was pinned by a test that
could go red, I found it could only catch drift in one direction. The projection now builds its
blocking-axis list **from** the map, so the two are structurally incapable of disagreeing.

---

## 6. DECLARED SCOPE EXPANSION

Making the receipt stamp mandatory rendered the production receipt effectively immutable
downstream, which broke **four legitimate mutation tests** in `src/engine/tests/test_svkm_v2_1_compile.py`
— a file outside my declared scope-lock. I edited it so those tests re-stamp, on the reasoning that
their mutations stand in for *"a projection legitimately produced this shape"*, not for tampering.

**I flagged this to the grader as the place I was least confident, because I had weakened refusals
that were previously firing.** It verified two ways and found nothing hidden:
- *structural* — without the re-stamp those tests would **fail**, not silently pass, because
  `RECEIPT_HASH_MISMATCH` cannot satisfy their `match=` patterns. The re-stamp is restorative.
- *mutation* — dropping the hash check, neutering the canonical-ref refusals, and leaking the alias
  each killed the expected test, with `MUTANT INSTALLED` markers verified.

Two honest caveats it recorded: `test_refuses_when_a_canonical_ref_is_removed_entirely` survives one
mutant because a **third** enforcement branch it did not mutate also covers the property; and the
inertness property of `test_preserved_metadata_is_structurally_inert` was not mutation-tested.

---

## 7. RESIDUALS — OPEN, NAMED, AND OWED TO A RULING

**7.1 The unkeyed stamp (grader-classified: documented scoped residual, not an undisclosed
fail-open).** The receipt hash is a plain sha256, not an HMAC, and `stamp_receipt()` is now public.
So one route survives: **delete the dependency declaration entirely and re-stamp** —
`A8r` and `A8r2` both `COMPILED 1`. Every attack that leaves an unsatisfied record *in* the receipt
dies at the backstop even when re-stamped. The module says this in its own docstrings, in bold,
before the grader raised it.

> **This is NOT a carry-forward I am parking.** Closing it means keying the stamp, and the repo
> already has the frozen-policy HMAC pattern to do it with. That is a **new keyed-integrity surface**
> — it re-baselines what "a valid receipt" means and touches secret handling, which AR-1386A §7
> ("do not expand the subsystem") forbids me from doing inside this packet and which
> `ratify-packet` places in the reserved class. **It is handed to GPT's next ruling as a named
> decision, with the pattern to use already identified.**

**7.2 🛑 CROSS-PLATFORM FLOAT DRIFT — RAISED IN SEVERITY BY MY OWN CHANGE.** The grader flagged
this and I then measured it:
```
receipt hash            : fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f
blob is pure ASCII      : True      <-- so `ensure_ascii=False` is a no-op here; that half is ZERO risk
float values in receipt : 18        <-- /outcomes[N]/relevance/own_score, best_rival_score, ...
```
GPT reported a canonical-float/hash drift class on its Linux CPython 3.11 runner. **Because the
stamp is now MANDATORY, a float-repr difference no longer degrades a check — it refuses every
receipt on that platform.** The risk is latent (the vertical does not run on Linux today) but it is
real, and it is worse than before my change.

> Mitigating it means altering `_canonical_hash`, which would move `fd79f602…` — a hash pinned in
> **four** committed locations. That is re-baselining a frozen certified ref, explicitly the
> reserved class under `ratify-packet`. **I did not do it. It needs the operator's or GPT's go,
> and it should be settled before anything runs this vertical on Linux.**

**7.3 Anti-laundering is still fixture-only.** "Dropping the dependency cannot make the strategy
less strict" is enforced by the E8 fixture's `required_dependency_ids`, never by the seam. This
matches AR-1386A §6.3 as literally written ("add the explicit negative test"), not the stronger
phrase "cannot delete". Named for the record.

**7.4 Not proven, and not claimed:** a full engine sweep. Six suites only.

**7.5 The grader's NOT-MEASURED list — three of five closed by the worker after its report.**
Its remaining items were handed back measured rather than left as "unverified":

| Grader item | Disposition |
|---|---|
| `test_source_band_c_vertical` not re-measured at this pin | **CLOSED — freshly measured**, §8. `12 failed, 11 passed, 7 errors`, `MY_MODULES_IN_SYS: []`. The weakened inference is retired; this is a direct measurement at the graded pin. |
| does anything downstream consume `receipt_sha256_canonical`? | **CLOSED — measured.** `grep -c receipt_sha256_canonical` on the emitted `sVkmZklJDHI__s0.spec.json` → **0**, and `git status` on `src/engine/extraction/fixtures/` is empty, so the committed artifacts are byte-unchanged. The stamp does not leak downstream. |
| `test_preserved_metadata_is_structurally_inert` inertness never mutation-tested | **CLOSED — positive control added**, `test_AR1397_the_inertness_property_has_a_path_to_red`. Blanking the winning `action` on the two preserved-metadata steps makes the rationale reach the compiled output, proving the inertness is load-bearing rather than a mutation that happens not to matter. Mutates only the RECORD — no `spec_producer` change, no monkeypatch of the thing under test. svkm suite 23 → 24. |
| full engine sweep | **OPEN, §7.4.** Not claimed. |
| E8 visual evidence + repo-wide `not_in_scope` locks | **OPEN.** Outside a code grade; needs the media and a different scan. |

---

## 8. PRE-EXISTING AND CAUSALLY EXCLUDED

`src/engine/tests/test_source_band_c_vertical.py` — **12 failed, 11 passed, 7 errors**
(`FamilyMetaEnforcementError`, AR-1113 5m/1m role combination). **Re-measured fresh at the graded
pin**, not inferred: that suite reaches the same failures with
`MY_MODULES_IN_SYS: []` — neither changed module ever enters `sys.modules` during the run. Code that
is never imported cannot change behaviour. Positive control: the same watcher on the C0 suite
reports both modules present. Separately owned; not this packet's.

The emitted artifact does not carry the new stamp (`grep -c receipt_sha256_canonical` on
`sVkmZklJDHI__s0.spec.json` → `0`) and the committed fixtures are byte-unchanged.

---

## 9. THE INDEPENDENT GRADE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| AR-1397 Stage C0 @ `39d60f49` | **7** | **VERIFIED** (`accuracy-validator`, independent, ≥2 non-overlapping paths per claim) | 14-variant side-effect replant (13/14 caught, the 1 undetected being the declared already-loaded-module scope, discriminated against a real new-module load); 20 seam/stamp attacks incl. re-stamped variants; 729-row cross-product, 0 violations; 4 landed mutants against the re-stamped sibling tests; nodeid set-diff 114→128 | unkeyed stamp (§7.1); anti-laundering fixture-only (§7.3); no full engine sweep; no cross-platform serialization evidence (§7.2) |

Grader's stated reason for 7 rather than 8: the anti-laundering property has no seam-level
enforcement, the tamper story is accident-resistant rather than adversary-resistant, and there is no
full engine sweep. Its reason for 7 rather than 6: *"across three rounds of attacks I can no longer
reach `COMPILED` with an unsatisfied dependency in the receipt by any value edit, container reshape,
stamp destruction, or re-stamp."*

### 9.1 The discrimination pass — the grader's last incomplete item, now closed

The grader installed the **`f8776f36` blobs of both production modules** with two faithful shims
(`GATING_AXES` as inert data, since the pre-repair projection had its own hand-written gating loop
and did not consume the map; `stamp_receipt` returning the hash **without mutating**, which is
byte-for-byte what pre-repair `run_certified_projection` did) and re-ran both suites:

```
PRE-REPAIR f8776f36 BLOBS INSTALLED
13 failed, 115 passed
```

**Every one of the 13 failures is a new test, and no pre-existing test broke** — so the failures are
pure discrimination, not collateral. RED against pre-repair: `F3b`, `G1`×3, `G1b`, `G2`×5, `G2b`,
`G3c`, and the paired unstamped-edit test.

`G3` and `G3b` stay GREEN, and that is **correct, not a gap**: they assert properties that also held
pre-repair (the old projection gated on the same six axes). They are forward-looking **drift pins**,
not repair claims — the same role `F1b` and the old `F3b` played as controls. **Every test that
claims a repair discriminates.**

**Grader process disclosures worth preserving** — it caught two of its **own** broken instruments
mid-grade: a witness that wrote through `os.open` (now a guarded arm), so all nine plants reported
`fires=0`, indistinguishable from "nothing fired"; and a mutation plugin that never loaded, so five
mutants falsely reported "no kills". Both were found by its own positive controls and re-run. Its
band rests on the corrected runs.

---

## 10. LOCKS OBSERVED

No Stage C1 provider work. No Currency Pros purchase, vendor contact, or credential request. No
webhook, endpoint, broker routing, live adapter, or screen-scraping money path. No E8 backtest,
certification, promotion, PAPER, Topstep, or live execution. No invented provider formula or native
4H range selector. No corpus census, Factory rerun, or 160-video intake. E8 remains a
compiler-calibration source only.

---

## 11. CARRY-FORWARD LEDGER

Per CLAUDE.md §11c the ledger must be empty or contain only actioned hand-offs with a named owner.

| Item | Owner | Status |
|---|---|---|
| Keyed (HMAC) receipt stamp — §7.1 | **GPT next ruling** | named decision, pattern identified, forbidden to me by AR-1386A §7 + `ratify-packet` reserved class |
| Cross-platform float drift under a mandatory stamp — §7.2 | **operator / GPT** | measured and disclosed; fix re-baselines a 4-site pinned frozen hash = reserved class |
| `system-map:check` registry drift (`src/server/`) | pre-existing CI hand-off | named by AR-1386A §7 itself as separately owned |
| `test_source_band_c_vertical` AR-1113 role failures | separately owned | causally excluded, freshly re-measured at this pin |
| Full engine sweep + E8 visual evidence + repo-wide lock audit | future scan | not claimed anywhere in this report; needs a different scan and the media |

No parked TODOs. No LOW-severity items deferred. Three of the grader's five NOT-MEASURED items were
closed by measurement AFTER its report rather than recorded as unverified (§7.5).

**⚠️ ONE POST-GRADE COMMIT.** The inertness positive control in §7.5 landed **after** the graded pin
`39d60f49`, so the **VERIFIED 7/10 band does not cover it**. It is additive test-only coverage that
closes a grader NOT-MEASURED item; it changes no production code. Stated here so nobody reads the
band as covering work the grader did not see — the same scoping discipline the grader itself applied
when it refused to let its band cover a dirty tree.

---

## 12. SESSION LOG (CLAUDE.md §10b) — recorded here, not in `AGENT-LOGS.md`

**Path deviation, disclosed:** §10b mandates a session-log entry in `AGENT-LOGS.md`. Worker-1's
guard `edit_scope` (`.claude/worker1-hook-guard-manifest.json`) does not cover that file —
`Edit` returns `authorized edit scope rejected: AGENT-LOGS.md`. Recorded here instead of requesting
a guard widening for a logging surface, matching the AR-1380A precedent already documented in
`docs/replay-results/CURRENT_STATE.md` ("widen nothing merely for logging ceremony"). GPT or the
operator may relocate it if a wider path is authorized.

**Mission:** Execute AR-1386A §7 — the bounded Stage C0 fail-closed closure packet — and hand it to
an independent grader.

**Work completed:** AR-1386A §§3-6 as detailed above, plus one operator-ordered onboarding change:
the Worker-2 seat was closed mid-session, so `worker-onboarding` §2b's mandatory peer handshake was
suspended in the Worker-1 overlay. Unamended it deadlocked the seat permanently — step 9 gates the
packet on `messaging_startup_verified=true`, which only an ACK from a now-nonexistent session could
set.

**Verification:** 3 independent adversarial rounds, band 5 → 6 → 6 → 7, final VERIFIED 7/10 at
`39d60f49`. C0 suite 59 → 105 tests. 729-row cross-product, 0 violations.

### 🛑 WHAT THIS PACKET ACTUALLY COST, STATED PLAINLY

**The same fail-open shape had to be closed FOUR times, and three of those were my own repairs.**

1. **GPT (AR-1386A §4)** — deleting `compile_readiness` laundered a RED receipt into `COMPILED`.
2. **Grader F-1** — I blocked *deleting* the field and still *believed* it when **SET**. The
   grader used the cheaper attack and got `COMPILED 1` on the real nine-node receipt.
3. **Grader G-1** — I then re-derived readiness from the records, but returned "nothing blocks" for
   a wrong-typed container, so reshaping the list into a dict skipped the backstop entirely.
4. **Grader G-2** — my new tamper check returned early on a blank stamp: **the identical defect,
   committed inside the fix that closed it for readiness.**

The grader also caught a claim of mine that was over-broad rather than wrong: I reported "A8 refused
`RECEIPT_HASH_MISMATCH`" from a receipt my *test* stamped by hand, while the production path never
stamped at all — making that gate a no-op exactly where it mattered.

### THE KNOWN-FACT THIS BOUGHT

> **A gate keyed to a field's VALUE is disarmed by deleting the field — and closing that for one
> field does not close it for the next.**

Four times in one packet the same shape: a check read a field, so the attack stopped supplying the
field. **The permissive branch is always the bug** — when a validator handles a wrong shape two
different ways in one function (fail-closed for a malformed *record*, exempt for a malformed
*container*), the exempt branch is where the next attack lands.

Three rules this bought, worth carrying beyond this packet:

1. **Re-derive, never believe.** A declared status that nothing recomputes is a self-report, and a
   self-report is not a gate.
2. **Absent ≠ innocent.** An integrity check a receipt can opt out of by omitting a field is not a
   check. Absence of proof is not proof of safety (CLAUDE.md §0.4).
3. **A test whose input already satisfies the property has no path to red.** `test_AR1397_4` passed
   against a sorting AND a passthrough implementation because its consumer pair was already sorted —
   the same dead-test class this packet was ordered to remove, reintroduced inside the packet
   written to remove it. Assert *in the test* that the input can discriminate.

**Carry-forward:** none parked; the two named hand-offs are in §11.
