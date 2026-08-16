# AR-1264 — WORKER — P1 LIVE BOUNDARY: A AND C LAND; B IS BLOCKED ON A DESK DISPOSITION

```text
RULING FOLLOWED : AR-1263 §7 (A precedence repair · B activate native path in the real seat ·
                  C narrow G2 pre-call guard · D calibration only if the dispatch gate is open)
SEAT            : FRESH session, as AR-1263 §9 required. Onboarded via
                  worker-1-compiler-onboarding; read AR-1261/1262/1263 as documents, not as
                  inherited AR-1260/1261/1262 conversation.
WORKTREE (work) : C:\Users\tonio\Projects\wt-p1-toolbox-20260816   (NEW)
BRANCH          : claude/worker1-p1-toolbox-20260816
BASE (pinned)   : dd1bc2306dee2f894272fa7c4a973c4812672dfe  = origin/external-advisor/gpt-speed-engineering
  4e14ee59      : A — self-protected precedence
  032ebc76      : C — G2-D pre-call boundary
HEAD / PIN      : 032ebc76ca75171d525723dbe239418b4cdbd424  <- every number below is at THIS pin
WORKER-1 TREE   : untouched by this packet. Still 60729c48, still the one pre-existing dirty
                  file docs/wave25-exit-engine-ab-report.md.
OPUS CALLS SPENT: 0 of 8. Receipt directory byte-unchanged (README.md only). Re-verified AFTER
                  all work; preflight exit code read directly, not through a pipe.
CI              : NONE at this pin. All evidence below is LOCAL.
EAR             : armed 2s on origin refs/heads/external-advisor/gpt-rulings, baseline
                  b297d6d4. Red-proofed on a throwaway BEFORE trusting it (emits on move /
                  silent without one / refuses non-repo cwd / refuses absent ref). It then
                  DELIVERED AR-1263 into this session's chat mid-turn.
GRADER          : NOT DISPATCHED — AR-1263 requires no grade for AR-1264. Say the word.
```

---

## 1. PRE-FLIGHT (advisor-ruling §0.-2) — NO CONTRADICTION ON PREMISES

| # | | |
|---|---|---|
| 1 | SCOPE | AR-1263 §7A–D. §9 explicitly permits a separate worktree rooted at the GPT speed-engineering toolbox authority branch, and forbids forking a second copy of the hook implementation into Worker-1. I did the former, not the latter. |
| 2 | STOP | Unseen exact model identity (did not fire — no real call). Load-bearing fork ⇒ STOP+REPORT (**FIRED — see §4**). |
| 3 | PROHIBITED | Spending a G2 attempt · continuing E1/E2 · building a parallel hook framework · claiming P1 ACTIVE before real registration. None done. |
| 4 | PROOFS | RED→GREEN · the 7 named negatives + 2 positives · mutation control · real-queue preflight. |
| 5 | REPO STATE | Every AR-1263 premise verified `[MEASURED HERE]`: P1 not registered (live settings carry only PreToolUse/PostToolUse desk guards; no SessionStart, no hook-runner, no TaskCompleted); `record_native_dispatch`/`capture_native_return` have no non-test caller; queue 8/0. |
| 6 | ALREADY LANDED? | No. `REVIEW_REQUIRED` returns zero hits anywhere in the Worker-1 tree — the toolbox is only on the authority branch. |
| 7 | METRIC/GRADE MIX | None. |

---

## 2. §7A — THE PRECEDENCE DEFECT WAS TWO DEFECTS, AND THE OBVIOUS FIX IS THE TRAP

**Measured at the base pin**, `classifyPath` verdicts for Worker-1:

```text
src/engine/extraction/g2d_finalizer.py       REVIEW_REQUIRED
src/engine/tests/test_g2d_finalizer.py       REVIEW_REQUIRED
scripts/g2d_real_queue_preflight.py          REVIEW_REQUIRED
.claude/worker1-hook-guard-manifest.json     REVIEW_REQUIRED
src/server/services/paper-engine.ts          BLOCK
package.json                                 HANDOFF_REQUIRED
```

`auditPaths` folded `REVIEW_REQUIRED` into `blocking`, and the bridge denied on
`!safe_to_edit_without_handoff` **before ever consulting the authorized packet scope**.

⇒ **Activating P1 as it stood would have denied Worker-1 every file in its own G2 packet.**
That is AR-1256's "one blocker inside the pinned toolbox", now located exactly.

**The trap:** the obvious repair — let `REVIEW_REQUIRED` through when packet scope covers it —
immediately opens a worse hole, because Worker-1's manifest lists `.claude/` in
`allowed_prefixes`. The worker would gain edit rights over
`.claude/worker1-hook-guard-manifest.json`, the file that declares its own permissions. That is
precisely what §7A forbids.

**Repair:** a `SELF_PROTECTED` category evaluated FIRST and never scope-overridable (guard
manifest, `.claude/settings*.json`, `.claude/hooks/`, the pinned toolbox), plus one exported
`decideEditPermission()` so the bridge and the controls read the SAME law instead of a second
copy that drifts and stops biting while still reporting PASS.

Self-protection rules are an **injected parameter, never mutable module state**. I rejected a
`__setSelfProtectedRulesForTest` seam on purpose: a guard carrying a runtime switch that turns
it off is not a guard, and the mutation control does not need one.

```text
SELF_PROTECTED / BLOCK / HANDOFF_REQUIRED -> DENY, scope never consulted
REVIEW_REQUIRED                           -> allow ONLY inside explicit authorized packet scope
ALLOW_LANE_MATCH                          -> still must satisfy packet scope
```

### Evidence

```text
baseline, untouched source extracted at dd1bc230 : 86/86 pass
new controls BEFORE the fix                      : 10 fail / 2 pass   (RED)
new controls AFTER                               : 12/12              (GREEN)
full toolbox suite after A                       : 98/98
```

The 2 passing controls in the RED run are deliberate positive witnesses that the harness runs
rather than failing everything blindly.

**Why the self-protected controls assert a VERDICT, not just a decision:** before the repair
every unmatched path (the manifest included) was denied as `REVIEW_REQUIRED`. A control that
only asserted `deny` would have been GREEN on the broken code **and stayed green through the
very change that opens the hole.**

**Mutation control:** removing the self-protected category makes the guard-manifest self-edit
WRONGLY allow — proving that category, not some incidental guard, is doing the work.

**Two pre-existing tests changed. Both were expectation updates, not behaviour changes**, and I
tightened rather than loosened: a `deepStrictEqual` summary gained `self_protected`, and one
deny-reason regex was reworded — the cross-lane path still denies, and its assertion now names
the verdict and the offending path.

**BOOTSTRAP NOTE, deliberate:** with the guard ACTIVE a worker cannot repair this toolbox.
Repairs are desk-authorized packets on the authority branch — as AR-1264 itself is.

---

## 3. §7C — THE PRE-CALL BOUNDARY

Required property, implemented: a native subagent invocation that is part of G2-D cannot be
issued unless the exact frozen condition holds a durable pre-call permit matching **queue
artifact SHA + `task_input_sha256` + requested `opus`**, with the condition not already spent.

**Fail-closed detection is the whole design.** Detection keys off G2 *surface* — the frozen
queue artifact, the real receipt directory, any queue condition ref — or a permit marker.
Never on the caller volunteering one.
★ `AN OPT-IN GUARD IS A GUARD THAT THE MISTAKE YOU FEAR WILL OPT OUT OF.`
A permit-bearing call naming a non-member ref is caught by declaration.

**"Already spent" has two independent durable witnesses:** `queue.attempts`, and the existence
of any `.attempt/.dispatch/.raw/.completion` receipt (named by a JS mirror of the Python
`_safe_name`). Either alone denies — so a crash between receipt write and queue update cannot
buy a second call.

### Controls — 15/15, all synthetic, no attempt claimed

```text
POSITIVE  benign non-G2 subagent usage remains usable
POSITIVE  exact authorized permit reaches the boundary; receipt dir untouched
NEGATIVE  no permit                                   -> DENY before call
NEGATIVE  wrong condition ref                         -> DENY
NEGATIVE  wrong task_input_sha256                     -> DENY
NEGATIVE  wrong queue sha                             -> DENY
NEGATIVE  sonnet / haiku / 'Opus' / 'claude-opus-5' / 'opus-impostor' / '' -> DENY
NEGATIVE  second dispatch, queue.attempts witness     -> DENY
NEGATIVE  second dispatch, receipt-file witness alone -> DENY
NEGATIVE  permit for a condition the call does not name -> DENY
NEGATIVE  attempt != 1                                -> DENY
NEGATIVE  absent/unreadable permit                    -> DENY, not skipped
FAIL-CLOSED  omitting the marker does not escape the gate
MUTATION     marker-dependent detection would reopen the hole
```

Protected guard/manifest self-edit is denied by §7A above, controlled there.

### Cross-instrument join on the REAL artifacts — read-only, no dispatch

```text
guard queue sha256 (node crypto) == python preflight queue sha256
  5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
8 frozen conditions · max_attempts_per_condition = 1 · 0 spent
real no-permit G2-shaped dispatch -> DENY
real benign subagent dispatch     -> ALLOW
```

That is two different instruments in two languages agreeing on the queue identity, not one
source read twice.

```text
full toolbox suite after A + C : 113/113   (86 baseline + 12 + 15)
preflight AFTER all work       : 8 ready / 0 claimed / 0 dispatched / 0 completed
                                 receipt dir non-README = []   exit 0 (read directly)
```

---

## 4. §7B — BLOCKED, AND THE BLOCKER IS A DESK DISPOSITION, NOT AN ENGINEERING GAP

I did not activate the native hook path, and I am not calling P1 ACTIVE.

**Measured end-to-end against the real Worker-1 worktree:**

```text
verifyResumeAnchor(...require_clean: true) -> ok=false, errors=["worktree is dirty"]
SessionStart  -> "GPT worker guard STOP: worktree is dirty. Do not edit."
              -> TF_CLAUDE_GUARD_ANCHOR_OK never set
PreToolUse    -> deny  "worker session anchor was not verified at SessionStart;
                        edits are fail-closed"
```

⇒ **Registering the hooks today would deny every edit in the Worker-1 seat.** The cause is the
single pre-existing dirty file `docs/wave25-exit-engine-ab-report.md` — a timestamp-only
regeneration.

Both available remedies are ones I may not take:

- **Clean or commit it** — AR-1245 §9 says do not sweep it into G2 commits and do not use it as
  a reason to clean mid-G2.
- **Set `require_clean: false`** — the manifest's own note calls this "weakening a guard to
  obtain a green" and assigns its disposition to the desk. The refusal is CORRECT; the tree
  really is dirty.

**This is the load-bearing fork, and it is yours.** Options as I see them, with my
recommendation last:

1. Dispose of that file explicitly (commit it alone, on its own authority, outside G2).
2. Narrow the anchor to `require_clean` **except** an explicitly listed, desk-dispositioned
   path — a scoped exception with a citation, not a blanket `false`.
3. Leave §7B blocked until G2-D is done, and run the frozen eight with the §7C guard armed but
   the native registration still absent.

**I recommend (2):** it keeps the guard biting on every unexpected dirty file, encodes the
desk's existing disposition of this one instead of forgetting it, and unblocks real-seat
activation without touching G2 commits. It is a manifest/anchor change, so it is
self-protected — desk-authorized by construction.

---

## 5. §7D — CALIBRATION NOT RUN

AR-1263 §7D gates the non-G2 calibration on the live Claude subagent dispatch gate being
genuinely available. It is not: P1 is not registered, and §7B is blocked above. Per the ruling
I am reporting the blocker **once** and not asking repeatedly.

No calibration receipt exists. `actual_model_identity` therefore remains **UNWITNESSED** — D1-C2
stays OPEN exactly as AR-1263 left it. I did not widen the approved identity set, and I did not
infer an identity from anything.

---

## 6. MY OWN DEFECTS THIS PACKET (0-CTRL.4)

Disclosed rather than rewritten out of the history:

1. **Permit path extraction was broken on Windows.** I regexed `JSON.stringify` output, whose
   escaped separators truncated the path, so the guard returned a confident *"permit
   unreadable"* for a permit that was perfectly readable. Fixed by walking raw string values.
   ★ `AUDIT THE INSTRUMENT BEFORE BELIEVING IT.`
2. **A permit-bearing call naming a non-queue ref was classified benign** and allowed. Fixed:
   carrying a permit marker makes a call G2 by declaration.
3. **My first control run failed for a harness reason, not a guard reason** — `writePermit`
   never set `queue_artifact_sha256`, so every permit died at check 1 and the later-stage
   assertions never ran. The guard had been denying correctly the whole time; my expectations
   were wrong. Permits are now COMPUTED from the synthetic queue, never hand-copied.
4. **I mistyped the preflight filename and read `tail`'s exit code as Python's** — the piped
   exit-code trap this desk has convicted before. Re-run directly; the exit 0 above is real.

---

## 7. WHAT I DID NOT MEASURE

- **No CI at this pin.** Every number here is local.
- **`claude-finish-check` has the same structural REVIEW_REQUIRED problem** as the bridge did:
  it reads `safe_to_edit_without_handoff` against the actual diff, so a legitimate Worker-1
  packet would fail it. I did **not** change it — AR-1263 §7A scoped me to the guard decision,
  and `finish.enabled` is currently `false`. **Reporting, not fixing.** It will bite the moment
  finish is armed.
- I did not prove the guards fire in a real registered seat — that is §7B, blocked.
- I did not run the repo-wide vitest/pytest suites; scope was the toolbox.

---

## 8. NEXT

Per AR-1263 §8 this is the pre-call checkpoint before the one-shot ruling. Awaiting your grade
plus a disposition on §4. `MP1-CANDIDATE-INGRESS-1` and the money path are untouched and still
gated behind it.
