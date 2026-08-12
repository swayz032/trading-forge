# AR-1025 — WORKER — HANDOFF AT A CLEAN BOUNDARY · R3-4 IS THREE STEPS FROM CLOSED · THE 32-ROW INVENTORY IS MEASURED HERE SO NOBODY RE-DERIVES IT

```
RULING : AR-1024 GPT ruling, gpt-rulings 8cbe03ff  (fast-path authorized, no round-trip)
PIN    : 858506cf  origin/h1-wave4-sealed12-driver  (pushed, GPT-verified)
DONE   : §6 step 1 (durable map receipt) · step 2 (34/34 dispositioned, 0 UNEXPLAINED)
OPEN   : step 3 census32 backfill · step 4 ONE successor seal · step 5 ONE canonical
         closeout · step 6 close R3-4.   NO STOP CONDITION IS ACTIVE.
```

## 1. WHY I AM HANDING OFF, STATED HONESTLY

**Not because a lane is unstarted** — `worker-onboarding §5` is explicit that unstarted is a reason
to stay. **Because of a measured property of MY OWN error rate against THIS specific task.**

I made **three** errors this session:
1. dropped `e2e::test_walk_forward_mode` from a denominator (**a row→denominator join**);
2. matched `three_fixes::max_dd` **by function name instead of by canonical node ID**, producing a
   false movement alarm (**a name→node-ID join**);
3. a reconstruction harness exited 1 (reported, not laundered into a null).

**Two of the three are join errors.** The remaining census backfill is the most join-dense task in
the whole R3-4 lane: it joins **row number → table line number → cluster letter → `R-799 §5` form
number → converting commit sha → proof-receipt section**, thirty-two times, across a **702-line**
document. `[MEASURED]` I already hit a `cp1252` stdout fault and a `--tb` parse fault reading it.

⇒ **Continuing into the most join-dense remaining task at my deepest context, with a measured
same-session join-error rate of 2, is how a census comes out looking complete and being wrong.** I
warned against exactly that shape in `AR-1024 §4`; doing it anyway would make the warning
worthless. **This is a task-fit judgment, not exhaustion theatre.**

## 2. THE 32-ROW INVENTORY — `[MEASURED HERE]`, SO THE NEXT SEAT DOES NOT RE-DERIVE IT

Parsed from `docs/designs/ACCEPT5-SKIP-CENSUS-1-2026-08-11.md`; the parse **asserted exactly 32
rows** before reporting (a short parse would have raised, not silently truncated).

| bucket | rows | count | what the next seat must do |
|---|---|---:|---|
| **CLOSED, citation already in the row** | 19, 20, 21, 22, 23, 24 | 6 | cite only — do NOT rerun |
| **VIOLATION** | 2–18, 26–29 | 21 | source disposition from durable cluster evidence |
| **OTHER** | 1, 25, 30, 31, 32 | 5 | see §3 — three are already `OUT OF SCOPE` |

**Sub-structure inside the 21 VIOLATION rows, by the status column:**
```
SITE REMOVED (converted) : 2, 3, 4, 5, 12, 14, 16      -> converting commit is the receipt
FIRED                    : 13, 15, 17                  -> Cluster A, LANDED, census §10 + §10.1
DID NOT FIRE             : 6, 7, 8, 9, 10, 11, 18, 26, 27, 28, 29
```

**The durable evidence each landed cluster already carries (cite, do not rebuild):**
```
Cluster A  rows 13/15/17   census §10   + §10.1 four controls executed, §10.2 population effect
Cluster D  rows 19/21/24   census §11   + §11.1 three arms per row, disposable worktree @ 48a7d0ac
Cluster F  rows 22/23      census §12   + §12.1 planted triggers pre/post, worktree @ 2d8b1da1
row 20     standalone      converted to form [1] at e55a9ef1, sha 920557eb..., 978 bytes
```

**The 5 OTHER rows:**
```
row  1  "NOT machine-local -- config-shape skip"        (never a violation)
row 25  R-803: TRACKED dead-skip debt, NOT a fifth input
rows 30, 31, 32  "OUT OF SCOPE -- STOP [11]"            <- already scoped out; do NOT re-open
```

⚠️ **The 11 `DID NOT FIRE` VIOLATION rows are the real work.** Census **`§7`** already accepted the
remaining set **GROUPED BY ROOT CAUSE per `R-814`, explicitly "not site-by-site"** — that grouping
is the durable evidence `AR-1024` ruling §3 rule 3 tells you to resolve them from. **Read census
`§7` before touching a single row.**

## 3. THE RULING'S BOUNDS, RESTATED SO THEY ARE NOT RE-READ WRONG

From the `AR-1024` GPT ruling — **this is a RECEIPT-BACKFILL lane, not a re-certification lane**:
- **Do NOT rerun a control merely to fill a field** when a durable receipt already proves the row.
- Only if a row has **no** durable evidence may you run **the smallest row-specific control**.
- **Do NOT shrink the historical 32-row denominator** because a site was later removed — a
  converted row stays in the census with its final disposition and proof receipt.
- No cluster-wide rerun · no new hermeticity campaign · no new checker · no broad skip cleanup.
- The six banked external-input files stay banked.
- **Do NOT reopen the 34-node disposition** and do NOT re-adjudicate the 30 previously accepted.

**Then:** ONE successor disposition seal (collection root stays immutable), bound to the map
receipt `858506cf`, the 34-node set, the 34-node disposition table, the completed 32-row census;
then **ONE** canonical isolated ACCEPT-5 closeout; then **close R3-4** → `R3 = 4/5`.

**STOP only if:** a row cannot be dispositioned from durable evidence without guessing · a
smallest-control reveals a new production defect · census work would change governed
production/compiler/trading behaviour · the denominator stops being the authorized 32.

## 4. THE INSTRUMENT, EXACTLY

```bash
# canonical closeout arm -- NO reverse, NO limit, NO --no-layer2:
python scripts/accept5_isolated_runner.py --out-dir <SHORT PATH>
```
🛑 **USE A SHORT `--out-dir`** (I used `C:\Users\tonio\a5post`). `[MEASURED]` a scratchpad-depth
path made `git worktree add` die with **`Filename too long`** on
`docs/replay-results/.../result-cache/...json`. The same hazard applies to any deep out-dir.

**Expected baseline for the closeout, from my run at pin `00332950`:**
`108 children · 2420 nodes · 2386 passed · 32 failed · 2 xfailed · 34 non-pass · ~6.5 min serial`.
Anything else is a movement and is a STOP.

**Publishing to the GPT branch — use plumbing, NOT a worktree** (the path-length trap above):
```bash
BLOB=$(git hash-object -w <file>)
export GIT_INDEX_FILE=/c/Users/tonio/AppData/Local/Temp/idx.$$
git read-tree origin/external-advisor/gpt-rulings
git update-index --add --cacheinfo 100644,$BLOB,docs/advisor-rulings/<name>.md
TREE=$(git write-tree); unset GIT_INDEX_FILE
NEW=$(git commit-tree $TREE -p origin/external-advisor/gpt-rulings -F -)
git push origin $NEW:external-advisor/gpt-rulings
git ls-remote origin refs/heads/external-advisor/gpt-rulings   # VERIFY FROM THE REMOTE
```

⚠️ **The `pre-push` hook will block on a stale `SYSTEM-INVENTORY.md`.** Remedy is
`git commit -o docs/designs/SYSTEM-INVENTORY.md`, **never `--no-verify`**. ⚠️ **`ruff-lint` blocks
commits on PRE-EXISTING debt in any file you touch** — prove it pre-existing against
`git show HEAD:<file>`, then `--select=I001,F401 --fix`, safe fixes only, and **disclose it**.

## 5. NO SUB-AGENT IS OWED; NO EAR IS ORPHANED BY ME

- **No `accuracy-validator` dispatched** — `AR-1023` §5 and `AR-1024` §8 both say none is required.
  **Nothing is in flight; the gap is empty, verified, not assumed.**
- **My ear** is a `Monitor` on `origin/external-advisor/gpt-rulings` (2s poll), armed at
  `37759ed4`, **red-proofed four ways before I trusted it** (refuses non-repo cwd · refuses absent
  ref · silent on no-move · emits on move) and it **fired correctly on the real branch** four
  times. It dies with this session; **the next seat arms its own.**
- ⚠️ **TWO ORPHAN EARS EXIST AND ARE NOT MINE.** `[MEASURED]` `bash.exe` PIDs `13092` and `27280`,
  born `22:39:08` / `22:40:09`, whose parent `claude.exe` PIDs (`27600`, `25028`) are **GONE**.
  They poll `git ls-remote` every 2s and **can deliver to nobody**. I did not arm them so I did not
  kill them (`[one-monitor]` / never-kill-what-you-did-not-arm). **Flagging, not acting.**

## 6. WHAT I DID NOT MEASURE

- **The 32 census rows are inventoried, NOT dispositioned.** I read the table and the section map;
  I did **not** open census `§7`'s root-cause grouping, and **no row has been assigned a
  `FINAL_DISPOSITION` by me.**
- I did **not** re-verify the 30 previously-accepted node dispositions (ruling §2 forbids it).
- The one-cent causation residual in `AR-1024 §2` remains `HYPOTHESIS / UNPROVEN`.
- The `run_walk_forward` **docstring still says `plain` is the default** while the executable
  resolution says `cpcv`. GPT ruled this real but **NOT an R3-4 blocker and NOT a cleanup lane.**
  Recorded so it is not rediscovered as new.

## 7. STATE OF THE BRANCHES

```
origin/h1-wave4-sealed12-driver   858506cf   repair 2d42c9e8 · inventory 00332950 · map receipt 858506cf
origin/external-advisor/gpt-rulings          AR-1022 · AR-1023 · AR-1024 published + GPT rulings on each
working tree                      CLEAN for src/ ; untracked docs pre-date this session
```

★★★★★ **`THE REPAIR IS LANDED, PUSHED AND EXTERNALLY VERIFIED; THE DENOMINATOR IS CLOSED AT 34 WITH
ZERO UNEXPLAINED; WHAT REMAINS IS RECEIPT ASSEMBLY, ONE SEAL, ONE RUN. I AM STOPPING BECAUSE THE
NEXT TASK IS MADE OF THE EXACT JOIN I DEMONSTRABLY GOT WRONG TWICE TODAY — NOT BECAUSE IT IS
HARD.`**
