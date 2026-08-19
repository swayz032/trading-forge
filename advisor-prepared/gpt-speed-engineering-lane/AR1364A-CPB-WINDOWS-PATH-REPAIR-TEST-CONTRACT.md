# AR-1364A — CPB Windows path repair test contract

Base Worker source: `0f454465af154fbff42dea5fb3b8b2ea9f638890`.

Candidate patch artifact: `advisor-prepared/gpt-speed-engineering-lane/AR1364A-CPB-WINDOWS-PATH-REPAIR.patch`.

## Defect to close

`control-plane-seat-hook.mjs::makeRealIo()` currently spawns Git as:

`git -C <deep-worktree> ...`

AR-1369 reproduced a Windows/Git-for-Windows failure when `verifyAuthorityIndependently()` then reads a long ruling object with `<sha>:<advisor-reports/...long filename...>`: the failed CPB-0010 shape crosses the path/stat boundary and throws `Filename too long` before authority validation.

## Candidate law

Repository selection moves from Git argv to the child-process working directory:

`execFileSync('git', args, { cwd, encoding: 'utf8' })`

No authority, claim, queue, receipt, bundle, origin, allowed-path, or fail-closed validation law may change.

## Independent Worker attack

Do not edit Trading Forge protected production files. Use an OS-temp disposable copy/repository that does not share Trading Forge's Git common directory.

1. Copy the exact protected bootstrap source from Worker base `0f454465...` into scratch.
2. Demonstrate the historical RED shape with the pre-patch `git -C <deep-path> show <sha>:<long-ruling-path>` behavior on the installed Windows/Git-for-Windows environment.
3. Apply the exact candidate patch to the scratch copy only.
4. Prove the same long authority object read succeeds through the patched `makeRealIo()` semantics.
5. Re-run the CPB-0010 historical replay with network fetch intercepted and the historical authority pinned to `e7077d46a657288ecc5eb9c38a4540acf218a653`.
6. Use fixed synthetic session IDs. Do not use `crypto.randomUUID()` in the replay proof.
7. The exact preserved manifest/claim must now reach the real authority/identity logic.
8. Run exactly these three discriminating in-memory negative controls after the path crash is removed:
   - altered manifest branch -> refuse for branch/identity reason;
   - altered bootstrap bundle SHA -> refuse for bundle reason;
   - altered authorization ID/claim binding -> refuse for authorization/claim reason.
9. If all three controls are pre-empted by one unrelated exception again, classify `F3_INDETERMINATE`.
10. Official replay classification remains only `F1_STATIC_PASS`, `F2_STATIC_FAIL`, or `F3_INDETERMINATE`.

## Repair acceptance

Candidate repair is ready for protected integration only if:

- the historical long-path crash is reproduced before patch and absent after patch on Windows;
- the exact CPB-0010 replay reaches authority/identity logic;
- all three required negative controls are discriminating and refuse for their intended reason;
- no production/protected Trading Forge file is modified during the scratch grade;
- no Claude subagent/Agent/Task/model execution is used for the mechanical replay;
- existing bootstrap/control-plane tests available to the Worker remain green when executed against the scratch candidate;
- Worker reports exact command output, source hashes, patch hash, and classification.

## Explicitly rejected workarounds

Do not treat any of these as the production fix:

- shortening future ruling filenames;
- shortening worktree names;
- enabling Windows long paths globally;
- removing independent authority verification;
- removing the live GPT authority fetch;
- replacing fail-closed errors with ignore/retry behavior;
- changing `git show` to another `<sha>:<path>` command without proving it avoids the same boundary.

A short next ruling filename may be used only as a temporary bootstrap bridge after this repair is independently proven; it is not the defect repair itself.
