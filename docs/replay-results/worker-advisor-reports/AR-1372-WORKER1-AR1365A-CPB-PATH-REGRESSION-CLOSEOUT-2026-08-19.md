# AR-1372 (worker-1)

```
RULING : AR-1365A on origin/external-advisor/gpt-rulings @ 0697f0d72f61ad84d1ed15f515d93379fe9ef93b
         (§4 authorized one test-only closeout commit: scripts/control_plane_bootstrap.test.mjs
         + one new report only. No further scripts/control-plane-bootstrap/** change.)
PIN    : worker HEAD before this commit = 53d226a4c022b0093873d1dbe7b411d3ba5817cb
         (== the exact HEAD GPT inspected in AR-1365A), branch claude/worker1-h1-20260815
CHANGED: scripts/control_plane_bootstrap.test.mjs (+ this report only)
```

## Governance correction acknowledged

AR-1365A did not accept AR-1371's characterization that the operator's in-chat instruction
explicitly superseded AR-1364A's protected-edit lock. Understood — noted plainly, not re-argued.
This closeout stays exactly inside the one authorized scope: the test file and one report. No
further edit to `scripts/control-plane-bootstrap/**`, the guard manifest, `scripts/claude_toolbox.mjs`,
either forensic worktree, any claim/receipt, or any bootstrap/Guard-V2 marker.

## Confirmation: no protected source changed after 53d226a4...

```
$ git status -sb
## claude/worker1-h1-20260815
 M scripts/control_plane_bootstrap.test.mjs
$ git rev-parse HEAD
53d226a4c022b0093873d1dbe7b411d3ba5817cb
```

Only the test file is modified. `scripts/control-plane-bootstrap/**` is byte-identical to what
AR-1365A already inspected at this HEAD.

## T1 / T2 / T3 — added exactly as specified in AR-1365A §5

- **T1** `verifyAuthorityIndependently` call-shape guard — throws on any `git show` call carrying a
  `<sha>:<path>`-shaped argument; requires `ls-tree <authorityHead> -- <exact ruling path>` then
  `cat-file blob <exact resolved object id>`; asserts the positive result still reaches `ok: true`.
- **T2** `bootstrap.mjs::measureState` call-shape guard — same forbidden-shape throw, wrapping the
  existing `fakeIo` baseline (so every other call — fetch, rev-parse, config, status, for-each-ref —
  is exercised exactly as the rest of the suite already proves); asserts `ls-tree`/`cat-file blob`
  are both actually called and the measured `rulingId`/`rulingText`/`isNewestRuling` are correct.
- **T3** fail-closed on an unresolvable object — `ls-tree` returns nothing resolvable; asserts
  `ok === false`, `code === 'authority_object_unresolvable'`, `cat-file` is never called, and (via
  `decide()`) no receipt is ever minted for that failed authority result.

## Full suite, current (fixed) source

```
$ node --test scripts/control_plane_bootstrap.test.mjs
tests 175 / pass 175 / fail 0 / cancelled 0 / skipped 0 / todo 0
```

172 pre-existing tests + T1 + T2 + T3, all green.

## Mutation proof (disposable scratch only, per §5's explicit requirement)

Scratch: `C:\Users\tonio\AppData\Local\Temp\tf-cpb-t1t2t3-mutation-proof` (own directory, outside
Trading Forge, no shared Git common dir — copies only, never a `git init` needed since nothing
here uses git plumbing on the scratch dir itself, only Node's test runner against copied files).

**Step 1 — GREEN on current fixed source, copied verbatim into scratch:**
```
tests 175 / pass 175 / fail 0
```

**Step 2 — mutated BOTH vulnerable call sites back to the exact old shape** (`io.git('show',
\`${authorityHead}:${changed[0]}\`)` in `control-plane-seat-hook.mjs`, and the equivalent two-line
old form in `bootstrap.mjs::measureState`), verified byte-for-byte against the pre-fix historical
shape before re-running:
```
tests 175 / pass 172 / fail 3
```
The exact 3 failures are T1, T2, T3 — nothing else regressed (no collateral failures). T1/T2 fail
with the intended, named reason:
```
Error: FORBIDDEN CALL SHAPE: git show with a revision/path argument
       (["show","abc123:advisor-reports/AR-1281-X.md"]) — this is the exact old vulnerable
       <sha>:<path> shape the AR-1369/AR-1371 repair removed. Production must use ls-tree +
       cat-file blob instead.
    at control-plane-seat-hook.mjs:84:25   (the exact mutated line)
```
```
Error: FORBIDDEN CALL SHAPE: git show with a revision:path argument
       (["show","9bf12d20:advisor-reports/AR-1281-EXAMPLE.md"]) — the exact old vulnerable shape
       the AR-1369/AR-1371 repair removed from measureState.
    at bootstrap.mjs:121:21   (the exact mutated line)
```
T3 also correctly goes RED under the mutation (via a different, still-honest assertion path: with
the old shape, `ls-tree` is never called at all, so `rulingText` resolves through the mutated
`show` call instead, which T3's fixture returns `''` for, yielding
`no_marker_in_current_authority` rather than `authority_object_unresolvable` — still a failed
assertion, still proof the mutation was caught, by a different but equally valid route).

**Step 3 — restored the two files from the real (fixed) repo, re-ran:**
```
tests 175 / pass 175 / fail 0
```

GREEN -> RED (exactly T1/T2/T3, named reason) -> GREEN. The new tests would have caught the exact
defect this whole investigation exists to close.

## GitHub CI / status — separate from local evidence

```
$ gh api repos/swayz032/trading-forge/commits/53d226a4c022b0093873d1dbe7b411d3ba5817cb/status
{"state":"pending","statuses":[],"total_count":0,...}
$ gh run list --branch claude/worker1-h1-20260815 --limit 5
(empty)
```

**CI: NONE.** No combined status checks, no workflow runs for this HEAD. The 175/175 result above
is local-only evidence, exactly as AR-1365A required this report to state plainly rather than
relabel as CI GREEN.

## Confirmations required by §6

- `cpb-2026-08-19-0009` and `cpb-2026-08-19-0010` remain untouched and permanently spent — no
  bootstrap authorization action of any kind was taken in this closeout.
- Zero Claude/Agent/Task/model execution was used for the mechanical replay/mutation proof — pure
  Node test runner + PowerShell file copies, run directly by me.
- Both preserved forensic worktrees were not touched, launched into, or read from in this
  closeout (this packet's evidence needs were satisfied entirely by the scratch mutation proof and
  the already-fixed real source; the CPB-0010 end-to-end replay against the real preserved
  worktree was already completed and reported in AR-1371).

## GRADER

Not dispatched — mechanical test-suite evidence and a mutation proof, matching §6's own framing
("the point is not test count, the point is proving the new tests would have caught the exact old
defect"), not a judgment call requiring independent grading.

## STOP

None. Closeout complete, exactly inside the one authorized scope.

## NEXT (not self-authorized — awaiting GPT)

Per AR-1365A §7: awaiting GPT's independent confirmation that no protected source changed after
`53d226a4...`, that the new tests genuinely kill the old vulnerable shape, and its decision on
upgrading the AR-1371 candidate to a technical PASS plus the next Guard-V2/bootstrap step. Not
self-authorizing a new bootstrap marker, and noting per AR-1365A §7 that any future marker must
bind the new (post-AR-1371) `bootstrap_bundle_sha256`, not the old one.
