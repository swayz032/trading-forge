# AR-1293 — RETIRE THE LEGACY PRIVILEGED COMMIT-ONLY BASH ROUTE: F22 CLOSED

**The one execution-boundary defect AR-1292A found (F22) is closed: the `cp-commit.mjs` Bash shape
is removed from `BASH_ALLOWED_SHAPES`, so `cp-finalize.mjs` is now the sole legal commit/push/
receipt route for the privileged seat. The file itself is untouched — no deletion, still in
`BUNDLE_FILES`. 86/86 tests pass (83 pre-existing + 3 new). Zero bootstrap executions, zero
privileged launches, zero Agent/subagent calls, zero frozen G2 spend. Frozen eight: 8 READY /
0 SPENT.**

**Model:** Sonnet 5, HIGH effort, per AR-1292A's routing law ("a narrow security-boundary cleanup,
not semantic strategy work").

---

## 1. WHAT WAS BROKEN, AND WHAT CHANGED

### F22 — the retired commit-only helper was still a legal privileged Bash shape

`BASH_ALLOWED_SHAPES` carried both `cp-commit.mjs` (commits locally, deletes the message file, does
**not** push, does **not** write the trusted completion receipt) and `cp-finalize.mjs` (re-checks
staged paths, commits, pushes the measured branch, writes the completion receipt). The test suite's
own claim — *"finalization is the only publish path"* — was never actually discriminating, because
it proved raw `git commit`/`git push` denied but never proved the *other allowlisted* commit route
denied, since that route was still legal. A privileged seat legally invoking `cp-commit.mjs` could
advance HEAD, delete the transient message file, push nothing, and leave no completion receipt —
exactly the local-only-stranding state the terminal-finalizer design (and AR-1292's F21 fix, on the
supervisor's side of this same seam) exists to prevent.

**Fix:** the `cp-commit` entry is removed from `BASH_ALLOWED_SHAPES` in `control-plane-guard.mjs`.
`cp-commit.mjs` itself is **not deleted** — per AR-1292A's own instruction, and because AR-1293's
scope names no deterministic test requiring its removal. It stays in the repository and in
`BUNDLE_FILES` as conservative/historical bundled code; only its privileged execution route is gone.

**Files touched**, exactly the authorized surface (AR-1292A §"Scope"), nothing else:

```
MOD    scripts/control-plane-bootstrap/control-plane-guard.mjs
MOD    scripts/control_plane_bootstrap.test.mjs
MOD    docs/replay-results/control-plane-bootstrap/CONTRACT.md
```

`plan.mjs`, `bootstrap.mjs`, `authorization.mjs`, `claim-store.mjs`, `control-plane-seat-hook.mjs`,
`cp-finalize.mjs`, `cp-commit.mjs` itself, `bundle.mjs`, and the frozen G2 tree — all untouched,
matching "do not need modification for the expected repair." `[MEASURED HERE]` — reviewed the full
diff of every touched file before staging.

---

## 2. H1–H6 — EACH PROOF, WITH ITS COMMAND

Command for the full suite: `node --test scripts/control_plane_bootstrap.test.mjs`

```
tests 86
pass  86
fail  0
```

No live probe skipped (`LIVE C9`/`C9b` both ran and passed, as in every prior packet).

| Proof | What it shows | Test |
|---|---|---|
| H1 | the retired `cp-commit.mjs` shape DENYs specifically — because it is no longer allowlisted, not because Bash broke wholesale | `AR1293-H1` |
| H2 | `cp-finalize.mjs` ALLOWs (no args); `--anything` DENYs; raw `git commit`/`git push` DENY; ordinary `git add` still ALLOWs | `AR1293-H2` |
| H3 | the generated Phase-1 prompt names `cp-finalize.mjs` and never names `cp-commit.mjs`, both directions asserted | `AR1293-H3` |
| H4 | all 83 pre-existing AR-1277..AR-1292 controls remain green under this change | full-suite count above |
| H5 | zero executions/launches/Agent calls/frozen calls this packet; frozen 8/0 unchanged | this report §3 |
| H6 | exact final execution pins, measured read-only through the real production plan path | this report §4 |

---

## 3. TERMINAL FROZEN PROOF (H5, unchanged by this packet)

This packet made no filesystem or git change to the real frozen queue/receipt/manifest tree.

```
real bootstrap executions = 0
privileged launches       = 0
Agent/subagent calls      = 0
frozen calls               = 0
frozen ready               = 8
frozen spent                = 0
attempts                    = {}
frozen receipts             = README ONLY
```

---

## 4. H6 — FINAL EXECUTION PINS, MEASURED READ-ONLY

Command (the real production plan path, default `--plan` mode, no arguments):

```
$ node scripts/control-plane-bootstrap/bootstrap.mjs
```

`[MEASURED HERE]` — run after the AR-1293 code/test/CONTRACT commit (`b4aadd3a`), before this
report's own commit:

```
worker_head                 = b4aadd3a4f0a95cafbbaed0baa19485f7ec78f51
bootstrap_bundle_sha256     = 582b8f0614286ba2bf6ca4c91acece8748844da0133f0e9be403d6ab74ea80d7
frozen_queue_sha256         = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
frozen ready/spent          = 8 / 0
frozen receipts             = README_ONLY
legacy 0001 claim           = PRESENT / SPENT  (claimed_authorization_ids = ["cpb-2026-08-17-0001"])
fresh 0002 claim            = ABSENT — not in claimed_authorization_ids, which is the union of the
                               shared Git-common-dir store and the legacy committed store
```

The tool itself correctly refused to plan against anything executable
(`authorized: false, refusal.code: "no_marker"`) — the newest GPT ruling at measurement time
(`AR-1292A`) carries no `CONTROL_PLANE_BOOTSTRAP_AUTHORIZATION_V1` block, exactly as expected; no
marker is authorized or issued by this packet either.

`frozen_queue_sha256` matches the value AR-1292A §H6 named verbatim.

**Disclosed per AR-1292A's own instruction:** the AR-1293 code commit above is not necessarily the
*final* Worker-1 HEAD by the time GPT reads this — the shared-tree pre-push `inventory-freshness`
hook may add one more auto-regenerated `SYSTEM-INVENTORY.md` commit before/at push, and this report
itself lands as a further commit after the pins above were measured. Per AR-1292A §"After AR-1293
passes": *"If an automatic post-report inventory commit advances Worker-1 HEAD afterward, GPT will
inspect that diff and bind the true latest head."* I am not hand-advancing or guessing a later pin
here — the true final tip is whatever `git log -1` on `origin/claude/worker1-h1-20260815` shows
after this push, which GPT reads directly.

---

## 5. WHAT THIS PACKET DID NOT DO (forbidden list, AR-1292A §"Explicitly forbidden")

`bootstrap --execute` — never invoked (the one real invocation above was the default read-only
`--plan` mode, which itself refused to authorize anything). New executable marker — none issued.
New bootstrap claim — none. Privileged seat launch — never. `Agent`/`Task` calls — zero. Frozen G2
call or retry — none. Tier-3 semantic work — none. Compiler/backtest/paper/broker/live-money work —
none. Permanent model-router implementation — not started. `cpb-2026-08-17-0001`'s forensic state —
untouched (confirmed still present/spent in the H6 measurement above).

## END STATE

```
F22 retired cp-commit Bash route   = CLOSED (shape removed, file untouched)
tests                              = 86/86 (83 pre-existing + 3 new)
frozen G2                          = 8 READY / 0 SPENT, unchanged
worker_head (pre-report)           = b4aadd3a4f0a95cafbbaed0baa19485f7ec78f51
bootstrap_bundle_sha256            = 582b8f0614286ba2bf6ca4c91acece8748844da0133f0e9be403d6ab74ea80d7
next executable marker             = NOT MINTED — GPT's to issue after grading this packet and the
                                      true final Worker-1 tip
```
