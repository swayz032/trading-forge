# H1 WAVE-6 PASS-1 — "quote-as-you-extract" — DESIGN PACKET (ratify-packet, autonomous-class)

> Status: DESIGN ONLY. No extractor prompt/schema/code has been touched. Authored against
> the **spent-16 gold regression corpus + design pool ONLY** — the fresh Wave-6 sealed set
> does not exist in this packet's view (§2 of the pre-reg seals it separately, before this
> upgrade is designed; that ordering is preserved here). Outranks nothing; is itself
> outranked by `docs/designs/h1-wave6-extractor-iteration-preregistration-2026-07-12.md`
> (the §2 frozen ruling) and by CLAUDE.md §12 (bidirectional-completeness), §13
> (fixed-point-stop ban), and the campaign laws (`extraction-campaign` skill).
>
> Class per `ratify-packet`: **instrument-touching** (extraction-fidelity logic) →
> autonomous-class (pre-live, not irreversible/live-capital) → stage this packet, then
> pass-1 BUILD proceeds via agent-loop (scope-locked implementer → fresh-context
> independent grader), no operator permission-wait required. This packet IS the receipt.

---

## 1. DRIFT CHARACTERIZATION (evidence-grounded)

**Scope (Law 7):** sealed-16 (`8e39ffe1`) · taxonomy `h1-pilot-2026-07-12` · extractor tag
`gemma4:e4b-it-qat:minimal-8field-pass-l:content-c37f24c1c01f3ad4` · anchor-locator (real
gemma) · two independent blind raters (raterA_stage2.json / raterB_stage2.json, 224
anchored conditions each). Source: `docs/replay-results/h1-scripts/pilot-run/rater-answers/`
+ `READ-NOTES-2026-07-12.md`.

**Top-line (already certified in READ-NOTES, restated for context):** of 220 raterable
anchored conditions, both-confirmed = 165 (75.0%), both-agree partial/denied = 43 (19.5%),
contested = 12 (5.5%) → combined per-condition support-miss ≈ 25%, matching the pre-reg's
"~25%" baseline exactly.

This section goes one level deeper than READ-NOTES: it bins raterA's 54 non-confirmed
justifications (20 denied + 34 partial; raterB's independent 54 — 16 denied + 38 partial —
corroborate the same clusters, with only the denied/partial *severity* differing on a small
subset, e.g. `R5L890juvRw` B002/B008/B011) into the classes both raters' free-text
justifications actually name, to show which classes quote-as-you-extract's mechanism
reaches and which it does not.

| Class | Named example (verbatim from a rater justification) | Approx. count (raterA n=54) | % of misses |
|---|---|---|---|
| **A. Direction-flip** | `CLDEIsNpVRc-S0-B007/8/9`: "Quote says wait for price to close **BELOW** the 1m FVG; condition says take a **LONG** after price closes **ABOVE**. Contradiction." (+ `-igpOZs8LsM-S0-B008/9/10`: upside-continuation quote grounding an enter-**SHORT** condition) | 6 | ~11% |
| **B. Timeframe-mismatch** | `WEhmadJArQo-S1-B002`: "Quote says start on the **15-minute** chart; condition says switch to the **5-minute** chart and trade the FVG. Timeframe contradiction." | 1 hard case (+ several softer TF-detail-added cases folded into class F below, e.g. `WEhmadJArQo-S0-B002`, `ZF8uKPqAu8M-S0-B000`) | ~2% hard / more soft |
| **C. Unrelated-anchor mis-grounding** | `-igpOZs8LsM-S0-B000`: "Quote is about stop-loss placement below the FVG; condition is about identifying a high-momentum trend. **Unrelated**." (+ `ZF8uKPqAu8M-S0-B005`, `kFyD3H6I1I8-S0-B003`, `IyFioFkRgWo-S1-B002`, `E9MzEC_yNoM-S0-B009`, `R5L890juvRw-S0-B001/B004/B009`, `0xygpCMwxbQ-S0-B003`, `4cT8WTyxhYY-S1-B000`, `kFyD3H6I1I8-S0-B001`) | 11–12 | ~21% |
| **D. Range-to-point narrowing** | `E9MzEC_yNoM-S0-B014/B015`: "Quote states a minimum of 1x and ideally 1.5x-2x; condition narrows to just '2x', dropping the range and floor." | 2 | ~4% |
| **E. Observed-vs-target reframing / overclaim** | `kFyD3H6I1I8-S0-B008`: "Quote reports an achieved RR of ~2.16-2.3 on one trade; condition reframes it as what the speaker 'aims for' (observed vs target)." (+ `CLDEIsNpVRc-S0-B001` primacy-claim add, `4cT8WTyxhYY-S1-B001`, raterB `W7nlnHTUZQU-S0-B005`) | 4 | ~7% |
| **F. Trigger-fragment-missing-action** | `CLDEIsNpVRc-S0-AUDIT`: "Quote gives only the trigger timing ('closest liquidity after entry taken out'); the 'go break even' **action is not stated** in the quote." (the single largest cluster — `0xygpCMwxbQ` B000/B014/B015, `DLwVqcLRcfw` B006/B016, `E9MzEC_yNoM` B016, `PVMgOxHUqFA` B004/B009, `W7nlnHTUZQU` B007, `WEhmadJArQo` S0-B000/B002/AUDIT/S1-B000, `ZF8uKPqAu8M` B000, `_LS6qcSlDCs` AUDIT, `kFyD3H6I1I8` B000, `4cT8WTyxhYY` B001, `dV7chra4u4Q` B002) | ~20 | ~37% |

**Two additional empirically-real clusters the raters named but the pre-reg's 6-item list
did not enumerate — recorded because a design that only targets the named 6 would miss
~15% of the observed misses:**

| Cluster | Example | Count | % |
|---|---|---|---|
| **G. Scope-broadening beyond the quote** | `IyFioFkRgWo-S0-B004`: "Quote grounds entering at established support (long); condition **generalizes** to 'support/resistance' and 'long or short' beyond the quote." (+ `IyFioFkRgWo-S1-B001`, `W7nlnHTUZQU` B000/B001) | 4 | ~7% |
| **H. Interpretive causal-reframe** | `DLwVqcLRcfw-S0-B001/B004/B005`: quote is a plain hold-while-above rule; condition recasts it as **"VWAP acts as support during a bullish trend"** — an unstated causal/explanatory claim. (+ raterB `DLwVqcLRcfw-S0-B009`) | 4 | ~7% |
| **I. Non-directional claim-inversion** | `R5L890juvRw-S0-B002/B008/B011`: quote says price "bounces **from** the outer bands **back to** fair value" (fair value is the target); condition asserts "outer bands **are** the target" — the literal opposite of what the quote says, without being a long/short direction flip. | 3 | ~6% |

**Why this stratification matters for the mechanism (stated here, elaborated in §2):**
Class F (trigger-fragment-missing-action, ~37%, the largest single cluster) and Class A
(direction-flip, ~11%) are exactly what "the quote sits in the generation window while the
condition is written" is designed to suppress — the model cannot silently append an
unstated action/spec/direction if it just wrote down the literal words that don't contain
it. Class C (unrelated-anchor mis-grounding, ~21%, the second-largest cluster) is
**not** a paraphrase-drift problem — it is the anchor-locator's *generative retrieval*
picking the wrong span in the first place. Quote-as-you-extract reaches class C only
indirectly (see §4, locator-role note). Classes D, E, G, H, I are addressed by the
quote-then-write discipline to varying degrees (see §2 prompt spec) but are not eliminated
by schema shape alone — the prompt's explicit instruction not to assert beyond the quote is
the operative lever for those.

---

## 2. THE MECHANISM

### 2.1 Schema addition

Add a new field **`transcript_quote`** to every condition-bearing object in
`src/agents/kb/transcript-extractor-minimal-schema.json`:

- `entry_sequence[].transcript_quote` (new)
- `confluences[].transcript_quote` (new — distinct from the existing `description`, which
  stays as the paraphrase/interpretation field)
- `stop.transcript_quote` (new — distinct from the existing `stop.rationale`)
- `targets[].transcript_quote` (new — distinct from the existing `targets[].rationale`)

**Definition (identical wording in each location):**

```json
"transcript_quote": {
  "type": ["string", "null"],
  "description": "A literal, contiguous substring copied VERBATIM from the transcript — the exact evidence for this condition, not a paraphrase. Do not add words, do not fix grammar, do not translate speaker jargon. This field is checked by a literal substring match against the transcript; a quote that does not appear verbatim fails validation. Set null ONLY when the paired field is itself null (e.g. stop.anchor=null, an empty confluences[] item is impossible since the array itself would just be empty).",
  "minLength": 5,
  "maxLength": 150
}
```

`transcript_quote` becomes **required** on `entry_sequence[]` items and `confluences[]`
items (every condition needs its evidence); it stays **optional/nullable** on `stop` and
`targets[]` items to preserve the existing honest-null pattern for framework-default
fallback (`stop.anchor: null` → 1.5×ATR default; `targets: []` → Style C 33/33/33 default).

**Critical ordering constraint — this is the actual mechanism, not the field's mere
existence:** Ollama's `/api/chat` `format` object drives GBNF-grammar-constrained sampling,
which walks each object's `properties` **in JSON-schema declaration order** during
generation (confirmed by the existing minimal-schema's own design rationale — Wave 26 Pass
L flattened the schema specifically to control gemma4:e4b-it-qat's generation path). For the
mechanism to work — "the trader's words sit in the generation window while the condition is
being written" — **`transcript_quote` MUST be declared as the FIRST property in each
object's `properties` block**, before `action` (entry_sequence), before `description`
(confluences), before `anchor` (stop), before `type` (targets). If `transcript_quote` is
declared after the condition text, the model has already committed to the paraphrase before
it types the quote, and the whole mechanism degenerates back into the current
`rationale`-is-a-paraphrase-anyway behavior. **This ordering requirement is a first-class
part of the schema spec, not an implementation detail** — pass-1's parity/coverage tests
must assert property order, not just property presence.

### 2.2 Prompt change

Add a new anti-pattern section **"D. QUOTE-THEN-WRITE"** to
`src/agents/transcript-extractor-minimal.md`, parallel to the existing A/B/C sections,
placed immediately after section C (before "Output shape"):

> ### D. QUOTE-THEN-WRITE — copy the evidence BEFORE you write the condition
>
> For every `entry_sequence` step and every `confluences` condition (and `stop`/`targets`
> when the speaker states them explicitly): first copy a literal, verbatim, contiguous
> phrase from the transcript (≤150 characters) into `transcript_quote`. THEN write the
> condition. **The condition you write must not assert anything the quote you just copied
> does not support** — no added direction, no added timeframe, no added specificity beyond
> what the quote actually says.
>
> ❌ **WRONG** (the pilot's actual failure — `CLDEIsNpVRc`):
> ```json
> {"transcript_quote": "wait for price to close below the 1-minute FVG",
>  "action": "Take a long position after price closes above the bearish FVG."}
> ```
> The quote says BELOW; the action says ABOVE. If you just copied "close below" you cannot
> also write "close above" two lines later — check what you copied before you commit the
> claim.
>
> ✓ **RIGHT**:
> ```json
> {"transcript_quote": "wait for price to close below the 1-minute FVG",
>  "action": "Take a short position after price closes below the 1-minute FVG."}
> ```
>
> If you cannot find a literal quote that supports the exact condition you are about to
> write, **do not invent one and do not force the fit**. Either narrow the condition to
> only what the quote actually says (a quote giving "minimum 1x, ideally 1.5x-2x" supports
> a condition saying "at least 1x, ideally 1.5x-2x" — NOT a condition saying "targets 2x"),
> or drop the condition and add it to `rejected_strategies[]` with reason
> `not_enough_rules` if it was load-bearing.

This directly targets classes A, D, E, F, G, H, I from §1 (the quote is the literal check
against invented direction, invented range-collapse, invented emphasis/causality, invented
missing actions, invented scope-broadening). It does **not** directly fix class C
(unrelated-anchor) — see §4.

---

## 3. SCHEMA-CHANGE PROTOCOL GATES — all four pre-registered before pass-1 build

Per `docs/designs/h1-wave6-extractor-iteration-preregistration-2026-07-12.md` §3 and
`[[feedback_schema_is_decision_boundary_constrained_sampling_2026_07_12]]`: adding a
required per-condition field to the constrained-sampling grammar perturbs the ENTIRE
distribution, not just the new field — every gate below exists to bound that perturbation
before it reaches the fresh set.

### Gate 1 — 5-fixture parity gate
- Command: `tsx scripts/wave26-gemma4-smoke-test.ts --parity-only` (CLAUDE.md §2b,
  `extraction.parity_test_run` hook).
- Requirement: MUST report PASS before merge.
- If the schema change breaks one or more of the 5 frozen fixtures (expected, since none of
  them currently exercise `transcript_quote`): the fixtures are **updated + re-frozen with
  written rationale** in the same pass-1 commit — never silently loosened, never skipped.
  The rationale must state, per fixture, what changed and why the new expected output is
  still correct (not just "made it pass").

### Gate 2 — Coverage-stability
- **Baseline (pre-registered NOW, from Phase-1 pilot totals in READ-NOTES):** 25
  strategies, **253 spine conditions**, across the spent-16.
- **Floor (pre-registered NOW):** re-running pass-1's extractor over the same spent-16
  transcripts must yield **≥ 90% of 253 = ≥ 228 total spine conditions**. This is a floor,
  not a target — more conditions is not penalized (the pre-reg's binding concern is
  quote-as-you-extract making the model emit FEWER conditions to dodge the quoting
  burden, not more).
- **Per-strategy guard (pre-registered NOW, catches localized collapse an aggregate floor
  could mask):** no single one of the 25 strategies may lose more than 50% of its own
  original condition count. (E.g. `dV7chra4u4Q` s0 had 19 conditions in the pilot; pass-1
  must retain ≥ 10 for that strategy specifically, even if the aggregate floor is met.)
- Both checks run as part of pass-1's regression suite, not as a one-off manual count.

### Gate 3 — Pre-registered design-pool support-rate target
- **Target (already frozen in the pre-reg, restated with the exact baseline it's measured
  against):** combined per-condition support-miss rate (both-agree-denied + both-agree-
  partial + contested, using the SAME strict contested-downgrade rule as the frozen pilot
  read per `CONDUCTOR-PRECOMMIT-RULES-2026-07-12.md`) must fall from the pilot's measured
  **~25%** to **≤ 8%** on the DESIGN-side data.
- **Measured on:** the spent-16 (now the gold regression corpus per pre-reg §2), re-run
  through the new pass-1 extractor with `transcript_quote` populated. **Never the fresh
  sealed set** — that read happens exactly once, after pass-1 clears all four gates
  (pre-reg §4).
- **Grading procedure for this interim gate (pre-registered NOW, distinct from the
  terminal fresh-set protocol which stays two-blind-rater):**
  1. **Mechanical pre-filter (free, run first):** literal substring containment check —
     does `transcript_quote` appear verbatim (case-insensitive, whitespace-normalized) in
     the source transcript? A quote that fails this check is an automatic support MISS,
     no rater needed. This is a genuinely new, near-zero-cost integrity check that did not
     exist before (the old `description`/`rationale` fields were free paraphrase, not
     literal-quote-constrained, so nothing was substring-checkable).
  2. **One-rater semantic pass (not the full blind-paired protocol)** on everything that
     survives the mechanical filter: does the condition's claim match what the quote
     actually supports? One rater is sufficient for this interim design-gate because it is
     not the terminal verdict — the fresh-set read in pre-reg §4 still gets the full
     two-blind-rater protocol. Using one rater here bounds design-pass rater cost while
     keeping doer≠grader (the rater is not the pass-1 implementer).
- If gate 3 misses on pass-1: pass-2 (of the ≤2-pass budget) gets exactly one more
  iteration on the prompt/schema before the budget is spent and §5 of the pre-reg's fork
  fires.

### Gate 4 — Doer≠grader independent grade
- Per `ratify-packet` + `grading-integrity`: the pass-1 implementer (a scope-locked agent)
  does not grade its own gates 1–3. A fresh-context independent grader re-derives all four
  gate results from the artifacts (parity test output, condition-count diff, mechanical
  substring-check output, one-rater support-grade file) before pass-1 is declared cleared.
- A self-reported "gates 1–3 all pass" from the implementer is `status=CLAIMED`, not
  `VERIFIED`, until this independent re-derivation runs.

---

## 4. SCOPE + WHAT PASS-1 DOES NOT TOUCH

**In scope (extractor only):**
`src/agents/transcript-extractor-minimal.md` (prompt), `src/agents/kb/transcript-extractor-minimal-schema.json`
(schema), the 5 frozen parity fixtures (updated only if broken, with rationale), and the
pass-1 regression suite (coverage-stability + mechanical substring-check tooling, new).

**Explicitly OUT of scope for pass-1 (unchanged):** the anchor-locator, the tier-1/tier-3
classification (Addendum 4/5/7 machinery), the two-stage cert schema, the downstream
conveyor (Phase-1 assembler, DSL guards, framework-overlay.ts defaults). None of these are
edited, retrained, or reconfigured by this packet.

**The interaction worth flagging (design note, not a build decision):**

Today, the anchor-locator's job is **generative retrieval**: given only the extractor's
paraphrased condition text (no quote), search the whole transcript and propose the
best-matching span. This is exactly where class C (unrelated-anchor mis-grounding, ~21% of
the pilot's misses) originates — retrieval is a harder, more open-ended task than
verification, and it has no way to know the extractor's condition already drifted from
anything actually said, so it proposes *something* plausible-sounding instead of correctly
finding nothing.

With `transcript_quote` populated at extraction time, the locator's job for anchored
conditions **shifts from propose-a-grounding to verify-the-extractor's-own-quote**: (a) does
the claimed quote literally exist in the transcript (mechanical, ~free — this is Gate 3's
pre-filter reused), and (b) does the condition still match what that quote says (a narrow
self-consistency check against the SAME generation's own evidence, not a cold search across
the whole transcript). Verification against a candidate is structurally easier and more
reliable than open-ended retrieval, so this recommends — but does **not**, in this design
packet, decide — collapsing the locator's normal-case path to verify-only, with the
existing generative-retrieval behavior demoted to a **fallback rescue path** used only when
`transcript_quote` is null (framework-default fields) or fails the mechanical substring
check (fabricated quote). This would be expected to suppress class C going forward, since
class C's root cause (locator inventing a plausible-but-wrong grounding for an
already-drifted condition) has no independent invention step left to go wrong in the
verify-only path.

This is flagged for a **future pass's scope decision**, not pass-1's — changing the
locator's role is a separate instrument change requiring its own packet, its own parity
check against whatever fixtures exercise locator behavior, and its own coverage/support
gates. Pass-1 ships `transcript_quote` and lets the *existing* locator consume it
opportunistically if it already has logic to prefer a supplied quote (verify first) before
falling back to search — but does not mandate or build that branch.

---

## 5. CONFIRMATIONS

- Designed against the **spent-16 gold regression corpus** (`raterA_stage2.json` /
  `raterB_stage2.json` / `READ-NOTES-2026-07-12.md`) and the **design pool** (the existing
  minimal-8field schema + prompt) **only**. No fresh Wave-6 sealed-set transcript was
  opened, referenced, or assumed to exist by this packet.
- No extractor prompt, schema, or code file was edited. `src/agents/transcript-extractor-minimal.md`
  and `src/agents/kb/transcript-extractor-minimal-schema.json` were read-only inputs to this
  design.
- No commit was made.
- This packet stages the receipt required by `ratify-packet`'s autonomous-class flow (what
  & why, blast radius, exact scope-locked change, verification plan = the four gates in §3,
  rollback = revert the two edited files + the fixture updates, all bundled in one
  reversible commit pre-merge). Pass-1 BUILD may now proceed via the agent-loop
  (scope-locked implementer → fresh-context independent grader) without further operator
  permission-wait, per the 2026-07-11 operator amendment — this is pre-live, not
  irreversible/live-capital class.
