# AR-1260 — WORKER — D1 A–D: THE QUARTET IS WALKED, AND TWO OF ITS FOUR LINKS WERE DECOR

```text
RULING FOLLOWED : AR-1259 §8 (A complete-quartet join · B crash-safe capture ·
                  C model/task identity · D real queue preflight). E1 NOT started.
SEAT            : fresh main session (AR-1255 §3.1) — AR-1258 was a completed packet
WORKTREE        : C:\Users\tonio\Projects\wt-claude-worker1-20260815
BRANCH          : claude/worker1-h1-20260815
PIN (evidence)  : 1cc77d1228f2cd119625ed47b6e923bea4f8a131  <- every number below is at THIS pin
  586ad8d0      : the work (A–D + tests)
  1cc77d12      : SYSTEM-INVENTORY regenerate — ordered by the pre-push guard, see F-5
BRANCH HEAD     : eda500ab — one further commit, the resume anchor only (docs). No code.
YOUR GRADED PIN : 10c04f43 — reachable from mine (git merge-base --is-ancestor: YES)
DELTA vs 10c04f43: 6 commits. 3 are the out-of-band/resume-anchor commits AR-1258's resume
                  card already disclosed to you; 3 are this packet (2 code+map, 1 anchor).
OPUS CALLS SPENT: 0 of 8. Receipt directory byte-unchanged (README.md only).
CI              : NONE at this head. All evidence below is LOCAL.
EAR             : ARMED this session on origin refs/heads/external-advisor/gpt-rulings
                  @ e8a04d6f (= AR-1259, the newest ruling), 2s poll. The EAR ARMED
                  line was DELIVERED into this session's own chat — a live ear process
                  belonging to a dead seat was found first (PID 5132, parent gone) and
                  was NOT killed and NOT counted as mine. Blind window backfilled: the
                  arming head IS AR-1259, read by hand; nothing landed between.
GRADER          : NOT DISPATCHED — AR-1259 §8 requires no grade for AR-1260. See §7.
```

---

## 1. PRE-FLIGHT (advisor-ruling §0.-2, seven questions) — NO CONTRADICTION, EXECUTED

| # | | |
|---|---|---|
| 1 | SCOPE | AR-1259 §8 names behaviours, not files. The behaviours live in `g2d_finalizer.py` (A), `isolated_bridge.py` (B, C), their tests, and a new read-only script (D). `[MEASURED HERE]` |
| 2 | STOP | "any real receipt appears unexpectedly" — recognised as a non-README entry in `isolated-receipts-t1/`. Did not fire. Also: no E1, no Opus spend. |
| 3 | PROHIBITED | E1–E3 · real G2-D calls · sweeping historical worktrees · Worker-2 · mutating the parked `paper-parity` memory payloads · cleaning the dirty `wave25` file. None touched. |
| 4 | PROOFS | 4 REFUSE controls + 1 ACCEPT (A) · failure injection (B) · identity joins (C) · read-only preflight receipt (D). |
| 5 | REPO STATE | Verified at the pin before editing: all named symbols exist; frozen queue present, 8 entries, `queue_sha256 5935b1c6…`. |
| 6 | ALREADY LANDED? | No. `system_inventory.py --check` = FRESH; greps for `quartet` / `STRANDED` / `crash-safe` across `src/`, `scripts/`, `ADVISOR-RULINGS.md`, `AGENT-REPORTS.md` and the memory directory returned nothing implementing this. `stranded_mid_handoff` existed but covers only CLAIMED/DISPATCHED. |
| 7 | METRIC/GRADE MIX | None. §8 D is purely mechanical counts. |

---

## 2. THE DEFECT, NAMED AT ITS LAYER

The durable handoff writes **four** receipts. The consumer opened **two**.

```text
.attempt      the budget was claimed        <- read
.dispatch     a call was actually ISSUED    <- NEVER OPENED
.raw          the text that came back       <- read
.completion   the call actually FINISHED    <- NEVER OPENED
```

Two consequences, both reachable, neither hypothetical:

- **A raw return for a call that was never issued was fully admissible.** `.attempt` + `.raw`
  was the entire pair, and `.attempt` proves only that a budget was claimed.
- **The half-written final commit read as a finished call.** `capture_native_return` writes
  `.raw` then `.completion`; `state_of` returned `RAW_RETURN_CAPTURED` on `.raw` alone. Worse,
  the completion CONTRACT was validated *after* `.raw` was already on disk, so an unrecognised
  metadata field produced the stranded state **as routine — no crash required.**

★ `FOUR FILES ARE A CHAIN ONLY IF SOMETHING WALKS ALL FOUR LINKS. TWO OF THEM WERE DECOR.`
★ `A TWO-FILE COMMIT READ THROUGH ONE OF ITS FILES IS NOT A STATE, IT IS AN ASSUMPTION.`

---

## 3. CHANGED

```text
src/engine/extraction/g2d_finalizer.py         A
src/engine/extraction/isolated_bridge.py       B, C
src/engine/tests/test_g2d_finalizer.py         +19 guards, fixture upgraded (see §6 F-1)
src/engine/tests/test_isolated_bridge.py       +15 guards
scripts/g2d_real_queue_preflight.py            D  (new, read-only)
src/engine/tests/test_g2d_real_queue_preflight.py  D's own RED proof (new)
docs/designs/SYSTEM-INVENTORY.md               regenerated — ordered by the pre-push guard
```

No compiler, backtester, PAPER, broker, live, agent-definition or skill file changed.

### A — complete-quartet consumer join
All four receipts are walked in order and joined on `condition_ref`, the frozen
`task_input_sha256`, the queue-artifact **bytes**, and `attempt_number == 1`.
REFUSE: no dispatch · no completion (STRANDED) · completion without dispatch · completion
without raw · dispatch without attempt · any mismatched condition/task-id/queue.
ACCEPT: the exact quartet.

### B — crash-safe capture
`STRANDED_INCOMPLETE` is a real state. `.raw` without `.completion` is never
`RAW_RETURN_CAPTURED`; the finalizer refuses it; `capture_native_return` refuses to resume it
(the attempt was claimed, so it is spent — **no retry is automatically granted**). The completion
contract is validated and the receipt fully built **before any file is created**, so a refusal
leaves the directory exactly as it found it. `bridge_report` gets its own bucket for it —
folding it into either neighbour would hide the distinction the state exists to draw.

### C — model / task identity
`record_native_dispatch` now **REFUSES** a requested model that is not `opus`, instead of
faithfully recording an unauthorized call. The completion receipt **JOINS** the dispatch —
the literal `"requested_model_identity": "opus"` is gone from the builder — and two *exposed*
native task ids that disagree are refused at capture and again at consumption.

### D — read-only preflight
`scripts/g2d_real_queue_preflight.py`. Asserts the receipt directory exists **before** loading
(so `DurableAttemptLedger.load`'s `makedirs` is a proven no-op, not a trusted one), exposes no
delete path at all, and STOPs non-zero on any unexpected receipt.

---

## 4. RED — 34 new guards fail against unmodified HEAD

Run in a throwaway worktree at `478e2033` (removed after), new test files copied in, module
logic untouched. **Disclosed: two inert constants (`STRANDED_INCOMPLETE`, `APPROVED_MODEL_IDENTITY`)
were appended to the old module there so the test files could be IMPORTED.** Without that, the
first attempt produced a single collection ImportError — a blunt RED that proves the symbol is
new and says nothing about whether each guard bites.

```text
python -m pytest src/engine/tests/test_isolated_bridge.py -q
  15 failed, 16 passed          <- all 15 new guards RED; all 16 pre-existing GREEN

python -m pytest src/engine/tests/test_g2d_finalizer.py -q
  19 failed, 33 passed          <- all 19 new guards RED; all 33 pre-existing GREEN
```

**The suite discriminates — it is not always-red.** The 49 pre-existing tests stay green in the
same run, which is what separates "catches breakage" from "fails on everything".

---

## 5. GREEN + CONTROLS at `1cc77d12`

```text
python -m pytest src/engine/tests/test_g2d_finalizer.py \
    src/engine/tests/test_isolated_bridge.py \
    src/engine/tests/test_isolated_attempt_receipt.py \
    src/engine/tests/test_g2d_real_queue_preflight.py \
    src/engine/tests/test_isolated_dispatch.py \
    src/engine/tests/test_isolated_fallback_law.py -q
  -> 136 passed in 0.85s
```

**Blast radius, and its baseline joined by failure MEMBERSHIP (not by count):**

```text
pytest src/engine/tests/ -q -k "isolated or g2d or opus_phase1 or fallback or
                                span_collision or batch_locator or conveyor"
  mine (1cc77d12) : 4 failed, 356 passed, 5 skipped
  HEAD (478e2033) : 4 failed, 315 passed, 5 skipped   <- IDENTICAL command, clean tree
```

The **same four node ids** fail at both pins — `test_band_c_sizing_ingress.py` ×3 and
`test_production_hardening_g2a_g2b.py` ×1. **Pre-existing. Zero newly broken, zero newly errored.**
The +41 is exactly this packet's new tests.

⚠️ **Population caveat, stated because AR-1242 was convicted for omitting it:** my changed files
are **NOT members** of the governed `canonical_regression_population.txt`. The run above is a
blast-radius `-k` selection, **not** the governed instrument, and its denominator is not
comparable to the 35/2384 governed baseline.

### D — the real preflight, and proof it can go RED

```text
python scripts/g2d_real_queue_preflight.py
  queue_artifact_sha256     = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
  law_version               = isolated-fallback-law-v1
  input_route_version       = opus-phase1-route-v2
  queue_count               = 8
  claimed                   = []
  dispatched                = []
  completed                 = []
  crash_shaped              = []
  stranded_incomplete       = []
  ready                     = 8
  receipt directory non-README = []
  ALL 8 ONE-SHOT ATTEMPTS UNSPENT.      exit=0
```

**A detector that has only ever reported green is not yet an instrument**, so every STOP path is
fired against a **throwaway byte-copy** of the real artifacts (never the real directory):

```text
planted attempt receipt   -> claimed=[ref], ready 8->7, exit 2
stray file in receipt dir -> non-README=[...], ready STILL 8, exit 2   (discrimination control)
receipt dir deleted       -> SystemExit "read-only", and the dir is NOT created
clean run                 -> directory listing byte-identical, queue_count==8 as positive witness
delete-path grep          -> no os.remove / os.unlink / rmtree / .unlink( in the script
```

Witness that the real tree was untouched by the entire session:
`git status --porcelain docs/replay-results/` → empty; `ls isolated-receipts-t1/` → `README.md`.

---

## 6. FINDINGS — INCLUDING AGAINST MYSELF

**F-1 (mine, disclosed).** The finalizer's positive control previously built its fixture with
`led.persist_raw_return` **directly**, bypassing the bridge — so it constructed a shape the real
handoff cannot produce. Under §A that fixture is no longer a valid quartet, and I **upgraded it
to drive the real transitions**. This is a changed test fixture, not merely an added test, and it
is the reason `test_POSITIVE_CONTROL_...` is renamed. Judge the guards accordingly.

**F-2 (mine, caught by my own instrument).** My first §C proof was a **source-text assertion**
(`'"opus"' not in inspect.getsource(...)`). It failed — against my own **docstring**, which quotes
the old literal. That is the "a grep matching a comment is not a verification" trap in reverse.
Replaced with a behavioural proof: the `.dispatch` receipt on disk is edited to name a different
model and the completion must come back carrying **that** value. **I did not keep the clean second
attempt and hide the first.**

**F-3 (latent behaviour change, NOT dead).** `isolated_dispatch.IsolatedDispatcher` calls
`persist_raw_return` directly and writes no `.dispatch`/`.completion`. **Anything it produces is
now REFUSED by the finalizer.** `[MEASURED]` it has **zero non-test callers**, so nothing live
regresses — and AR-1254 F-2 already ruled the Python callback "not the real runtime", so refusing
it is the correct fail-closed direction. But the two paths are **no longer interchangeable**, and
that is a fact worth your ruling rather than my assumption.

**F-4 (stated assumption, not a measurement).** AR-1259 §8 C says the exposed
`actual_model_identity` must be Opus but does not fix the string the runtime emits. The runtime
emits a **versioned** name (`claude-opus-5`), so a literal `== "opus"` would refuse every honest
completion. I read it as **case-insensitive family membership** (`"opus" in value.lower()`) and
said so in the code. **If that reading is wrong, one named line is wrong** — `_model_family_is_opus`.
Note the asymmetry I chose deliberately: the *requested* model at dispatch is held to **strict
equality**, because there the caller picks the string.

**F-5 (guard fired, obeyed not routed around).** The first `git push` was **BLOCKED** by the
`inventory-freshness` pre-push hook: my new script made `SYSTEM-INVENTORY.md` stale. I ran the
guard's own published remedy and committed the regeneration as its own commit. **The push did not
land on that attempt, and I did not claim it had.**

**F-6 (untouched, as ordered).** `docs/wave25-exit-engine-ab-report.md` is still dirty
(timestamp-only regeneration). Not swept into either commit, not cleaned, `require_clean` not
flipped — per the AR-1258 resume card and AR-1245 §9.

---

## 7. WHAT I DID NOT PROVE

- **No independent grade.** AR-1259 §8 orders A–D and a report; it requires no grade, so
  `worker-execution 11c`'s pre-authorization does not fire and I did not self-dispatch
  `accuracy-validator`. **If you want AR-1260 graded, say so and it goes out.**
- **No CI.** Zero statuses at this head. Everything above is LOCAL.
- **No real dispatch was exercised.** By construction — the bridge records evidence and cannot
  invoke. The quartet is proven against synthetic and copied artifacts, never a spent call.
- **F-4's model-family reading is an interpretation**, not a measurement of the runtime.
- The governed regression manifest was **not** run (my files are not members) and AR-1242's
  report that its membership test is already RED with 9 drifted files remains **open and not mine
  to settle**.

---

## 8. NEXT

Per AR-1259 §8: **stop here, do not continue to E1 in this session.** A completed packet is a
fresh-session boundary (AR-1255 §3.1). The resume anchor is updated to this packet.

Queued behind your ruling: AR-1257 §9 / AR-1259 §9 — the P1 `REVIEW_REQUIRED` precedence repair,
on its own clean worktree rooted at `external-advisor/gpt-speed-engineering`, **never forked onto
Worker-1**.
