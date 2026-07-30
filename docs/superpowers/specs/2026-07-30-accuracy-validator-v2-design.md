# accuracy-validator v2 — design spec

**Date:** 2026-07-30 · **Approved by operator:** full rebuild + `model: opus` (Opus 5), both
2026-07-30 · **Status:** DESIGN — implementation proceeds under `ratify-packet`
(autonomous class: pre-live, reversible, no live default, no frozen ref invalidated;
independent grade is the gate; operator holds standing veto).

This file is the design AND the staged 5-part packet (§8). It lives in the container now
(container is NOT a git repo — [MEASURED 2026-07-30] `.git` there holds only `info/`);
it is committed into `trading-forge/trading-forge` in the same wave as the change.

---

## 1. Problem (measured 2026-07-30)

- Three divergent on-disk versions of `accuracy-validator.md` exist:
  - **Container** (`trading-forge/.claude/agents/`, 24,743 B, mtime 2026-07-05): only copy
    with the grading-integrity certifier section, body output format, self-verification
    loop, agent memory. Pinned `model: sonnet` until today's operator order (`opus` now).
  - **Git-committed** (last commit `26fa5e52`, 2026-06-23; EOL-identical across campaign
    tree, nested checkout, `runtime-production`, every `wt-*` — ~45 copies): thinner body;
    `charter:`/`mandate:`/`prohibited:`/`output_format:` sit as unknown FRONTMATTER keys
    the loader likely never injects (unverified mechanism — treated as at-risk content,
    resolved by moving everything into the body regardless).
  - No `.agents/` copy (swept).
- Every campaign-seat grade to date loaded the git version: the July discipline arrived
  via dispatch briefs, not the definition. The definition predates ALL July verification
  laws.
- The stale-pin disease is live: a 2026-07-05 `model: sonnet` pin silently downgraded the
  grader whenever a stronger session dispatched it.

## 2. Goals / non-goals

**Goals**
1. One v2 definition that makes any fresh instance behave like the desk's best grader
   WITHOUT relying on the dispatch brief to smuggle in the law.
2. One master copy, versioned, byte-propagated everywhere a seat can dispatch from.
3. A drift tripwire with a path to red.
4. Behavioral proof (trap tests) that v2 catches defect classes v1 misses, and does not
   invent defects on clean claims.

**Non-goals (explicitly OUT of scope)**
- Rewriting the other 10 agent definitions (follow-up class-sweep; the tripwire covers
  their drift already — see §5).
- Committing `.claude/skills/` to git (named follow-up; v2 is self-sufficient by design).
- Any change to gates, backtester, sizing, or other instrument code.
- Retroactive invalidation of prior VERIFIED bands (they stand as issued).

## 3. The v2 definition file

### 3.1 Frontmatter
```yaml
name: accuracy-validator
description: <keep v-container's proactive trigger description + 4 examples verbatim>
model: opus        # operator-ordered 2026-07-30. Alias, not a dated id: tracks newest
                   # Opus (Opus 5 today) instead of rotting like the sonnet pin did.
color: yellow
memory: project
```
No `tools:` key (default = all tools). NOTHING load-bearing in frontmatter beyond these
keys — every rule lives in the body, killing the unknown-key risk class outright.

### 3.2 Body sections (target ≤ ~14 KB total; distilled, not a dump)

1. **Identity & mandate** — auditor of last resort; a claim is true because it was
   measured, not because it was reported; two NON-OVERLAPPING data paths or it is
   UNVERIFIED.
2. **Two modes, one law** — HUNT (false-positive sweep on a system claim) and GRADE
   (certify a delivery band). Same laws; different output contract (§3.2.7).
3. **Grading discipline** (inlined from `grading-integrity`, not referenced-only):
   doer ≠ grader is structural; bands rubric table verbatim (7–8 realistic ceiling, 10 is
   itself a red flag); re-derive from zero, ignore prior scores including its own;
   >1-band jump in one wave without independent re-scan = implausible → UNVERIFIED;
   every band scoped to corpus + battery + engine + snapshot; uncertainty as a bound,
   never a point.
4. **The verification laws** — one line + the convicting incident each (a rule carries
   its reason). The twelve:
   1. Two non-overlapping paths — re-running the other party's query is NOT a second path.
   2. An absence claim owes a POSITIVE CONTROL (plant a known-bad; catch it), an
      enumerated surface, and dynamic reach (`await import` hid a write surface).
   3. The JOIN KEY is the claim — prove the thing measured IS the thing claimed
      (6x-convicted desk failure).
   4. Coverage = the IMPORT CLOSURE, never a name grep (7 vs 145).
   5. Every check must own a path to red — a discriminating fixture that fails without
      the guarded property.
   6. A completion signal is not a result — verify the artifact, not the exit code.
   7. Two true facts do not make a true link — the link is its own claim.
   8. A mechanism claim ("by construction", "cannot happen") gets its own test.
   9. A boundary is proven by what it excludes — name the nearest neighbours kept out.
   10. The surface has a second dimension: the WORKING DIRECTORY. A repo-wide null
       result must state which repo; cross-tree questions use a filesystem sweep;
       `--git-common-dir` (not `--show-toplevel`) discriminates linked worktrees.
   11. Identity decays — PIDs, agent ids, tab ids; walk up from `$PID`, never trust a list.
   12. A caption is a claim — prose, type tags, and comments get graded like code.
5. **Dispatch contract** — what a valid brief gives it: the claim VERBATIM, pinned
   commit/artifact hashes, join keys, a WORKING access recipe (not prohibitions), and an
   explicit novel-false-green hunt request. Its duties when the brief falls short:
   name which claim each restriction makes uncheckable (a restriction in the brief is a
   hole in the result); demand the pin if the head can move; the honest null — "no
   refutation found; here is what I covered and what I could not" — is a complete answer.
6. **Independence rules** — never certify anything it designed, built, or previously
   graded in the same lineage without declaring it; the dispatcher does not interpret the
   grade; if the graded head moves mid-grade, the verdict names the pinned hash it
   describes.
7. **Output contracts** — HUNT: v1's Discrepancy block format (kept verbatim) + the
   clean-report coverage enumeration (what was verified, which sources compared, which
   ids traced, what was NOT verified and why). GRADE: the grading-integrity table row
   (System | Band | Status | Evidence | Open risks) + written reconciliation when
   VERIFIED differs from CLAIMED by >1. Both modes: every load-bearing sentence carries
   its evidence grade (MEASURED HERE / MEASURED BY GRADED INSTRUMENT / ARTIFACT-SOURCED /
   CORROBORATED / RELAYED / HYPOTHESIS / UNENUMERATED).
8. **Self-verification loop** — v1's five checks, plus: every absence claim shows its
   positive-control witness; every "identical/unchanged" claim shows the join key.
9. **Agent memory** — keep v1's instructions; add the caveat that memory accrues in the
   tree it ran in (container dir is primary; worktree memories may vanish with the tree —
   durable findings also go in the report).

Note (2026-07-30, caught by the T2 implementer): §1 renders as the untitled opening
paragraph and §6's independence rules are distributed into §3 (lineage bar) and §5
(pin/verdict-hash duties) — the artifact carries 8 `##` headers, not 9, and the plan's
sanity check counts 8. The dispatcher-side rule "the dispatcher never interprets the
grade" lives in the plan's Task 8 protocol, where the dispatcher is.

## 4. Propagation — one master copy

1. Land v2 in `trading-forge/trading-forge` on the hardening branch via a dedicated
   worktree (worktree-session discipline; never edit the shared checkout directly).
2. Byte-sweep the identical file into: the container copy + every existing live tree's
   `.claude/agents/` (~45 measured today; re-enumerate at execution time — the tree
   population moves daily) + `runtime-production` + `tf-deep-scan` + the nested
   registered worktrees under the repo's own `.claude/worktrees/` (added post-grade:
   the independent grade found 16 stale copies there that the original sweep missed).
3. EOL: the June split was CRLF-vs-LF at checkout (7,362 vs 7,260 B, same content). The
   parity check therefore compares EOL-NORMALIZED hashes; whether to add a
   `.gitattributes eol` pin is decided at plan time (it re-touches checkouts — blast
   radius noted in §8.2).

## 5. Drift tripwire

`scripts/check-agent-parity.ts` (committed with the wave):
- Enumerates every `*/.claude/agents/*.md` under `C:\Users\tonio\Projects` (filesystem
  sweep — law §3.2.4.10), EOL-normalizes, hashes, and compares each agent's copies
  against the git master.
- RED on: any divergence, a missing container copy, or zero copies found (absence guard).
- **Path to red (law 5):** `--self-test` plants a mutated copy and routes it through
  the REAL walker+scan pipeline (not a bypass hash): the plant must be flagged, and a
  post-cleanup rescan must show it cleared — both halves, tripwire-style; a stale plant
  dir fails loud. (Strengthened 2026-07-30 after the Task-3 review found the original
  bypassed the walker, so a walker regression could not fail the self-test.) A
  self-test that cannot fail is rejected in review.
- **Independent census (F-1 fix, post-grade 2026-07-30):** the independent grade
  falsified "swept everywhere" — 16 stale copies sat in registered worktrees under
  the repo's own `.claude/worktrees/`, invisible to sweeper AND checker because both
  shared one hand-copied walker that never descended into `.claude` (and MAX_DEPTH 4
  cut the nesting). Fix: both walkers descend into `.claude` with MAX_DEPTH 6, and
  the checker additionally runs a structurally different second enumerator (plain
  bounded file census, no `.claude` special-case, own depth bound) and goes RED with
  `CENSUS MISS` on any copy the scan walker failed to reach. A checker may never
  share its sweeper's enumerator — that is the audit-population law applied to our
  own tooling. The self-test exercises BOTH mechanisms: half 1 plants a mutated
  copy the walker must flag as DRIFT; half 2 plants a stray copy outside any
  `.claude/agents` dir — structurally invisible to the walker — that the census
  must flag as CENSUS MISS (added after the F-1 fix review found the census had no
  path to red of its own). Stated domain of the whole guard: copies under
  `C:\Users\tonio\Projects`, outside the SKIP set; both enumerators honor that
  same boundary BY DESIGN, so a copy inside a SKIP dir or outside the root is
  invisible to both — that is the guard's declared edge, not a blind spot it
  claims to cover.
- Covers ALL agent definitions (cheap class-level drift coverage) even though only
  accuracy-validator's CONTENT is rebuilt in this wave.
- Wiring into the nightly rail job list is decided at plan time; manual invocation is
  the floor.

## 6. Trap tests (behavioral red-proof of the upgrade itself)

Four fixture briefs, staged under `docs/superpowers/specs/fixtures/av2/`, each a
self-contained claim + artifacts:

- **T1 coverage-by-grep:** "all consumers updated" backed by a name grep; a
  dynamically-imported consumer is planted unupdated. v2 must catch (law 4 + 2).
- **T2 absence-without-control:** "no write surface exists" while an `await import`
  conceals one. v2 must run/demand the positive control and find it (law 2).
- **T3 join-key mismatch:** evidence measures neighbouring object A; the claim is about
  B. v2 must convict the key, not the values (law 3).
- **T4 clean control:** a genuinely true claim with full receipts. v2 must certify it
  clean — no invented defects (false-positive half).

Protocol: dispatch the OLD definition (from any un-swept tree, pinned) on T1–T4 and
record verdicts; dispatch v2 on the same fixtures. **Acceptance: v2 goes 3/3 caught +
1/1 clean.** The old agent's verdicts are the comparison receipt, not a gate (if old
catches some, fine — v2's bar is absolute). Fixtures persist as the definition's
regression suite: rerun after ANY future edit to the file.

## 7. Landing protocol

Ratify-packet agent-loop: scope-locked implementer (fresh worker agent) builds §3–§6 →
fresh accuracy-validator instance grades the wave (it did not design or build it;
structural independence holds) using the trap-test receipts + its own two-path checks →
external GPT read of the v2 definition attached as `[EXTERNAL OPINION]` before the
packet closes → post-hoc plain-English receipt to the operator. Designer (this session)
and builder both disqualified from grading.

## 8. The 5-part packet (staged receipt)

1. **What & why now** — grader definition stale since 2026-06-23 in every dispatchable
   tree; three-way version drift; stale model pin. Receipts: hash sweep + `git log
   --follow` (3 commits, last `26fa5e52` 2026-06-23) + frontmatter diff, all measured
   2026-07-30 this session. Operator ordered best-engineering rebuild + Opus.
2. **Blast radius** — grading pipeline only. No frozen ref invalidated; prior VERIFIED
   bands stand as issued (graded by v1 — recorded, not re-litigated). New grades cost
   Opus rates (operator-ordered). If §4.3 opts into `.gitattributes`, checkouts re-touch
   — decided at plan time, default NO. Sweep blast radius: applying the sweep
   dirties existing worktrees' `git status` with the canonical agent file; seat
   PRs should commit it (it is canonical) or `git checkout --` it — never
   hand-edit it.
3. **Exact change, scope-locked** — `.claude/agents/accuracy-validator.md` (git master +
   byte-sweep of copies), `scripts/check-agent-parity.ts`, `docs/superpowers/specs/`
   (this spec + fixtures). OUT: other agents' content, skills-to-git, gates/engine/any
   measured value.
4. **Verification plan** — trap tests §6 (3/3 + 1/1), parity check GREEN over live
   population + RED self-test, loader sanity (dispatch v2 once; confirm the system-prompt
   listing renders from the new description), independent grade §7.
5. **Rollback** — old versions preserved at pinned hashes (`746ee136…` container,
   `d785541b…`/`ec117292…` checkouts); single-file revert + re-sweep restores any tree in
   one command; no data, schema, or gate is touched.

## Self-review (2026-07-30)

Placeholders: none open — §4.3/§5 wiring decisions are explicitly deferred TO PLAN TIME
with defaults named, not TBDs. Consistency: §3.1 no-tools-key matches §3.2 body-only
law placement; §6 acceptance matches §8.4. Scope: single wave, one agent's content +
class-level tripwire — within one implementation plan. Ambiguity: "everywhere" is
enumerated (§4.2) with re-enumeration ordered at execution time.
