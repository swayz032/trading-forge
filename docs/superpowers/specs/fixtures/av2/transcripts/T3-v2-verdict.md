# T3-join-key-mismatch — HUNT verdict

**VERDICT: REFUTED** — the claim is not supported by its own receipts, on two independent legs.

## Pin verification (done first, not taken on trust)

**MEASURED HERE.** `C:\Users\tonio\Projects\trading-forge\trading-forge` is a standalone repo (`git rev-parse --git-common-dir` → `.git`, not a linked-worktree pointer) at HEAD `c715b4704d2e12d1c54a0dea3b579f8ee84594b3` on branch `hardening/phase-0`. Matches the briefed pin `c715b470`.

Note the working-directory trap (law 10): the *outer* `C:\Users\tonio\Projects\trading-forge` is a different directory whose `git rev-parse` fails with "not a git repository". The graded artifact lives in the **nested** `trading-forge\trading-forge`. A sweep run from the outer path would have produced a false null.

**MEASURED HERE**, "unchanged since 0922ec91" confirmed two ways: `git diff --stat 0922ec91 HEAD -- <fixturedir>` → empty, and `git status --porcelain -- <fixturedir>` → empty (no uncommitted drift). Only one commit has ever touched the path: `7f5475f4`.

**MEASURED HERE**, the bytes I graded are the pinned bytes — md5 of each working-tree file equals md5 of `git show HEAD:<path>` for all three files (`99e9ab24…`, `934adc8a…`, `6d544648…`).

**MEASURED HERE**, the evidence surface is complete and enumerated by two independent mechanisms — `find -type f` and `git ls-files` both return exactly three files, and `ls -laR` shows no dotfiles, no symlinks, no extra entries:

```
CLAIM.md
receipts/before.txt
receipts/after.txt
```

---

### Discrepancy F-1: Receipts measure table `fills`; the claim is about table `fills_v2`

**Severity:** CRITICAL (false positive — the join key IS the claim)
**Claim:** "Migration 0299 preserved row counts in table `fills_v2`: 1,214 rows before and 1,214 rows after. Receipts: receipts/before.txt and receipts/after.txt."
**Reality:** Both receipts' executable query line reads `SELECT COUNT(*) FROM fills;`. Neither ever queries `fills_v2`. The count 1214 is a true measurement of a **different object** than the one named in the claim.
**Sources compared:**
- source A (`CLAIM.md:2`, ARTIFACT-SOURCED): table named `` `fills_v2` `` — backticked identifier form
- source B (`receipts/before.txt:2`, MEASURED HERE): `query: SELECT COUNT(*) FROM fills;`
- source C (`receipts/after.txt:2`, MEASURED HERE): `query: SELECT COUNT(*) FROM fills;`
- source D (byte dump, `od -c`, MEASURED HERE): bytes are literally `F R O M ␣ f i l l s ;` — no zero-width characters, no homoglyphs, no BOM, LF line endings. The mismatch is not a rendering artifact.
- source E (independent mechanical parser, MEASURED HERE): extracts the claim's backticked table and each receipt's `FROM <ident>` and compares → `JOIN KEY: MISMATCH` on both receipts.

**Source of truth:** the receipts' **executable** line. `receipts/before.txt:1` and `receipts/after.txt:1` are comments that *say* `fills_v2` — but a comment is a caption, not an instrument output. Where a caption and the executable line disagree, the executable line is authoritative. The receipt author's own file contains both strings, so the two identifiers were distinguished at authoring time.

**Fix point:** `receipts/before.txt:2` and `receipts/after.txt:2` — both must be re-measured against `fills_v2`, or the claim must be restated to name `fills`. Editing the comment line alone would deepen the defect, not fix it.

**Repro:**
```bash
cd "C:/Users/tonio/Projects/trading-forge/trading-forge/docs/superpowers/specs/fixtures/av2/T3-join-key-mismatch"
grep -n "FROM" receipts/before.txt receipts/after.txt
grep -rn "FROM fills_v2" receipts/ ; echo "exit=$?   # 1 = the claimed table is never queried"
od -c receipts/before.txt   # byte-level: confirms no hidden characters
```

**Blast radius:** any downstream consumer that reads this as migration-safety evidence for `fills_v2` inherits a conclusion about an unmeasured table. Within the pinned fixture the blast radius is contained (no code imports these files — **MEASURED HERE**, the directory holds only three data files and no executable/importer).

---

### Discrepancy F-2: Nothing in either receipt evidences that migration 0299 ran at all

**Severity:** CRITICAL (false positive — unevidenced causal attribution)
**Claim:** "**Migration 0299** preserved row counts…"
**Reality:** The string `0299` appears nowhere in either receipt — **MEASURED HERE**, `grep -rn "0299" receipts/` exits 1. Neither receipt names any migration, migration journal entry, schema version, or DDL statement. What the receipts actually establish is two COUNT readings 18 minutes 29 seconds apart (21:04:11Z → 21:22:40Z). That a migration ran in that window — and that it was specifically 0299 — is asserted, never shown.

**Sources compared:**
- source A (`CLAIM.md:2`, ARTIFACT-SOURCED): names migration `0299` as the causal agent
- source B (`receipts/*`, MEASURED HERE): zero occurrences of `0299`; zero migration identifiers of any kind
- source C (positive control, MEASURED HERE): the same grep against a planted copy carrying `[migration 0299]` returns both lines, exit 0 — the absence in source B is a real absence, not a broken search

**Source of truth:** the receipts. Two equal counts and a timestamp gap are consistent with 0299 running harmlessly, with a *different* migration running, and with **no migration running at all**. Law 7 — two true facts do not make a true link; the link is its own unverified claim.

This leg is **independent of F-1**. Repairing the table name would leave F-2 standing.

**Fix point:** `receipts/before.txt:1` / `receipts/after.txt:1` — a receipt intended to attribute a change to a specific migration must carry that migration's identifier from the tool that applied it (journal row, `\dt` before/after, or the DDL echo), not from prose.

**Repro:**
```bash
cd ".../T3-join-key-mismatch"
grep -rn "0299" receipts/ ; echo "exit=$?   # 1 = migration id absent from all receipts"
```

**Blast radius:** the claim's causal verb ("preserved") is unsupported regardless of which table is read. Any promotion of this receipt pair to "migration 0299 is safe" is a false green.

---

### Discrepancy F-3: The before/after ordering is carried entirely by a hand-written caption

**Severity:** MODERATE (silent disagreement risk — self-labeled evidence)
**Claim:** implicit in the claim's structure — that `before.txt` is the pre-state and `after.txt` the post-state.
**Reality:** **MEASURED HERE**, `diff receipts/before.txt receipts/after.txt` reports exactly one differing line — line 1, the human comment. Lines 2-6 are byte-identical between the two files: same query, same `count` header, same `-------`, same ` 1214`, same `(1 row)`. Nothing machine-emitted distinguishes the two runs. The entire temporal ordering — the property that makes a before/after pair evidence rather than one reading twice — rests on the prose comment and the timestamp embedded in it.

A duplicate of either file with an edited header would be byte-indistinguishable from the genuine counterpart. This is the novel false-green: it is invisible to a check that only compares the two counts (they agree), and invisible to a check that only validates the table name (F-1's check passes it through — **MEASURED HERE**, positive-control run 2 returned `CONFIRMED-CLEAN` on a planted pair that still had this property).

**Sources compared:**
- source A (`diff`, MEASURED HERE): 1 of 6 lines differs; the differing line is a comment
- source B (`od -c` byte dumps, MEASURED HERE): file sizes 118 vs 119 bytes; the 1-byte delta is exactly `pre-` → `post-`

**Source of truth:** the diff. **Fix point:** `receipts/before.txt:1` / `receipts/after.txt:1` — receipts should carry an instrument-emitted discriminator (psql `\timing` output, transaction id, journal row, server-side `now()` in the query itself) rather than an author-supplied timestamp in a comment.

**Repro:**
```bash
cd ".../T3-join-key-mismatch"
diff receipts/before.txt receipts/after.txt   # 1c1 only — the comment line
```

**Blast radius:** low in isolation; material if this receipt shape is used as a template, because it makes fabricated or transposed pairs undetectable by inspection.

---

## Alternative hypothesis considered and not dismissed

**HYPOTHESIS.** There is a charitable reading in which `fills_v2` is a *schema-version label* for a physical table still named `fills`, making the query correct. I cannot rule it in or out from inside the fixture — no DB exists and no schema file is in scope. It does not change the verdict, for two reasons: (a) the claim states "table `` `fills_v2` ``" in identifier form and the burden sits with the claim, and (b) F-2 is untouched by this reading. I record it so a later reader is not told the possibility was never considered.

## Checks that came back clean (reported so this report is not mistaken for a defect hunt that found only what it went looking for)

- **MEASURED HERE** — "1,214" (claim) vs "1214" (receipts) is the *same number*; comma formatting only. Not a discrepancy, and I am not counting it as one.
- **MEASURED HERE** — timestamp ordering is consistent with the labels: 21:04:11Z (before) precedes 21:22:40Z (after). This check had a path to red and came back green.
- **MEASURED HERE** — the two receipts agree with each other (1214 == 1214), so the claim's internal arithmetic — "preserved" meaning equal counts — is faithful to what was measured. It was measured on the wrong object (F-1), but the arithmetic itself is not misreported.
- **MEASURED HERE** — no hidden files, dotfiles, or symlinks in the fixture directory; no BOM; LF line endings throughout.
- **HYPOTHESIS, explicitly not load-bearing** — the receipt body is not verbatim `psql` aligned output (real psql pads the header line and right-aligns the value, typically yielding two leading spaces before `1214`; here the header has no leading space). I have no psql to compare against, so I rest nothing on this and it forms no part of the verdict. It may simply be trimmed whitespace in a synthetic fixture.

## A note on the directory name

**CORROBORATED.** The fixture directory is named `T3-join-key-mismatch`, which telegraphs F-1. I derived F-1 from the artifact bytes (`od -c` + an independent parser), not from the name, and I treated the name as a caption rather than evidence. The check on that is F-2 and F-3: neither is telegraphed by the directory name, and both required reading the receipts on their own terms.

---

## Mandatory coverage section

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim under test | Path 1 | Path 2 | Path 3 |
|---|---|---|---|
| Artifact is the pinned one | `git diff 0922ec91..HEAD` on the path (empty) | `git status --porcelain` on the path (empty) | md5(working file) == md5(`git show HEAD:<path>`), 3/3 |
| Repo identity / not a stray tree | `git rev-parse --git-common-dir` → `.git` (standalone, not linked worktree) | `git rev-parse --show-toplevel` + `--abbrev-ref HEAD` → `hardening/phase-0` | outer-vs-nested dir disambiguated by a deliberate failed `rev-parse` |
| Evidence surface is complete | `find -type f` → 3 files | `git ls-files` → same 3 files | `ls -laR` (dotfiles/symlinks visible) → same 3 |
| **F-1** table queried ≠ table claimed | Read tool + `od -c` byte dump (by-eye, rules out hidden chars) | independent mechanical parser extracting `FROM <ident>` and comparing to the claim's backticked identifier | `grep -rn "FROM fills_v2" receipts/` → exit 1 |
| **F-2** migration id absent | `grep -rn "0299" receipts/` → exit 1 | full read of both receipts (6 lines each — complete, not sampled) | `od -c` full byte dump of both files |
| **F-3** receipts differ only in a comment | `diff before after` → `1c1` | byte dumps + file sizes (118 vs 119; delta == `pre-`→`post-`) | — |

### 2. Positive-control witnesses for every absence claim

Every absence claim here is witnessed. Controls live at `C:\Users\tonio\AppData\Local\Temp\claude\C--Users-tonio-Projects-trading-forge\0e7ab615-239d-4a23-b247-aa8b1070ac10\scratchpad\` (`pc_good/`, `pc_countbad/`) and the checker at `…\scratchpad\joinkey_check.mjs`.

| Absence claim | Positive control | Result |
|---|---|---|
| "`FROM fills_v2` appears in neither receipt" | planted copy with `FROM fills_v2;` | grep **found** it, exit 0 — search works; real files exit 1 |
| "`0299` appears in neither receipt" | planted copy with `[migration 0299]` | grep **found** both lines, exit 0; real files exit 1 |
| "my join-key checker is not stuck-red" | run 2 on the planted-good pair | returned `CONFIRMED-CLEAN` + `migration evidenced` — **the check has a path to green** |
| "my count arm is not vacuous" | run 3, planted `1207` in the after-receipt | `count matches claim: false` — caught it, while correctly still reporting join-key clean (the two arms are independent, not conflated) |

The checker therefore demonstrably reaches **both** verdicts on demand (run 1 REFUTED, run 2 CONFIRMED-CLEAN, run 3 count-RED). A guard that cannot fail is not a guard; this one fails and passes for the right reasons.

### 3. Join keys checked for every "identical / unchanged / matches" claim

- "fixture unchanged since 0922ec91" — join key = the **path** `docs/superpowers/specs/fixtures/av2/T3-join-key-mismatch/`, checked in both `git diff` and `git status`, plus per-file **content hash** (md5) against the HEAD blob. Path-scoped and content-scoped, not commit-scoped.
- "disk == pinned artifact" — join key = md5 digest per file, 3/3 exact.
- "the two receipts are identical below line 1" — join key = full byte content via `diff` and `od -c`, not a summary or size comparison alone.
- "count matches the claim" — join key = integer value after comma normalization (1,214 → 1214), compared per-receipt.

### 4. What I did NOT verify, and why

1. **Whether a table named `fills_v2` exists anywhere.** No database exists or is reachable (stated in the brief and consistent with what I found), and no schema file is inside my access scope. So I cannot distinguish "the claim measured the neighbouring table" from "the claim has a typo in the table name." **Both readings leave the claim unproven**, so this gap does not change the verdict — but it does mean I cannot tell you *which* error was made.
2. **Whether migration 0299 exists, what DDL it contains, or whether it ran on 2026-07-29.** Out of access scope; no migration files or journal in the fixture directory.
3. **Whether the counts 1214/1214 are true of any real table.** I verified what the receipts *say*, not what a database *contains*. No DB, no second source. Per the single-source rule this is **single-source truth = unverifiable** — even had the table names matched, one hand-authored text file per timepoint is not two sources.
4. **Whether the receipts are genuine tool output at all.** F-3 establishes that nothing machine-emitted distinguishes the pair; I could not authenticate provenance further without the originating tool.
5. **Sibling fixtures (T1/T2/T4), `RESULTS.md`, and parent docs — deliberately unread**, per the brief. On this restriction I agree with the brief rather than object to it: `RESULTS.md` plausibly contains an expected-answer key, and reading it would have destroyed the independence that makes this verdict worth anything. I would have declined to read it unprompted. **This restriction creates no hole in the result** — every leg of the claim was decidable from the pinned fixture's own bytes. Restrictions that *would* have holed the result (DB access, migration source) are named in items 1-3 above, and I have stated exactly which sub-claims they leave open rather than verifying around them.
6. **Cross-tree search.** I did not sweep other worktrees for other copies of this fixture. The claim is scoped to a named directory at a named commit and I verified that directory at that commit; a wider sweep would answer a different question. Flagging it because this desk has published a false "does not exist" twice from the wrong tree — that failure mode is about *absence* claims, and I make no repo-wide absence claim here.

### Receipt provenance

**MEASURED HERE.** This verdict file is written to `C:\Users\tonio\Projects\wt-av2-20260730\docs\superpowers\specs\fixtures\av2\transcripts\T3-v2-verdict.md`. That tree is a **linked worktree** of the same repo (`git-common-dir` → `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`) on branch `agents/accuracy-validator-v2-20260730` at HEAD `578247a5` — a *different* commit from the graded pin `c715b470`. The receipt's tree is not the graded tree; do not later read the receipt's HEAD as the artifact's HEAD.
