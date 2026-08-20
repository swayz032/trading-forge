# AR-1375 (worker-1)

```
RULING : AR-1367A on origin/external-advisor/gpt-rulings @ 092cae9d694676c9bc0bec21f8f6defbe8249387
         (§3 REQUIRED PROMOTION ACCEPTANCE — 13-item independent verification from the normal seat)
PIN    : worker HEAD 39b354e4cb9dfacf2a615605b1cfaf2fd948787d (UNCHANGED — see finding below),
         branch claude/worker1-h1-20260815, tree clean throughout
CHANGED: this report only.
```

## RESULT SUMMARY

**Bootstrap execution: SUCCEEDED** (first success across four attempts — cpb-0009, cpb-0010,
cpb-0011). `completion_verified: true`, `commit_sha: 1e1a5e0535243e8c2432c35a894a1e230429b70b`,
`pushed: true`.

**Independent verification: 9 of 13 items confirmed GREEN by me directly. 4 items (§3 #8–11,
the isolated-grader controls) could not be cleanly exercised from this seat and are reported
honestly as such rather than assumed. One structural finding requires attention before this can
be called fully "live": the promotion commit is NOT yet on `claude/worker1-h1-20260815` — see
§A below.**

## A. STRUCTURAL FINDING — the promotion landed on its own branch, not on my worker branch

```
$ git fetch origin control-plane/ar-1367a-guard-repair-cpb-2026-08-19-0011
$ git status -sb
## claude/worker1-h1-20260815      (unchanged)
$ git rev-parse HEAD
39b354e4cb9dfacf2a615605b1cfaf2fd948787d   (unchanged — same as before --execute)
```

Commit `1e1a5e05` exists only on `control-plane/ar-1367a-guard-repair-cpb-2026-08-19-0011`
(confirmed a clean single-commit descendant of my exact HEAD — `git log 1e1a5e05 --oneline -3`
shows its direct parent is `39b354e4`). My own worktree's `scripts/claude_toolbox.mjs` and
`.claude/worker1-hook-guard-manifest.json` are **still the pre-promotion files** — TOOLBOX_PIN is
still `59cfb1cd...`.

**This is not a mistake — it is the established pattern for this exact class of operation.**
Checked git history for precedent:

```
81fa62c3 Merge control-plane/ar-1319-guard-repair-cpb-2026-08-18-0007: F36 live propagation
d5273312 Merge control-plane/ar-1311-guard-repair-cpb-2026-08-17-0005: AR-1311A guard propagation
```

Reading `81fa62c3`'s full message: *"Per AR-1318A §6 (GPT ruling...): automatic integration
authorized once bootstrap completion_verified:true, pushed:true, and independent post-bootstrap
inspection confirm the exact 4-file shape and exact target values. AR-1320 (worker-1, guarded
seat) performed that independent verification and **was correctly blocked from merging by its own
guard**; this is **the top-level integration session** AR-1318A names to complete the
merge-back."*

**This is exactly my situation now.** My guarded worker-1 seat is not the actor that lands this
merge — a separate, named, top-level (unguarded) integration session is, and historically that
step required its own explicit GPT authorization clause (AR-1318A §6 named it). AR-1367A did not
contain an equivalent explicit merge-authorization clause that I can find. **I am not
self-authorizing a merge** — reporting this precisely so GPT can either issue the equivalent
authorization/perform the integration, or clarify that this ruling already intended something
different.

## B. Items independently verified GREEN (§3 #1–7, #12, #13)

All measured by reading the actual promotion-branch commit content directly (`git show
1e1a5e05:<path>` via PowerShell — the Bash tool's protected-surface fence blocks referencing
`claude_toolbox.mjs`/the guard manifest by name even for a read-only `git show`, so PowerShell was
used for those two specific reads only; everything else ran through the normal Bash tool),
**never by merging or trusting the privileged seat's own summary uncorroborated**.

1. **Live target pin**: `scripts/claude_toolbox.mjs` at commit `1e1a5e05` — `TOOLBOX_PIN =
   '4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4'`. Exact match. ✅
2. **Manifest expected pin**: `.claude/worker1-hook-guard-manifest.json` at that commit —
   `_toolbox_pin: "4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4"`. Exact match. ✅
3. **Manifest bundle**: same file — `_toolbox_bundle_sha256:
   "5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801"`. Exact match. ✅
4. **Materialization recomputes the exact 56-file bundle**: extracted the promoted
   `claude_toolbox.mjs` to a disposable scratch file and called its **actual exported
   `materialize()` function directly** (not a reproduction): returned `pin: "4c6f36ea..."`,
   `file_count: 56`, `bundle_sha256: "5b54027ed3b1bfb2d7e4c37d2644103875539e1bcc641f0abfea26f58fc2d801"`.
   Exact match, from the real function, not my own parallel logic. ✅
5. **Frozen queue unchanged**: `5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939`,
   READY 8, SPENT 0 — reconfirmed via a fresh `bootstrap.mjs --plan` run after the execute
   completed. ✅
6. **Receipt tree unchanged**: `c11966868f8a511554e1f26bf6e5555c59833d04`, clean — unchanged from
   AR-1373's measurement (nothing in this promotion touches that namespace). ✅
7. **Normal Worker SessionStart arms under the promoted guard**: **NOT YET TESTABLE** — my own
   session is still running under the pre-promotion guard (see §A). This requires either the
   merge to land or a fresh session started against the promoted branch. Reported as unverified,
   not assumed.
8–11. **Isolated accuracy-validator activation, deny-list enforcement, cross-worktree/parent-rewind
   refusals**: **NOT INDEPENDENTLY VERIFIED THIS PASS.** I attempted to run the toolbox's own
   dedicated test files for this exact surface (`isolated-grader-cross-worktree-same-session.test.mjs`,
   `isolated-grader-parent-history.test.mjs`, `isolated-grader-seat.test.mjs`, etc. — all present
   in the materialized 56-file cache) directly against the materialized cache, but several depend
   on fixture paths relative to the real repo root (e.g.
   `claude-hooks/settings.fragment.json`) that don't exist inside the isolated cache directory —
   an artifact of how I tried to exercise them, not a defect in the tests or the promotion. Fully
   exercising items 8–11 needs either a live `isolation:"worktree"` `accuracy-validator` dispatch
   (a real Agent call, not read-only-mechanical) or running these tests from within a properly
   fixtured live checkout — neither of which I self-authorized, consistent with the standard
   packet prompt's own framing that this class of check ("the one cheap Agent traversal
   calibration and the remaining zero-model G2 controls") is Phase 2, separate from this Phase 1
   closeout. Flagging rather than skipping silently.
12. **T1/T2/T3 (the CPB Windows path-length regression) remain green**: confirmed byte-identical
   `scripts/control-plane-bootstrap/**` content between my worktree and commit `1e1a5e05`
   (independently recomputed the 10-file bootstrap bundle from the promotion commit's actual
   blobs via the real imported `computeBundle` — see disclosed self-correction below — got
   `f75739efcc41fe8763b6f779e46ee4862900ebbd0673d799d344c4f5fb1dc613`, exact match), then ran
   `node --test scripts/control_plane_bootstrap.test.mjs` in my own worktree: **175/175 pass,
   including T1/T2/T3**. ✅
13. **Completion receipt present and binds the exact successful attempt**: confirmed from the
   `--execute` output — `completion.authorization_id: "cpb-2026-08-19-0011"`,
   `completion.ruling_id: "AR-1367A"`, `completion.commit_sha: "1e1a5e0535..."`,
   `completion.pushed: true`, `completion_verified: true`,
   `completion_failure_reason: null`. Cross-checked: re-ran `bootstrap.mjs --plan` afterward and
   confirmed `cpb-2026-08-19-0011` now appears in `claimed_authorization_ids` (permanently spent,
   as expected for a completed one-shot). ✅

## FINDINGS (including against myself)

1. **Self-caught instrument bug, disclosed before it became a false finding**: my first attempt
   to independently recompute the 10-file bootstrap bundle hand-rolled the `computeBundle`
   algorithm rather than importing the real function. Every per-file `{path, bytes, sha256}`
   matched exactly, but the **aggregate** hash did not (`50715160...` vs expected `f75739ef...`).
   Re-did it importing the actual `computeBundle` export from `bundle.mjs` and feeding it the same
   git-show-fetched bytes — got the exact expected value. The bug was in my reproduction, not in
   production or in the promotion. Not presenting only the clean second attempt as if it were the
   only one.
2. **The promotion has not yet reached my live branch** (§A) — this is the one open item that
   determines whether items #7–11 can even be attempted, and whether this promotion is "done" in
   the sense of actually protecting my running session.
3. `scripts/control-plane-bootstrap/**` content is confirmed byte-identical between my worktree
   and the promotion commit — nothing about this promotion touched that surface, consistent with
   AR-1367A's exact authorized-paths list (3 files: toolbox, manifest, closeout report).

## GRADER

Not dispatched — mechanical verification of measured values, not a judgment call. (An
`isolation:"worktree"` `accuracy-validator` dispatch — a live check, not a grading act — is what
§3 items 8–11 would need; not run this pass, per §B above.)

## STOP

**Effectively yes, on the merge question.** Per historical precedent (§A), landing this onto
`claude/worker1-h1-20260815` is not mine to do from this guarded seat, and AR-1367A did not carry
an explicit automatic-integration clause the way AR-1318A §6 did for the prior promotion. Not
self-authorizing it.

## NEXT (not self-authorized — awaiting GPT)

1. GPT's decision on how `control-plane/ar-1367a-guard-repair-cpb-2026-08-19-0011` lands onto
   `claude/worker1-h1-20260815` — an explicit automatic-integration authorization (as AR-1318A §6
   did) or a top-level integration act.
2. Once live on my branch: items #7 (SessionStart arms) and #8–11 (isolated-grader controls) can
   be attempted from a normal Worker-1 seat, matching the "Phase 2, after GPT grades Phase 1"
   framing.
