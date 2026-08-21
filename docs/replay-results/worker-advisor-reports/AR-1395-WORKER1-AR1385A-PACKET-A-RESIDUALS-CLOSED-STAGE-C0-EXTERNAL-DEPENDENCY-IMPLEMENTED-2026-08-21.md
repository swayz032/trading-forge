AR-1395

RULING : AR-1385A (`a1ae225bd96908eec64f025bf76d8fcdc2ca0460`, 2026-08-21) section 10 — Packet A
(close AR-1394's residuals) then Packet B (implement Stage C0 only). Received live via the armed
`gpt-rulings` ear mid-session (`861dd4e2 -> a1ae225b`).

PIN : branch `claude/worker1-h1-20260815`. Start `55f1cdd6` — the head AR-1385A inspected.

COMMIT CHAIN :
```
f39c9db0  Packet A -- residuals closed, mutation arms moved to a temporary evidence root
b3cc79cb  Packet B -- Stage C0 typed external decision dependency        <- THE GRADED PIN
cda596b6  Packet B lint repair -- ruff I001 + B904
6ddb18b0  Packet B fix -- close the compile seam                          <- CURRENT HEAD
```
🛑 **THE GRADED PIN IS `b3cc79cb`, WHICH STILL CONTAINS A HOLE I FOUND AND FIXED AT `6ddb18b0`.**
See §4. If the grader reports that seam, its report is correct against its pin and already repaired.

RESULT : **Packet A COMPLETE. Packet B COMPLETE, plus one self-found defect repaired.** Stage C1 not
started (correctly gated). One pre-existing CI-gate drift discovered, outside scope, handed off.

---

## 1. PACKET A — AR-1385A SECTIONS 3 AND 4

### Correction 1 — active state no longer tells the old story (§3)

History may preserve a struck error; an **active machine-readable field may not keep announcing it
as current truth.** GPT was right that I had left exactly that.

| § | Item | Done |
|---|---|---|
| 3.1 | `vi_task.json` `executor_status` still said `VISUAL_UNRESOLVED / COMPILE_BLOCKER_SOURCE_MISSING / proven unresolvable` | Active field now states the three-axis result; former value moved verbatim to an explicitly struck history key. |
| 3.2 | `CURRENT_STATE.md` stale Lane B verdict; `32` artifacts; "ONE THING BLOCKING THE MONEY PATH" | Verdict struck and replaced with 3A/3B/native; `32`→**34**; the blocker claim corrected — Currency Pros gates **C1 only**, never C0. |
| 3.3 | `vi_findings.md` still said 32 | `34`, pointing at the dual pixel/byte verifier rather than `sha256sum -c` alone. |
| 3.4 | Malformed emphasis before "Currency Pros indicator" | Repaired. |
| 3.5 | AR-1394 omitted `docs/designs/SYSTEM-INVENTORY.md` from its CHANGED list | **Disclosed here, AR-1394 not rewritten.** Every changed-path list in this packet includes it. |

### Correction 2 — controls must not mutate real evidence (§4)

**GPT was right, and this was the load-bearing half.** Arms D and E mutated copies of the *scripts*
but wrote into the **real evidence files**, restoring them in `finally`. A kill between mutation and
restore leaves committed evidence altered.

★ **A TEST FOR EVIDENCE SAFETY MUST NOT MAKE EVIDENCE SAFETY DEPEND ON ITS OWN CLEANUP.**

REPAIR: `TF_VI_E8_EVIDENCE_ROOT`, a test-only override honoured by the generator, the proof and the
manifest verifier. Every destructive arm now runs against a full temporary copy.

Added **ARM F — the control on the containment itself.** It damages the temp lane and then **aborts
mid-mutation with no restore**, and still requires the real tree to be untouched. Asserting
containment only when the destructive arms *succeed* proves nothing about the case that matters.
Plus a whole-run fingerprint invariant over the real tree.

```
ARM A READ-ONLY       proof leaves the real tree byte-unchanged            PASS
ARM B REPRODUCIBLE    7 magnifications match by decoded pixels             PASS
ARM C MANIFEST GREEN  34 artifacts match by pixels AND bytes               PASS
ARM D MUTATION BITES  [temp] one-pixel change -> PIXELS DIFFER, exit 1     PASS
ARM E GUARD BITES     [temp] self-mutating proof refuses itself            PASS
ARM F CONTAINMENT     [temp] unrecovered abort does not escape             PASS
WHOLE-RUN INVARIANT   real fingerprint identical at start and end
```

---

## 2. PACKET B — STAGE C0

### What it closes

A taught rule whose value is computed **outside** Trading Forge had nowhere to live: the
representation offered *an executable condition* or *the source did not say*, and nothing between.
A required gate whose provider **meaning** was known but whose provider **access** was unproven got
forced into the nearest wrong bucket and reported as an absent source rule — the false terminal
refusal AR-1384A retracted. Three facts now stay separate and cannot collapse into one boolean:
**semantic status · access status · implementation status.**

### Added — `src/engine/extraction/source_graph_projection.py`

- **`ExternalDependencySpec`** (frozen). `consumer_refs` is a **set of existing executable refs**;
  `dependency_id` is the stable key. Per §6.1 the provisional positional `entry_sequence[1]` from
  the rejected candidate is explicitly **not** the contract.
- **`validate_external_dependencies()`** — refuses empty/duplicate id, empty consumers, unknown
  consumer, **metadata-only consumer**, unknown kind/status, empty output values, **missing
  `UNKNOWN` sentinel**, incomplete gate coverage, **fail-OPEN mapping**, timeframe
  contradiction/empty, and caller-hash mismatch. Reports readiness rather than raising on it,
  mirroring `validate_graph_edges`.
- **`external_dependency_contract_hash()`** — computed here, **never trusted from the caller**;
  reuses the existing canonical-serialization form so it cannot drift from the certifier's
  determinism proof.
- **`ProjectionSpec.external_dependencies`** — defaulted empty, **omitted from the receipt when
  empty**, on the discipline `ConditionBinding.parameters` established.

### The generic module stayed generic

`source_graph_projection.py` is fenced against source-specific strings — and the banned list
includes the substring **`short`**, so a real strategy's `SHORT_ONLY` gate value can never appear in
it. Domain vocabulary therefore flows through as **data**, exactly as `edge_type` already does. This
is §6.2's "no provider-specific logic or Currency Pros string in the generic module", enforced
mechanically rather than by intention. **The fence caught me once** (see §5).

### Fail-closed, which is the point

- `UNKNOWN` mapping to anything but `NO_TRADE` is refused.
- A contract with **no `UNKNOWN` value at all** is refused — it cannot express provider silence, and
  silence is the common case.
- **Access is not one fact:** `access_status`, `live_delivery`, `historical_replay`,
  `update_policy` each independently block.
- Unresolved access drives the **existing `RED` route**. No new grade string was minted:
  `g2d_finalizer` refuses any grade outside `{RED, GREEN_PENDING_CERTIFICATION}`, so a third value
  would fail closed for the wrong reason.
- `structured_blocker.terminal` is **`false`**. Unverified is not unavailable.
- **`semantic_status` survives the RED grade.** RED means *not ready to execute*, never *the source
  was not understood* — collapsing those two is the original defect.

### RED → GREEN

RED, before any code existed:
```
python -m pytest src/engine/tests/test_external_dependency_projection.py -q
ImportError: cannot import name 'ACCESS_UNVERIFIED' from
  'src.engine.extraction.source_graph_projection'
1 error in 0.25s        (30 tests could not even collect)
```

GREEN, the artifact the compiler now emits (`python scripts/_ar1395_c0_evidence.py`):
```
grade             : RED
compile_readiness : BLOCKED_EXTERNAL_DEPENDENCY
structured_blocker: {
  "reason": "EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED",
  "terminal": false,
  "dependency_ids": ["e8.htf_premium_discount"],
  "unverified_axes": {"e8.htf_premium_discount":
      ["access_status","live_delivery","historical_replay","update_policy"]}}
semantic_status   : MULTIMODAL_RESOLVED     <- survives the RED grade
contract_sha256   : 13055537dcfc1dd0e35306a5bc5754c4189897a7238313f2f519eef2a09fe0a5
two runs identical: True
LEGACY (no dependency): grade GREEN_PENDING_CERTIFICATION, and none of
  external_dependencies / compile_readiness / structured_blocker appear
```

### Compatibility — measured, not asserted

```
sibling projection suite     31 passed   (unchanged)
C0 suite                     41 passed
downstream compiler suites   32 passed   (unchanged)
certifier                    overall_status GREEN_ALL_ITEMS_DONE, items A-I DONE
committed v2.1 receipt       sha256 3ccb4080...950c   IDENTICAL to baseline
receipt_sha256_canonical     fd79f602...fc4f          IDENTICAL to baseline
ruff                         exit 0, "All checks passed!"
full src/engine/tests sweep  DOES NOT COMPLETE -- see section 6b. 0 failures attributable here.
```
The only certificate change is **one line** — the neighboring-suite tail, whose **outcome is
identical** (`294 passed, 5 skipped`); only the deselected count moved. Of that delta, **+39 is my
new suite** (measured by re-running the certifier's exact command with my file excluded: `9368`, vs
`9407` with it). The remaining **+2 predates this packet** and is disclosed as discovered drift.

---

## 3. THE FIXTURE (§6.6)

`docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/e8-calibration/external_dependency_calibration_fixture.json`
— pinned to the already-accepted transcript/visual facts, hashing the two panel frames. Expected
result is a **named, structured, nonterminal refusal**, not a trade and not a green strategy. It
carries `required_dependency_ids` so that **deleting the broken gate is detectable** (§7 item 15):
without that, the cheapest route past any external blocker would be to drop the dependency and go
green. `consumer_refs` is bound only against the synthetic calibration projection — **never** against
the rejected candidate SHA, which stays under lock.

---

## 4. 🛑 A REAL HOLE IN MY OWN CHANGE, FOUND AND FIXED — AND IT IS THE MOST IMPORTANT ITEM HERE

I nominated the certification seam to the grader as attack surface 8, then **checked it myself
rather than waiting**. It was a genuine defect.

**`svkm_v2_1_compile.build_certified_record()` never read the receipt's readiness at all.** It
refused only on a canonical ref that was not `ACCEPTED`. That was sufficient while the only way to
be unready was a failing canonical node — but an external dependency breaks that assumption exactly:
**every canonical ref can verify perfectly while the strategy is still unexecutable.** So an artifact
carrying `grade=RED` and `compile_readiness=BLOCKED_EXTERNAL_DEPENDENCY` **compiled as though it
were executable.** That is precisely the false green §7 item 16 exists to forbid.

★ **A READINESS SIGNAL THAT NO CONSUMER ENFORCES IS NOT A GATE, IT IS A COMMENT.**

REPAIR (`6ddb18b0`): `_refuse_if_not_compile_ready()`, called **first** in `build_certified_record`
so an unready artifact cannot hide behind a later unrelated refusal. Keyed on `compile_readiness`,
deliberately **not** on `grade` — grade is RED for many ordinary reasons this adapter already reports
more precisely. A receipt with no `compile_readiness` key passes straight through, so legacy
receipts are unaffected. `_COMPILE_READY` is **imported**, not re-declared: a second copy of a
literal is a copy that drifts.

RED → GREEN: `ImportError: cannot import name '_refuse_if_not_compile_ready'` → 2 seam tests pass,
C0 suite `39 → 41`, and the real certified compile path still passes (32 downstream, certifier
`GREEN_ALL_ITEMS_DONE`, receipt byte-identical).

---

## 5. FINDINGS AGAINST MYSELF — FOUR, ALL CAUGHT BY CHECKS RATHER THAN BY ME

1. **My first C0 fixture graded RED before any dependency existed** (no graph edges). Every "the
   dependency forced RED" assertion would have passed for the wrong reason. **A control that cannot
   discriminate proves nothing.** Fixed with real edges/roots and a grounded transcript; the reason
   is written into the test file so it cannot be quietly undone.
2. **My first seam test was vacuous the same way.** Calling `build_certified_record` on the synthetic
   4-ref projection raises `CanonicalNodeNotAcceptedError` *no matter what* — it lacks the 9 real
   canonical refs. It would have gone green while proving nothing about readiness. Rewritten to
   assert the readiness refusal on its own function **and** to require the readiness message to be
   the one that surfaces, which is what proves it fires first.
3. **The banned-string fence caught me** hardcoding a source-specific module name in a docstring.
   Reworded to reference the sibling by role. My deliberate avoidance of domain gate values in
   module source did hold.
4. **I nearly accepted a false green on the full sweep.** `pytest ... 2>&1 | tail -4` reports
   **`tail`'s** exit code, not pytest's — it returned "exit code 0" while pytest had actually
   errored on an unrecognised `--timeout` argument I passed. Re-run via a script that captures
   pytest's own return code. ★ **AN EXIT CODE FROM THE WRONG PROCESS IS A FALSE GREEN, AND A CHEAP
   ONE TO SHIP.**
5. **Disclosed:** running the certifier as a compatibility *proof* rewrote the certificate file as a
   side effect — the same proof-mutates-evidence shape §4 had just convicted, one layer over. The
   diff is outcome-neutral and is kept because it is now accurate, but I should have anticipated it.
6. **The ruff pre-push gate refused my first Packet B push** (import order, `raise ... from`). Both
   were real and are fixed, not bypassed. I had not noticed ruff on earlier pushes because those
   commits touched no Python.

---

## 6. PRE-EXISTING DRIFT — DISCOVERED, NOT CAUSED, OUTSIDE SCOPE, HANDED OFF

`npm run system-map:check` **exits 1**: *"Registry is missing 3 engine subsystem mappings"* —
**`battery`, `extraction`, `forensics`**. CLAUDE.md §10 requires this gate to exit 0.

`[MEASURED]` all three directories exist at **`4fc0f6f5`**, the head before any of my work
(`battery` 6 files, `extraction` 83, `forensics` 3), and this packet adds **no new directory** under
`src/engine/`. **I did not cause it.**

The fix lives in `src/server/lib/system-topology.ts` and its registry — **explicitly outside this
seat's `edit_scope`** (`_not_listed_is_not_allowed`). Per §11c this is a **named hand-off**, not a
parked TODO: it needs a seat with `src/server/` authority. Diagnostic instrument committed at
`scripts/_ar1395_systemmap_probe.py` so the next seat does not re-derive it.

---

## 6b. THE FULL ENGINE SWEEP — WHAT I ACTUALLY MEASURED, AND WHAT I DID NOT

**I did not obtain a completed full-suite result, and I am not claiming one.**

`python -m pytest src/engine/tests/ -q` **is killed partway** — exit `4294967295` (`-1`, an external
termination, not a pytest failure code), output stopping at ~3–9%, **no summary section produced**,
so it yields `F` marks with no node ids. Retried with `-rf --tb=no -p no:cacheprovider
--continue-on-collection-errors`; same termination. `DISPATCH-KNOWN-TRAPS.md` §3 already records
that this suite collects ~7,800 tests and *"then takes minutes"* — that trap is about slowness; what
I hit is a hard kill, which I could not resolve and am reporting rather than working around.

**So I measured a bounded slice instead, in completing batches, and attributed every failure:**

```
files 0-5    exit 1    21 failed, 65 passed
files 6-11   exit 1     2 failed, 145 passed
files 12-17  exit 1     2 failed, 150 passed
files 18-23  exit 1     9 failed, 133 passed
                       ----------------------
                       34 failing nodes across the first 24 of 403 test files
```

```
IN FILES THIS PACKET TOUCHED ......... 0
IN FILES THIS PACKET DID NOT TOUCH ... 34
```

The 34 sit in `test_a_plus_gate_parity.py` (18), `test_b3_archetypes.py` (6),
`test_a_plus_market_auditor.py`, `test_accuracy_fixes.py`, `test_b14_topstep_consistency_survival.py`,
`test_apply_trade_management_branching.py`, `test_artifact_writers_pin_newline.py`,
`test_accept5_stale_run_consumption.py` — A+ gate wiring, market auditor, archetype fixtures,
commission math, Topstep consistency. **Unrelated subsystems.**

**And that is proven, not inferred from topic.** `[MEASURED]` **not one of those eight files
references `source_graph_projection`, `svkm_v2_1_compile`, or `external_dependency`** — they cannot
reach any line this packet changed:
```
test_a_plus_gate_parity.py                  none
test_a_plus_market_auditor.py               none
test_accept5_stale_run_consumption.py       none
test_accuracy_fixes.py                      none
test_apply_trade_management_branching.py    none
test_artifact_writers_pin_newline.py        none
test_b14_topstep_consistency_survival.py    none
test_b3_archetypes.py                       none
ANY FAILING FILE REFERENCES MY CHANGED MODULES: False
```

🛑 **SCOPE, STATED SO THE HEADLINE CANNOT TRAVEL WIDER THAN THE BODY:** I measured **24 of 403 test
files (~6%)**. I do **NOT** claim "the engine suite has 34 failures" — the true total over all 403
files is **unmeasured**, and on this sample it would be substantially higher. What I claim is
exactly: **in the slice I measured, every failure is in a file that cannot reach this packet's
code.** Combined with 104 passing tests across the four files I did touch and the certifier's
pre-registered neighboring command returning its committed `294 passed, 5 skipped` unchanged, the
no-regression claim for THIS packet holds — while the broader suite's health is an open, separately
owned question I am surfacing rather than absorbing.

Instrument committed: `scripts/_ar1395_full_sweep.py`, `scripts/_ar1395_early_failures.py`.

---

## 7. WHAT I DID NOT DO, DELIBERATELY

No Stage C1. No provider adapter, webhook, endpoint, or network call. No Currency Pros purchase,
subscription, vendor contact, or credential request. No UI preflight (access still unconfirmed —
*"we using topstep x"* is neither yes nor no, §8). No invented native 4H range selector. No E8 Round
4 or reuse of the rejected candidate. No E8 backtest, certification, promotion, PAPER, Topstep or
live execution. No broad corpus census (§9.4 gates it on the C0 birth tests). No change to
`ConditionBinding` or `breakout_confirmation_ambiguity.py` — both outside `edit_scope`, and §4 of
the dependency record already recorded the contract as *"recorded, not wired"*.

**All AR-1385A section 10 locks observed.**

---

GRADER : `accuracy-validator` dispatched adversarially (DISPROVE mandate, ≥1 novel attack required)
against frozen pin **`b3cc79cb`**, per `ratify-packet` (instrument changes proceed under mandatory
independent grading; doer ≠ grader). Its brief hands it a working reproduction recipe, names the
claims verbatim, nominates eight attack surfaces **against myself**, and lists what I did **not**
prove. **⏳ VERDICT PENDING AT THE TIME OF WRITING — this AR will be amended with the FULL grader
report, including any finding that convicts me, and the durable receipt path.** Two results are
outstanding: the grader's verdict and the full `src/engine/tests/` sweep. **Neither is claimed as
green here.** No number or band is issued by me; I do not grade my own repair.

STOP : none fired.

NEXT : GPT's ruling on this packet. The **one open operator question** is unchanged and no longer
blocking: does the operator hold lawful Currency Pros access? **Yes** → the bounded §7 preflight
resumes as C1. **No** → E8 stays calibration-only and nothing is spent. Either way C0 stands, because
the compiler learning to represent an external decision dependency never depended on that answer —
which is the durable value route (b) was chosen for.
