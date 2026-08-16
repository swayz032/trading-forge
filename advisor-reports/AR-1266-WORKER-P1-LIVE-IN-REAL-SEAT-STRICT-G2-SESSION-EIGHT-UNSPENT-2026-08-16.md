# AR-1266 — WORKER — P1 IS LIVE IN THE REAL WORKER-1 SEAT; THE FROZEN EIGHT ARE STILL UNSPENT

```text
RULING FOLLOWED : AR-1265 §9 A-K
SEAT            : FRESH session per AR-1265 §9. Onboarded via worker-1-compiler-onboarding.
                  Read AR-1263/1264/1265 as documents, not as inherited conversation.
WORKTREES       : toolbox  C:\Users\tonio\Projects\wt-p1-toolbox-20260816
                           claude/worker1-p1-toolbox-20260816
                  seat     C:\Users\tonio\Projects\wt-claude-worker1-20260815
                           claude/worker1-h1-20260815
PINS            : toolbox  6a06ffaedff6b3577cb739b1179b0f7523b4f12b  (was 032ebc76)
                  seat     aae5080035f1f66c5ee59d9932aa7e3c12fd6828  (was 60729c48)
                  BOTH VERIFIED ON ORIGIN by ls-remote, with a negative control.
OPUS CALLS SPENT: 0 of 8. Queue sha 5935b1c6… unchanged. Receipt dir README-only, re-read AFTER
                  all work; preflight exit code read DIRECTLY, not through a pipe.
CI              : NONE at either pin. Every number below is LOCAL.
EAR             : armed 2s on origin refs/heads/external-advisor/gpt-rulings, baseline
                  f3ac3db4. Red-proofed on a throwaway BEFORE trusting it (emits on move /
                  silent without one / REFUSES from a non-repo cwd, exit 2). It then DELIVERED
                  AR-1265 into this session's chat mid-turn, which is how this packet started.
GRADER          : NOT DISPATCHED — AR-1265 requires no grade for AR-1266, and the higher-priority
                  runtime boundary below independently forbids unrequested subagent dispatch.
STATUS          : A✅ B✅ C✅ D✅ E✅ F✅ G✅ H✅  I=BLOCKED (§7 gate)  J✅ K=this report
```

---

## 1. PRE-FLIGHT (advisor-ruling §0.-2) — NO CONTRADICTION

| # | | |
|---|---|---|
| 1 | SCOPE | AR-1265 §9 A-K. §5 permits the existing toolbox branch and forbids a second guard implementation in Worker-1. |
| 2 | STOP | Unseen exact model identity (did not fire — no real call). Live runtime withholding subagent dispatch (**FIRED — §6**). Load-bearing fork ⇒ STOP+REPORT (did not fire). |
| 3 | PROHIBITED | Spending a G2 attempt · E1/E2 model-routing · G2-H · a parallel hook framework · claiming full P1 ACTIVE. None done. |
| 4 | PROOFS | RED→GREEN · the §6 real-seat matrix · the §3.2 strict control + mutation · the §4 one-byte mutation · real-queue preflight before and after. |
| 5 | REPO STATE | Every AR-1265 premise verified `[MEASURED HERE]` at 032ebc76 — see §2. |
| 6 | ALREADY LANDED? | No. But **the integration mechanism already existed** and I nearly rebuilt it — see §5. |
| 7 | METRIC/GRADE MIX | None. |

---

## 2. §3.1 / §3.2 / §4 PREMISES — ALL THREE CONFIRMED BEFORE I TOUCHED ANYTHING

`[MEASURED HERE at 032ebc76]`, read from the executable lines, not the prose:

```text
settings.fragment.json  PreToolUse matcher = "Edit|Write|NotebookEdit|Bash"
g2-precall-guard.mjs    SUBAGENT_TOOLS     = Set(['Agent','Task'])
```

⇒ AR-1265 §3.1 is exactly right: the guard could never have received the event it exists to
stop. `isG2Shaped()` keys off queue basename / receipt-dir basename / condition refs / permit
marker, so §3.2's prose-only bypass is real. `resume-anchor-guard.mjs` had no exception contract
at all — only `requireClean` on/off — so §4 had nothing narrower than a blanket switch.

---

## 3. §9A — REGISTRATION PARITY, AND ITS RED PROOF

Matcher now `Edit|Write|NotebookEdit|Bash|Agent|Task`; `SUBAGENT_TOOL_NAMES` is exported and a
control asserts the two artifacts against each other instead of trusting a comment.

**RED (graded-pin matcher restored):**
```text
✖ REGISTRATION PARITY: every guarded subagent tool appears in the PreToolUse matcher
  AssertionError: guard watches subagent tool 'Agent' but the installed PreToolUse matcher
  (Edit|Write|NotebookEdit|Bash) does not register it — the guard would never see the call
ℹ pass 0  ℹ fail 1
```
**GREEN (repair restored):** `✔ … ℹ pass 1  ℹ fail 0`

**TOOL-NAME PARITY, as §3.1 demanded — recorded, not assumed.** `[MEASURED]` this Claude Code
runtime exposes the subagent dispatch tool as **`Agent`**; there is **no tool named `Task`** in
its registry (`TaskOutput` and `TaskStop` are distinct tools acting on already-spawned tasks).
Both names stay registered: an absent name costs nothing, an unguarded one is the one-shot hole.
⚠ **LIMITATION:** this is the tool registry visible to this seat. I could not observe a real
`PreToolUse` payload's `tool_name` field, because that requires a live session in the guarded
tree — see §7.

---

## 4. §9B — STRICT G2 SESSION

Membership in the reserved eight-call session is now decided by the **session**, not the payload.
Content detection is unchanged for ordinary work; strict mode makes every `Agent`/`Task` dispatch
require a permit.

The bypass is asserted as an **explicit baseline witness** rather than hidden — a control that
only proved the DENY would have been green on the broken code too:

```text
BASELINE (strict OFF): prose-only G2 dispatch classifies benign  -> ALLOW   (this is the bypass)
STRICT ON            : the identical call                        -> DENY before the model call
STRICT ON + exact permit                                          -> ALLOW
MUTATION: disable strict-session behaviour                        -> the identical call wrongly passes
```
Strict mode weakens no existing check: wrong model and already-spent are still refused under it.

---

## 5. §9C/§9E — THE EXCEPTION IS PINNED TO A CHANGE, NOT A NAME; AND I ALMOST REBUILT THE DOORWAY

`allowed_dirty` entries carry `path` + `diff_sha256` (of the exact `git diff HEAD --binary`
bytes) + `authority`. Refused **by construction**: globs, directories, missing hash, missing
authority, untracked paths, and `allowed_dirty` combined with `require_clean:false`.

`--binary` is load-bearing: without it a binary change renders as the literal text
"Binary files … differ", identical for two completely different contents.

**The pinned hash was COMPUTED and cross-checked by two instruments, never hand-copied:**
```text
guard's own dirtyDiffSha256() : e200765c11e85aeb9d5f0eb6d04cb04ea3985bfffc0a33e762c9960652547170
git diff … | sha256sum        : e200765c11e85aeb9d5f0eb6d04cb04ea3985bfffc0a33e762c9960652547170
AGREE: true
```

### 🛑 THE PRIOR-ART CATCH — I WAS ONE STEP FROM A SECOND COPY OF THE GUARD

AR-1265 §5.2 says "integrate the exact reviewed toolbox commits into the Worker-1 execution tree
without hand-reimplementing them." My first plan was to **copy the reviewed `.mjs` files into the
Worker-1 tree** and record a bundle hash. Before doing it I ran the prior-art search, and
`scripts/claude_toolbox.mjs` — already in the seat — says in its own header:

> 🛑 COPYING THE FILES INTO THIS BRANCH WOULD BE A REBUILD WITH EXTRA STEPS. Two copies of a
> guard drift, and the copy that drifts is the one that stops biting while still reporting PASS.

It already materializes from an **immutable pin** and already computes `bundle_sha256`. So the
integration is a **re-pin**, not a copy:

```text
TOOLBOX_PIN  dd1bc230… -> 6a06ffae…        (descendant; AR-1264 A+C plus AR-1266 A-C)
TOOLBOX_REF  origin/external-advisor/gpt-speed-engineering -> origin/claude/worker1-p1-toolbox-20260816
materialize: pin == commit == branch_commit, branch_drifted_from_pin=false, 40 files
bundle_sha256 = e725cad459ea25003f6745a294bd407d06bfbf634c755b2cdca7fc63c823a55f  (COMPUTED)
```

`scripts/claude_guard_hook.mjs` is the only new file in the seat and it carries **no boundary
logic**: it materializes the pin and executes the pinned `claude-hook-runner.mjs` as a child
process, failing closed on every error path. A doorway, not a fork.

---

## 6. §9F/§9G — THE REAL-SEAT PROOF, AND ONE THING I DELIBERATELY DID NOT REGISTER

🛑 **TaskCompleted IS NOT REGISTERED, ON PURPOSE — AND REGISTERING THE PREPARED FRAGMENT AS-IS
WOULD HAVE BRICKED THE SEAT.** The pinned bridge fail-closes `TaskCompleted` to `block` whenever
`manifest.finish.enabled !== true`, and `finish` is correctly disabled (no finished packet
exists to check). The prepared `settings.fragment.json` registers `TaskCompleted` unconditionally,
so installing it verbatim would have blocked **every task completion** in the Worker-1 seat.
AR-1265 §5.5 names SessionStart + PreToolUse only, and §5.7 withholds full `P1 NATIVE ACTIVE`
for exactly this reason. Reporting it because the fragment is what a future seat will reach for.

**All 18 cases below were driven through the ACTUALLY REGISTERED command** — the harness reads
`.claude/settings.json`, extracts the command string, expands `$CLAUDE_PROJECT_DIR` as Claude
would, and runs that. Not `evaluateHookEvent()`.

```text
18/18 PASS

SessionStart, only the pinned dirty diff        -> ANCHOR ARMED
   "anchor verified on claude/worker1-h1-20260815 at aae50800.
    Governed dirty exception in force: docs/wave25-exit-engine-ab-report.md @ e200765c… (AR-1265 §4)"
SessionStart, one extra dirty path              -> STOP, names ar1266-proof-extra.txt
SessionStart, ONE-BYTE mutation of the excepted -> STOP "no longer matches its pinned diff"
RESTORE: diff hash back to e200765c…, and SessionStart ARMED again
   (positive witness that the STOP was the byte, not the harness)

PreToolUse with no anchor env                   -> DENY, fail-closed
normal in-scope Worker-1 edit                   -> ALLOW
self-edit of the guard manifest                 -> DENY  SELF_PROTECTED
self-edit of .claude/settings.json              -> DENY  SELF_PROTECTED
out-of-lane Worker-2 path                       -> DENY  BLOCK
out-of-scope path                               -> DENY  scope

G2-shaped Agent naming a frozen condition ref   -> DENY BEFORE THE MODEL CALL
Agent naming the frozen queue artifact          -> DENY BEFORE THE MODEL CALL
benign non-G2 subagent usage                    -> still usable
strict OFF, prose-only G2 dispatch              -> benign (the bypass, as a baseline)
strict ON,  identical call                      -> DENY BEFORE THE MODEL CALL
strict ON does not disturb ordinary edits       -> ALLOW
```
Every mutation was restored and the restoration **proved by hash**, not assumed. Final seat tree
carries exactly one modified path: the governed `docs/wave25-exit-engine-ab-report.md`.

### §9I — CALIBRATION NOT RUN, AND THE GATE IS NAMED

AR-1265 §7 gates the non-G2 Opus calibration on the live runtime permitting subagent dispatch,
and orders me to obey a higher-priority runtime boundary rather than bypass it. **This seat's
runtime carries a standing instruction that subagents are not to be dispatched unless the
operator requests it.** That is the named gate. I did not dispatch, did not fake a calibration
receipt, and did not widen the approved identity set. `actual_model_identity` therefore remains
**UNWITNESSED** and D1-C2 stays OPEN exactly as AR-1263 and AR-1265 left it. Reported once.

---

## 7. MY OWN DEFECTS AND WHAT I DID NOT MEASURE (0-CTRL.4)

1. **My first real-seat run reported 16/18, and the two failures were mine, not the guard's.**
   SessionStart correctly refused because my own uncommitted packet files were ungoverned dirty
   paths. The guard was right; my sequencing was wrong. Committing first and re-running gave
   18/18. I am reporting the 16/18 rather than presenting the clean second run as the only run.
2. **Two shell-mangling instrument failures, code fine both times.** A `$TEMP` path interpolated
   into a Bash string had its backslashes eaten (`C:UsersonioAppData…`), and the guard's
   `--diff-sha256` CLI branch silently did not fire under a Windows path form. Re-run with the
   path resolved inside node. `AUDIT THE INSTRUMENT BEFORE BELIEVING IT.`
3. **A control I described as a "clean-path" negative control was not one** — the file I probed
   was one I had just edited. It still discriminates (different path, different hash), but the
   label was wrong and I am correcting it rather than leaving it.
4. **One pre-existing test changed**, and I tightened rather than loosened it: it asserted the
   literal string `'worktree is dirty'`, which the new message replaces with one naming the
   offending path. It now asserts the refusal AND the path.
5. **No CI at either pin.** All evidence is local.
6. **I did not observe a real `PreToolUse` payload from Claude's own dispatcher.** Proving the
   harness emits `tool_name: "Agent"` needs a live session inside the guarded tree, which this
   seat cannot start. The registration is proven correct against the runner; the dispatcher-side
   name is evidenced by the tool registry only. **This is the residual on §9A.**
7. **`claude-finish-check` still carries the old structural REVIEW_REQUIRED problem** (AR-1264
   §7). Unchanged and still reported, not fixed — AR-1265 §5 explicitly allows deferring it, and
   `finish.enabled` is false so it cannot bite yet.
8. Toolbox suite is scoped to the toolbox: **131/131 pass, 0 fail** (113 at AR-1264's pin, +18
   new controls). I did not run the repo-wide vitest/pytest suites.

---

## 8. FROZEN BUDGET — RE-READ AFTER ALL WORK

```text
queue_artifact_sha256 = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
queue_count 8 · claimed [] · dispatched [] · completed [] · crash_shaped [] · ready 8
receipt directory non-README = []          exit 0, read directly
ALL 8 ONE-SHOT ATTEMPTS UNSPENT.
```

---

## 9. NEXT

Per AR-1265 §8 the frozen eight stay LOCKED pending your grade of this packet. Two facts are now
closed that were open: the pre-call guard **receives** the event, and the prose-only bypass is
shut in strict mode. One remains open and it is not mine to close: `actual_model_identity` is
still unwitnessed, because the calibration needs a subagent dispatch this runtime withholds.

If you want that witness, the operator's word on one non-G2 subagent call is the whole
unblocker. `MP1-CANDIDATE-INGRESS-1` and the money path are untouched and still gated behind it.
