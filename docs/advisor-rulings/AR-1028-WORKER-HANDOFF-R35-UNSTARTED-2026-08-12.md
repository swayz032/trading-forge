# AR-1028 — WORKER — HANDOFF AT THE CLEANEST BOUNDARY THIS CAMPAIGN HAS HAD: `R3-4` CLOSED AND EXTERNALLY ACCEPTED · `R3-5` AUTHORIZED, `0 / 4` STARTED

```
RULING : AR-1027 GPT ruling, gpt-rulings 89e4fc2c  (R3-4 ACCEPTED; R3-5 A-D authorized straight-through)
PIN    : fdaa000b  origin/h1-wave4-sealed12-driver  (pushed, GPT-verified commit-by-commit)
MY BATCH: 6 / 6 COMPLETE -- row-20 conversion, RED/GREEN, receipt truth, ONE seal,
          ONE canonical closeout, R3-4 closed. Externally verified at AR-1027 §2.
R3-5    : 0 / 4 -- items A, B, C, D ALL UNSTARTED. NOT blocked. NOTHING half-done.
STOPS   : none active.   IN FLIGHT: nothing.   GRADE OWED: none (AR-1027 §5).
```

## 1. WHY I AM HANDING OFF, AND IT IS NOT THE FORBIDDEN REASON

`worker-onboarding §5` is explicit that **unstarted is a reason to stay, not to leave**, and that a
handoff declaration is self-assessment rather than a transfer of authorization. **So I am naming the
distinction precisely:**

**The batch I was given is `6 / 6` COMPLETE and externally accepted.** `R3-5` is not the remainder of
my batch — it is a **new four-item lane opened by a ruling that landed after my work closed.**
**I am not leaving lanes unfinished; I am declining to open a new one at depth.**

**The measured reason:** `R3-5` items `A`–`D` each require an investigation plus a `RED → repair →
GREEN → negative control` cycle, and item `C` (feeder independence) is an architecture trace whose
answer is not yet known. **Beginning a four-item lane this deep in context is how one item lands
half-repaired and the report reads as complete** — this campaign's most-convicted shape, and
`§4.5`'s explicit warning that exhaustion is the most expensive and most dangerous moment to swap.
**A clean boundary is the cheap moment, and this is one: task closed, report landed, ruling accepted.**

★ **AND THE INCOMING SEAT NEEDS NOTHING FROM ME TO START.** `AR-1027 §4` is a cold-start-complete
`R3-5` contract — four items, each with its *smallest acceptable proof* enumerated, plus `§5`
execution policy, `§6`'s six STOPs and `§7`'s exit condition. **Read that ruling and begin; do not
reconstruct scope from this AR.**

## 2. WHAT THE NEXT SEAT MUST NOT RE-DERIVE

- **`R3-4` IS CLOSED. `R3 = 4 / 5`.** Do not reopen it, re-adjudicate the 34 nodes, re-derive census32,
  mint a second seal, or re-run cluster controls (`AR-1027 §1`, `§5`).
- 🛑 **`2419` (sealed population) vs `2420` (canonical nodes) IS NOT A DEFECT — `AR-1027 §3` settles it:**
  the RWS repair added exactly one boundary-control node after the historical root was sealed; it is
  named in the post-repair map and PASSES. **Do not regenerate the collection root, mint a second
  successor seal, or build a population reconciler.** ★ I noticed this delta and did **not** raise it
  as a count defect; GPT pre-empted it anyway. **It will look like a discrepancy to a fresh reader —
  it is not.**
- **Two skip sites survive on purpose and are OUT OF SCOPE** (`STOP [11]`): the broadcast site at
  `test_wave_b_intrabar_stops.py:82` covering census rows `30`–`32`. **Named, not touched.**
- **The `run_walk_forward` docstring** still says `plain` while execution resolves `cpcv` —
  `AR-1024 §1`: real, but **not** a blocker and **not** a cleanup lane. **Recorded so it is not
  rediscovered as new.**

## 3. THE INSTRUMENT TRAPS THAT COST ME REAL ATTEMPTS — BANKED SO THEY COST NOBODY AGAIN

Full recipe in memory `[accept5-seal-closeout-recipe]`. The four that bit:
1. 🛑 **`generate_disposition_seal.py --scratch` takes a FILE, not a directory.** A directory dies
   `PermissionError` **while the wrapper reports `exit 0` and writes no artifact.** ⇒ **open the
   produced JSON; never accept an exit code.**
2. **Short `--out-dir`** or `git worktree add` dies `Filename too long`.
3. **`PYTHONIOENCODING=utf-8`**, or reading these JSONs raises `UnicodeEncodeError: cp1252` on `→`.
4. **Write comparison scripts to a FILE, not a bash heredoc** — even `<<'PY'` ate backslashes here.
   Build one as `chr(92)`.
⚠️ **`manifest_sha256` NAMES TWO DIFFERENT FILES** (runner = its own generated `manifest.json`; seal =
`canonical_regression_population.txt`). **A mismatch there is NOT a movement.**

## 4. SEAT / EAR / IN-FLIGHT

- **My ear dies with this session — the next seat arms its own** (`worker-onboarding §2a`, and note the
  script's `cd` argument is load-bearing). **Armed at `f55a4a93`; it fired on every real move,
  including `AR-1026` and `AR-1027` landing.** ✅ **Red-proofed in all three legs by live observation
  this seat:** resolved a real SHA at arming (not `<absent>`), **silent** across a long no-move
  interval, **emitted** on every move.
- ⚠️ **THREE ORPHAN EARS WILL EXIST AFTER I EXIT** — `[MEASURED]` `bash.exe` `13092` and `29416` whose
  parent `claude.exe` are already gone, **plus mine once this seat ends.** They poll `git ls-remote`
  every `2s` and deliver to nobody. **I did not arm the first two so I did not kill them.**
  ⚠️ **CORRECTION TO `AR-1025 §5`, which said its ear "dies with this session": the PROCESS OUTLIVED
  ITS SEAT — only DELIVERY died.** ★★★ **`AN ORPHANED EAR IS A LIVE PROCESS WITH A DEAD AUDIENCE; ONLY
  THE PARENT WALK TELLS THEM APART.`**
- **No sub-agent dispatched; nothing owed. The gap is empty, verified rather than assumed.**
- **Working tree:** my commits are `c9df5099 · f5b9a89c · 8f04a42f · 08aa7a9f · fdaa000b`, all pushed
  and verified **from the remote**. `docs/wave25-exit-engine-ab-report.md` was already modified and the
  untracked `docs/` files already present **when I seated**; I touched neither.
- 🛑 **ONE PIECE OF DEBT I DID NOT PAY:** the memory index `MEMORY.md` is `19.7 KB` against a `17.1 KB`
  target. **I declined to compact it at depth** — that file's own header records that the real debt is
  `211` memories with no pointer, and a rushed pass drops pointers **undetectably**. **It is a
  deliberate, disclosed non-payment, not an oversight.**

## 5. THE NEXT TASK, AS THE RULING DEFINES IT

**`R3-5`, items `A`→`D` in the shortest dependency-safe order, no GPT round-trip between ordinary
items** (`AR-1027 §4`–`§5`). On completion: **`R3-5 CLOSED` → `R3 = 5/5` → Phase 5 referee engineering
CLOSED — and `AR-1027 §7` forbids inventing an `R3-6`.**
**Then immediately `MP1-CANDIDATE-INGRESS-1` → persisted candidate/config authority → DB →
`/api/backtests` → Python backtester** — the money path.

★★★★★ **`THE REFEREE LANE IS ONE ITEM SET FROM OVER. THE ONLY WAY IT GETS LONGER IS IF A SEAT TREATS
A SETTLED QUESTION AS AN OPEN ONE — SO READ `AR-1027 §3` AND `§5` BEFORE YOU "NOTICE" ANYTHING.`**

**A fresh worker session is needed.**
