# classifier-fix packet — provenance note (R-210 §1)

## What is in this directory

| artifact | what it is |
|---|---|
| `premise-audit-arrival-paths.json` | the PREMISE AUDIT, run before any code changed: per-row arrival path (sole hit / precedence win / unmatched default) for all 249 classifier-routed rows on both corpora, plus the founding-instance probes that located each fixture row **by row** before it became a test |
| `classifier-fix-delta.json` | per-family before/after delta + full transition matrix + every moved row. The BEFORE arm is the vaulted pre-change module re-executed in-process, not a carried-over number |
| `ladder-recomputed.json` | the tier-A unlock ladder, both arms re-derived here |

All figures are **HYPOTHETICAL**: production flags are OFF and no `.spec.json`
on disk was rewritten. The 77 sealed corpus was not touched.

## ★ COMMIT-PROVENANCE ANOMALY — read this before trusting `git log` for this packet

The packet landed as commit **`ca494af6`**, whose message carries the full
measurement record (arrival-path counts, the corrected mechanism finding, the
derived unsafe-stem set, the ladder collapse, and the three deliberate
tripwires).

**That commit is no longer on the branch.** Roughly one minute after it landed,
a concurrent session in this shared tree ran `git commit --amend`, which
amended *my* commit — replacing it with **`fec03722` "WIP multi-axis caption
gate"**. The reflog records it:

```
fec03722 h1-wave4-sealed12-driver@{1}: commit (amend): WIP multi-axis caption gate
ca494af6 h1-wave4-sealed12-driver@{2}: commit: H1 classifier fix (R-210 §1) ...
a4565794 h1-wave4-sealed12-driver@{3}: commit (amend): WIP multi-axis caption gate
```

**Content impact: NONE.** All six files were verified byte-identical between
`ca494af6` and the post-amend HEAD. The amend absorbed the work rather than
discarding it.

**Record impact: REAL.** `fec03722` now contains this packet's six files *plus*
the other session's `dual_denominator_remeasure.py`, all under the caption
*"WIP multi-axis caption gate"* — a message that describes neither the classifier
fix nor its measurements. ★ **This is the caption-is-a-claim disease in commit
form: the diff and its stated subject no longer correspond.** It is also the
exact failure the house `git commit -o <paths> -F <msgfile>` rule exists to
prevent — but `-o` protects the *committer*, and nothing protects a landed
commit from someone else's `--amend`.

**Standing implication worth minting:** in a shared tree, `git commit --amend`
is not a private operation. It rewrites whatever commit happens to be HEAD,
which may belong to another agent. The `-o` discipline must be paired with
*never amending a commit you did not author* — verify `git log -1 --format=%s`
is your own subject before amending.

The original message survives only in the dangling object `ca494af6`
(`git show ca494af6`), which will be lost to garbage collection. This note and
the packet's final report are the durable record.
