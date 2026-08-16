# AR-1262 — WORKER — D1-C1: THE ACTUAL-MODEL CHECK IS AN EXACT SET, BECAUSE A SUBSTRING IS NOT AN IDENTITY

```text
RULING FOLLOWED : AR-1261 §9 (A implement D1-C1 · B controls · C rerun D1 suites ·
                  D rerun read-only preflight · E prove 8 ready · F report and stop)
SEAT            : the AR-1260 seat, continuing. AR-1261 landed on the armed ear MID-TURN
                  and does NOT require a fresh session for AR-1262 (contrast AR-1259 §8,
                  which said so explicitly). No E1/E2 opened.
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
PIN (evidence)  : 227533be  <- every number below is at THIS pin
  f73bde88      : the work (matcher + controls)
  227533be      : SYSTEM-INVENTORY regenerate — ordered by the pre-push guard again
BRANCH HEAD     : 60729c48 — one further commit, the resume anchor only (docs). No code.
YOUR GRADED PIN : 1cc77d12 — reachable from mine. Delta to the evidence pin is exactly
                  2 commits, both this packet.
OPUS CALLS SPENT: 0 of 8. Receipt directory byte-unchanged (README.md only).
CI              : NONE at this pin. All evidence below is LOCAL.
EAR             : still armed, 2s, on origin refs/heads/external-advisor/gpt-rulings.
                  It DELIVERED AR-1261 into this session's chat and had already proved it
                  fires by catching my own AR-1260 publish.
GRADER          : NOT DISPATCHED — AR-1261 requires no grade for AR-1262. Say the word.
```

---

## 1. PRE-FLIGHT (advisor-ruling §0.-2) — NO CONTRADICTION, EXECUTED

Skills re-checked rather than remembered (`worker-execution §0.-1`): `worker-execution`,
`advisor-ruling` and `worker-onboarding` are byte-identical to the copies I read earlier this
session (`git hash-object`; last mtimes 2026-08-11/12, i.e. before this session). **Nothing
mutated under me.**

| # | | |
|---|---|---|
| 1 | SCOPE | One function in `src/engine/extraction/g2d_finalizer.py` + its tests. "Do not redesign the bridge" — the bridge is untouched. |
| 2 | STOP | An unseen exact identity ⇒ STOP and report, do not widen. Did not fire (no real call). No Opus spend. No E1/E2. |
| 3 | PROHIBITED | `contains` · `startsWith` · fuzzy · regex admitting arbitrary suffixes · aliases invented after seeing the answer · repairing `IsolatedDispatcher` back into the path. None done. |
| 4 | PROOFS | positive ×2, negative ×4 named + more, **mutation control**, rerun D1 suites, rerun preflight, prove 8 ready. |
| 5 | REPO STATE | `_model_family_is_opus` present at the graded pin, exactly as you quoted it. `[MEASURED HERE]` |
| 6 | ALREADY LANDED? | No — I wrote the defect myself in AR-1260, minutes earlier. |
| 7 | METRIC/GRADE MIX | None. |

---

## 2. YOU WERE RIGHT, AND HERE IS THE MEASUREMENT

I disclosed the substring matcher as an assumption. **Disclosure is not mitigation** — it was a
defect wearing a caveat. Measured, both matchers side by side, at the two pins:

```text
identity                        AR-1260 substring   AR-1262 exact set   verdict
'not-opus'                                   True               False   ATTACK GOT THROUGH
'opus-impostor'                              True               False   ATTACK GOT THROUGH
'myopus'                                     True               False   ATTACK GOT THROUGH
'this-is-not-opus-model'                     True               False   ATTACK GOT THROUGH
'claude-opus-5-evil-suffix'                  True               False   ATTACK GOT THROUGH
'CLAUDE-OPUS-5'                              True               False   ATTACK GOT THROUGH
'claude-sonnet-5'                           False               False   unchanged
'claude-haiku-4-5-20251001'                 False               False   unchanged
''                                          False               False   unchanged
'claude-opus-5'                              True                True   unchanged (accepted)
'claude-opus-5[1m]'                          True                True   unchanged (accepted)
```

**SIX attacks got through, not nine** — see §5 for why that distinction is not pedantry.
Two of the six are ones your ruling did not list and I added because a lazier repair would have
admitted them: `claude-opus-5-evil-suffix` (a `startsWith` fix would pass it) and `CLAUDE-OPUS-5`
(a case-insensitive fix would pass it).

---

## 3. THE REPAIR — ONE FUNCTION, NO REDESIGN

```python
ACTUAL_MODEL_IDENTITY_CONTRACT_VERSION = "g2d-actual-model-identity-v1"

APPROVED_ACTUAL_MODEL_IDENTITIES = frozenset({
    "claude-opus-5",
    "claude-opus-5[1m]",
})

def _actual_model_identity_is_approved(value: str) -> bool:
    return value in APPROVED_ACTUAL_MODEL_IDENTITIES
```

Exact membership. **Case is significant** — a model id is an identifier, not prose, and
lower-casing would silently admit a spelling this desk has never seen. `NOT_EXPOSED` remains an
accepted honest absence. Strict requested-model equality at dispatch is **unchanged**.

### Provenance of each member, and its grade

Both are **ARTIFACT-SOURCED from the Claude Code runtime's own model declaration — NOT measured
from a completion receipt**, because zero of the eight calls have been spent. `claude-opus-5` is
the runtime's stated model id for Opus 5; `claude-opus-5[1m]` is the exact id this seat reports.

### ⚠️ THE BARE WORD `opus` IS DELIBERATELY *NOT* A MEMBER

It is the authorized **requested** identity (`APPROVED_MODEL_IDENTITY`, still strict equality at
dispatch). The guess that a runtime might echo it back as an **actual** identity is a HYPOTHESIS,
and your §5 forbids widening on less than evidence. **The asymmetry is priced deliberately:**
being too narrow costs a STOP with all eight calls intact; being too wide costs a spent call
attributed to the wrong model. I took the recoverable error.

---

## 4. CONTROLS — INCLUDING THE MUTATION YOU REQUIRED

```text
positive : "claude-opus-5"              -> ACCEPT
positive : "claude-opus-5[1m]"          -> ACCEPT
positive : NOT_EXPOSED                  -> ACCEPT   (honest missing telemetry)
negative : not-opus · opus-impostor · myopus · this-is-not-opus-model
                                        -> REFUSE   (your four, verbatim)
negative : claude-sonnet-5 · claude-haiku-4-5-20251001   (exact real non-Opus identities)
negative : claude-opus-5-evil-suffix    -> REFUSE   (defeats a startsWith repair)
negative : CLAUDE-OPUS-5                -> REFUSE   (defeats a lower-casing repair)
negative : ""                           -> REFUSE
contract : the approved set is asserted EQUAL to {claude-opus-5, claude-opus-5[1m]} and
           asserted NOT to contain APPROVED_MODEL_IDENTITY ("opus")
shape    : the matcher's OWN source carries no " in (", ".lower()", ".startswith",
           ".endswith", "re." or "fnmatch"
```

**MUTATION CONTROL (your §5, last line).** The AR-1260 substring matcher is restored verbatim
inside the test and the four attacks are asserted to **wrongly pass** under it — then it is
restored and re-proved. Asserting the mutation *lets them through* is what proves the exact-set
check is the thing doing the work, rather than some other guard in the chain incidentally
catching those strings. The final restore-and-re-prove step exists because a leaked monkeypatch
would silently disarm every test after it.

**Source-shape assertion scoped to the FUNCTION, not the module** — the module docstring
legitimately quotes the old substring matcher to explain what was wrong with it, and a
whole-module grep fails on that comment. That is AR-1260 F-2 recurring; I scoped it this time
instead of rediscovering it.

---

## 5. RED / GREEN, AND AN HONEST NARROWING OF MY OWN RED

**RED at your graded pin `1cc77d12`** (throwaway worktree, new test file copied in, module logic
untouched; the new names shimmed in as inert constants so each guard is judged individually —
disclosed, same technique and same disclosure as AR-1260):

```text
python -m pytest src/engine/tests/test_g2d_finalizer.py -q
  -> 12 failed, 54 passed      <- 12 new guards RED; all 54 pre-existing GREEN
```

🛑 **AND THE PART I AM NARROWING MYSELF: 12 RED IS NOT 12 ATTACKS.** Three of the nine negative
cases — `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `""` — were **already refused** by the
substring matcher and went red **only because I changed the error message text**. Reading the
pytest failure list as a count of caught attacks would have let me publish "9 attacks got
through" when the measured answer is **six**. I caught this by running both matchers directly
rather than inferring behaviour from the failure list.
★ `A RED CAUSED BY A CHANGED MESSAGE IS NOT A RED CAUSED BY A CHANGED BEHAVIOUR.`

**GREEN at `227533be`:**

```text
python -m pytest src/engine/tests/test_g2d_finalizer.py \
    src/engine/tests/test_isolated_bridge.py \
    src/engine/tests/test_isolated_attempt_receipt.py \
    src/engine/tests/test_g2d_real_queue_preflight.py \
    src/engine/tests/test_isolated_dispatch.py \
    src/engine/tests/test_isolated_fallback_law.py -q
  -> 150 passed in 0.95s        (was 136 at 1cc77d12; +14 = this packet's controls)
```

**Blast radius, joined by failure MEMBERSHIP:**

```text
pytest src/engine/tests/ -q -k "isolated or g2d or opus_phase1 or fallback or
                                span_collision or batch_locator or conveyor"
  -> 4 failed, 370 passed, 5 skipped
```

The **same four node ids** as at both prior pins (`test_band_c_sizing_ingress.py` ×3,
`test_production_hardening_g2a_g2b.py` ×1). Pre-existing. Zero newly broken, zero newly errored.

⚠️ Same population caveat as AR-1260, restated because it does not stop being true: my changed
files are **NOT members** of the governed `canonical_regression_population.txt`. This is a `-k`
selection, **not** the governed instrument, and its denominator is not comparable to the
35/2384 governed baseline.

---

## 6. §9 D + E — THE REAL QUEUE, RE-MEASURED AT THIS PIN

```text
python scripts/g2d_real_queue_preflight.py
  queue_artifact_sha256     = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
  queue_count               = 8
  claimed                   = []
  dispatched                = []
  completed                 = []
  crash_shaped              = []
  stranded_incomplete       = []
  ready                     = 8
  receipt directory non-README = []
  ALL 8 ONE-SHOT ATTEMPTS UNSPENT.        exit=0
```

`ls isolated-receipts-t1/` → `README.md`. `git status --porcelain docs/replay-results/` → empty.
**Re-measured after the repair, not carried across it.**

---

## 7. FINDINGS

**F-1 (mine, and it is the one that matters).** I shipped a substring check and labelled it an
assumption. **A disclosed defect is still a defect** — the label bought me nothing and cost you a
ruling. The general form: when a check is *supposed* to be an identity comparison, "I could not
determine the exact string" is a reason to fail closed on a short set, not a reason to widen to a
substring. I had the fail-closed option available and did not take it.

**F-2 (mine, caught before publishing).** Nearly reported 9 attacks caught when the measured
number is 6 — see §5. The instrument (a pytest failure list) was answering a different question
than the one I was asking of it.

**F-3 (your §7, actioned).** `IsolatedDispatcher` is left deprecated and test-only. I did **not**
repair it back into the path and did not add a compatibility branch.

**F-4 (your §8, actioned).** Packet base, packet commits, evidence pin and documentation tail are
reported separately above, and the resume anchor now carries that discipline as a standing rule
for the next seat.

**F-5 (guard fired again, obeyed again).** The `inventory-freshness` pre-push hook blocked the
first push — `_model_family_is_opus` no longer exists, so the map named a dead symbol. Ran its
own published remedy. **The push did not land on that attempt.**

**F-6.** `docs/wave25-exit-engine-ab-report.md` still deliberately dirty, still not swept, still
not cleaned.

---

## 8. WHAT I DID NOT PROVE

- **No independent grade** — AR-1261 orders none, so `11c`'s pre-authorization does not fire.
- **No CI** at this pin.
- **The set members are ARTIFACT-SOURCED, not measured from a real completion.** Zero calls
  spent means no runtime has ever handed this code an `actual_model_identity`. The first real run
  is therefore also the first test of whether the set is right — **and by design, being wrong
  there is a STOP with the budget intact, not a spent call.**
- The governed regression manifest was not run (my files are not members); AR-1242's report that
  its membership test is already RED with 9 drifted files stays open and is not mine to settle.

---

## 9. NEXT

Per §9 F: **report and stop.** Not continuing to E1/E2.

I am deliberately **not** resolving your §9 fork myself. Real G2-D execution spends an
irreplaceable one-shot budget, which is the reserved class — it needs your ruling **and** the
live dispatch gate, and I can attest to neither from here. If the gate is not available, the
queued item is the P1 `REVIEW_REQUIRED` / native-hook **source** repair on the speed-engineering
toolbox authority path, never forked into Worker-1. The resume anchor records the fork verbatim
rather than picking a branch of it.
