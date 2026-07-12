# H1 Tier-1 Deterministic Gradient Detectors — SPEC (2026-07-12)

> **Status: SPEC ONLY.** No detector implementation lands from this document. Per the frozen
> `#7-before-#6` dependency (`phase-1-h1-preregistration-2026-07-12.md` §6), the Wave-2 SPEC may
> be written in parallel with Wave-1, but the **implementation gates on Wave-1's failure-mode
> report**, which is not yet available. Every decision that requires that report is quarantined in
> §6 (WAVE-1 FEED) and left as an explicit `TODO-GATED-ON-WAVE-1` — none are resolved here by
> guessing.
>
> **Author seat = doer.** This spec is review-ready and implementation-ready except where §6 marks
> a gate. It does not certify any detector; birth-gating (§3) and the held-out read (§4) are the
> load-bearing evidence gates, run at implementation time.

## Read-order (the law this spec obeys)
1. `phase-1-h1-preregistration-2026-07-12.md` — frozen H1 pre-reg. §0(a) tier-1 definition; §4
   certificate schema; §7 engagement-birthright + type specimens + 143/70 + ≤1.85× tripwire.
2. `corpus-v3-gate1-respecification-2026-07-05.md` — the surface-gradient finding (lines 894-904),
   the type specimens (N04/N34 positive, N06/N28 negative, lines 896-898 + 876-877), and the
   frozen overfit numbers (design 34.35% vs held-out 17.14% = 2.00×, lines 63-65 + 101).
3. `corpus-v3-classifier-iteration-2026-07-06.md` — the CLOSED classifier track's dying gift: which
   patterns proved reliable (entry-trigger/retest → gate) vs which died (retracement-level /
   probabilistic language needed DISCOURSE, not the sentence).

---

## §0 — What tier-1 IS (and the one thing it must never do)

Tier-1 is a set of **deterministic surface-pattern detectors** that fire ONLY on the surface
classes the corpus-v3 gate-1 re-specification proved carry gate-strength **in the sentence itself**,
frame-strip-invariant. Per the frozen surface gradient (`corpus-v3-gate1-respecification` line 901):

> **imperative** (always carries) → **conditional-action + exclusion-contrast** (CARRIES) →
> **intent-narration + probabilistic-expectation** (does NOT carry — recoverable only from discourse).

Tier-1 owns the left two bands. The right band is **tier-2's** (discourse-aware adjudication) — the
classifier's dying gift is that for those surfaces the margin lives in the discourse FRAME, not the
sentence (`phase-1-h1-preregistration` §0(b)). **Tier-1 claims ONLY what a surface pattern proves;
everything else FALLS THROUGH to tier-2 (§2). Tier-1 never guesses.**

Three detector families ship:
- **imperative** — already proven (control-gate 10/10 in the neutral adjudication, `gate1-respec`
  line 854; 5/5 imperatives → mandatory-gate at HIGH confidence). Recapped in §1.0, not re-derived.
- **conditional-action** — NEW (§1.1). Type specimen **N04**.
- **exclusion-contrast** — NEW (§1.2). Type specimen **N34**.

---

## §1 — The three detector families

Each family below defines: the surface pattern, the trigger vocabulary, the **boundary against
narration** (the thing that must make it stay SILENT), and the grounding citation. Vocabularies are
seeds; §4 mandates they be characterized from the **143-condition design set**, never from the type
specimens (the specimens are birth fixtures, not design inputs — see §3/§4).

### §1.0 — imperative (proven; recap only)
- **Pattern:** bare directive verb in command mood — "buy X", "sell when Y", "enter on Z", "don't
  trade during W". Subject elided; action is the main clause.
- **Boundary:** distinguished from narration by mood — a report of a past/hypothetical action ("I
  bought there", "you could buy") is NOT imperative.
- **Grounding:** `gate1-respec` line 854 (control gate 5/5 imperative → mandatory-gate, all HIGH);
  line 901 ("imperative — always carries"). This family is the tier-1 anchor; it is the one class
  where surface==gate is uncontested.

### §1.1 — conditional-action ("ACTION when/if/on TRIGGER")
The type-specimen band (**N04**). The claim tier-1 is allowed to make: a directive/entry action
**syntactically bound** to a trigger clause is a gate on the surface, frame-strip-invariant.

- **Surface pattern:** `<ACTION> <TRIGGER-CONNECTIVE> <TRIGGER-CONDITION>` (or the mirror
  `<TRIGGER-CONNECTIVE> <TRIGGER-CONDITION>, <ACTION>`). The action must be a directive/entry verb,
  and the trigger must be a concrete market condition the action is bound to.
- **Trigger connectives (seed — characterize from the 143):** `when`, `if`, `on` (as in "on the
  retest"), `once`, `after`, `as soon as`, `upon`, `the moment`. Connective must **bind the action
  to the condition**, not merely sequence narration ("then" alone is NOT a trigger connective — see
  boundary).
- **Action verbs (seed — characterize from the 143):** buy, sell, enter, take (a position/puts/
  calls), long, short, exit, add, scale, fade. Directive mood or infinitival-bound-to-connective.
- **Type specimen (POSITIVE, must FIRE) — N04:** *"buy from the demand zone when it is retested"* —
  "the action is bound to the trigger; `because` = rationale not hedge; frame-strip leaves the
  conditional intact" (`gate1-respec` line 896). The `when it is retested` clause is the gate.
- **Boundary vs narration (must stay SILENT):** the killer is **intent-narration**, present or past
  tense, where the "action" is a *state of looking* rather than a bound directive:
  - **N06 (NEGATIVE, must stay SILENT):** *"looking for a retracement opportunity to then buy"* —
    "intent-narration (present tense); frame-strip leaves no conditional" (`gate1-respec` line 897).
    `looking for … to then buy` is a described intent, not `buy WHEN <trigger>`. **The presence of
    a bare `then` after an intent verb (`looking for`, `waiting for`, `hoping`, `want`) is the
    narration signature — it must NOT be read as a trigger connective.**
  - **N28 (NEGATIVE, must stay SILENT):** *"what I was looking for"* — "past-tense narration, report
    of prior intent, not a stated gate" (`gate1-respec` lines 876-877). Past-tense framing of intent
    is out.
- **What tier-1 is NOT allowed to claim in this family** (the classifier's dying gift):
  **probabilistic-expectation** language — e.g. "price will probably retrace to the level" (the
  canonical N17 Fibonacci case, `gate1-respec` line 856-860, Afrikaans *"prys waarskynlik sal
  terugtrek"*) reads as narration on the surface; the gate was recoverable only from DISCOURSE.
  A conditional whose trigger is a *forecast* ("when price probably pulls back") FALLS THROUGH to
  tier-2, it does not fire tier-1.

### §1.2 — exclusion-contrast ("X, NOT Y")
The second type-specimen band (**N34**). The claim: an explicit **negative contrast between two
candidate trigger conditions** discriminates the gate on the surface — narration cannot produce a
clean negative contrast, so its presence is itself the proof of surface gate-strength.

- **Surface pattern:** `<ACTION/TRIGGER on X> <CONTRAST-MARKER> <Y>` where Y is an explicitly
  rejected alternative condition. The contrast is what carries — the detector fires on the
  **discrimination**, not on X alone.
- **Contrast markers (seed — characterize from the 143):** `, not …`, `not on/at …`, `rather than`,
  `instead of`, `never on/at …`, `and not …`, `but not …`. Marker must set two *comparable trigger
  objects* in opposition.
- **Type specimen (POSITIVE, must FIRE) — N34:** *"take puts on a VWOP retest, NOT a pre-market low
  retest"* — "the exclusion-contrast discriminates trigger conditions = gating on the surface … the
  negative contrast is what narration can't do" (`gate1-respec` line 898).
- **Boundary vs mere negation (must stay SILENT):** the family is NOT "any sentence containing
  `not`." It requires **two comparable trigger objects in opposition**. Guard against:
  - **Negated narration:** "I'm not sure the setup is there" — negation of a *state*, no contrasted
    trigger object. SILENT.
  - **Single-sided negative with no positive pole:** bare "don't take the pre-market low retest" is
    an imperative-negative (routes to §1.0 as an avoid-rule if directive; otherwise falls through),
    NOT an exclusion-contrast — there is no `X` it selects INSTEAD.
  - **`gate1-respec` line 898 anchor:** the doc itself notes *"bare 'looking to take puts on X' would
    fail like N06; the negative contrast is what narration can't do"* — i.e. strip the contrast and
    N34 collapses to N06's narration class. The contrast is load-bearing; without it, SILENT.

---

## §2 — High-precision / low-recall contract (the fall-through)

Tier-1 is **high-precision, low-recall BY DESIGN** (`phase-1-h1-preregistration` §0(a)). It exists to
classify the provable left of the gradient and to **hand everything else off cleanly**, never to
guess the ambiguous middle.

- **Positive claim:** a detector fires ONLY when its pattern matches with its guards satisfied. A
  fire emits `classifying_tier=1` and a `surface_class ∈ {imperative, conditional-action,
  exclusion-contrast}` with a verbatim `quote_anchor` + `char_span` (§5).
- **Fall-through behavior (LOCKED):** any span that no tier-1 detector fires on is emitted with
  `surface_class = cannot-determine-at-tier-1` and `classifying_tier = null`, and is **routed to
  tier-2** for discourse-aware adjudication. Fall-through is the DEFAULT, not an error state:
  - No tier-1 detector may emit a *low-confidence* fire. Confidence is not a dial tier-1 turns down
    to cover recall — an ambiguous match is a **non-match** (SILENT) and falls through.
  - Fall-through carries the span + char_span forward unmodified so tier-2 adjudicates the exact
    same surface tier-1 declined.
  - **Ties/overlaps:** if two detectors would fire on overlapping spans, that is an ambiguity →
    both SILENT on the overlap → fall through. (Non-overlapping fires on one segment are fine and
    expected — a segment can contain an imperative AND a separate conditional-action.)
- **Why never-guess is the contract:** the classifier track was CLOSED precisely because it was
  *human-equivalent (~67%) on the margin but could not demonstrably beat it* (`gate1-respec`
  lines 58-62). Tier-1 does not re-fight that battle — it claims only the surface it can PROVE and
  cedes the margin to tier-2/tier-3. A tier-1 that reaches for recall re-imports the ~67% margin
  ceiling into the layer that is supposed to be certain.

---

## §3 — Engagement-birthright fixtures (Law 1, pre-reg §7)

Per `phase-1-h1-preregistration` §7: *"Every tier-1 detector … ships with failure-injection fixtures
at birth: it must FIRE on known-positives AND stay SILENT on known-negatives, proven before it is
allowed to exist. Four dormancies were bought by shipping features that never fired."* This is a
**birth gate**, not a test suite you add later.

### §3.1 — Fixture format (per detector)
Each detector ships a fixture file with, at minimum:

```jsonc
{
  "detector": "conditional-action",          // family under test
  "positives": [                             // MUST fire
    { "id": "N04", "text": "buy from the demand zone when it is retested",
      "expect": { "fires": true, "surface_class": "conditional-action",
                  "anchor_substring": "when it is retested" } }
  ],
  "negatives": [                             // MUST stay silent
    { "id": "N06", "text": "looking for a retracement opportunity to then buy",
      "expect": { "fires": false } },
    { "id": "N28", "text": "what I was looking for",
      "expect": { "fires": false } }
  ]
}
```

Canonical fixture assignment (from the pre-reg + gate-1 respec type specimens):

| Detector | POSITIVE (must FIRE) | NEGATIVE (must stay SILENT) |
|---|---|---|
| imperative | control-gate imperative set (5/5, `gate1-respec` l.854) | control-gate descriptive set (5/5 contextual) |
| conditional-action | **N04** (l.896) | **N06** (l.897), **N28** (l.876-877) |
| exclusion-contrast | **N34** (l.898) | **N06** (l.897), + the contrast-stripped N34 ("looking to take puts on X", l.898) |

> The three additional negatives cross-wire: N06 (intent-narration) and N28 (past-tense narration)
> are the canonical narration counterexamples for BOTH new families — a conditional-action or
> exclusion-contrast detector that fires on them has reached into tier-2's band.

### §3.2 — Birth gate (pass condition, LOCKED)
A detector **does not exist** (may not be registered, may not run in the pipeline) until:

> **FIRES-ON-POSITIVES ∧ SILENT-ON-NEGATIVES** across its full fixture set, with **zero exceptions**.

- A positive that does not fire → detector FAILS birth (a dormant feature — the exact failure mode
  §7 forbids). A negative that fires → detector FAILS birth (a hallucinated gate — reaches into
  tier-2).
- The birth gate runs in CI as a hard gate (§7 test plan) and is re-asserted on every edit to the
  detector or its vocabulary.
- **Engagement-count rule (from `reference_vix_margin_dormant`):** every detector ships with a live
  fire-count assertion — a detector whose fire count is 0 across the design set is presumed dormant
  and blocked, not shipped-and-hoped.

---

## §4 — Overfit discipline

The gate-1 re-specification **already froze** that the legacy deterministic-rule layer overfit its
design split: *"deterministic-rule coverage design-set 34.35% vs held-out 17.14% = 2.00× → rules
OVERFIT the design split"* (`gate1-respec` lines 63-65, re-frozen line 101). The pre-reg pins the
tripwire **tighter than that historical number**: **≤ 1.85×** (`phase-1-h1-preregistration` §7). The
new families must therefore generalize BETTER than the layer that was closed for overfitting.

### §4.1 — Design/validation split (LOCKED)
- **DESIGN on the 143-condition rules-design set ONLY.** All pattern vocabularies (connectives,
  action verbs, contrast markers) are characterized from the 143 (`gate1-respec` line 48; iteration
  doc HARD-DISCIPLINE point 1). The type specimens (N04/N34/N06/N28) are **birth fixtures, NOT design
  inputs** — designing a detector to move a known specimen is memorization wearing a rule's clothes
  (`gate1-respec` line 442, iteration doc lines 27-30).
- **VALIDATE on the held-out 70, single-shot** (`gate1-respec` line 49). The held-out set is opened
  ONCE per detector version to measure generalization; iterating against held-out results converts
  it into a second design set and voids it.

### §4.2 — Overfit ratio (computation, LOCKED to the gate-1 definition)
Matching the frozen metric (`gate1-respec` line 63):

```
overfit_ratio = tier1_coverage(design_143) / tier1_coverage(heldout_70)
```

where `tier1_coverage(S)` = (# conditions in S on which ANY tier-1 detector fires) / |S|. Computed
per detector-family AND for the tier-1 layer as a whole (the whole-layer ratio is the one the
tripwire gates on; per-family is diagnostic).

- **PASS:** `overfit_ratio ≤ 1.85` (the pinned tripwire).
- **EXCEEDED (`> 1.85`):** the added coverage is design-split-specific → the family is **rejected
  for that version** exactly as option-(a) rule expansion was rejected (`gate1-respec` line 101,
  "more rules likely overfit further"). The response is NOT to relax the tripwire (that is the
  goalpost-move the gate-1 discipline note forbids, `gate1-respec` lines 68-73) — it is to
  re-characterize the pattern from the 143 toward a more general form, or to concede the band to
  tier-2 (a narrower tier-1 with a lower ratio beats a broader one over the tripwire).
- **Precision companion (advisory, not the tripwire):** track tier-1 precision (fires that a blind
  rater confirms are genuine gates) on design vs held-out. A large precision drop design→held-out
  is the same overfit signature the coverage ratio catches; report it alongside but gate on the
  coverage ratio per the frozen definition. *(Whether precision should co-gate is a §6 WAVE-1-FEED
  item — Wave-1's failure modes may show coverage-ratio alone is insufficient.)*

### §4.3 — Anti-memorization pre-commit
A detector version that (a) raises coverage on the 143 but NOT on the held-out 70, or (b) fires only
on spans resembling the type specimens, is **memorization → rejected** before it reaches the
certificate stage (`gate1-respec` line 442; iteration doc line 29). The held-out coverage must
**improve-or-hold** relative to the prior version, exactly as the classifier iteration required its
held-out margin to improve-or-hold (iteration doc lines 24-26).

---

## §5 — Interfaces

### §5.1 — Detector input
```
DetectorInput {
  segment_text:  string          // the transcript segment under test (sentence/clause granularity)
  char_span:     [number, number]// [start, end] of segment_text into the FULL transcript
  full_transcript_sha256: string // provenance carry (matches cert schema §4 provenance)
}
```
Segmentation (how the transcript is chopped into segments) is a pipeline concern upstream of tier-1;
the detector treats `segment_text` as its unit and reports char offsets relative to the full
transcript so anchors are globally resolvable.

### §5.2 — Detector output (per fired span; matches pre-reg §4 certificate schema)
```
Tier1Detection {
  surface_class: "imperative" | "conditional-action" | "exclusion-contrast"
  classifying_tier: 1
  quote_anchor:  string          // the trader's VERBATIM words that constitute the gate
  char_span:     [number, number]// [start, end] of quote_anchor into the FULL transcript
  confidence:    number          // [0,1]; see below — tier-1 emits ONLY high-confidence fires
}
```
- **Confidence semantics:** tier-1 confidence is NOT a recall dial (§2). A detector emits a fire
  only above a fixed high-confidence floor; anything below is a non-match → fall-through. The exact
  numeric floor is a **§6 WAVE-1-FEED** item (Wave-1's economics/failure data informs how tight the
  floor must be to hold tier-3 invocations ≤ 1/video). Until then the floor is a parameter, not a
  guessed constant.
- **Fall-through record (per span with no fire):**
  ```
  Tier1FallThrough { surface_class: "cannot-determine-at-tier-1", classifying_tier: null,
                     char_span: [number,number] }  // routed to tier-2
  ```

### §5.3 — Mapping to the frozen certificate (pre-reg §4)
`Tier1Detection` is the tier-1 contribution to a spine condition's certificate entry. It populates
`surface_class`, `classifying_tier`, `quote_anchor`, and `char_span` directly. The remaining
certificate fields are OUT OF TIER-1 SCOPE and populated downstream:
- `adjudication_verdict` — tier-3 only (present iff `classifying_tier == 3`).
- `compile_integrity` lints (direction_conflation, unsat_sat, or_alternatives, f2_coverage,
  causality) — the compile stage; their exact set/format is a **§6 WAVE-1-FEED** item.
- `provenance`, `scope_line` — the certificate assembler.

Tier-1 must NOT assert any field it cannot anchor: a `Tier1Detection` without a resolvable
`char_span` into the full transcript is invalid and is discarded to fall-through (the claim-scoping
rule baked into pre-reg §4).

---

## §6 — WAVE-1 FEED (the honest dependency surface)

Per `phase-1-h1-preregistration` §6, Wave-1 (the (b)-cert shakedown / 14-concept demotion adjudication)
produces three load-bearing outputs: (i) demotion per-concept fidelity verdict, (ii) the certificate
machinery's **failure-mode list**, (iii) real tier-3 throughput/cost. **The IMPLEMENTATION of the
items below cannot be resolved without that report. They are left as explicit gated TODOs — resolving
any by guessing would violate the frozen dependency.**

- **`TODO-GATED-ON-WAVE-1 [A] — ambiguity routing (tier-3 vs retry-at-tier-1).** When a span is
  ambiguous, the current spec routes it uniformly to tier-2 fall-through (§2). Wave-1's failure-mode
  list may show distinct ambiguity CLASSES that warrant different handling — e.g. a class that
  should skip tier-2 and go straight to tier-3 adjudication, vs a class worth a second tier-1 pass
  with a relaxed guard. **The class→route table is UNSET until Wave-1 enumerates the classes.** (This
  is the specific item the task names.)
- **`TODO-GATED-ON-WAVE-1 [B] — tier-1 confidence floor (§5.2).** The high-confidence floor that
  separates a fire from a fall-through must be set so that tier-3 invocations land ≤ 1/video
  (pre-reg §1 ECONOMICS rider). That budget is derived from Wave-1's real per-adjudication
  throughput/cost (output iii). **Floor UNSET until then** — it is a parameter, not a constant.
- **`TODO-GATED-ON-WAVE-1 [C] — compile-integrity lint set (§5.3).** Which lints run, their exact
  pass/fail semantics, and the offending-anchor format are shaped by the certificate machinery's
  FAILURE-MODE list (output ii). The pre-reg §4 names five lints; Wave-1 tells us which failure modes
  they actually caught and whether the set is complete. **Lint spec deferred to the compile-stage
  sub-spec, gated on Wave-1.**
- **`TODO-GATED-ON-WAVE-1 [D] — fall-through boundary tuning vs (b)-cert.** Wave-1's demotion
  per-concept fidelity verdict (output i) may show the tier-1/tier-2 boundary should sit at a
  different place for specific concept families (e.g. concepts where discourse reliably recovers a
  gate might tolerate a stricter tier-1). **The boundary is set by this spec's surface gradient for
  now; Wave-1 may adjust it — do NOT pre-adjust.**
- **`TODO-GATED-ON-WAVE-1 [E] — overfit precision co-gate (§4.2).** Whether precision (not just
  coverage ratio) must co-gate against the tripwire depends on whether Wave-1's failure modes include
  high-coverage/low-precision families the coverage ratio misses. **Advisory-only until Wave-1.**

---

## §7 — Test plan

### §7.1 — Unit fixtures per detector (the birth gate, §3)
- Each detector's fixture file (§3.1) runs as a unit suite: every positive asserts `fires==true` +
  correct `surface_class` + anchor substring present; every negative asserts `fires==false`.
- **Pass condition = the §3.2 birth gate** (fires-on-pos ∧ silent-on-neg, zero exceptions). Wired as
  a CI hard gate — a RED birth suite blocks the detector from registration.
- Fire-count assertion (engagement-birthright): each detector fires ≥1 time across the 143 design set
  (dormancy guard).

### §7.2 — Held-out validation harness (§4)
- Runs the full tier-1 layer across the **held-out 70**, single-shot per detector version.
- Emits per-family and whole-layer `tier1_coverage(design_143)` and `tier1_coverage(heldout_70)`.
- **Blind-precision leg:** a control-gated blind rater (fresh context; NO detector output visible)
  adjudicates a sample of tier-1 FIRES on the held-out set as genuine-gate / not — the doer≠grader
  precision check (mirrors the gate-1 independent-rater discipline). Reported alongside coverage.

### §7.3 — Overfit-ratio check (§4.2, LOCKED gate)
- Computes `overfit_ratio = tier1_coverage(design_143) / tier1_coverage(heldout_70)` for the whole
  layer.
- **GREEN iff `overfit_ratio ≤ 1.85`.** `> 1.85` → the detector version is rejected (§4.2); the
  harness prints the offending per-family ratios so the over-covering family is identifiable.
- Anti-memorization assertion: held-out coverage improves-or-holds vs the prior detector version
  (§4.3); a version that only moves design-set coverage fails this leg even if the ratio is under
  1.85×.

### §7.4 — Interface/contract tests
- Every emitted `Tier1Detection` has a `char_span` that resolves to `quote_anchor` verbatim in the
  full transcript (claim-scoping invariant, §5.3). A non-resolving anchor is a hard failure.
- Every non-fired span emits exactly one `Tier1FallThrough` with `classifying_tier == null` (no span
  is silently dropped — the anti-goalpost of recall is that fall-through is explicit and counted).

---

## §8 — Location confirmation + flagged gaps (honesty ledger)

**Type specimens — ALL FOUR LOCATED and quoted verbatim** in
`corpus-v3-gate1-respecification-2026-07-05.md`:
- **N04** (positive, conditional-action) — line 896: *"buy from the demand zone when it is retested"*.
- **N34** (positive, exclusion-contrast) — line 898: *"take puts on a VWOP retest, NOT a pre-market
  low retest"*.
- **N06** (narration negative) — line 897: *"looking for a retracement opportunity to then buy"*.
- **N28** (narration negative) — lines 876-877: *"what I was looking for"* (past-tense intent).

The surface-gradient finding that names these as type specimens / counterexamples is frozen at
`gate1-respec` line 901 and the verdict at line 904.

**143/70 split — LOCATED.** Design set = **143 rules-design conditions** (`gate1-respec` lines 48,
451, 553, 570); held-out = **70** (`gate1-respec` lines 49, 114, 452). Frozen coverage numbers:
design 34.35% vs held-out 17.14% = **2.00×** (lines 63-65, 101). Tripwire **≤ 1.85×** from
`phase-1-h1-preregistration` §7.

**Flagged gaps (NOT invented):**
- **The 143 conditions and the 70 held-out conditions are referenced by count and by aggregate
  coverage, but the per-condition TEXT/IDs are not enumerated in these design docs.** The detector
  vocabularies in §1 are seeds to be characterized from the actual 143 at implementation time
  (§4.1); this spec does not fabricate that set. If the 143/70 condition tables are not retrievable
  from the audit artifacts (`dri-audit-2026-07-05.json` and the rules-design source referenced at
  `gate1-respec` line 33), that is a hard blocker for §4 and must be surfaced before implementation —
  flagged here rather than papered over.
- **Five certificate `compile_integrity` lints** are named in pre-reg §4 but their semantics are a
  Wave-1-gated item (§6[C]) — not specified here by design.
- **The tier-1 confidence floor and the ambiguity class→route table** are unset (§6[A], §6[B]) — the
  two decisions the frozen `#7-before-#6` order explicitly reserves for Wave-1.
