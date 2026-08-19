# AR-1351

RULING : AR-1348A / AR-1345A (GPT external advisor rulings) -- independent grade of the
         AR-1350 closeout: `scripts/strategy_factory_opus_batch_locator.py` and the 42-unit
         authority-based Opus regeneration. Dispatched under `ratify-packet` doer != grader.
GRADER                                : accuracy-validator (independent). Did NOT design, build,
         or previously grade this driver, the batch mechanics, or any of the 42 units.
GRADED HEAD (start)                   : `cba4756486aa0eee6034d1e82b1d605a9164b244`
GRADED HEAD (end)                     : `0360a65eff1315f5f66500d350b107050a011a3d`
         HEAD MOVED MID-GRADE (one `auto-wip: turn-end safety commit`). Verified the graded
         surface is byte-identical across `cba47564..0360a65e` (`git diff --stat` over
         `scripts/`, `src/engine/extraction/`, `docs/replay-results/strategy-factory-census/`
         is EMPTY; the only delta in the move is one line of `Trading Forge System Map v2.md`).
         This verdict therefore describes BOTH commits.
BLOBS PINNED (verdict describes these exact objects, not a branch name):
         `6c824ccf138121613cc99d98c549ae8b9335c90a`  scripts/strategy_factory_opus_batch_locator.py
         `19cf51766d099b88af945758682934cd6e8a5b6a`  src/engine/extraction/batch_locator.py
         `d7e4573430d062388c912f83d35f3368920dab5d`  src/engine/extraction/pilot_conveyor.py
         `af71f710ee15c18b9beaea506eca3db278bd550b`  src/engine/extraction/anchor_locator.py
         `1d9190e388a2741dfe670a6e93f1641e74f99b3f`  scripts/strategy_factory_prep_provenance_inventory.py
         `91fbb2fc3ec055ef22501693c3322b8dfd52364c`  scripts/strategy_factory_prepare_and_finalize.py
         `ea0dbb7f1ec81bd0d99a329687aae9e3d4a2358c`  .../extraction-vault/prep-provenance-inventory.json
WORKTREE IDENTITY                     : linked worktree; `git rev-parse --git-common-dir` =
         `C:/Users/tonio/Projects/trading-forge/trading-forge/.git`. All null results below are
         scoped to THIS tree and named as such (Law 10).

## SUMMARY: NO REFUTATION OF THE CENTRAL CLAIMS. FIVE REAL FINDINGS, NONE FALSIFYING. BAND 7 VERIFIED.

The dispatch mandate was DISPROVE. I tried to break four things: that the driver reuses rather
than reimplements, that the 42 Opus receipts are genuine rather than fabricated/copy-pasted, that
the certificates are reproducible rather than hand-written, and that `0/42 pilot_grade` is a real
semantic finding rather than a mechanical artifact. **All four survived independent
re-derivation.** I did not manufacture a finding to compensate.

What I did break: the driver's claimed desync guard is provably blind in a measurable subset of
units, and the load-bearing determinant of the headline number has no provenance at all. Both are
recorded below as real findings against a story that is otherwise sound.

---

## GRADING TABLE

| System | Band | Status | Evidence | Open risks |
|---|---|---|---|---|
| `strategy_factory_opus_batch_locator.py` (driver code) | 7 | **VERIFIED** | Full read of blob `6c824ccf`; reuse proven by byte-diff of both mechanics modules against their pre-work commits; guard exercised to RED on 3 failure modes and GREEN on clean | F-2 desync guard blind on duplicate `condition_text`; F-3 text-mode write breaks on-disk hash repro |
| Opus-locator provenance for the 42 units ("real Opus execution") | 8 | **VERIFIED** | 42/42 receipt hashes match their raw-response committed blobs; 42/42 mutually distinct; 42/42 cross-join clean to index + transcript + path; 4/4 planted-bad positive controls fired | Agent-tool dispatch is not directly attestable by design (named, not hidden); F-3 |
| 42 certificates reproducible from frozen inputs | 8 | **VERIFIED** | 5/5 re-ran `finalize` from committed stage1/stage2; content-identical to committed (`git diff --ignore-cr-at-eol` empty); tree returned clean | Only 5 of 42 re-run (~12%); see coverage bound |
| `prep-provenance-inventory.json` (`needs_regeneration=0`) | 6 | **VERIFIED** | Script re-run reproduces byte-identically; 47 units independently recomputed from disk | F-4 classifier is mere file-existence, no path to red; F-5 scope boundary unpublished |
| `0/42 pilot_grade=true` as a REAL factory finding | 6 | **VERIFIED (claim upheld, evidence thin)** | Deterministic crosstab: `confirmed`→tier3 274/274, `partial`→None 210/210, `denied`→None 6/6. Blocker is 216 genuine Stage-2 non-confirmations, NOT a locator artifact | **F-1: Stage-1/Stage-2 dispatches have ZERO provenance.** Single-source truth |
| AR-1350 closeout report as a caption on the above | 7 | **VERIFIED** | Cited commits resolve and are in HEAD history (7 of 8) | `59cfb1cd` not on this branch (control-plane, off-instrument) |

**Overall: band 7 VERIFIED** — adversarially tested with residual risks documented. Not 8: the
sole determinant of the headline number (Stage-2) is unreceipted, and a claimed safety guard has
a demonstrated blind spot. Not lower: every checkable claim reproduced through independent paths.

CLAIMED vs VERIFIED reconciliation: AR-1350 asserts no numeric band for itself and states at
point 13 that the grader has not yet run. There is therefore no >1-band gap to reconcile. This is
the correct posture and I am recording it as such.

---

## FINDINGS

### Discrepancy F-1: the number that decides everything is the one with no provenance
**Severity:** CRITICAL (single-source truth = unverifiable)
**Claim:** "0/42 certificates achieve `pilot_grade=true` (a real, re-measured factory-wide
finding, not a locator artifact)."
**Reality:** The finding is real and I upheld it — but it rests **entirely** on Stage-2 support
verdicts, and the Stage-1/Stage-2 Opus dispatches retain **no raw response, no hash, and no
receipt**. Per-unit artifacts are exactly: `certificate.json`, `opus_batch_receipt.json`, `pkl`,
`stage1_answers.json`, `stage2_answers.json`, `tier3_packet.json`. The locator dispatch got
`batch_raw_response.txt` + `receipt.json` + `raw_response_sha256`; the two dispatches that
actually decide the outcome got a bare parsed JSON dict.
**Sources compared:** [locator dispatch: raw text + sha256 + receipt, hash-verifiable |
Stage-1 dispatch: parsed answers only | Stage-2 dispatch: parsed answers only]
**Source of truth:** The crosstab is authoritative on *mechanism* — `classifying_tier=3` iff
Stage-2 `support == "confirmed"`, with zero exceptions across 490 verdicts. So all 42 failures
trace to 210 `partial` + 6 `denied`. That mechanism is MEASURED HERE. The *content* of those 216
judgments is RELAYED — nothing in the repo can distinguish them from any other JSON.
**Fix point:** `scripts/strategy_factory_prepare_and_finalize.py` — Stage-1/Stage-2 need the same
raw-preserve + hash + receipt treatment `cmd_ingest` already gives the locator
(`strategy_factory_opus_batch_locator.py:177-214`).
**Repro:** `ls docs/replay-results/strategy-factory-census/extraction-vault/preps/ | sed 's/^[^.]*\.//' | sort -u`
— six suffixes, none of them a stage raw or receipt. Repo-wide `find` for stage1/stage2 non-answers
artifacts returns only the OLD `h1-scripts/pilot-run/rater-answers/` and sealed-read files.
**Blast radius:** Every downstream reading of the 0/42 result. AR-1345A's entire purpose was to
move load-bearing evidence under receipted authority; that was done for the locator and not for
the adjudicators. The asymmetry is the finding.
**Mitigating (stated honestly):** an independent semantic re-derivation (below) found the Stage-2
judgments defensible on every one of 14 deeply-checked conditions. This is corroboration, not
provenance.

### Discrepancy F-2: the desync guard does not guard where two conditions share text
**Severity:** MEDIUM (silent misattribution surface in a claimed safety mechanism)
**Claim:** driver docstring / `cmd_prep` — "asserting the condition_text matches what THIS
position's ref expects is a same-call desync guard: a silent mismatch here would hand one
condition's raw answer to a DIFFERENT condition's disposition."
**Reality:** The guard compares `condition_text`, not `condition_ref` — because
`prepare_strategy`'s `propose_fn` seam only passes `(transcript, condition_text)` and no ref.
Wherever two conditions in one batch carry **identical** `condition_text`, the guard is blind by
construction. **MEASURED HERE:** 4 of 42 units contain duplicate `condition_text`
(`KXWRtV2LOVc__s0`, `N7SM8a7Dc9s__s0`, `UBvfsImdI2U__s0`, `h6TnE7QClJg__s0`), and in **2 of those
the duplicate pair received DIFFERENT Opus answers**, so a swap would be a real misattribution:
- `KXWRtV2LOVc__s0` `targets[0].rationale` vs `targets[1].rationale`
  → `'targeting the opposing end of the 4our CRT range'` vs
    `'expands to the opposing end of the range which range the 4H hour CRT range'`
- `h6TnE7QClJg__s0` `targets[0].rationale` vs `targets[1].rationale`
  → `'set your takeprofit at least 1 and a half to two times the distance of your stop loss'` vs
    `'target at least 1.5 to two times your risk.'`
**Sources compared:** [guard code path: text-equality only | batch index: duplicate texts present |
batch answers: differing raw answers for the duplicate pair]
**Source of truth:** Executed probe. I monkeypatched `pilot_conveyor.prepare_strategy` to call
the real `propose_fn` with positions 17 and 18 of `h6TnE7QClJg__s0` **swapped**. Result:
`GUARD DID NOT FIRE`, and the two positions received the two different answers interchangeably.
**Fix point:** `scripts/strategy_factory_opus_batch_locator.py:257` — the guard should fail closed
when `emit` detects duplicate `condition_text` within a batch (assert uniqueness at
`cmd_emit`, blob `6c824ccf` line ~111), since the seam cannot carry a ref.
**Repro:** load the driver via `importlib`, patch `pc.prepare_strategy` with a fake that calls
`propose_fn` over `texts` with the two duplicate indices transposed, then raise a sentinel before
the write block; observe no `RuntimeError`.
**Blast radius:** 2 of 42 current units are in the exposed class. **No actual desync occurred** —
order derives from the same pure `extract_spine_condition_texts` call both times, and all 5
re-derived certificates reproduced exactly. This is a latent hole in a claimed guard, not a live
defect. It is reported because the guard is *offered as the reason* misattribution cannot happen.

### Discrepancy F-3: recorded hashes do not verify against the files they name (Windows text-mode write)
**Severity:** MEDIUM (repro-hostile provenance; a naive auditor reads it as 30/42 corrupt)
**Claim:** each receipt's `raw_response_sha256` attests its `batch_raw_response.txt`.
**Reality:** `cmd_ingest` hashes the **LF-normalized in-memory string**
(`raw_text.encode("utf-8")`, line 179) and then writes the file in **text mode**
(`open(..., "w")`, line 180), which emits CRLF on Windows. **MEASURED HERE:** naive
`sha256(disk bytes)` matches only **12 of 42** raw responses and **0 of 42** `batch_task.txt`.
Under LF-normalization, **42/42 and 42/42** match, with zero unexplained.
**Sources compared:** [receipt claim | worktree bytes: 30/42 CRLF | committed blob: LF]
**Source of truth:** the committed blob. `.gitattributes:46` declares `*.txt text eol=lf`, so git
normalizes on commit; I verified `git show HEAD:<path> | sha256sum` equals the claimed hash for
6/6 sampled CRLF cases. **The canonical committed evidence is clean; only the working-tree copy
is unverifiable.** This is emphatically NOT fabrication, and I want that on the record.
**Fix point:** `strategy_factory_opus_batch_locator.py:180` and `:128` — pass `newline="\n"`
(same defect class the repo's own `d4df6aa3` NEWLINE census pinned at 59 sites; these are
unpinned new write sites). `strategy_factory_prepare_and_finalize.py:184` has it too.
**Repro:** `python -c` hashing `batch_raw_response.txt` raw vs `.replace(b'\r\n', b'\n')`.
**Blast radius:** any future auditor or CI check that verifies receipts from a working tree.

### Discrepancy F-4: the provenance inventory cannot go red
**Severity:** MEDIUM (detector blind spot — the Pass-6 class)
**Claim:** the inventory classifies by "WHICH LOCATOR BACKEND ACTUALLY RAN, using a join key that
cannot be spoofed."
**Reality:** the predicate is `os.path.exists(receipt_path)` (line 132). **MEASURED HERE:** the
script never hashes `batch_raw_response.txt`, never compares `receipt.video_id` to the filename,
and never validates receipt content. An **empty or copy-pasted** `<video>__s<N>.opus_batch_receipt.json`
yields `needs_regeneration=false` identically to a real one. The join key it advertises is file
existence, which is exactly what a fabricator would supply.
**Source of truth:** my external audit, which is a genuinely different path — and which found the
42 real. So the inventory's *conclusion* is correct while its *method* is not load-bearing.
**Fix point:** `scripts/strategy_factory_prep_provenance_inventory.py:132-142` — verify
`raw_response_sha256` against the raw file (LF-normalized, per F-3) and assert
`receipt["video_id"]/["strategy_index"]` equal the filename before crediting `opus_batch`.
**Repro:** positive control — receipt A tested against unit B's identity fired 4/4 of my checks
(join key, task-sha join, path, raw hash) and **0 of the inventory's**.
**Blast radius:** the `needs_regeneration_count: 0` headline. Currently true, but not *because*
the inventory established it.

### Discrepancy F-5: the inventory publishes no scope line
**Severity:** LOW (unbounded absence claim — Law 9)
**Claim:** "0 units need regeneration," presented as factory-wide.
**Reality:** the enumeration surface is one directory listing (`os.listdir(VAULT_DIR)`), so
anything without a vault record is invisible **by construction**. **MEASURED HERE:** the corpus
holds **40** transcripts but only **39** vault records — `sVkmZklJDHI` has a transcript and no
vault record. Repo-wide there are **17 further prep `.pkl` artifacts** outside the inventory:
16 in `docs/replay-results/h1-scripts/pilot-run/preps/` and 1 in
`docs/replay-results/svkm-extraction-certified/grade/`.
**Source of truth:** both exclusions are legitimate — `sVkmZklJDHI` is the AR-1234 pin video
living in its own certified lane with its own `svkm_*` toolchain, and the 16 are the **sealed**
H1 pilot (`8f9c8c1d`, 2026-07-12, "READ ONCE ON ALL 16, RESULT VAULTED"), which sealed-pilot
integrity forbids regenerating. **This is a boundary, not a silent drop.**
**Fix point:** emit a `scope_line` in `prep-provenance-inventory.json` naming the population and
the nearest neighbours deliberately excluded.
**Blast radius:** reader inference only. No contaminated unit is hiding in the gap — I checked.

---

## WHAT SURVIVED THE ATTACK (the disprove attempts that failed)

1. **"Reuses, does not rebuild"** — UPHELD, MEASURED HERE. `git diff` of
   `batch_locator.py` against its pre-work commit `083c553a` and `pilot_conveyor.py` against
   `d4df6aa3` are both **empty**; neither was touched by this work. Full read of the driver blob
   shows **no** local verification logic and **no** network call — `grep` for
   `_verify_and_locate|def verify|substring|\.find\(|re\.search|ollama|requests|http` matches only
   two *docstring* lines. Verification authority genuinely stays in `anchor_locator`.
2. **Gemma is structurally bypassed** — MEASURED HERE. `anchor_locator.py:276` is
   `fn = propose_fn or _default_propose_fn`; supplying a non-None `propose_fn` means the Gemma
   path is never reachable for these 42 units. Not a promise — a branch.
3. **Receipts are genuine, not copy-pasted** — MEASURED HERE via three non-overlapping joins:
   42/42 `raw_response_sha256` distinct, 42/42 `batch_task_sha256` distinct, and every receipt
   cross-joins to its own `batch_task_index.json` task hash, its own video's real transcript
   sha256, and its own paths. Zero failures.
4. **Certificates are computable from their own frozen inputs** — MEASURED HERE. Re-ran
   `finalize` on 5 units I chose (`mNcoaNdAyIE__s0`, `c8VLqF0XDR4__s0`, `VTEQ2fhGLqE__s2`,
   `l-2iKbcm5UI__s0`, `ktkqq7QsN9Q__s3`); all 5 reproduced the committed `pilot_grade`,
   `full_grade` and full `diagnosis` dict, and `git diff --ignore-cr-at-eol` over the preps
   directory was empty. Tree verified clean afterward.
5. **`0/42` is not a locator artifact** — MEASURED HERE, and this was my strongest disprove
   attempt. I first hypothesised the universal blocker was mechanical: `finalize_certificate`
   joins verdicts to conditions **by char_span**, and duplicate spans exist. That hypothesis
   **failed** — total duplicate-span surplus is 16 against ~220 fall-throughs, and `diag_ok`
   never equals distinct-span-count. The real mechanism is the deterministic crosstab above.
   I also confirmed **0 of 504** span-map items were missing from their `stage1_answers.json`,
   so the fall-throughs are genuine judgments and not undispatched items.
6. **The declines are honest** — MEASURED HERE. All 8 unanchored conditions across 6 units carry
   reason `locator_declined`. Zero hallucination-class or non-substring unanchored.
7. **The guard is real where it can see** — MEASURED HERE. Path-to-red proven on all three modes:
   wrong text → `call-order desync at position for condition_ref ...`; over-call → `called more
   times than there are batched answers`; under-call → `under-called: 15 batched answers never
   consumed`. GREEN on the correct order (16 answers served, no raise). Both halves run.
8. **The AR-1234 failure mode does not reproduce** — see next section.

## THE AR-1234 "REAL QUOTE, WRONG QUOTE" CHECK

Delegated to an independent semantic re-derivation over **5 units** deliberately excluding the
already-discussed `1HFoStW_wsc` and `75DJN5UVQnw`: `qLtq73bTPBA__s0`, `mNcoaNdAyIE__s0`,
`h6TnE7QClJg__s0`, `ktkqq7QsN9Q__s0`, `nV9gknhy2Ew__s0` — **59 literal span checks** and
**14 deep semantic re-derivations** of `confirmed` verdicts.

**Result: 0 WRONG-QUOTE.** Every span byte-exact; every quote occurring exactly once in its
transcript (no ambiguous-span risk). Two conditions graded WEAK-BUT-DEFENSIBLE
(`h6TnE7QClJg-S0-B009`, `nV9gknhy2Ew-S0-B009`), neither a misgrounding, and the second moot
because Stage-1 returned `cannot-determine` so no verdict applied.

The most probative evidence is a near-duplicate cluster in `nV9gknhy2Ew` — three conditions all
about the 10am 4H candle, precisely where a batched locator is most likely to hand one quote to
all three. It did not: B012 got the "specifically applied to" sentence, B000 the same sentence
**extended right** to capture "highest win rate", and B001 a passage **~6,500 characters away**
("I've seen the best results with a 10 a.m. candle") because that is where optimality is actually
expressed. It declined the easy adjacent quote for the semantically correct distant one. That is
the opposite of the Gemma failure mode.

I note for the record that the sub-audit generated **58 false "mismatches"** from an invalid
positional cert↔packet join and **retracted them itself** before reporting. I am recording the
retraction rather than the raw count, because a positional join between a certificate (all spine
conditions) and Set B (tier-1 fall-throughs only) is not a valid join key — Law 3.

Also verified independently: `mNcoaNdAyIE-S0-B001` shows `stage2 = confirmed` but an empty
`quote_anchor` and null verdict in the certificate. This is **correct fail-closed behavior**, not
a lost adjudication — Stage-1 returned `cannot-determine`, so Stage-2 is deliberately not applied.
The cert's `char_span [3070,3117]` extracts exactly `"Basically, the most recent area of
uncertainty."`, i.e. the locator anchored it correctly and the pipeline then refused to credit it.

---

## MANDATORY CLOSING: COVERAGE ENUMERATION

### 1. What I verified, and via which two-plus non-overlapping paths

| Claim | Path A | Path B | Path C |
|---|---|---|---|
| Mechanics modules unmodified | `git diff` vs pre-work commits (empty) | full read of driver blob for reimplementation | `git log` shows no post-work commit touching either |
| Real Opus locator execution | receipt hash vs raw-response **committed blob** | mutual distinctness of 42 raw + 42 task hashes | cross-join to index task-sha, transcript sha, and paths |
| Certificates reproducible | re-ran `finalize`, compared diagnosis fields | `git diff --ignore-cr-at-eol` byte comparison | independent crosstab predicts every `classifying_tier` |
| `needs_regeneration = 0` | re-ran inventory script (byte-identical) | recomputed 47 units from raw disk enumeration | repo-wide `find` for prep artifacts outside the surface |
| `0/42 pilot_grade` | census of committed certificates | 5-unit `finalize` re-derivation | support→tier crosstab over 490 verdicts |
| Grounding correctness | byte-exact span extraction (59) | semantic re-derivation + active hunt for a better quote (14) | uniqueness-of-quote-in-transcript check |
| Graded surface stability | HEAD re-derived at end | `git diff cba47564..0360a65e` over graded paths (empty) | blob hashes pinned in header |

Note on Law 1: re-running the worker's own `finalize` would be the same path wearing a second
hat, so it is **Path A only**. Path B (git-level byte comparison) and Path C (an independently
derived crosstab that predicts `classifying_tier` from Stage-2 support without invoking the
instrument) are what make the certificate claim stand.

### 2. Positive-control witnesses for every absence claim I make

| My absence claim | Planted known-bad | Result |
|---|---|---|
| "no fabricated/copy-pasted receipts" | receipt A tested against unit B's identity | **4/4 checks FIRED** (join key, task-sha, path, raw hash) |
| "no tampered raw responses" | 1-bit flip in a raw-response file | **RAW_HASH check FIRED** |
| "the desync guard works" | wrong text / over-call / under-call | **RuntimeError on all 3**; GREEN on clean order |
| "the guard is blind on duplicate text" | swapped positions 17/18 of `h6TnE7QClJg__s0` | **guard did NOT fire** — the blind spot is the witness |
| "inventory cannot detect a fake receipt" | same planted receipt A-on-B | **0 of the inventory's checks fired** |

Law 5 satisfied on both halves: every harness above was shown to go RED on planted-bad **and**
GREEN on clean.

### 3. Join keys checked for every "identical / unchanged / matches" claim

- "mechanics unmodified" → path + blob identity across `083c553a..HEAD` / `d4df6aa3..HEAD`.
- "receipt attests this unit" → `receipt.video_id` + `strategy_index` **vs the filename stem**,
  `receipt.batch_task_sha256` **vs** `batch_task_index.task_sha256`, `index.transcript_sha256`
  **vs** the real transcript file, and substring containment of the stem in both recorded paths.
  42/42 clean on all four.
- "certificate reproduces" → per-unit `pilot_grade`, `full_grade`, and all six `diagnosis` keys.
- "stage answers join to the prep" → every `stage1`/`stage2` key is a member of
  `item_span_map` ∪ the 10 blind controls; all 10 controls present in all 42; every span-map item
  answered. Zero orphans in either direction.
- "inventory population is complete" → vault-record ids **vs** disk listing **vs** transcript ids.

### 4. What I did NOT verify, and why

1. **That the Agent-tool dispatches were literally Opus.** Not attestable from this repo — no
   per-call API transcript is retained, by design. The brief said so up front and it is true. My
   receipt work bounds *tampering and copy-paste*, not *model identity*. Anyone claiming model
   identity is verified here is over-reading me.
2. **Stage-1 and Stage-2 content provenance** — impossible, see F-1. The 216 non-confirmations
   that produce the headline number are RELAYED, corroborated only by sampling.
3. **37 of 42 certificates were not re-derived.** I re-ran 5. On a 5/5 clean sample the residual
   defect rate is bounded at **≤~45% @95%** — a weak bound; I state it as a bound, not a point.
   Full byte-reproduction of all 42 is cheap and should be run before this is treated as settled.
4. **28 of 42 units got no semantic grounding review.** 5 units / 14 deep conditions of ~274
   `confirmed` verdicts ≈ **5% coverage**. On 0/14 wrong-quote the bound is **≤~23% @95%**. This
   does NOT establish a low corpus-wide misgrounding rate and must not be quoted as if it does.
5. **I did not read the AR-1348A ruling text on `origin/external-advisor/gpt-rulings`.** I graded
   the artifacts against the mandate as briefed rather than re-deriving the ruling's own wording;
   a restriction I am naming rather than papering over. My verdict is therefore on *what was
   built and measured*, not on *whether it satisfies AR-1348A's letter* — that judgment remains
   the external advisor's.
6. **`59cfb1cd`** (AR-1348 G2 guard fix) is cited by AR-1350 but is **not in this branch's
   history**. It is control-plane/harness, not instrument code, so it does not affect this
   instrument grade — but I did not verify it landed anywhere.
7. **The 16 sealed H1-pilot preps and the sVkm lane** were characterized (dates, provenance,
   sealed status) but not themselves audited for locator backend. If AR-1348A's cleanup was ever
   intended to reach them, that is an open question I am surfacing, not answering.
8. **No DB / n8n / SSE / audit_log hop was walked** — this change touches none of them; it is a
   filesystem-artifact pipeline. Named so the omission is not mistaken for coverage.

---

## RECOMMENDATION

**ACCEPT the work at band 7.** The central claims are true and independently re-derived. Close
F-1 through F-5 in this wave per CLAUDE.md §11c (zero carry-forwards) — all five have a named
single fix point, and F-1 and F-4 are the two that matter, because they are the difference
between "the number is right" and "the number is *established*."

Nothing here should stop the pipeline. Nothing here justifies calling the locator recovery
unproven. But `0/42` should not be quoted as a receipted measurement until Stage-1/Stage-2 carry
the same provenance the locator already does.

-- accuracy-validator, independent grader, 2026-08-19
