# `C8` EXTRACTION-SIDE DIAGNOSIS — why a chart parameter becomes a trading rule

**Deliverable of R-426 items (1)+(2) · 2026-07-29 · DIAGNOSIS + PROPOSAL ONLY — no code changed.**

> **TREES.** Producer code read in `C:/Users/tonio/Projects/trading-forge/trading-forge` (the primary
> checkout, where `src/agents/` and `src/server/` live). Binding/census figures measured in
> `wt-preflight-blockers-20260729` @ `83efd34e`, sha256-identical to `runtime-production` @ `a6f92822`
> on all three engine files. Live DB reads were SELECT-only under
> `SET default_transaction_read_only = on`. **[MEASURED] `backtests total = 0`.**
> **POPULATION:** `POP-120-LIVE`, reported **per-video (40)** unless a figure says otherwise.

---

## §0 — ★★★ CORRECTION TO AR-391 / R-426, FILED FIRST BECAUSE THE DESK HAS ALREADY BUILT ON IT

**AR-391 graded the provenance column `[UNANSWERABLE — NO TRANSCRIPT IN ROW]` for every term, and
R-426 ratified it and went further:** *"the live library CANNOT be graded for source fidelity at all,
because the rows do not carry the source."*

★★★ **THAT IS TOO STRONG, AND THE ERROR IS MINE.** I measured `transcript_chars` — which is genuinely
absent — and concluded the row carries no source. **I never opened the condition objects themselves.**

**[MEASURED, all 120 rows, 6450 entry conditions] every condition carries BOTH an `evidence` field and
a `span` field, and `evidence` is non-empty on 6450 of 6450.** The artifact contract declares them:
`spec-onboarding-service.ts:166-173`, `SpecEntryCondition { id · type · object · role · span · evidence }`.

**What `evidence` actually contains — [MEASURED, per-video basis, 2150 conditions]:**

| shape | n | share |
|---|---:|---:|
| opaque chunk POINTER (`T-<vid>-C####`, incl. `{a, b}` and `start:/end:` variants) | 936 | 43.5% |
| **VERBATIM source text** (>25 chars) | **312** | **14.5%** |
| short string ≤25 chars, not a pointer — **unclassified, I did not read them** | 902 | 42.0% |

★★ **So the honest statement is narrower than either of ours:** source-fidelity grading is **possible
today on at least the 14.5% that carry verbatim text**, and possible on the 43.5% **only if a store
resolving `T-<video>-C####` exists** — ★ **[NOT MEASURED] I did not look for that store, so I do not
know whether those pointers resolve or are a pointer-lie.** ★★★ **A provenance field that is 100%
populated and 43.5% opaque is exactly the shape this campaign convicts: it reads as complete
provenance and may be a pointer to nothing.** That question is now the highest-value cheap probe left.

★ **Also corrected: AR-391 §7's AM/PM hypothesis.** I proposed a normalizer stripping punctuation and
dropping the token `a`. **The codebase already documents a different and better-evidenced cause:**
`AGENT-LOGS.md` (F-2, 2026-07-03) records *"clock-time guard strips 'HH MM m eastern' (a 9:30 a.m.
session time with **ASR-dropped 'a.'**)"* — i.e. the damage is in the **speech-recognition transcript**,
upstream of any normalizer, and a guard already exists in `spec-timeframe-recovery.ts` to stop it
being misread as a 30-minute chart. **My hypothesis named the right effect and the wrong stage.** The
corpus_B requirement is unchanged.

---

## §1 — THE PRODUCER BOUNDARY, NAMED

**`role` is NOT assigned anywhere in this repository.** It arrives already set, on the artifact.

- **[MEASURED]** `grep` for any assignment of `role: "spine" | "confluence" | "trigger"` across all
  `*.ts` / `*.py`, excluding tests and the vendored worktrees, returns **no assignment site** — only
  the type declaration `spec-onboarding-service.ts:170` and consumers that COMPARE against it
  (`playbook-registration.ts:94`, `spec-family-bindings.ts:217`, `spec-timeframe-recovery.ts:257`,
  `spec_condition_compiler.py:541/605`, `spec_family_bindings.py:661`).
- `spec-onboarding-service.ts:165` calls its own interface *"Spec artifact contract (mirrors the
  25-sample generalization corpus)"* — **an INPUT contract.** The onboarding service consumes `role`;
  it does not create it.

★★★ **AND THE FINDING THAT MATTERS MOST HERE: [MEASURED] the extractor prompt
`src/agents/transcript-extractor.md` contains the string `spine` ZERO times.** The prompt that
produces these strategies **never defines the role vocabulary the entire safety chain treats as its
mandatory-execution contract.** ★★ Whatever assigns `spine`/`confluence`/`trigger` is either a
downstream graph-builder outside this repo or an unprompted model convention — **and that is the
single most important unknown this diagnosis surfaces.**

---

## §2 — ★★★ WHY A CHART PARAMETER BECOMES A CONDITION: THE PROMPT INSTRUCTS IT

Three mechanisms, quoted verbatim from `src/agents/transcript-extractor.md`.

**(1) A QUOTA WITH A RE-SCAN LOOP — §7, line 169:**
> *"SCAN THE ENTIRE TRANSCRIPT for EVERY additional filter the speaker mentions. Each additional
> filter is a confluence factor. The 2026 institutional standard is **≥3 factors per strategy**.
> Videos that describe fewer than 3 are usually mis-extractions of richer setups — **re-scan before
> accepting a 1-or-2-factor extraction**."*

★★★ **A numeric floor, plus an instruction to go back and look again until it is met.** A strategy
the teacher taught in two steps cannot be emitted in two steps without tripping a re-scan.

**(2) AN EXPLICIT INSTRUCTION TO OVER-INCLUDE — line 171:**
> *"**Bias toward INCLUSION when in doubt.** The operator can prune later via re-extract. A missed
> factor means the strategy scores wrong permanently until re-extracted."*

★★ **The asymmetry is stated as policy: false positives are cheap, false negatives are permanent.**
`C8` is that policy working exactly as written.

**(3) THE TIMEFRAME-CHAIN RULE — the direct generator of the library's most common condition, line 616:**
> *"Emit `confirming_indicators[]` whenever the source describes ≥2 entry conditions, INCLUDING
> sequential multi-step structural workflows… **The chain "wait for 4H FVG → drop to 15M for setup →
> enter on 1M IFVG close" IS confluence: emit each step as a confirming indicator.**"*

★★★ **"Drop to 15M" is chart navigation. The prompt classifies it as confluence and orders it
emitted as a step.** That is why **`'timeframe'` is the single most common entry condition in the
operator's library.**

**THE EXHIBITS — `C8` caught in the act, in the teacher's own words, from the `evidence` field:**

| emitted condition | `role`/`type` | the teacher actually said |
|---|---|---|
| `'time frame'` | confluence / WAIT_SESSION | *"So, let's go to the 4our and let's zoom in."* |
| `'1 hour chart'` | confluence / WAIT_SESSION | *"Okay, now that we are on the 1 hour chart, what I like to start doing is marking out KPLs."* |
| `'time frame'` | **spine** / WAIT_SESSION | `{ "description": "Switch to 15-minute time frame" }` |
| `'intraday time frames'` | **spine** / WAIT_SESSION | *"gap down and from there we go to the intraday time frames to find a potential setup."* |
| `'time frame pairing'` | confluence / WAIT_SESSION | *"I'm using the 15-minut time frame in this example as it is paired with the 4hour time frame."* |

★★★ **Every one of these is a narration of what the speaker is doing with his charts. Two are
`role=spine` — the class the preflight treats as MANDATORY EXECUTION.** ★ The third row also shows a
**second defect: a JSON blob has leaked into the `evidence` string**, so the field carries at least
four incompatible encodings (verbatim text · `T-x-C###` · `{a, b}` · a serialized object).

---

## §3 — ★★★ `role=spine` DOES NOT MEAN EXECUTION, AND THE CODEBASE FOUND THIS OUT ON 2026-07-03

`spec-timeframe-recovery.ts:171-174`, verbatim:
> *"The compiler's `role="spine"` means **"narrative backbone", NOT "execution layer"** — a
> `WAIT_BIAS:daily` step is frequently tagged spine, so a role-based floor promoted a DAILY bias frame
> to exec while the real intraday exec (tagged `role=confluence`) was excluded. Classification must
> therefore be by **type**."*

**I tested that claim on the production population rather than inheriting it. [MEASURED, per-video,
2150 entry conditions] the role × type cross-tab:**

| role | ENABLE_ENTRY | ENTER | WAIT_BIAS | WAIT_STRUCTURE | WAIT_SESSION | WAIT_CONFIRMATION | FILTER | EXIT_HINT | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `spine` | **0** | **0** | 159 | 249 | 142 | 137 | 130 | 26 | 923 |
| `confluence` | **0** | **0** | 72 | 192 | 295 | 101 | 220 | 0 | 898 |
| `trigger` | **160** | **85** | 14 | 2 | 6 | 7 | 13 | 1 | 329 |

★★★ **ALL 245 execution-grade entry tokens (`ENABLE_ENTRY` + `ENTER`) carry `role=trigger`. ZERO
carry `role=spine`. Not one, in 40 videos.** ★★ **The producer never puts the entry event in `spine`.
`spine` is a narrative backbone — 159 of its 923 members are `WAIT_BIAS`, which the codebase's own
July-3 classification calls CONTEXT, never execution.**

★★★ **THIS IS THE SEAM DEFECT UNDERNEATH EVERYTHING.** The safety chain's
`_MANDATORY_ROLES = frozenset({"spine", "invalidation"})` (`spec_execution_preflight.py:94`) reads
`spine` as *the source marked this rule structurally required for execution*. The producer means
*this is the backbone of the explanation*. **One word, two incompatible contracts, across the
producer/consumer seam — and the consumer side was built on the wrong one, eight weeks after the
other side of the codebase documented the right one.**

★ **This is not a criticism of the preflight's grounding.** Its docstring honestly says the role
vocabulary was measured over POP-16 and that `spine`/`invalidation` are *"the only values this
campaign has evidence for."* **The evidence existed — in a TypeScript comment and an AGENT-LOGS entry
from 2026-07-03 — and no census reached it, because a census of the corpus cannot find a semantic
contract that lives in the producer's code.**

---

## §4 — THE `trigger` PRODUCER-CONTRACT QUESTION, FOLDED IN AND ANSWERED AS FAR AS THE EVIDENCE GOES

R-423 pinned four promotion conditions; #2 is *"producer code showing it represents the entry event
required for execution."*

**What I can now show:**
- **[MEASURED]** 245 of 245 `ENABLE_ENTRY`/`ENTER` tokens are `role=trigger`; 0 are `spine`.
- **[MEASURED]** the artifact carries `entry_trigger_id`, a first-class pointer to the designated
  trigger condition (`spec-onboarding-service.ts:180`).
- **[PRODUCER TEXT]** `transcript-extractor.md:130` — the output is *"rejected ONLY for missing
  source-owned entry logic — an empty `entry_sequence`, or **a missing entry trigger** / direction"*;
  `:481` — *"Steps MUST be in execution order (first check → **last trigger**)."*

★★ **So the producer treats the entry trigger as MANDATORY — it is a rejection condition — and the
consumer's `trigger` role is where every execution-grade token lands.** ★★★ **But I stop short of
saying condition #2 is met, and I say why: the prompt never uses the word `spine`, and I never found
the code that maps `entry_sequence` steps onto `role` values. Until that mapper is read, "the
producer's rejection-worthy entry trigger" and "the `role=trigger` field" are two facts joined by a
strong inference, not a verified join.** ★ **That mapper is the single read that would settle it, and
it is not in this repository.**

---

## §5 — R-426 ITEM (2): `C8` IN `invalidations` — SMALLER, AND WORSE-SHAPED

**[MEASURED, per-video] 201 invalidation bindings; 2 carry `C8` terms:**

| condition | strategy / video | binding |
|---|---|---|
| `'timeframe'` | `69b64551…` / `m-G1ag77aVc` | `bindable=True · executed=True · approximation=False · primitive=structural_stops.compute_structural_stop` |
| `'timeframe selection constraint'` | `1489bf44…` / `UBvfsImdI2U` | identical |

★★★ **On the entry side a `C8` term REFUSES and is therefore visible. On the invalidation side it
BINDS, EXECUTES, and is stamped `approximation=False` — "exact".** A chart-resolution annotation is
running as the framework's structural stop, and **the preflight cannot see it, because
approximate-or-not, a BOUND rule passes.** ★★ **The count is 2 and the shape is the false-exactness
species the whole safety chain was built to end. Small blast radius, exact defect.**
★ Both rows are `CANDIDATE`.

---

## §6 — PROPOSAL (producer-side, per R-426: no consumer-side suppression)

**P1 — RETIRE THE `≥3 FACTOR` QUOTA AND THE INCLUSION BIAS.** Replace *"re-scan before accepting a
1-or-2-factor extraction"* with *"emit exactly the factors the speaker states; a 1-factor strategy is
a valid extraction."* ★★★ **A quota on a count the extractor controls is optimizing the proxy and
destroying the purpose — the desk's own convicted law, currently written into the prompt as policy.**

**P2 — SPLIT NAVIGATION FROM CONDITION.** Amend the line-616 chain rule: *"drop to 15M for setup"*
sets the **execution timeframe**, it is not a confluence step. Chart navigation, instrument
selection and platform narration go to a non-executable `annotations[]` array — **emitted, never
dropped**, so the record still shows what the teacher said and nothing is silently discarded.

**P3 — DEFINE THE ROLE VOCABULARY IN THE PRODUCER, OR STOP TREATING IT AS A SOURCE CLAIM.** Either
the prompt states what `spine`/`confluence`/`trigger` mean and the producer is held to it, **or**
`spine` is downgraded at the consumer from MANDATORY to UNKNOWN_REQUIREDNESS — because today the
preflight records *"the source marked this required"* about a field the source never defined.
★★ **P3 is a RULING, not a worker call: it changes what the safety chain asserts, and it must not be
done to raise a pass count.**

**P4 — ONE EVIDENCE ENCODING, AND MAKE THE POINTER RESOLVE.** `evidence` must be verbatim source text
plus a resolvable locator — not four encodings of which 43.5% are opaque. This is the corpus_B
requirement that makes fidelity grading possible at all.

★ **Sequencing note:** P1 and P2 are extraction-side and are the only ones that reduce `C8`.
**[MEASURED, AR-391] `C8` is the only class that unlocks any strategy alone (6), and it spans 37 of
40 videos** — so P1+P2 are the money path's first real move.

---

## §7 — WHAT THIS DIAGNOSIS DID NOT MEASURE

★★★ **[NOT FOUND]** the code that assigns `role`. Searched: all non-test `*.ts`/`*.py` in the primary
checkout for any assignment of the three literals; found only the type declaration and consumers.
**It is outside this repository or it is model-emitted.** Everything in §3–§4 is measured on its
OUTPUT, which is why §4 stops short of declaring R-423 condition #2 met.
★ **[NOT MEASURED]** whether `T-<video>-C####` pointers resolve against any transcript store — the
highest-value cheap probe left, and the one that decides whether §0's 43.5% is provenance or a
pointer-lie.
★ **[NOT READ]** the 902 short `evidence` strings (42.0%) — unclassified, deliberately not guessed.
★ **[UNENUMERATED]** the timezone/calendar basis; unchanged since R-419.
★ **[NOT MEASURED]** whether the prompt's `≥3` quota is causally responsible for the `C8` volume. The
prompt instructs it and the corpus exhibits it; **an ablation — re-extract one video with the quota
removed — would prove it, and no extraction run is authorized.**
