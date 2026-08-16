# WORKER REPORT — AR-1270 · 2026-08-16

## F-5 AND F-6 ARE CLOSED **FOR THE CLAUDE TOOL SURFACE** — EDIT/WRITE/NOTEBOOKEDIT BY PATH CLASSIFICATION, BASH BY A NEW PROTECTED-SURFACE FENCE — AND THE SEAT IS RE-PINNED TO `18108039`. TEN CONTROLS PASS THROUGH THE ACTUALLY REGISTERED COMMAND, THE STALE-CACHE GUARD STILL BITES AGAINST A PLANTED PERMISSIVE TOOLBOX, AND THE FROZEN EIGHT ARE STILL 8 READY / 0 SPENT, RE-MEASURED AFTER THE RE-PIN. **THE AR-1269A CALIBRATION WAS NOT RUN AND ITS ONE AUTHORIZATION IS UNSPENT: THIS SEAT IS NOT GUARD-BOUND, SO IT STRUCTURALLY CANNOT PRODUCE WITNESS 1.**

```text
REPORTING ON            : AR-1269 §6 A-D  (+ AR-1269A, read, not spent)
WORKER BRANCH           : claude/worker1-h1-20260815
WORKER HEAD             : aedacf7ad110b92bbb8152e50c9ec9e65f7e558f   (pushed, verified on origin)
TOOLBOX BRANCH          : claude/worker1-p1-toolbox-20260816
TOOLBOX PIN             : e0c44ca4 -> 18108039056a0994c1fc1be9583812b0838dba50  (pushed, verified)
TOOLBOX BUNDLE          : 1d12f61277d8d3c502df9bd7dea5dac541e64335e469fd7176187f4b02144b06 (42 files, COMPUTED)
DESCENDANT RE-PIN       : VERIFIED  `git merge-base --is-ancestor e0c44ca4 18108039`
MEMBER DIFF             : 3 files, +377 / -12

F-5 RECEIPT + QUEUE     : CLOSED FOR THE CLAUDE TOOL SURFACE
F-6 BASH SIDE DOOR      : CLOSED FOR THE CLAUDE TOOL SURFACE
RED PROOF               : 16 RED / 2 GREEN at pre-fix pin e0c44ca4  ->  18/18 GREEN at 18108039
FULL TOOLBOX SUITE      : 177/177 (was 159/159). 0 fail.
REGISTERED-COMMAND      : 10/10 through `node scripts/claude_guard_hook.mjs --manifest ...`
STALE-CACHE CONTROL     : STILL BITES (planted permissive toolbox under a stamp claiming the new pin)
SESSIONSTART            : ARMS. anchor verified @ aedacf7a, governed dirty exception e200765c in force
REAL G2-D CALLS         : 0/8      queue sha 5935b1c6 UNCHANGED · ready 8 · receipts README-only
AR-1269A CALIBRATION    : NOT RUN — UNSPENT. BLOCKED ON SEAT BINDING, see §6.
CI                      : NONE at either pin. All evidence is LOCAL.
CERT                    : RED (unchanged). COMPILER/BACKTEST/PAPER/BROKER/LIVE: LOCKED (unchanged).
NEXT WORKER AR          : AR-1271
```

---

# 1. HEADLINE SCOPE, STATED BEFORE THE EVIDENCE

AR-1269 §8 recorded that three consecutive packets shipped a title wider than its mechanism
(`AR-1266` "P1 IS LIVE", `AR-1268` "PRECALL BOUNDARY CLOSED"). So the scope goes first, not in a
caveat further down:

**WHAT IS CLOSED:** the surface Claude's own tools reach — `Edit` / `Write` / `NotebookEdit` via
path classification, and `Bash` via a new reference-based fence evaluated before the
mutation-spelling blacklist.

**WHAT IS NOT CLAIMED:** that the control plane is unwritable *in general*. A process the guard
never sees — anything outside a Claude tool call — is unaffected, and is supposed to be: the
trusted transition doorway must keep writing receipts from inside its own process
(AR-1269 §6A). The claim is about the **guarded worker's reach**, not about the filesystem.

**ALSO NOT CLAIMED:** that a real native `Agent` dispatch was observed traversing the installed
hook. It was not. See §6.

---

# 2. ITEM A — THE G2 CONTROL PLANE IS NO LONGER WORKER-WRITABLE

Two rules added to `SELF_PROTECTED_RULES` in the one module that owns them:

```text
exact  : docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json
prefix : docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/
```

The existing exact protections (manifest, settings, hooks, toolbox, doorway, activator, the two
helpers, `native_call_manifest`) are preserved unchanged.

**THE RECEIPT HALF IS THE ONE THAT MATTERED.** `outstandingCapture()` decides capture by
`fs.existsSync` on `.raw.json` and `.completion.json`. With the receipt directory writable through
the allowed `docs/replay-results/` prefix, the guarded worker could manufacture the exact
file-existence state the forced-capture stop reads as evidence, and clear it while the previous
answer was still uncaptured. That is control-plane integrity, and it is now denied at the tool
surface.

**THE QUEUE HALF IS BOUNDED, AND I AM NOT OVERSTATING IT.** Per AR-1269 §4 verbatim — *"Do not
overstate the queue gap as an authorization bypass"* — the native-call manifest pins the queue
sha256 and the guard compares it, so a queue edit already failed closed. It is protected because
an editable frozen artifact is not frozen, **not** because it was an open authorization hole.

**Controls (all through the registered runner as a child process):**

```text
Edit  frozen queue                      -> DENY SELF_PROTECTED
Write .attempt receipt                  -> DENY SELF_PROTECTED
Write .dispatch receipt                 -> DENY SELF_PROTECTED
Write fake .raw receipt                 -> DENY SELF_PROTECTED
Write fake .completion receipt          -> DENY SELF_PROTECTED
Write ordinary docs/replay-results file -> ALLOW      <- DISCRIMINATES: prefix NOT globally frozen
MUTATION: drop the receipt-prefix rule  -> the forbidden .raw write becomes ALLOWED  (rule BITES)
MUTATION: drop the queue rule           -> the frozen queue becomes editable         (rule BITES)
```

The discriminator is load-bearing. A `docs/replay-results/` **prefix** rule would have passed all
five denials and failed only that one line — the same trap `scripts/` set for F-1 one directory
over.

---

# 3. ITEM B — BASH IS NO LONGER A SIDE DOOR

**The defect, at the executable line.** `claude-hook-bridge.mjs` handled `Bash` at what was line
150 by calling `bashMutationReason()` and **returning immediately**. The Bash arm therefore never
reached `auditPaths()` / `SELF_PROTECTED_RULES` at all. Any writer whose spelling was absent from
the blacklist reached a protected file untouched by the path classifier.

**The repair is not more spellings.** AR-1269 §5 forbade that explicitly. The fence asks a
different question — *does this command reference a protected surface at all* — which is decidable
without a shell parser and is indifferent to whether the writer is one this desk has seen. It is
evaluated **before** the blacklist, and it reads the same `SELF_PROTECTED_RULES` the path
classifier reads, so there is no second rule list to drift.

Distinctive extra spellings (`isolated-receipts-t1`, `g2d_precall_transition`, …) are declared as
a `bash_tokens` field **on the rule itself**, opt-in per rule. They are opt-in because the bare
basenames of `.claude/settings.json` and `.claude/hooks/` are `settings.json` and `hooks`, which
are far too generic to fence a shell command on without bricking the seat.

**The three required shapes, each with its own red proof:**

```text
dd if=/dev/zero of=scripts/claude_guard_hook.mjs ...                       -> DENY (fence)
python -c "...os.open('<receipt dir>/x.raw.json', os.O_WRONLY|os.O_CREAT)" -> DENY (fence)
python scripts/g2d_precall_transition.py --queue <REAL queue> --claim ...  -> DENY (fence)
```

Each pairs with an asserted control that `bashMutationReason()` returns **null** for that same
command. That is what makes them regressions rather than assertions: before this packet, a null
there *was* the verdict ALLOW. If the blacklist ever grows to cover one of these, that control
fails loudly rather than the shape silently stopping to prove anything.

```text
ORDERING     `rm <receipt>/x.dispatch.json` trips BOTH; the reason names the SURFACE, not the
             mutation -- if the order regressed, the categorical claim would be resting on a
             spelling again.
SPELLING     Windows separators, doubled slashes and upper case all still fence.
DISCRIMINATES `git status --porcelain` · `node --test src/engine/tests/...` ·
             `python scripts/system_inventory.py --check` · `ls docs/replay-results/some-other-run`
             all ALLOW. Fail-closed must be AIMED; a fence that denied everything would pass
             every test above and be indistinguishable from a broken seat.
MUTATION     dropping the receipt rule reopens the interpreter write.
```

## 3.1 🛑 SCOPE DISCLOSURE — THE FENCE IS WIDER THAN THE §6B FLOOR

AR-1269 §6B set a **minimum** of three shapes. I implemented the fence **uniformly over the whole
self-protected set**, which is wider. Two consequences I am not hiding:

1. it denies a **harmless read** (`cat`) of a protected file;
2. it denies Bash that names the pinned toolbox directory — **which includes running the toolbox's
   own test files by path**.

Rationale: a uniform rule has no "which subset did you pick, and why" seam for the next writer to
walk through. Consequence (2) is tolerable because a guarded seat cannot repair the toolbox anyway
by existing design — toolbox repair is an unguarded desk-authorized packet, exactly as this one
was. **But this is a widening of a stated floor, it is my judgment and not your instruction, and
narrowing it is one field.** If you want the floor exactly, say so and it is a one-line change.

---

# 4. ITEM C — DELIBERATE RE-PIN AND PROOF THROUGH THE REGISTERED DOORWAY

```text
1  toolbox committed 18108039, DESCENDANT of e0c44ca4 (asserted, not assumed), pushed + ls-remote
   verified against a negative control (a ref that must not exist returned empty).
2  bundle 1d12f612... COMPUTED by `scripts/claude_toolbox.mjs materialize`, 42 files
   (41 + the new control suite). Never hand-copied.
3  manifest _toolbox_pin/_toolbox_bundle_sha256 updated; TOOLBOX_PIN updated in the activator.
4  10/10 controls through the ACTUALLY REGISTERED command, not an imported function.
5  STALE-CACHE CONTROL STILL BITES.
6  read-only preflight re-measured AFTER the re-pin.
```

**On step 5 — the control is the AR-1267 F-2 shape, reproduced deliberately.** I planted the
**pre-fix permissive** `lane-boundary-guard.mjs` into the TEMP cache while leaving the stamp still
claiming the NEW pin and bundle. If the cache were trusted on existence, the receipt-write control
would have flipped to ALLOW. It did not: the doorway re-hashed the cached bytes, refused the stale
copy, rematerialized from the pin, and the control still DENIED.
**Positive witness that the path actually ran:** the cached file afterwards *contains* the receipt
rule (grep count 0 before, 2 after), so rematerialization demonstrably happened rather than the
tamper quietly not mattering.

**On step 6 — re-measured, not carried across the re-pin:**

```text
queue_artifact_sha256 = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939  (UNCHANGED)
queue_count = 8 · ready = 8
claimed [] · dispatched [] · completed [] · crash_shaped [] · stranded_incomplete []
receipt directory non-README = []
ALL 8 ONE-SHOT ATTEMPTS UNSPENT.
```

**SessionStart still arms** (a re-pin that bricked the seat would be a worse outcome than the gap):
`anchor verified on claude/worker1-h1-20260815 at aedacf7a. Governed dirty exception in force:
docs/wave25-exit-engine-ab-report.md @ e200765c11e8 (AR-1265 §4).`

---

# 5. ITEM D — THE FROZEN EIGHT WERE NOT TOUCHED

Every control artifact is synthetic: a throwaway `git init` repo whose paths merely **spell** the
real ones, which is what makes the real rule values the thing under test. The registered-command
controls are decision-only — a PreToolUse hook returns a verdict and never performs the write.

No `.attempt`, `.dispatch`, `.raw` or `.completion` was created under the real receipt directory.
Verified by the preflight's own `receipt directory non-README = []`.

---

# 6. 🛑 AR-1269A — THE ONE CALIBRATION IS **UNSPENT**, AND I DID NOT SPEND IT

AR-1269A landed on the branch **while I was seated** (my 2s ear caught `ab4ddbb3 -> 9332fe4b`
mid-turn) and explicitly authorizes exactly one non-G2 Opus calibration for the §9H runtime
witness. I read it and deliberately did not run it. Here is why, measured.

Its first required witness is:

> *a real native Agent dispatch traverses the installed PreToolUse hook*

**This seat cannot produce that witness.** `[MEASURED HERE]` The settings that bind my session are
the OUTER repo's `.claude/settings.json`, whose PreToolUse matchers are `Write|Edit|MultiEdit` and
`Bash`. Nothing binding this session registers `Agent` or `Task`, and `grep -c claude_guard_hook`
returns **0** across `.claude/settings.json`, `.claude/settings.local.json` and the user-level
settings. The worker-1 native guard is registered in the **worktree's** `.claude/settings.json`,
which binds a session whose project dir is the worktree.

An `Agent` dispatch from here traverses **no worker-1 guard at all**. Running the calibration in
this seat would spend the single authorization and return a witness that does not answer the
question — and I would then have to ask for another.

**AND THIS IS STRUCTURAL, NOT AN ACCIDENT OF THIS SEAT:**

```text
repairing the guard  REQUIRES an UNGUARDED seat   ("a guarded seat cannot repair its own guard")
witnessing the guard REQUIRES a   GUARDED seat    (the hook must actually be installed)
```

Those are mutually exclusive in one session. AR-1270 had to be the unguarded one. **The
calibration therefore needs a seat whose project directory is
`C:\Users\tonio\Projects\wt-claude-worker1-20260815`**, seated after this re-pin so it picks up
`18108039`. That is a seating instruction, not a code change, and I am not self-authorizing the
seat swap.

`A CAPABILITY AUTHORIZED TO A SEAT THAT CANNOT EXERCISE IT IS NOT YET AUTHORIZED.`

---

# 7. WHAT I GOT WRONG (0-CTRL.4 — SURFACE IT, INCLUDING MY OWN)

Three harness defects, all mine, none in the boundary. All three failed **uniformly across every
case including the discriminators**, which is the signature that identified them:

1. **POSIX cwd.** I fed the hook `$PWD` (`/c/Users/...`). Windows reports an invalid cwd as
   `ENOENT`, so it surfaced as `spawnSync git ENOENT` and looked like a missing git.
2. **Bash backslash mangling.** `${W//\//\\\\}` produced invalid JSON escapes. Worse, my *parser*
   then read the resulting empty stdout as **ALLOW** — a false green in the instrument, in a run
   whose whole purpose was checking a boundary. Rewritten to build JSON with `json.dumps` and to
   treat empty-stdout-with-nonzero-exit as `ERROR`, never as a pass.
3. **POSIX paths into Python** a third time, on the guard-binding check. Re-run with Windows paths
   before I asserted anything from it.

Also disclosed: I wrote the control suite once referencing an export that did not exist, and let a
Cyrillic character into a comment; both were fixed before the first recorded run. And the red proof
required **inert import shims** in the pre-fix tree (`export` the existing `bashMutationReason`; a
`bashProtectedSurfaceReason` returning `null`). Neither invents behaviour — the pre-fix tree really
had no fence — but a bare copy would have produced one collection error and a blunt RED instead of
16 behaviour-judged reds.

---

# 8. WHAT I DID NOT MEASURE

```text
- no live native Agent event was observed (§6). ACTUAL MODEL IDENTITY REMAINS UNWITNESSED,
  and APPROVED_ACTUAL_MODEL_IDENTITIES was NOT widened.
- no CI at either pin. Every number here is LOCAL.
- the fence is proven against the shapes listed. It is REFERENCE-based, so I claim coverage of
  "commands that name a protected surface" -- NOT of a command that reaches one without naming it
  (a variable holding the path, a symlink, a `cd` into the directory followed by a bare basename
  not in bash_tokens). I did not attempt to enumerate that class and do not claim it is closed.
  THIS IS THE HONEST RESIDUAL AND I WOULD RATHER YOU RULE ON IT THAN HAVE IT DISCOVERED.
- I did not re-open F-2/F-3/F-4, did not redesign G2, did not touch Worker-2, did not touch the 33.
- `conditionIsSpent()` left exactly as written, per the standing instruction not to "fix" it.
- AR-1242 canonical_regression_population.txt is still RED (9 files drifted). Untouched, unassigned.
```

---

# 9. WHAT I RECOMMEND

1. **Rule on the §3.1 widening** — keep the uniform fence, or narrow it to the §6B floor.
2. **Rule on the §8 residual** — whether "references a protected surface" is a sufficient boundary,
   or whether the indirect-reference class needs closing before a frozen call.
3. **Seat the calibration in a guard-bound session** at the worktree project dir, on pin `18108039`.
   Its one authorization is unspent.
4. The independent grade on this packet is not required by AR-1269 and I did not self-dispatch one.
   Say the word and it goes out with a DISPROVE mandate.

**No frozen G2-D call was run, considered, or prepared. 0/8 stands.**
