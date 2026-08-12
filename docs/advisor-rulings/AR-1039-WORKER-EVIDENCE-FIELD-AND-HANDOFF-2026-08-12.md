# AR-1039 — WORKER — **THE TEACHERS' WORDS ARE PRESERVED** (`evidence`, not `object`) · A NEAR-MISS I CAUGHT BEFORE PUBLISHING · HANDOFF

```
RULING : AR-1037 (gpt-rulings db7bb787) §5/§6 — reading the real ORB sources
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81   origin/h1-wave4-sealed12-driver  (unchanged)
TREE   : C:\Users\tonio\Projects\wt-h1-wave4-20260712
STATE  : READ-ONLY. **NO PRODUCTION CODE MUTATED. NO COMMIT. NO SERVICE DEPLOYED.**
SEAT   : HANDING OFF — genuine context exhaustion, at a clean boundary. §5.
```

## 1. THE SPEC'S REAL SHAPE — THIS IS THE USEFUL PART FOR THE NEXT SEAT

Each condition in `strategies.config.compiled_spec.spec.entry_conditions[]` carries:

```json
{ "id": "WAIT_STRUCTURE:opening range breakout orb#0",
  "type": "WAIT_STRUCTURE",  "role": "spine",
  "object":   "opening range breakout orb",          ← SHORT LABEL, 2-5 words
  "evidence": "T-oDLt-C0000",                        ← the teacher's WORDS, or a transcript ref
  "span":     { "start": 0, "end": 28 } }
```

🛑 **`object` IS A LABEL. `evidence` IS THE SOURCE.** `evidence` holds **either** the teacher's
verbatim prose **or** a transcript-span id of the form `T-<video>-C<nnnn>`, with `span{start,end}`
offsets into that transcript.

**MEASURED across all 40 production videos:**

```
entry conditions total          : 2150
evidence = INLINE TEACHER PROSE : 1214   (longest 62 words)
evidence = transcript-span ref  :  936
evidence = empty                :    0
videos with >=1 inline prose    : 40/40
```

⇒ **The extraction did NOT lose the teaching.** Roughly 56% of conditions carry the words inline;
the rest are addressable by transcript id + span.

**Real examples from the ORB source `oDLt9zh33LE`** (49 prose-bearing conditions, longest 37 words):

> *"If we are at a swing point and we have swept out a swing high and people think that okay cool
> we have broken out of this…"*
> *"They take the entry at the candle close, stop loss at that candle low and they target their
> two R."*

★ **That second quote is an exact, executable rule** — entry at candle close, stop at candle low,
target 2R. **This is the shape AR-1037 §7 criterion 2 asks for**, and it exists in the production
library. Whether it is *this* strategy's own trigger rule (rather than a description of what
"they" do) is **NOT yet determined — I did not read the surrounding conditions.**

## 2. THE NEAR-MISS — I ALMOST PUBLISHED THE OPPOSITE

I measured word-counts on **`object`**, got a mean of **2.3–5.6 words with 40/40 videos under 8**,
and had drafted the conclusion:

> *"40/40 production videos have fragment-shaped extractions… the production library's specs do not
> carry enough source prose to determine any teacher's exact mechanics… the blocker is upstream of
> the compiler, in extraction."*

**That is false, and it would have been a serious false finding** — it would have condemned the
extraction layer, likely triggered an extraction re-run campaign, and pointed the money path at a
defect that does not exist.

**What caught it:** before claiming the library had lost the teaching, I asked the one question the
claim depends on — *"could the prose live in a different field and `object` just be a label?"* — and
dumped **every key** of a condition instead of the one I had been reading. `evidence` was right
there.

★★★★★ **`I MEASURED THE NEIGHBOURING OBJECT` — for the FOURTH time in this session** (`[i-measured]`).
The pattern across all four is identical and worth naming precisely:

| # | I measured | the claim needed | caught by |
|---|---|---|---|
| 1 | `role == "spine"` | *actually evaluated* (`executed` too) | my own re-check |
| 2 | parent key `instrument_classification` present | the **child** key, whose name varies per record | my own re-check |
| 3 | compiler's **condition type** | the **teacher's words** | **the operator** |
| 4 | `object` (label) | **`evidence`** (prose) | my own re-check, barely |

**Three of four were caught only because I re-checked a surprising result. A surprising result is
an accusation against the instrument first — that habit is the only thing standing between this
desk and four published false findings.**

## 3. WHAT IS NOW KNOWN, AND WHAT IS NOT

**KNOWN (measured this session):**
- Live library = **120 strategies = 40 videos × 3 instruments** (MES/MNQ/MCL); 120/120 carry a
  persisted `compiled_spec`. `Trading Forge` / `Postgres-KcfX` / `sakura:34357`.
- **Tier-A fixtures and the production library are DISJOINT** — the golden `st5e-YJRfKc` is not in
  production (AR-1038 §0). Fixture-derived conclusions do not transfer.
- **16 of 40 videos** carry opening-range teaching language in their prose (AR-1038 §3b).
- Teacher prose is preserved and addressable (§1).

**NOT KNOWN — the next seat's job:**
- **No ORB source's mechanics have been read yet.** No per-teacher table exists.
- The **936 transcript-span refs** point at a transcript store I did **not** locate.
  `transcript_fetch_outcomes` is **0 rows**; I did not search files or other tables for
  `T-<video>-C<n>`. **Do this before assuming any rule is unrecoverable.**
- The `ENABLE_ENTRY`/`ENTER` trigger types on production ORB rows route to `_h_non_gating` in
  `ENFORCED_DISPATCH` — **HYPOTHESIS ONLY**, not measured against a compiled plan.
- **No production strategy has been compiled or refusal-checked.** AR-1037's approximation
  correlation is a **fixture** fact and must not be assumed here.

## 4. NEXT SEAT — START HERE

1. Read `oDLt9zh33LE` and `e5HQXYBUW-Q` (and `c8VLqF0XDR4`, `deymRD3kSD0`) **`evidence` fields, in
   `span` order**, and write each teacher's ORB mechanics table per AR-1037 §5. **Read `evidence`,
   never `object`.**
2. Locate the transcript store for `T-<video>-C<nnnn>` refs (AR-1037 §6 authorizes transcript
   recovery).
3. Compile those rows and call `execution_refusal()` — measure, do not inherit the fixture finding.
4. Then AR-1037 §8's selection order and §9's money-path proof.

**Working `.env`** (live DB + live project token) is in the worktree; `git check-ignore` confirmed
it is ignored/untracked. Backup of the pre-repair `.env` is in this session's scratchpad only.

## 5. WHY I AM HANDING OFF

Genuine context exhaustion, at a clean boundary: a lane closed (library reached, enumerated,
structure mapped), nothing half-written, **no uncommitted code**, working tree clean, every finding
delivered to this branch. **Fan-in: the ORB mechanics table is UNSTARTED, not blocked** — a fresh
seat can start it from §4 without re-deriving anything, which is exactly the state a handoff is
supposed to leave behind.

Outstanding for GPT: nothing blocking. Outstanding for the operator: nothing.
Still open and disclosed: the canonical-manifest red (`committed=107 derived=108`,
banked as `ACCEPT5-POSTCLOSE-POPULATION-DRIFT-1`, **do not regenerate**).

Ear armed on this branch.
