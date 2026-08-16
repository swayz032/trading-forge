# AR-1238 (WORKER) — AR-1236 §11 PROTECTION TOOLBOX ACTIVATED · 2026-08-16

```text
RULING : AR-1236 §11 / AR-1230 — activate the AR-1194..AR-1198 toolbox, DO NOT rebuild it
PIN    : branch claude/worker1-h1-20260815 · head eaf205252230732274c20b8174ab942da856b45b
STOP   : none fired
NEXT   : your call on the lane-boundary rule gap in §3 — it is a lane-ownership decision, not mine
```

This is the parallel support lane. It did not block and did not delay the money path: AR-1237
(§10 route) was published before this started.

---

## 1. THE TOOLBOX WAS REAL AND IT WAS UNREACHABLE FROM THIS SEAT

`[MEASURED HERE]`

```text
37 tooling files, ref origin/external-advisor/gpt-speed-engineering @ dd1bc2306dee
present in this worktree:  NO
present on the GPT rulings branch: NO
```

The toolbox exists in the repository and lives on a ref **this worktree never checks out**. From
the Worker-1 seat it was **BUILT-UNREACHABLE** — the exact species `system_inventory.py` exists to
surface. ★ **"Already built" and "actually usable from the seat that needs it" are different
claims, and only one of them was true.**

### Activation by pinned reference, NOT by copying

🛑 **Copying the files into this branch would be a rebuild with extra steps.** Two copies of a
guard drift, and **the copy that drifts is the one that stops biting while still reporting PASS.**

`scripts/claude_toolbox.mjs` materializes the tooling **from the pinned ref** into a throwaway
cache and runs it there, recording the ref, the resolved commit, and a **sha256 per file**. If the
toolbox moves, the receipt changes and the drift is visible instead of silent. One source of
truth; this file is a doorway, not a fork. It refuses outright if the ref is missing rather than
substituting anything of its own.

---

## 2. WHAT DISCRIMINATES — RED AND GREEN, BOTH HALVES

### Resume-anchor guard: bites both ways

```text
GREEN  correct head, clean tree      -> anchor.ok True,  clean True,  errors []
RED    real but DIFFERENT head       -> anchor.ok False,
       errors ['resume anchor moved: expected 8ab08cf9…, got c91e1c0e…']
```

⚠️ **My first RED attempt was a bad instrument, not a result:** an all-zeros SHA made the guard
throw on `git rev-parse` rather than return a refusal. A crash is not a verdict. Re-run with a
real-but-wrong commit, which is what produced the refusal above.

### Its first run convicted this seat, correctly

Preflight returned `STOP` with `worktree is dirty` — the dirty file was the activator itself,
uncommitted. Committing it cleared exactly that leg and nothing else. **A guard whose first act is
to catch its own author is behaving.**

### Test-theater detector: proven able to fire before its clean result was believed

```text
RED    planted theatrical test (it.skip + tautological assert)
       -> verdict BLOCK, hard_failures ['critical test contains 1 skip/todo declaration(s)']
GREEN  test_opus_phase1_route.py, test_batch_locator.py
       -> verdict NO_STATIC_RISK_SIGNALS, skip_todo 0, mock_calls 0
```

The tool's own limitation is carried into the receipt rather than dropped: *"Static screening
cannot prove a test reaches production behavior. NO_STATIC_RISK_SIGNALS still requires RED/GREEN,
controls, and production-route review."*

---

## 3. 🛑 A FINDING AGAINST THE TOOLBOX — A GUARD THAT CAN NEVER GO GREEN

`[MEASURED HERE]` — lane-boundary guard over the seven paths this lane actually touches:

```text
BLOCK             src/server/services/paper-execution-service.ts     <- Worker-2 territory
REVIEW_REQUIRED   src/engine/extraction/opus_phase1_route.py
REVIEW_REQUIRED   src/engine/tests/test_opus_phase1_route.py
REVIEW_REQUIRED   scripts/svkm_opus_batch_locator.py
REVIEW_REQUIRED   docs/replay-results/svkm-extraction-certified/o1-batch/batch_task.txt
REVIEW_REQUIRED   src/engine/backtester.py
REVIEW_REQUIRED   docs/designs/SYSTEM-INVENTORY.md
summary {"allow":0,"block":1,"handoff_required":0,"review_required":6}
```

**The BLOCK is right and it is the protection that matters** — the guard refuses Worker-2's file.

But **`allow` is 0 of 7.** Because `safe_to_edit_without_handoff` requires an ALLOW,
`runClaudePreflight` returns **`STOP` on every run, forever** — clean tree, correct anchor,
in-lane paths, still STOP.

> ★ **A RED WITH NO PATH TO GREEN IS THE SAME DEFECT AS A GREEN WITH NO PATH TO RED. Both stop
> carrying information, and this one trains the seat to route around the guard.**

**NOT FIXED HERE.** The bounded path rules encode *who owns what*, which is a lane-ownership
decision and not a worker's to widen — and your §11 order is to activate this toolbox, not rebuild
it. **Your call.** The narrow question: should `src/engine/extraction/**`, `src/engine/tests/**`
and `scripts/svkm_*` be ALLOW for worker-1?

---

## 4. AND A FALSE GREEN IN MY OWN RUNNER, CAUGHT BY THE POSITIVE CONTROL

The detector returns **`hard_failures`**. My runner filtered on **`hardFailures`** — undefined on
every row — so it printed **"0 hard failures" while the tool was returning verdict BLOCK.**

**A false green inside a runner whose entire job is catching false greens.** It survived my first
read of its own output, because that output looked exactly like a clean pass. It was caught only
by planting a deliberately theatrical test as a positive control.

★ **`A CLEAN RESULT FROM A DETECTOR YOU HAVE NOT PROVEN CAN FIRE IS NOT EVIDENCE — AND WHEN THE
DETECTOR IS FINE, THE FIELD NAME IS THE NEXT PLACE THE LIE HIDES.`** Same shape as the
object-vs-evidence near-miss already banked in memory: the code was right, the tool was right, and
**the field I read was the claim.**

Fixed, and the runner now reads `verdict` as well, so a future rename breaks loudly instead of
passing silently.

---

## 5. NOT DONE, AND NOT CLAIMED

- **`claude-hook-bridge` / `claude-hook-runner` are NOT wired into native Claude hooks.** This
  worktree has no `.claude/settings.json` at all. Wiring hooks changes what runs on every tool
  call in this seat, so it is a live-behaviour change I am not making unilaterally at the end of a
  lane. The tools are now reachable and runnable on demand; automatic invocation is not claimed.
- `commit-evidence-verifier`, `evidence-receipt`, `edit-scope-guard`, `ci-root-cause-extractor`
  and the remaining 30 files are **materialized and reachable but NOT exercised** in this report.
  I ran three. **I am not reporting the toolbox as validated — I am reporting three tools as
  proven and the rest as available.**
- **The full `src/engine/tests` regression is STILL RUNNING** (process confirmed alive by
  `Win32_Process`, not by a task list). **I quote no number from it.** The earlier attempt was
  killed at 25 minutes by a `timeout` wrapper that then reported exit 0 — a false green I caught
  by reading the output instead of the exit code. Your §8 requires the completed delta before any
  integration claim, and it is still owed.
- §10.7's causal/risk gap and §10.8's antecedent ownership (AR-1237) remain open and are yours.
- The AR-1230 terminology alias layer still has no named owner. **Sixth report raising it.**

**STOPPING for your ruling on §3.**
