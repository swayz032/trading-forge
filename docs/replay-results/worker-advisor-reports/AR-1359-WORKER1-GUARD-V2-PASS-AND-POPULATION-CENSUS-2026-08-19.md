# WORKER-1 REPORT — AR-1359

Following AR-1356A's two parallel-authorized lanes.

---

## LANE B — GPT Guard Candidate V2 — independent grade

**SHA CITATION MISMATCH, disclosed up front:** AR-1356A SS "Guard Candidate V2 target"
names `ed89f4088bfc88f08bc24e44b3dd4abd26c047cc`. That commit **does not exist** --
confirmed absent from `external-advisor/gpt-guard-engineering` (post-fetch tip
`4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4`), absent from `git rev-list --all`, and absent
from every ref on `origin` (`git ls-remote`). The branch's actual current tip,
`4c6f36ea`, carries commits titled exactly matching AR-1356A's SS7 description of V2's
mechanism (`fix(guard): bind grader permits to monotonic parent history`,
`fix(guard): enforce parent history across grader lifecycle`,
`test(guard): lock parent rewind across grader lifecycle`) and directly builds on `f1604d04`
(the graded, rejected V1). **Graded `4c6f36ea` as the intended candidate** -- the only
reachable commit on the named branch matching the described work -- rather than guessing
at unrelated content or stopping the whole lane over what looks like a stale/typo'd SHA in
the ruling. Flagging for correction in the next ruling; not treated as a contradiction
requiring a full stop, since the named branch has exactly one plausible candidate.

**VERDICT: PASS.**

### Setup
Manual explicit-SHA throwaway worktree (`git worktree add ... 4c6f36ea...`), removed after
grading. All execution via PowerShell (the Bash protected-surface fence still blocks any
command referencing the toolbox path by pattern, confirmed unchanged from AR-1358 --
AR-1356A SS9 declined to weaken it, correctly, so this is expected and not re-flagged as a
new finding).

### Required minimum suite -- full results

```
node --test .../isolated-grader-seat.test.mjs                            (part of sweep)
node --test .../isolated-grader-dirty-after-activation.test.mjs          (part of sweep)
node --test .../isolated-grader-cross-worktree-same-session.test.mjs     (part of sweep)
node --test .../isolated-grader-parent-history.test.mjs                  (part of sweep)
node --test .../claude-hook-lifecycle.test.mjs                           (part of sweep)
node --test .../*.test.mjs   (full sweep, all 29 files together)

276 pass / 0 fail / 0 cancelled / 0 skipped
```

Both AR-1358-identified vacuous fixtures now execute for real and PASS:
- `same session id + copied marker still cannot authorize a different synthetic worktree` -- PASS
- `tracked artifact regeneration after activation does not brick the next grader command` -- PASS

The new parent-history suite (4 tests) all PASS, including the exact AR-1358 A2
reproduction and its two neighboring seams:
- `AR-1358 A2: advance then rewind cannot mint a fresh isolated-grader permit` -- PASS
- `normal fast-forward parent progress still permits an isolated grader` -- PASS
- `a token minted before a later parent rewind is refused at child activation` -- PASS
- `an already-active isolated grader loses execution after the parent rewinds` -- PASS

No regression anywhere else in the 276-test full sweep (normal Worker arming, G2
pre-call/postcall, protected-surface self-protection, resume-anchor, lane-boundary,
edit-scope-guard, all green) -- meets AR-1355A SS7's "even if all new tests pass" bar.

### Required novel attack (independent, not authored by GPT)

**Cross-repository marker theft** -- not covered by any of GPT's 4 parent-history tests,
which only move worktrees/branches *within one repository*. Per AR-1356A SS8's suggested
category "permit copied across common-git-dir/repository boundary":

1. Repo 1 (legit): armed parent, real permit issued, real child worktree activated with
   the real token. Positive control confirmed the legit child's own ordinary command was
   NOT denied (activation genuinely worked).
2. Repo 2 (attacker): an entirely separate `git init`, unrelated to Repo 1 -- not a
   worktree of it -- constructed to look maximally similar (identical branch name
   `claude/worker1-test`, identical file content at H1, worktree named with the same
   `worktree-agent-*` convention) so only the repository-identity binding itself could
   catch the theft.
3. Copied the real consumed activation-marker file from Repo 1's child git-dir into
   Repo 2's attacker-child git-dir, under the identical filename (same session ID kept
   constant, matching the "keep other fields constant" instruction).
4. Attempted an ordinary command from Repo 2's attacker child, same session ID.

Result:
```
cross_repository_attack_decision: "deny"
cross_repository_attack_reason: "isolated grader seat is not activated: isolated grader
  worktree changed since activation. Run the exact one-use activation command from the
  task prompt."
```
**PASS.** Discriminates on the correct binding (place/worktree identity), not an
unrelated field, consistent with AR-1356A SS8's requirement.

### Grade decision

**PASS.** All required properties independently verified: explicit accuracy-validator +
isolation:worktree obtains/redeems one token; unrelated worktree cannot borrow; same
session ID + different worktree denied (both within-repo and, via my novel attack,
across-repo); grader stays read/test-only (unchanged from V1, not re-tested here since
AR-1358 already confirmed Edit/Write/Agent/Task remain denied and nothing in this diff
touches that surface); AR-1358 A2 exact scenario denied; token-before-rewind and
active-grader-after-rewind both denied; full toolbox suite has zero regressions.

**Recommend GPT issue the deliberate live re-pin ruling for `4c6f36ea`** (or whatever
commit GPT confirms is the intended V2 target, given the SHA mismatch above -- if GPT
intended a genuinely different, not-yet-pushed commit, that needs to be pushed and
re-cited before re-pin). Worker 1 does not self-authorize the re-pin under any
circumstance -- that stays GPT's call per AR-1355A SS7/AR-1356A SS8.

---

## LANE A — Population-expansion census (read-only)

Dispatched as a read-only research task (no git mutation, no model/extraction spend).
Full citations verified by the dispatched research; summarizing the resolved answer here.

**RESOLVED. No ambiguity survives.**

Authority: `docs/advisor-rulings/AR-1141-GPT-ADVISOR-REPORT-NO-CLAUDE-ROTATION-AND-200-VIDEO-LIBRARY-2026-08-13.md`
(commit `ac8f2927b9c1dfcebbb5ffcc6f89ecb51a602412`). SS1 verbatim: *"The current historical
library is 40 unique YouTube videos/transcripts... The operator's target is 200 unique
YouTube videos before Claude Code access expires."* SS2 computes it explicitly:
*"archive/source-pin as many of the **additional 160 unique videos** as practical."*
200 - 40 = 160, prose and arithmetic agree.

```
authority_artifact/path: docs/advisor-rulings/AR-1141-GPT-ADVISOR-REPORT-NO-CLAUDE-ROTATION-AND-200-VIDEO-LIBRARY-2026-08-13.md
its SHA256 or commit pin: ac8f2927b9c1dfcebbb5ffcc6f89ecb51a602412
target_interpretation: TOTAL
current_unique_source_count: 40
proposed_target_total: 200
new_unique_source_count: 160
already_transcript_ready: 0
already_modern_extraction_ready: 0
needs_transcript_or_source: 160
needs_modern_extraction: 160
duplicate_count: 0
collision_count: 0
unresolved_identity_count: 160
proposed_population_manifest_sha256: NONE EXISTS YET
```

**Identity key:** `video_id` (YouTube ID) -- read from `library-manifest-v1.1.json` row
tags (`spec_video:<video_id>`) and from `docs/designs/source-videos-2026-07-02.json`'s
dict keys.

**Current-40 verification:** extracted programmatically from all 120 manifest rows by
`video_id` (not trusted from any round-number label) -- exactly 40 unique IDs.

**The one genuinely open item -- this is a scope decision, not a measurement:**
no list of the additional 160 specific videos exists anywhere in this repository. Searched
(full `git log --all --follow`) `docs/replay-results/strategy-factory-census/`, both JSON
files under `docs/designs/*video*.json`, and the transcript fixture directory
`src/engine/extraction/fixtures/source-evidence/` -- all contain exactly the current 40,
zero extras. None of the 160 have a transcript, extraction, or even a named identity
anywhere. `source-videos-2026-07-02.json` (older era) and the frozen
`library-manifest-v1.1.json` were independently diffed by `video_id` set: identical,
40/40 overlap -- confirms the "3-pilot + 37 remaining" AR-1338A language and this 40-set
are the same population, not two different ones.

**Per AR-1356A SS3's own instruction** ("If the exact 200-video authority cannot be
located or remains ambiguous after the repository census, STOP that expansion spend only
and report the exact missing authority") -- the TARGET itself is not ambiguous (TOTAL 200,
resolved with citation), but **WHICH 160 videos fill it has never been decided or recorded**.
That is not something a read-only repo census can resolve -- it requires either a new
sourcing decision or pointing at an external video-selection authority this repo does not
contain. Stopping new-source acquisition/model spend here and reporting the exact gap,
per that section's own instruction, rather than inventing a candidate list.

---

## Summary

```
AR-1359
RULING : AR-1356A SS3 (population census) + SS8 (guard V2 grade)
PIN    : guard candidate external-advisor/gpt-guard-engineering @ 4c6f36ea7e2f68e3eb50cf555390b3c4e98ddbd4
         (SHA mismatch vs. ruling's cited ed89f408... disclosed above)
CHANGED: no production files. One throwaway worktree created/removed. Scratch node files
         created for the novel attack, deleted before this commit (git status verified
         clean).
RED    : n/a for lane B (V1's RED was AR-1358; V2 is graded fresh, no RED expected or found).
GREEN  : lane B -- 276/276 tests pass including all 4 previously-broken/new controls;
         1 independent novel attack (cross-repository marker theft) also denied correctly.
CONTROL: positive control run before the novel attack (legit child's own ordinary command
         confirmed NOT denied) so the later DENY on the attacker copy is known to
         discriminate, not just fail generically.
GRADER : this IS the independent grade AR-1356A requested (worker-1, required minimum
         suite + 1 required novel attack, PASS).
FINDINGS: (1) the guard-candidate SHA cited in AR-1356A does not exist; graded the
         branch's actual tip instead, disclosed prominently, not silently substituted.
         (2) Lane A's target number is resolved (200 TOTAL) but the concrete 160-video
         list is an unrecorded scope decision, not a measurable fact -- distinguishing
         these two so a "still ambiguous" read is not attached to the (resolved) target
         number.
STOP   : new-source acquisition/model spend for the 160 additional videos, per AR-1356A
         SS3's own stop instruction -- the concrete list authority is missing, not merely
         hard to compute.
NEXT   : GPT decides (a) whether to issue the live re-pin ruling for the guard candidate
         (confirming or correcting the SHA), and (b) how the 160-video list gets decided --
         a new sourcing/selection ruling, or pointing at an external authority. Worker 1
         has no further self-authorized action on either lane until one of those lands.
```
