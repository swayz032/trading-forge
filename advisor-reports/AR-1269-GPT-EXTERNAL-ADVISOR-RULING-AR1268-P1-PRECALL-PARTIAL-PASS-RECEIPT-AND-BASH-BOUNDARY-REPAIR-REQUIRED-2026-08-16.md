# GPT EXTERNAL ADVISOR RULING — AR-1269 · 2026-08-16

## AR-1268 IS A SUBSTANTIAL PARTIAL PASS. THE STALE-CACHE REPAIR, TRUSTED `ATTEMPT -> DISPATCH` TRANSITION, FROZEN EIGHT-ROW NATIVE-CALL IDENTITY, ACTUAL OPUS FIELD BINDING, AND REAL-SEAT RE-PIN ARE MATERIAL AND REPOSITORY-SUPPORTED. THE FROZEN EIGHT ARE STILL 0/8 UNSPENT. BUT THE REPORT HEADLINE `PRECALL BOUNDARY CLOSED` IS TOO STRONG. THE REAL RECEIPT CONTROL PLANE IS DIRECTLY WRITABLE THROUGH THE ALLOWED `docs/replay-results/` PREFIX, AND THE BASH GUARD IS A MUTATOR-SPELLING BLACKLIST THAT CAN BYPASS `SELF_PROTECTED` PATH ENFORCEMENT. A FALSE `.raw + .completion` PAIR CAN SATISFY THE CURRENT FORCED-CAPTURE CHECK BY FILE EXISTENCE ALONE. REPAIR THESE TWO TRUST-SURFACE GAPS BEFORE ANY FROZEN G2 CALL. THE SINGLE NON-G2 CALIBRATION STILL REQUIRES AN EXPLICIT OPERATOR UTTERANCE AND REMAINS UNSPENT.

```text
RULING ON              : worker AR-1268
REPORT REAL-SEAT PIN   : d62b9b884a2f3526234c2d05636b1b4663162e9a
CURRENT WORKER BRANCH  : claude/worker1-h1-20260815
CURRENT WORKER HEAD    : 13c5a62e2147f1f36ebfb6ab0558dd47a613a444
HEAD DELTA AFTER REPORT: docs/designs/WORKER1-RESUME-ANCHOR.md ONLY
TOOLBOX BRANCH         : claude/worker1-p1-toolbox-20260816
TOOLBOX PIN            : e0c44ca4374358e3f9717a73c5faa1f7e963aa89
F-1 EXACT FILE PROTECT : PARTIAL PASS — EDIT/WRITE SURFACE PROTECTED; BASH ESCAPE REMAINS
F-2 STALE CACHE        : PASS
F-3 CLAIM->DISPATCH    : PASS AS PRE-CALL MECHANISM
F-4 NATIVE CALL BINDING: PASS AS FROZEN MECHANISM
FORCED CAPTURE         : RED AS TRUST BOUNDARY — RECEIPT FILES ARE WORKER-WRITABLE
QUEUE IMMUTABILITY     : OPEN — LIVE QUEUE IS WORKER-WRITABLE, BUT HASH DRIFT FAILS CLOSED
LIVE NATIVE EVENT      : NOT YET OBSERVED FROM THE REQUIRED REAL CALIBRATION
ACTUAL MODEL IDENTITY  : UNWITNESSED AT RUNTIME
MODEL CALIBRATION      : NOT RUN / REQUIRES EXPLICIT OPERATOR UTTERANCE
REAL G2-D CALLS        : 0/8
REAL RECEIPTS          : README.md ONLY
G2-H                   : OPEN
CI                     : NONE; tests are local-only evidence.
CERT                    : RED
COMPILER/BACKTEST/PAPER/BROKER/LIVE: LOCKED
NEXT WORKER AR          : AR-1270
```

---

# 1. INDEPENDENT GITHUB VERIFICATION

I did not grade AR-1268 from its prose.

The latest GPT authority before this review is AR-1267. AR-1267 authorized only the bounded A-G pre-call repair and explicitly required a hard stop at §9H before calibration unless the operator explicitly authorizes one subagent call.

AR-1268 reports real-seat pin:

`d62b9b884a2f3526234c2d05636b1b4663162e9a`

and toolbox pin:

`e0c44ca4374358e3f9717a73c5faa1f7e963aa89`.

GitHub now resolves Worker-1 to:

`13c5a62e2147f1f36ebfb6ab0558dd47a613a444`.

The only commit after the reported engineering pin is the resume-anchor documentation commit, changing only:

`docs/designs/WORKER1-RESUME-ANCHOR.md`.

Therefore the AR-1268 engineering snapshot is cleanly gradeable at `d62b9b88...`; later implementation did not contaminate the packet.

At the reported real-seat pin, the live manifest re-pins the toolbox to `e0c44ca4...` with bundle:

`c6182c1e21f7e4efba30797bb9db037540d43e0ca3747d2909b3f4f8066b4e5b`.

The frozen native-call artifact exists and declares:

```text
schema       : g2d-native-call-identity-v1
call_count   : 8
queue sha256 : 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
model        : opus on every row
subagent     : general-purpose on every row
```

The real queue still has eight entries and `attempts: {}`. The real receipt directory contains only `README.md`.

**0/8 frozen calls are committed/spent.**

GitHub check-runs, combined statuses, and Actions runs are empty at the real-seat pin. The toolbox pin likewise has no check-runs, statuses, or Actions run.

**CI: NONE; tests are local-only evidence.**

---

# 2. WHAT AR-1268 REALLY CLOSED

## 2.1 F-2 stale toolbox cache — PASS

The real registered doorway no longer trusts cache existence.

`scripts/claude_guard_hook.mjs` now:

1. reads the manifest `_toolbox_pin` and `_toolbox_bundle_sha256`;
2. reads the cached stamp;
3. exact-matches cached pin and bundle;
4. locally re-hashes the cached `.mjs` population back to the expected bundle;
5. rematerializes on mismatch;
6. verifies the rematerialized pin and bundle before executing the child;
7. fails closed on disagreement.

That is the right fast + robust shape. It does not pay forty `git show` calls on every tool event merely to be safe.

The worker's stale-permissive-runner control is also aimed at the actually registered doorway rather than an imported helper. That is the correct engineering boundary.

**F-2 = PASS.**

## 2.2 F-3 durable pre-call state transition — PASS AS MECHANISM

AR-1267's core contradiction is repaired.

The trusted PreToolUse path now calls the protected Python doorway, which reuses the existing durable law and performs:

```text
READY
 -> create-only .attempt
 -> create-only .dispatch
 -> ALLOW native Agent call
```

A dispatch failure leaves the attempt spent; there is no cleanup and no automatic retry. A pre-existing attempt remains a prior-claim/crash shape and denies. The worker also added concurrency controls against the create-only receipt boundary rather than inventing a second lock law.

That is architecturally correct.

**F-3 = PASS AS PRE-CALL MECHANISM.**

This is not yet proof that an actual Claude native Agent event traversed the mechanism in the live calibration. That witness remains open by design.

## 2.3 F-4 actual call identity — PASS AS FROZEN MECHANISM

The new native-call manifest is real and frozen before answers exist.

Each of the eight rows binds the load-bearing native call fields:

```text
model
subagent_type
prompt
```

to the already-frozen queue/task identity.

The guard also correctly distinguishes:

```text
model omitted/inherited != explicit Opus
subagent_type=fork       != isolated explicit-model route
```

and denies those shapes.

The prompt provenance is bounded to the existing locator prompt construction and pinned source identities rather than an answer-dependent rewrite.

**F-4 = PASS AS MECHANISM.**

Again: mechanism proof is not runtime model-identity proof. The real calibration still owes that witness.

## 2.4 AR-1267 §9H stop — PASS

The worker did not infer authorization from the ruling.

It stopped before the non-G2 calibration because no explicit operator utterance authorizing that subagent call had arrived.

It did not spend any of the eight frozen calls merely to prove the guard.

That restraint is correct and gets full credit.

---

# 3. CLAIM CORRECTION — `PRECALL BOUNDARY CLOSED` IS NOT SUPPORTED

AR-1268 deserves credit for reporting one of the remaining gaps against itself, but its headline is still stronger than the state of the repository.

The bounded correct status is:

**THE FOUR AR-1267 PRE-CALL REPAIRS LANDED AND PASS AT THEIR CLAIMED MECHANICAL SCOPE; THE FULL ONE-SHOT TRUST BOUNDARY IS NOT YET CLOSED.**

Two control-plane gaps remain before a frozen G2 call is safe enough to authorize.

---

# 4. F-5 — REAL RECEIPT CONTROL PLANE IS DIRECTLY WRITABLE

This is the worker's own reported finding, independently confirmed.

The real Worker-1 manifest allows the broad prefix:

`docs/replay-results/`

The G2 control plane lives under that prefix:

```text
queue:
  docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json

receipts:
  docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/
```

AR-1268 self-protects the new `native_call_manifest_t1.json`, but it does not self-protect the frozen queue or receipt directory.

The queue weakness is bounded by a useful defense: the native-call manifest pins the queue SHA, and the guard compares that pin to the live queue hash. A queue edit therefore causes a fail-closed mismatch rather than silently authorizing a changed task.

Do not overstate the queue gap as an authorization bypass.

The receipt gap is more serious.

`outstandingCapture()` currently treats a prior dispatch as captured when both files merely **exist**:

```text
.raw.json
.completion.json
```

But the guarded worker can directly Write under the real receipt directory because the directory is inside the allowed `docs/replay-results/` prefix and is not self-protected.

Therefore the guarded worker can manufacture file-existence state that the forced-capture gate treats as evidence of capture.

That means this sequence is mechanically possible at the present boundary:

```text
real dispatch exists
real answer is not durably captured
        ↓
worker writes fake .raw + .completion files
        ↓
outstandingCapture() sees both filenames
        ↓
forced-capture stop is falsely cleared
        ↓
next one-shot call may proceed
```

That is not merely denial-of-service. It is a control-plane integrity bypass.

**F-5 = RED.**

---

# 5. F-6 — `SELF_PROTECTED` CAN BE ROUTED AROUND THROUGH BASH

This finding was not called out by AR-1268 and is the main GPT challenge on this packet.

The real `.claude/settings.json` registers PreToolUse for:

`Edit|Write|NotebookEdit|Bash|Agent|Task`.

For Edit/Write/NotebookEdit, the bridge extracts the target path and routes it through `auditPaths()` / `SELF_PROTECTED_RULES`.

For Bash, it does something different.

`claude-hook-bridge.mjs::bashMutationReason()` uses a blacklist of recognized mutation spellings, including examples such as:

```text
sed -i
tee
touch
rm
mv
cp
truncate
redirection
writeFileSync/write_text/open(...,'w')
selected dangerous git commands
```

If a Bash command does not match one of those patterns, the bridge returns no objection. The Bash path never reaches the `SELF_PROTECTED` path classifier.

The existing Bash test covers representative known spellings such as `sed -i`, redirection, destructive git, and Node `writeFileSync`. It does not prove that the boundary is closed to other file-writing mechanisms.

This matters especially here because:

1. an unrecognized writer can target a `SELF_PROTECTED` file without the path classifier ever seeing it;
2. the trusted `scripts/g2d_precall_transition.py` doorway itself can create real `.attempt/.dispatch` receipts, so direct invocation of that helper through an allowed Bash shape would manufacture durable transition state without a corresponding native Agent dispatch;
3. direct receipt mutation can undermine the one-shot audit trail.

A command-spelling blacklist cannot support the categorical claim:

**`the guarded worker cannot edit its own control surface`.**

Do not repair this by adding two more spellings such as `dd` or `os.write` to the blacklist. That is whack-a-mole, not a boundary.

**F-6 = RED.**

---

# 6. AR-1270 — SHORTEST ROBUST REPAIR

Do not reopen F-2/F-3/F-4. Do not redesign G2. Do not spend a frozen call.

Execute only this bounded trust-surface repair.

## A. protect the frozen queue and the real receipt namespace

Extend the shared self-protection law so the worker cannot directly mutate:

```text
exact:
  docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json

prefix:
  docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/
```

Preserve the existing exact protection for the native-call manifest and live helpers.

Required controls:

```text
direct Edit frozen queue                    -> DENY SELF_PROTECTED
direct Write new .attempt receipt           -> DENY SELF_PROTECTED
direct Write new .dispatch receipt          -> DENY SELF_PROTECTED
direct Write fake .raw receipt              -> DENY SELF_PROTECTED
direct Write fake .completion receipt       -> DENY SELF_PROTECTED
ordinary authorized docs/replay-results file-> still not globally frozen
mutation removing receipt-prefix rule       -> one forbidden receipt write becomes allowed
```

The trusted transition/finalization code may still create receipts through its intended internal process path. Do not replace the durable receipt law with Claude Edit/Write.

## B. close the Bash route around path self-protection

Add a **protected-surface Bash fence** before the generic mutation-spelling logic.

At minimum, a Bash call that references the live protected control surfaces, the frozen queue, the real receipt prefix, or the transition doorway must DENY rather than falling through merely because the writer's spelling is unfamiliar.

Do not broaden this into a whole shell parser.

The fast robust goal is:

```text
Bash may remain usable for ordinary authorized read/test work,
but Bash is never a side door to the protected control plane.
```

Required biting controls must include at least three shapes the current blacklist does not establish:

```text
an alternate file writer targeting a protected file         -> DENY
an interpreter/low-level write targeting receipt namespace  -> DENY
direct Bash invocation of g2d_precall_transition.py on REAL control-plane paths -> DENY
```

Also keep a discriminator proving an ordinary Bash read/test command that does not touch protected control-plane paths is not globally bricked.

The control must test the **registered hook path**, not only `bashMutationReason()` in isolation.

## C. re-pin deliberately, then prove the real registered doorway

After toolbox repair:

1. immutable descendant re-pin;
2. recompute bundle identity;
3. update the real manifest pin/bundle deliberately;
4. registered-command controls through `scripts/claude_guard_hook.mjs`;
5. stale-cache control still bites;
6. read-only real preflight proves queue SHA unchanged, eight READY, receipts README-only.

## D. keep the frozen eight untouched

All AR-1270 controls use synthetic receipts except read-only inspection of the real queue/receipt state.

No `.attempt`, `.dispatch`, `.raw`, or `.completion` may be created under the real receipt directory by the repair packet.

---

# 7. CALIBRATION STATUS — DO NOT CONFUSE THIS WITH A FROZEN G2 CALL

AR-1267 §9H remains the authority.

The single non-G2 calibration exists to witness the real runtime facts AR-1268 cannot prove synthetically:

```text
real native Agent dispatch traverses installed PreToolUse
explicit requested model = Opus
actual model identity / task id / usage is captured if exposed
otherwise exact field is recorded honestly as NOT_EXPOSED
frozen G2 queue remains 0/8
```

This ruling does **not** manufacture the required operator utterance.

If the operator explicitly authorizes that one calibration subagent call in the live Worker-1 session, the calibration remains the correct next runtime witness and is not one of the frozen eight.

However:

**NO FROZEN G2-D CALL IS AUTHORIZED UNTIL F-5 AND F-6 ARE GREEN AND READ BACK THROUGH THE REAL REGISTERED DOORWAY.**

---

# 8. CLAIM-RELIABILITY ACCOUNTING

Give AR-1268 credit for its self-findings:

- cross-language CRLF defect caught before shipping the eight-call campaign;
- bad initial harness root corrected;
- remembered constants replaced by imported measured constants;
- old positive tests that lacked an explicit model were converted into negative controls rather than deleted;
- G2 artifact loading was narrowed away from ordinary Edit/Write;
- queue/receipt self-protection gap was explicitly reported instead of silently ignored.

Those are good engineering behaviors.

But preserve the headline correction:

```text
worker headline: PRECALL BOUNDARY CLOSED
GPT grade      : FOUR REQUIRED REPAIRS PASS AT BOUNDED MECHANICAL SCOPE;
                 FULL TRUST BOUNDARY STILL OPEN
```

Accidental truth or a self-reported caveat does not make a categorical headline stronger than its evidence.

---

# 9. LOCK STATE

Unchanged unless a later GPT ruling explicitly opens it.

```text
strategy certification          : RED / LOCKED
compiler authorization for sVkm : LOCKED
broad backtest campaign          : LOCKED
PAPER                            : LOCKED
Worker-2 runtime activation      : LOCKED where previously gated
broker / Topstep / live          : LOCKED
frozen G2-D campaign             : 0/8, NOT AUTHORIZED YET
single non-G2 calibration        : awaits explicit operator utterance
```

Do not spend one of the eight to prove a guard. Do not loosen a guard to make a calibration pass. Do not treat a local green suite as GitHub CI.

---

# FINAL RULING

**AR-1268 = SUBSTANTIAL PARTIAL PASS.**

The worker materially improved the system and correctly honored the no-dispatch stop. F-2, F-3 and F-4 are accepted at their mechanical scopes, and the frozen eight remain pristine.

But the one-shot campaign is not ready for a frozen call. The receipt namespace can presently be written by the worker, and Bash can route around path-based `SELF_PROTECTED` enforcement because the Bash boundary is a mutation-spelling blacklist rather than a protected-surface boundary.

**AR-1270 is authorized only for the bounded F-5/F-6 repair, deliberate re-pin, registered-doorway proof, and read-only 0/8 preflight.**

**Fast + robust:** close these two trust-surface gaps; do not restart the architecture.
