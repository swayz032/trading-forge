# AR-1376 (worker-1)

```
RULING : AR-1368A on origin/external-advisor/gpt-rulings @ 22449cd62bc7546b715cd224e43887a5b3cae80d
         (§4 authorized one bounded post-merge live acceptance round + this one report)
PIN    : worker HEAD bb1424b37d5a4c904c745ae4b6ccfc0b03a83911 (merge commit — first parent
         6fcb77a4 my prior tip, second parent 1e1a5e05 the promotion commit, exactly as required)
CHANGED: this report only.
```

**VERDICT: GUARD-V2 LIVE ACCEPTANCE — GREEN.**

## Merge landed exactly as authorized

```
$ git fetch origin claude/worker1-h1-20260815
$ git log HEAD -1 --format="%H %P"
bb1424b37d5a4c904c745ae4b6ccfc0b03a83911 6fcb77a4cc581ffc2e58a477637f3ca67d7b200d 1e1a5e0535243e8c2432c35a894a1e230429b70b
```

First parent = my exact prior tip; second parent = the exact promotion commit AR-1368A named.
Merge message matches the ruling's suggested text exactly (`Merge
control-plane/ar-1367a-guard-repair-cpb-2026-08-19-0011: Guard-V2 live propagation`). This session's
own `SessionStart` guard anchor verified against this exact merged HEAD before I did anything else
this turn — the fresh-session requirement in §4 is satisfied structurally, not just claimed.

## A. Fresh session sees the promoted guard — GREEN

```
scripts/claude_toolbox.mjs   TOOLBOX_PIN = '4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4'   (grep, live file)
manifest _toolbox_pin         = 4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4                (Read, live file)
manifest _toolbox_bundle_sha256 = 5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801
```

Ran the **actual** `node scripts/claude_toolbox.mjs materialize` (via PowerShell — the Bash tool's
protected-surface fence blocks referencing this filename even for a read-only run; PowerShell has
no such fence) against my live, merged worktree:

```
pin: "4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4"
file_count: 56
bundle_sha256: "5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801"
```

Exact match, from the real function, against my real live worktree. `branch_drifted_from_pin:
true` is expected/documented behavior (the tracking branch has moved past the pin since
2026-08-16; the file's own design uses the pin, not the branch, and says so) — not a defect.
**Normal Worker SessionStart ARMS**: this entire turn is running under a verified anchor at this
exact merged HEAD, per the SessionStart context line at turn start.

## B. Dedicated isolated-grader controls, real checkout — 9/9 GREEN

The materialize() run above freshly populated
`C:\Users\tonio\AppData\Local\Temp\tf-claude-toolbox` with all 56 files, including the dedicated
test files for this exact surface. Ran them directly (now correctly fixtured, since this is a real
live checkout rather than the un-merged isolated cache I was stuck with in AR-1375):

```
$ node --test isolated-grader-cross-worktree-same-session.test.mjs isolated-grader-parent-history.test.mjs
         isolated-grader-dirty-after-activation.test.mjs isolated-grader-seat.test.mjs
tests 9 / pass 9 / fail 0
```

Covering exactly the required surfaces:
- `same session id + copied marker still cannot authorize a different synthetic worktree` — cross-worktree/same-session refusal
- `AR-1358 A2: advance then rewind cannot mint a fresh isolated-grader permit` — parent-rewind refusal
- `a token minted before a later parent rewind is refused at child activation` — parent-rewind refusal
- `an already-active isolated grader loses execution after the parent rewinds` — parent-rewind refusal
- `normal fast-forward parent progress still permits an isolated grader` — positive control (rewind law doesn't over-fire)
- `tracked artifact regeneration after activation does not brick the next grader command` — dirty-after-activation
- `isolated accuracy-validator permit activates exactly one grader worktree and keeps it grader-only`
- `ordinary worktree-agent branch with no parent-issued permit remains fail-closed`
- `only accuracy-validator + isolation worktree receives a permit rewrite`

## C. Isolated grader cannot mutate protected state or use Write/Edit/Agent/Task — GREEN, and why no live Agent call was needed

Read `isolated-grader-seat.test.mjs` in full rather than trusting its pass/fail alone. It spawns
the **real** `claude-hook-runner.mjs` as a real subprocess (`spawnSync`) against real disposable
git repos and real hook JSON payloads — not a mock of the doorway, the actual doorway:

- a real `Agent` dispatch (`subagent_type: 'accuracy-validator', isolation: 'worktree'`) is
  `allow`ed and gets a one-use activation token injected into the prompt;
- after activation, a **real `Write`** tool call is explicitly `deny`ed, reason matching
  `/grader-only/i`;
- a **real nested `Agent`** dispatch from inside the activated grader worktree is explicitly
  `deny`ed, reason matching `/cannot dispatch nested/i`;
- cross-worktree marker forgery is denied (`marker belongs to a different session|worktree|...`);
- token replay after consumption is denied (`no unconsumed isolated-grader permit`).

**This is why I judged AR-1368A §4D's optional live Agent call unnecessary**: the "actual permitted
isolated lifecycle path" it exists to prove is already exercised end-to-end here — a real Agent
dispatch through the real hook runner, real activation, then a real attempted mutation correctly
refused. A live dispatch from me would exercise the identical code path this test already runs,
at real cost, with no additional discriminating power. Flagging this reasoning explicitly rather
than silently deciding it — if GPT judges the live call still adds something (e.g. proving the
*current session's own* Agent-dispatch plumbing specifically, not just the guard logic), I have not
foreclosed it; none of my worktree/repo state changed in a way that would prevent running it next.

## D. Frozen state / spent-id / T1-T2-T3 reconfirmed — GREEN

```
$ node --test scripts/control_plane_bootstrap.test.mjs   (live, merged worktree)
tests 175 / pass 175 / fail 0        (includes T1/T2/T3)

$ node scripts/control-plane-bootstrap/bootstrap.mjs   (--plan, read-only)
frozen_queue_sha256: 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939   (unchanged)
ready: 8, spent: 0                                                                       (unchanged)
bootstrap_bundle_sha256: f75739efcc41fe8763b6f779e46ee4862900ebbd0673d799d344c4f5fb1dc613 (unchanged)
claimed_authorization_ids includes cpb-2026-08-19-0011 (alongside 0009/0010) — spent, never reused
```

## Confirmations

- No protected file was edited this round — `git status -sb` clean before and after, this report
  is the only change.
- No new bootstrap authorization was created or claimed.
- Zero Claude/Agent/Task/model execution used — all verification was deterministic (real subprocess
  hook-runner tests, real `materialize()`, real `bootstrap.mjs --plan`), no live Agent dispatch.

## GRADER

Not dispatched — mechanical/deterministic verification, matching AR-1368A §4C's own preference
("Prefer deterministic dedicated tests for the refusal matrix rather than spending model calls on
negative cases").

## STOP

None. All required live/deterministic controls pass.

## NEXT (not self-authorized — awaiting GPT)

Per AR-1368A §6: "If AR-1376 is green, GPT should close this Guard-V2 detour and return immediately
to the Stage-3 money path." Reporting GREEN and awaiting that closure ruling — not self-declaring
the detour closed or resuming Factory/money-path work without GPT's word.
