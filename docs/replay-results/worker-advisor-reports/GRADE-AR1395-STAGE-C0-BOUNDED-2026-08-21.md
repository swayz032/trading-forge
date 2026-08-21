# INDEPENDENT GRADE — AR-1395 Packet B, Stage C0 (typed external decision dependency)

**Grader:** accuracy-validator (independent; did not design, build, or previously grade this change)
**Date:** 2026-08-21
**Mandate:** DISPROVE, not confirm. Doer ≠ grader.
**Verdict:** **BOUNDED** — the fail-closed core is real and mutation-resistant, but the headline
fail-closed guarantee has a reachable bypass, one required ruling test failed at the pin, and the
feature is unreachable from the production spec loader.

---

## 1. GRADE TARGET

| Item | Value |
|---|---|
| Repo | `C:\Users\tonio\Projects\wt-claude-worker1-20260815` |
| `git-common-dir` | `C:/Users/tonio/Projects/trading-forge/trading-forge/.git` (linked worktree) |
| **Pinned commit graded** | **`b3cc79cbdde14d9ccb7ea44e61a6b228081a3440`** (2026-08-20 23:38:14 -0400) |
| Branch | `claude/worker1-h1-20260815` |
| Authority | AR-1385A §6, §7 (`origin/external-advisor/gpt-rulings`) |
| Isolation used | detached worktree at `C:\tfpin` pinned to `b3cc79cb`, verified `git status --porcelain` empty before every measurement |

### 🛑 THE PIN DID NOT HOLD (governance finding, not a code defect)

The brief called `b3cc79cb` a FROZEN PIN. It was not frozen.

- At grade start: `HEAD == b3cc79cb`, tree clean. **MEASURED HERE**
- Mid-grade: tree went dirty — `src/engine/extraction/svkm_v2_1_compile.py` (+41) and
  `src/engine/tests/test_external_dependency_projection.py` (+66), files I never touched. **MEASURED HERE**
- By grade end: `HEAD == 51ff416d`, via `cda596b6` (lint), `6ddb18b0` (compile-seam fix),
  `51ff416d` (auto-wip). **MEASURED HERE**

My first measurement of the certification seam was taken against that uncommitted work and was
**wrong about the pin**. I discovered this only because I re-ran `git status`, not because anything
announced it. Every seam result below was re-taken inside the clean `C:\tfpin` worktree.

**Consequence:** a grade cannot be trusted if the target can move under it. Future dispatches must
either pin a tag/worktree the doer will not touch, or the doer must hold the tree still.

---

## 2. EXECUTION EVIDENCE

All commands run inside `C:\tfpin` (clean, detached at `b3cc79cb`) unless stated.

```text
$ python -m pytest src/engine/tests/test_external_dependency_projection.py -q
39 passed in 0.25s
$ python -m pytest src/engine/tests/test_source_graph_projection.py -q
31 passed in 0.38s
$ python -m pytest src/engine/tests/test_svkm_v2_1_compile.py \
      src/engine/tests/test_svkm_v2_1_golden_runtime_witness.py -q
32 passed in 1.82s
$ python -m pytest src/engine/tests/test_external_dependency_projection.py --collect-only -q
39 tests collected
$ python scripts/source_graph_projection_v2_1_certify.py
overall_status: GREEN_ALL_ITEMS_DONE   (A–I DONE, J EXTERNAL_NOT_CHECKED_BY_THIS_RUNNER)
```

C8's counts (39 / 31 / 32, certifier `GREEN_ALL_ITEMS_DONE`) **reproduce exactly at the pin**.

### Regression sweep — the doer's open carry-forward #2, now bounded and answered

The full 9703-test sweep does **not** complete: `--collect-only` finishes in 6.8s, but execution
reaches only ~3% in four minutes (≈2h projected), and three of my earlier concurrent runs sat at
**zero CPU delta over 20 minutes** — blocked, not slow. I stopped chasing it and answered the
regression question directly instead, by A/B-ing the pin against the pre-packet parent `4fc0f6f5` in
two clean worktrees (`C:\tfpin` @ `b3cc79cb`, `C:\tfbase` @ `4fc0f6f5`).

**Blast-radius population** — every test matching
`extraction|projection|compile|graph|g2d|finalizer|spec|svkm|evidence|fidelity|antecedent|collision`:

```text
@ b3cc79cb : 4 failed, 2394 passed, 5 skipped, 7303 deselected in 33.71s
```

**A/B of every failure observed, pin vs pre-packet parent — byte-identical both sides:**

| File set | `4fc0f6f5` (before) | `b3cc79cb` (pin) |
|---|---|---|
| the 4 blast-radius failing files | **9 failed, 168 passed** | **9 failed, 168 passed** |
| the 4 files failing in the first 3% of the full sweep | **23 failed, 122 passed** | **23 failed, 122 passed** |

Same counts, same test IDs, both sides. **Every failure I observed is PRE-EXISTING; this packet
introduces zero regressions in its blast radius.** C8's "no regression" claim is **CORROBORATED**
for the extraction/compiler surface. **MEASURED HERE**

*Separately worth the desk's attention (outside this packet):* the engine corpus carries a
substantial standing failure population — 23 failures inside the first 3% alone, in
`test_a_plus_gate_parity`, `test_a_plus_market_auditor`, `test_accuracy_fixes`,
`test_apply_trade_management_branching` — and `src/engine/tests/` cannot be run to completion. That
is a pre-existing condition at `4fc0f6f5`, not a finding against AR-1395, but "the full sweep is
green" is not a claim anyone can currently make.

---

## 2b. ATTACKS — everything I tried, including what did NOT break

| # | Attack | Outcome |
|---|---|---|
| A1 | Extra gate keys outside `values` mapped to permissive actions | **BROKE IT** → F-2 |
| A2 | Same, against the real pinned E8 fixture (`STALE: LONG_ONLY`) | **BROKE IT** → F-2 |
| A3 | `implementation_status="NOT_STARTED"` + access VERIFIED | **BROKE IT** → F-3 |
| A4 | All four axes `UNAVAILABLE` (terminal case) | **BROKE IT** → F-4 |
| A5 | Blank `provider`/`artifact`/`platform` + access VERIFIED | **BROKE IT** → F-5 |
| A6 | Arbitrary `semantic_status` / `implementation_status` strings | **BROKE IT** → F-5 |
| A7 | Post-validation mutation of the caller's `output_contract` dict | **BROKE IT** → F-6 |
| A8 | Live impure side effect injected into `run_projection` | **BROKE IT** (suite blind) → F-7 |
| A9 | Dependency pointed at an `ALIAS_OF_CANONICAL` ref | **BROKE IT** → F-9 |
| A10 | Flip PREMIUM/DISCOUNT in the pinned fixture | **BROKE IT** (undetected) → F-10 |
| A11 | Duplicate `consumer_refs` in one dependency | **BROKE IT** → F-14 |
| A12 | `consumer_refs` order permuted (ruling calls it a set) | **BROKE IT** (hash differs) → F-6b |
| A13 | C0-shaped BLOCKED record through the certification seam | **BROKE IT at the pin** → F-1 |
| A14 | `output_contract["type"]` set to a non-enum value | **BROKE IT** (unvalidated) |
| A15 | int-keyed vs str-keyed `configuration` hash collision | **HELD** — raises `TypeError`, no collision |
| A16 | 17 planted mutants against every structural guard | **HELD** — 16/17 killed |
| A17 | Empty tuple vs absent `external_dependencies` field | **HELD** — identical, omitted from receipt |
| A18 | Second receipt-emitting path bypassing the validator | **HELD** — `run_projection` is the sole emitter |
| A19 | Byte-identity of the committed receipt, 4 independent ways | **HELD** — identical every way |
| A20 | Did the packet cause the `system-map:check` failure? | **HELD** — pre-existing, doer is right |
| A21 | Did the packet regress the engine corpus? | **HELD** — zero regressions, A/B proven |

Fourteen attacks landed; seven bounced. The honest null matters as much as the findings: the hash
function is sound, the omit-when-empty discipline is exact, the validator is unbypassable on its own
path, and the compatibility claim is true in every direction I could measure it.

---

## 3. PASS — claims independently corroborated, and via which two paths

### C1 — "no-dependency spec produces a byte-identical receipt" → **CORROBORATED (4 paths)**

I did not re-read the doer's numbers. I re-derived them.

1. **Execution path.** Ran `svkm_v2_1_compile.run_certified_projection()` at the pin and computed the
   canonical hash myself:
   `fd79f602cd55e0abde88cf95516d1a3efe100395c948c5db22ca8d3bc162fc4f` — matches the receipt's
   internal `receipt_sha256_canonical`. **MEASURED HERE**
2. **Byte path.** `sha256` of the committed file =
   `3ccb4080ad84945d67d21b71dde5d9bc3211e36eeb9415b4c08552cc8eef950c`. **MEASURED HERE**
3. **VCS path.** `git diff --stat 4fc0f6f5 b3cc79cb -- <receipt>` is empty; the file's last touching
   commit is `fb97d871` (AR-1323A), long before this packet. **MEASURED HERE**
4. **Regeneration path (strongest).** Ran the certifier in a pristine worktree — it *rewrote*
   `source_graph_projection_v2_1.json`, and `git status` reported **no modification**. The file was
   regenerated byte-identically by post-change code. **MEASURED HERE**

Also confirmed structurally: the receipt at the pin carries neither `external_dependencies` nor
`compile_readiness` (omit-when-empty holds), and an empty tuple behaves identically to an absent
field — `ProjectionSpec().external_dependencies == ()` and the guard is `if projection.external_dependencies:`.
Mutant **M12** (guard removed) was **killed**. Attack surface 3: **CLOSED**.

### C4 — "Access is not one fact" → **CORROBORATED**
Path A: parametrized `test_C0_4e` over three axes plus `test_C0_4b`. Path B: mutants **M1** (grade
ignores `blocked`) and **M16** (axis-vocabulary check deleted) both **killed**; my own probe shows
each of the four axes independently drives `BLOCKED_EXTERNAL_DEPENDENCY`. **MEASURED HERE**

### C5 — "contract hash computed by the module, never trusted from the caller" → **CORROBORATED, with caveat**
Path A: mutant **M6** (mismatch check deleted) **killed**; mutant **M13** (hash → constant) **killed**.
Path B: I recomputed `external_dependency_contract_hash` out-of-band and it matched the emitted
`contract_sha256`. The int-key/str-key JSON collision I attempted did **not** collide (raises
`TypeError` on `sort_keys`), so no cheap collision exists. Caveat: see **F-6**.

### C7 — "semantic status survives the RED grade" → **CORROBORATED**
Path A: mutant **M11** (`semantic_status` erased from the record) **killed**. Path B: my own RED-path
probe reads `semantic_status == "MULTIMODAL_RESOLVED"` out of a `grade == "RED"` receipt. **MEASURED HERE**

### Attack surface 2 — "is `validate_external_dependencies` reachable on every path?" → **CLOSED**
`source_graph_projection.py` emits `projection_version` exactly once (line 1008), inside
`run_projection`, and `validate_external_dependencies` is called unconditionally at line 975 on that
same path. There is no second receipt-building route in the module. **MEASURED HERE**

### The tests are NOT vacuous — 17-mutant kill sweep

I mutated the production file in the disposable worktree, ran the suite, and restored
byte-identically after each (`source restored byte-identical: True`, asserted in-harness).

| Mutant | Result |
|---|---|
| M1 grade ignores `blocked` | killed |
| M2 fail-OPEN check deleted | killed |
| M3 metadata-consumer check deleted | killed |
| M4 duplicate-id check deleted | killed |
| M5 unknown-consumer check deleted | killed |
| M6 caller-hash mismatch check deleted | killed |
| M7 UNKNOWN-sentinel check deleted | killed |
| M8 gate-coverage check deleted *(re-run, unique anchor)* | killed |
| M9 timeframe-contradiction check deleted | killed |
| M10 `terminal` flipped to True | killed |
| M11 `semantic_status` erased | killed |
| M12 omit-when-empty guard removed | killed |
| M13 contract hash → constant | killed |
| M14 empty-consumer check deleted | killed |
| M15 unknown-kind check deleted | killed |
| M16 access-axis vocabulary check deleted | killed |
| **M17 live impure side effect injected** | **SURVIVED** → see F-7 |

**16 of 17 killed.** Every structural guard the doer claims has a real path to red.

*Harness honesty:* my first M8 run reported SURVIVED. That was **my** error, not a defect — the
anchor `if missing:` occurs three times in the file and `replace(..., 1)` hit line 306 instead of
line 519. Re-run with a unique two-line anchor: **killed**. A mutation that does not land proves
nothing, and I nearly published that as a finding.

### The `system-map:check` pre-existing claim → **CORROBORATED, the doer is right**
Path A (tree state): `git ls-tree -d 4fc0f6f5 src/engine/` lists `battery`, `extraction`, and
`forensics` — all three existed before any of this work. Path B (diff + registry): `git diff --stat
4fc0f6f5 b3cc79cb -- src/` shows **only two files** (the projection module and the new test file) —
no registry edit, no new engine directory — and `src/server/lib/system-topology.ts` at `4fc0f6f5`
already contained **0** mentions of `battery`/`forensics`. The inputs to the check are byte-identical
across the packet. **The failure is pre-existing and was not caused by this change.** **MEASURED HERE**

---

## 4. FINDINGS

### Discrepancy F-1: a BLOCKED C0 artifact compiled as executable — AR-1385A §7 item 16 FAILED at the pin
**Severity:** CRITICAL (false green at the money-path seam) · **Status at pin `b3cc79cb`: OPEN** · **Fixed at HEAD by `6ddb18b0`**
**Claim:** C2 — "An unresolved external dependency cannot read as green."
**Reality:** At the pin, `svkm_v2_1_compile.build_certified_record()` never read `compile_readiness`
at all. It gated only on per-outcome `disposition == "ACCEPTED"`. A receipt carrying
`grade="RED"` + `compile_readiness="BLOCKED_EXTERNAL_DEPENDENCY"` + a structured blocker compiled
into a certified executable record with **no refusal**.

**Sources compared (two non-overlapping paths, both against the pinned blob, not the dirty tree):**
- *Static:* `git show b3cc79cb:src/engine/extraction/svkm_v2_1_compile.py` contains
  `compile_readiness` → **False**, `structured_blocker` → **False**, `READY_PENDING_CERTIFICATION` → **False**.
- *Dynamic:* exec'd that pinned blob as a module and fed it a C0-shaped BLOCKED record →
  `build_certified_record` returned `{"strategies": [...]}`, 1 strategy built, **no exception**.

**Source of truth:** the dynamic run. The readiness signal existed and no consumer enforced it.
**Fix point:** `src/engine/extraction/svkm_v2_1_compile.py::build_certified_record` — closed at
`6ddb18b0` by `_refuse_if_not_compile_ready()`, which I re-measured as refusing. **MEASURED HERE**
**Repro (at the pin):** exec the pinned module, set `record["compile_readiness"]="BLOCKED_EXTERNAL_DEPENDENCY"`, call `build_certified_record(record)`.
**Blast radius:** anything downstream of the SPINE-A compiler consuming a certified record.

> The doer nominated this against themselves (attack surface 8) and fixed it during my grade. Credit
> where due — but at the graded commit it was open, and it is a required ruling item.

---

### Discrepancy F-2: the gate CAN fail open — undeclared provider states may map to trading actions
**Severity:** CRITICAL (fail-open readable from the receipt) · **Status at HEAD `51ff416d`: OPEN**
**Claim:** C3 — "The gate cannot fail open"; and the doer's own attack surface 6, "is `UNKNOWN`/`NO_TRADE`
enforced only at validation time, such that a receipt consumer could still read a fail-open gate from
`output_contract`?" **Answer: yes, and not only at validation time — by construction.**

**Reality:** `validate_external_dependencies` checks `values ⊆ gate` and never `gate ⊆ values`:

```python
missing = [v for v in values if v not in gate]      # values must be covered
...
if gate[UNRESOLVED_OUTPUT] != FAIL_CLOSED_ACTION:   # only the UNKNOWN key is constrained
```

So a contract may declare extra gate keys — `"STALE"`, `"ERROR"`, `""` — mapped to permissive
actions. They pass validation, are **serialized verbatim into the receipt**, and the artifact reads
**GREEN**.

**Measured (pinned worktree, and re-measured at HEAD `51ff416d`):**
```text
gate = {A:GO_A, B:GO_B, UNKNOWN:NO_TRADE, STALE:GO_A}   + all four access axes VERIFIED
grade            : GREEN_PENDING_CERTIFICATION
compile_readiness: READY_PENDING_CERTIFICATION
receipt consumer reading gate["STALE"] gets: GO_A
```
Repeated against the **real pinned E8 calibration fixture** with `"STALE": "LONG_ONLY"` added:
`GREEN_PENDING_CERTIFICATION` / `READY_PENDING_CERTIFICATION`, receipt gate
`{"DISCOUNT":"LONG_ONLY","PREMIUM":"SHORT_ONLY","STALE":"LONG_ONLY","UNKNOWN":"NO_TRADE"}`.

**Source of truth:** the emitted receipt. AR-1385A §7 item 14 requires "missing, unknown, **or stale**
provider state maps to `NO_TRADE` in the contract truth table." A stale state mapped to `LONG_ONLY`
is exactly the refused case, and it is admitted.
**Fix point:** `src/engine/extraction/source_graph_projection.py` ~line 519 — add the reverse
coverage check (`extra = [k for k in gate if k not in values]` → refuse), or constrain every gate
consequence not attached to a declared value.
**Blast radius:** any consumer that keys `output_contract["gate"]` by a live provider string.

---

### Discrepancy F-3: `implementation_status` is decorative — "no adapter exists" reads READY
**Severity:** HIGH (the three-facts principle collapses on the third fact) · **Status at HEAD: OPEN**
**Claim:** C2 — "An unresolved external dependency cannot read as green"; module docstring — "THREE
FACTS THAT MUST NEVER COLLAPSE INTO ONE BOOLEAN: semantic status / access status / **implementation status**."
**Reality:** `_ACCESS_AXES` contains only the four access axes. `implementation_status` is recorded in
the receipt and hashed into the contract, but **gates nothing**.

```text
implementation_status = "NOT_STARTED", all four access axes VERIFIED
grade            : GREEN_PENDING_CERTIFICATION
compile_readiness: READY_PENDING_CERTIFICATION
structured_blocker present: False
```
A dependency with **no validated adapter in existence** declares itself ready to compile. This is not
hypothetical: the pinned E8 fixture carries `implementation_status: "NOT_STARTED"`, and the only thing
holding it RED today is the access axes. The moment Stage C1 verifies access — the explicit next step
— this artifact goes green with nothing built.
**Fix point:** same file, the readiness computation — either add `implementation_status` to the
blocking axes or emit a distinct third readiness signal.

---

### Discrepancy F-4: `UNAVAILABLE` is reported to the world as `UNVERIFIED`, nonterminal
**Severity:** HIGH (the receipt asserts a false fact about the world) · **Status at HEAD: OPEN**
**Claim:** commit message — "structured_blocker.terminal is FALSE. **Unverified is not unavailable.**"
AR-1385A §6.4 — "Do not use terminal `UNSUPPORTED_CAPABILITY_REFUSAL` yet. Access is unverified, not unavailable."
**Reality:** the module mints `ACCESS_UNAVAILABLE = "UNAVAILABLE"` and then never distinguishes it.
`axes = [a for a in _ACCESS_AXES if getattr(dep, a) != ACCESS_VERIFIED]` lumps UNAVAILABLE in with
UNVERIFIED, so a dependency **proven permanently unavailable** emits:

```text
structured_blocker.reason   : EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED     <-- false
structured_blocker.terminal : False                                     <-- false
```

The doer's own distinction — the one this whole packet exists to protect — is inverted by the code
that claims to protect it. A permanently-dead provider reads as merely-unmeasured, inviting an
indefinite retry loop.
**Positive control for the "unused constant" claim:** `grep -rn "ACCESS_UNAVAILABLE" src/engine/`
returns exactly two lines — the definition (line 120) and its membership in `_ACCESS_STATUSES`
(line 121). Zero behavior, zero tests. Same for `EXTERNAL_DEPENDENCY_KIND_DATA_FEED` and
`EXTERNAL_DEPENDENCY_KIND_PLATFORM`: admitted by the validator, never exercised.

---

### Discrepancy F-5: provider ownership and `semantic_status` are unvalidated — AR-1385A §7 item 10 fails
**Severity:** MEDIUM · **Status at HEAD: OPEN**
**Claim:** AR-1385A §6.3 — refuse "unknown kind/**status**/output values"; §7 item 10 — "Removing the
provider-ownership receipt downgrades/refuses; **it may not stay green**."
**Reality:** only `kind` and the four access axes are checked against a vocabulary.
`semantic_status`, `implementation_status`, `provider`, `artifact`, `platform` accept any string,
including empty.

```text
provider="", artifact="", platform="", access VERIFIED
  -> GREEN_PENDING_CERTIFICATION / READY_PENDING_CERTIFICATION
semantic_status="GIBBERISH"
  -> receipt semantic_status = GIBBERISH, grade = GREEN_PENDING_CERTIFICATION
```
No test covers item 10. It is named in the fixture prose, not discharged in code.

---

### Discrepancy F-6: the receipt aliases caller-owned mutable state; "frozen" is skin-deep
**Severity:** MEDIUM · **Status at HEAD: OPEN**
**Reality:** `ExternalDependencySpec` is `@dataclass(frozen=True)`, but `configuration` and
`output_contract` are plain `dict`s and `consumer_refs` arrives from JSON as a `list`
(`ExternalDependencySpec(**fx["external_dependency"])` in `test_C0_6c`) despite the declared type
`tuple[str, ...]`. Worse, `validate_external_dependencies` stores the caller's dict **by reference**:
`"output_contract": dep.output_contract`. Measured:

```text
receipt dict IS caller dict object            : True
gate[UNKNOWN] in the ALREADY-EMITTED receipt  : NO_TRADE -> DIRECTION_A_ONLY
receipt still carries contract_sha256         : 6300674b164692da
true hash of the mutated dependency           : 735ff3b68a8434c4
```
A post-validation mutation flips the fail-closed sentinel **inside a receipt that has already been
emitted**, while the receipt's own `contract_sha256` silently goes stale. This is the one place the
hash could have caught the drift, and nothing recomputes it.
**Fix point:** deep-copy (or `MappingProxyType`) `configuration`/`output_contract` into the record,
and coerce `consumer_refs` to a tuple in `__post_init__`.

---

### Discrepancy F-7: `test_C0_4f_no_adapter_or_network_call_is_made` does not measure what it names
**Severity:** MEDIUM (caption defect; AR-1385A §7 item 13's second half is undischarged) · **Status at HEAD: OPEN**
**Claim:** the test name asserts no adapter/network call; the docstring concedes the mechanism —
"the proof that nothing reached out is that the projection is a pure function of its frozen inputs —
run it twice, identical result."
**Reality:** determinism is not purity. A deterministic side-effecting call is invisible to it.
**Positive control (mandatory for this class of absence claim):** I injected a live impure side
effect into `run_projection` on the external-dependency path — an append to an on-disk log — and ran
the full suite:

```text
M17 impure side effect injected -> SURVIVED | 39 passed in 0.21s
    side effect ACTUALLY FIRED 35 times during the suite
```
The injection was live (35 witnessed writes) and **not one of the 39 tests noticed**. The suite
cannot detect an adapter call. The *claim* is true at `b3cc79cb` — I read the module and there is no
network code — but it is true by inspection, not by test, and the test that names it is a guard with
no path to red.

---

### Discrepancy F-8: the versioned spec loader cannot carry an external dependency — AR-1385A §6.2 half-implemented
**Severity:** HIGH (the feature is unreachable from the production path) · **Status at HEAD: OPEN**
**Claim:** AR-1385A §6.2 — "Add a generic immutable `ExternalDependencySpec` … and an
`external_dependencies` collection to the existing `ProjectionSpec`**/versioned spec loader**."
**Reality:** `ProjectionSpec` got the field; the loader did not.
`source_graph_projection_spec.py::build_projection_run_inputs` constructs `ProjectionSpec(...)` with
seven keyword arguments and **`external_dependencies` is not among them**. Measured two ways:
- `"external_dependencies" in inspect.getsource(sgps)` → **False** (entire module). **MEASURED HERE**
- Read of lines 159–167: the constructor call enumerates `canonical_refs`, `alias_specs`,
  `preserved_metadata_refs`, `preserved_metadata_records`, `correction_ledger`, `graph_edges`,
  `graph_roots`. **MEASURED HERE**

**Consequence:** every production/certifier route (`svkm_v2_1_compile.run_certified_projection` →
`sgps.build_projection_run_inputs` → `run_projection`) reaches `run_projection` with
`external_dependencies == ()`, always. **Only directly-constructed `ProjectionSpec` objects — i.e.
test code — can declare a dependency.** The fail-closed machinery is real but presently
unreachable outside the suite, and item 16 was therefore also *vacuously* unreachable at the pin.
This is the single highest-leverage remaining gap: without it, Stage C0 cannot be exercised by any
committed JSON spec.

---

### Discrepancy F-9: a required gate may be attached to an `ALIAS_OF_CANONICAL` ref
**Severity:** MEDIUM · **Status at HEAD: OPEN**
**Claim:** C6 — "A required gate cannot be attached to a ref excluded from the executable denominator."
**Reality:** `valid_refs = set(text_by_ref) | {a.alias_ref for a in projection.alias_specs}` and the
only exclusion is `metadata_refs`. An alias ref is **not** in `canonical_refs`. Measured with a
properly-formed alias (my first attempt was inconclusive — the conservation check fired first, which
I record here rather than reporting the inconclusive run as a pass):

```text
consumer = "entry_sequence[1].rationale" (ALIAS_OF_CANONICAL of entry_sequence[1].action)
grade: GREEN_PENDING_CERTIFICATION / READY_PENDING_CERTIFICATION
disposition of that consumer: ALIAS_OF_CANONICAL
canonical_refs of the run: (entry_sequence[0].action, entry_sequence[1].action, stop.rationale)
```
Defensible — the alias resolves to an executable canonical — but nothing in the code, the docstring,
or the tests states or enforces that intent. No test covers it.

---

### Discrepancy F-10: the pinned calibration fixture is not tamper-evident
**Severity:** MEDIUM (AR-1385A §7 item 17 undischarged for the fixture) · **Status at HEAD: OPEN**
**Claim:** AR-1385A §7 item 17 — "Flip Premium and Discount actions; the semantic fingerprint/test
must fail."
**Reality:** the fixture pins `transcript_sha256`, `media_sha256`, and two `evidence_receipt_sha256`
values, but **no contract hash**: `"expected_contract_sha256" in FX["external_dependency"]` → **False**,
and no key anywhere in the fixture pins one. Measured tamper:

```text
tampered gate: {"DISCOUNT": "SHORT_ONLY", "PREMIUM": "LONG_ONLY", "UNKNOWN": "NO_TRADE"}
grade: RED | readiness: BLOCKED_EXTERNAL_DEPENDENCY | blocker: EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED
-> identical to the untampered result; no complaint of any kind
clean hash 13055537dcfc  vs  flipped hash 59f78f44d028   (differs, but nothing compares them)
```
`test_C0_5c` proves *the hash function is sensitive* on a synthetic dependency. It does not prove
*this fixture's semantics are pinned*. Those are different claims, and only the weaker one is tested.
**Fix point:** add `expected_contract_sha256` to the fixture (the validator already enforces it —
mutant M6 confirms), or assert the fixture's hash in `test_C0_6*`.

---

### F-11 (LOW): the "no new grade string" justification cites a module that cannot see this receipt
The commit message argues: *"No new grade string was minted — `g2d_finalizer` refuses any grade
outside {RED, GREEN_PENDING_CERTIFICATION}."* Measured: `g2d_finalizer` imports `run_route` from
`opus_phase1_route`, and `opus_phase1_route` contains **0** references to `run_projection` or
`source_graph_projection`. The two receipts are separate lineages; that fence cannot constrain
`run_projection`'s grade vocabulary. The *decision* may still be right — reusing RED is defensible on
its own merits — but the *stated mechanism* is a false link between two true facts.

### F-12 (LOW): the brief under-reports the commit's blast radius
The brief's "WHAT CHANGED" names 3 files. `b3cc79cb` touches **7**, including
`source_graph_projection_v2_1_certificate.json` — an artifact of record. The commit message *does*
disclose this honestly ("running the certifier as a compatibility PROOF rewrote the certificate file
as a side effect"), so this is a brief-vs-artifact gap, not concealment. Also unexplained in the
prose: the certificate's neighboring-suite `deselected` count moved 9366 → 9407, a delta of **41**,
while the packet adds **39** collected items. The residual 2 is most plausibly from commits
intervening since that certificate line was last regenerated — **HYPOTHESIS, not measured.**

### F-13 (INFORMATIONAL, pre-existing, NOT this packet's defect)
Running `test_svkm_v2_1_compile.py` rewrites three committed production fixtures under
`src/engine/extraction/fixtures/svkm_v2_1_compiled/`. Attributed cleanly: pristine worktree → run
only that suite → those three files modified. **`git diff --ignore-cr-at-eol` is empty — the change
is CRLF-only, no content drift.** I flag it because it is the same proof-mutates-evidence shape
AR-1385A §4 convicted, but it predates this packet and is a Windows line-ending artifact, not a
correctness issue. I explicitly decline to call this a hash-mismatch defect.

---

## 5. NOVEL ATTACKS (not nominated by the doer)

The doer nominated 8 surfaces. These were not among them:

1. **F-3 — `implementation_status` is decorative.** The doer guarded the access axis hard and left
   the third of their own three facts inert. This is the highest-probability future false green,
   because Stage C1's entire purpose is to flip access to VERIFIED.
2. **F-4 — `UNAVAILABLE` reported as `UNVERIFIED`, `terminal: False`.** The module mints a constant
   for the terminal case and then erases the distinction it exists to preserve.
3. **F-8 — the versioned spec loader gap.** The doer asked "is `validate_external_dependencies`
   reachable on every path?" (surface 2) and answered yes for `run_projection`. The sharper question
   is the inverse: *can any production caller reach it with a non-empty collection?* No.
4. **F-11 — the `g2d_finalizer` justification is a false link.**
5. **F-5 — `semantic_status` accepts arbitrary strings**, so "the source was understood" is an
   unvalidated free-text assertion in a receipt whose whole purpose is to keep that fact honest.

---

## 6. RECONCILIATION vs THE 20 REQUIRED TESTS (AR-1385A §7)

| # | Requirement | Status at pin |
|---|---|---|
| 1 | Legacy spec unchanged | **DISCHARGED** (C0_1, C0_1b; M12 killed) |
| 2 | Two consumers preserved exactly once | **PARTIAL** — no dedupe; duplicate consumers emit 3× (F-14 below) |
| 3 | Missing / metadata-only / empty / dup-ID / unknown-enum refuse | **DISCHARGED** (M3, M4, M5, M14, M15 killed) |
| 4 | Every output covered by the gate | **PARTIAL** — one direction only (F-2) |
| 5 | Mutating UNKNOWN from NO_TRADE refuses | **DISCHARGED** (M2 killed) |
| 6 | `decision_timeframe` mutation changes the hash | **DISCHARGED** (C0_5b) |
| 7 | Caller hash mismatch refuses | **DISCHARGED** (M6 killed) |
| 8 | 15m + 4H Premium → typed dependency, never `HTF_SOURCE_MISSING` | **PARTIAL** — fixture fields asserted; no assertion that `HTF_SOURCE_MISSING` is absent |
| 9 | 15m + 4H Discount → opposite gate consequence | **NOT WRITTEN** — no test asserts `DISCOUNT→LONG_ONLY` or `PREMIUM→SHORT_ONLY` |
| 10 | Removing provider-ownership receipt refuses | **REFUTED** (F-5) |
| 11 | Consumer marked context/tooling/metadata refuses | **PARTIAL** — metadata covered; context/tooling not modeled |
| 12 | "Indicator optional" does not remove the required HTF state | **NOT WRITTEN** |
| 13 | UNVERIFIED → BLOCKED, **and zero adapter calls** | **PARTIAL** — BLOCKED discharged; zero-calls unmeasured (F-7) |
| 14 | Missing/unknown/**stale** state → NO_TRADE | **REFUTED** (F-2) |
| 15 | Removing the dependency fails a presence assertion | **DISCHARGED** (C0_6d) |
| 16 | No C0 output passes the certification seam as executable | **REFUTED at pin** (F-1); fixed at `6ddb18b0` |
| 17 | Flip Premium/Discount → fingerprint fails | **REFUTED for the fixture** (F-10) |
| 18 | 4H→1H observable | **DISCHARGED** (C0_5b, M9 killed) |
| 19 | Dependency at an unrelated condition fails role validation | **PARTIAL** — non-existent refs refuse; no role concept exists; aliases pass (F-9) |
| 20 | Focused regression suite preserved | **DISCHARGED** (31 passed at pin) |

**11 discharged · 6 partial · 3 refuted (10, 14, 16) · 2 not written (9, 12).**

*(F-14, folded into item 2: `consumer_refs=("X","X","X")` is accepted and emitted verbatim three
times, and changes the contract hash — measured at pin and at HEAD. Related, F-6b: `consumer_refs`
is order-sensitive in the hash although AR-1385A §6.1 defines it as a **set**, so two byte-identical
contracts differing only in consumer order produce different `contract_sha256`. Measured:
`b66534a133164eb7` vs `8cf3a739e6c46903`.)*

---

## 7. GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| AR-1395 Stage C0 — typed external decision dependency @ `b3cc79cb` | **5 / 10** | **VERIFIED** (independent; not the doer) | 39/31/32 suites + certifier `GREEN_ALL_ITEMS_DONE` reproduced in a clean pinned worktree; C1 canonical hash re-derived by execution, by bytes, by VCS history, and by byte-identical regeneration; 16/17 mutants killed; 12 adversarial probes | F-1 (fixed at HEAD), F-2 fail-open gate keys, F-3 implementation axis inert, F-4 UNAVAILABLE mislabelled nonterminal, F-8 spec loader unreachable, F-5/6/7/9/10 |

**Band rationale.** Not 3–4: this is demonstrably more than "implemented but unproven" — the suite is
mutation-resistant on every guard the doer claims, and the doer caught and fixed their own vacuous
baseline before I arrived. Not 7–8: that band requires adversarial testing **with residual risks
documented**, and the residual risks here were asserted absent — claims C2, C3, and C6 are each
refuted by a reachable path I measured. Two required ruling items are refuted outright and two were
never written. Band **5** — real, working, better-than-happy-path fail-closed machinery with open
HIGH/CRITICAL fail-open holes and a production reachability gap.

Scope: commit `b3cc79cb` · `src/engine/extraction/source_graph_projection.py` +
`test_external_dependency_projection.py` + the pinned E8 calibration fixture · Python
`src/engine/tests` corpus · this Windows host. At HEAD `51ff416d` only F-1 is closed; F-2 through
F-10 were re-measured as still open.

---

## 8. LIMITATIONS — what I did NOT verify

1. **Full `src/engine/tests/` sweep — NOT RUN TO COMPLETION (bounded substitute delivered).** The
   suite does not finish: ~2h projected, and my concurrent attempts blocked at zero CPU. I answered
   the regression question by A/B-ing pin vs pre-packet parent over the 2394-test blast-radius
   population and over every failing file I observed (see §2) — all failures pre-existing, zero
   regressions. **What remains UNENUMERATED: roughly 7300 tests outside the blast-radius filter,
   never executed at either commit by me.** A regression there is unlikely (the packet adds one
   defaulted field to one dataclass and one new function) but is not measured. The desk should treat
   "full engine sweep green" as an unproven claim independent of this packet.
2. **`npm run system-map:check` was not executed by me.** My pre-existing verdict rests on two git
   paths (directory presence at `4fc0f6f5`, and byte-identical registry/engine inputs across the
   packet), not on running the check at both commits. The attribution is sound; the exit code at
   `4fc0f6f5` is **RELAYED** from the doer.
3. **No TypeScript, CI-gate, `n8n`, or frontend surface was touched.** Out of scope.
4. **I did not evaluate whether reusing `RED` was the right design** — only that the stated
   justification for it (F-11) does not hold. A third grade value may or may not be better.
5. **`EXTERNAL_DATA_FEED` / `EXTERNAL_PLATFORM_STATE` kinds** are admitted by the validator and
   never exercised anywhere. I confirmed the absence of coverage; I did not test their behavior.
6. **The pin moved under me.** Findings are stated against `b3cc79cb` and re-confirmed against
   `51ff416d`, but the intermediate commits `cda596b6` / `6ddb18b0` were not independently graded —
   only `6ddb18b0`'s effect on F-1 was measured.
7. **Blast radius of F-2/F-3 downstream of the compiler is unmeasured.** I proved the receipt carries
   the fail-open mapping and reads GREEN; I did not enumerate which consumers key into
   `output_contract["gate"]` at runtime, because no production caller can construct one today (F-8).

### Positive-control witnesses for every absence claim above
- *"the tests are not vacuous"* → 17 planted mutants, 16 killed; the one survivor (M17) was
  confirmed live by 35 witnessed side-effect writes; the false survivor (M8) was traced to my own
  non-unique anchor and re-run to a kill.
- *"the suite cannot detect an adapter call"* → planted a real impure side effect; suite stayed green.
- *"`ACCESS_UNAVAILABLE` has no behavior"* → enumerated every occurrence in `src/engine/`: 2, both
  definitional.
- *"the spec loader cannot carry the field"* → whole-module source search returned False, corroborated
  by reading the constructor's seven arguments.
- *"the receipt is byte-identical"* → regenerated it with post-change code and let `git` be the
  detector, rather than comparing a number to itself.

### Join keys checked for every "identical / unchanged" claim
- C1 unchanged → keyed on the file path `docs/replay-results/svkm-extraction-certified/grade/opus-v2/source_graph_projection_v2_1.json`, on `receipt_sha256_canonical`, and on the commit range `4fc0f6f5..b3cc79cb`.
- system-map pre-existing → keyed on the three subsystem names `battery`/`extraction`/`forensics`, the path `src/server/lib/system-topology.ts`, and the same commit range.
- test counts → keyed on the exact suite file paths, re-collected (`--collect-only` = 39) rather than trusted from the commit message.

---

## 9. VERDICT

**BOUNDED.**

The engineering is honest and the core is real: the structural validator refuses eleven distinct
malformed-contract classes, every one of those guards has a demonstrated path to red, backward
compatibility is proven four independent ways, and the doer caught and disclosed their own vacuous
baseline before shipping. That is genuinely good work and it should be said plainly.

It does not pass as claimed, for three reasons, each measured rather than argued:

1. **The fail-closed law has a hole** (F-2). A contract may map undeclared provider states — including
   the "stale" case AR-1385A §7 item 14 names explicitly — to trading actions, and the artifact reads
   GREEN. The single most load-bearing claim in the packet, C3, is false as written.
2. **The third of the three facts does not gate anything** (F-3). A dependency with no adapter in
   existence declares itself READY. Given that Stage C1's job is to verify access, this is the next
   false green, not a theoretical one.
3. **Nothing in production can reach any of it** (F-8). The versioned spec loader was not extended,
   so the fail-closed machinery is exercisable only from test code — which also made required item 16
   vacuously unreachable at the pin, independently of the seam defect that item 16 actually caught.

Recommended closure order: **F-8** (make it reachable) → **F-2** (close the gate) → **F-3** (gate the
implementation axis) → **F-4** (stop mislabelling UNAVAILABLE) → F-5/6/7/9/10. Items 9 and 12 of
AR-1385A §7 still need tests written.

Finally, the process finding stands on its own: **the frozen pin was not frozen.** I nearly published
a seam verdict measured against uncommitted work that post-dated the commit I was asked to grade. A
grade whose target moves is not a grade.

*No claim in this document rests on the doer's report. Every number above was re-derived from
artifacts or produced by a command run for this grade.*
