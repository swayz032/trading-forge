# H1 WAVE-6 PASS-2 — TWO-PHASE EXTRACTION — DESIGN PACKET (ratify-packet, autonomous-class)

> Status: DESIGN ONLY. No extractor/enumerator prompt, schema, or orchestration code has
> been touched. Authored against the **spent-16 gold regression corpus + design pool
> ONLY** (`docs/replay-results/h1-scripts/wave6-pass1-design-pool/`) — the fresh Wave-6
> sealed set (`docs/designs/h1-wave6-sealed-fresh-set-2026-07-12.json`, sha `4d7b3c29…`)
> was not opened, read, or referenced beyond its filename/sha. Outranks nothing; is
> outranked by `docs/designs/h1-wave6-extractor-iteration-preregistration-2026-07-12.md`
> §11 (the frozen ruling this packet specs — its shape is not re-negotiated here), by
> CLAUDE.md §12 (bidirectional-completeness) and §13 (fixed-point-stop ban), and by the
> `extraction-campaign` skill's seven Laws.
>
> Class per `ratify-packet`: **instrument-touching** (extraction-fidelity logic, a NEW
> instrument added) → autonomous-class (pre-live, not irreversible/live-capital) → this
> packet is the staged receipt; pass-2 BUILD proceeds via agent-loop (scope-locked
> implementer → fresh-context independent grader) without further operator
> permission-wait, per the 2026-07-11 operator amendment. This is the **last swing** of
> the ≤2-pass budget (§3/§11 of the pre-reg) — gates clear → freeze SHA → terminal read
> on the fresh 12; gates short → the pre-written Phase-1 fork fires (§5).

---

## 0. WHAT §11 ALREADY DECIDED (not re-derived here)

Pass-1 (quote-first, single-phase) improved condition grounding (Gate 3 target aimed at
25%→8% support-drift) but conflated two different questions: strategy SEGMENTATION
(needs the WHOLE transcript, a global view) and condition GROUNDING (needs contiguous
local quotes). Anchoring every condition to a contiguous quote span silently merged two
interleaved variants on `WEhmadJArQo` into one collapsed strategy, dropping all three of
variant B's distinctives (15-minute opening-range timeframe, passive-limit-order
confirmation, 2:1 target) — Gate 2 FAILED per the §10 content check
(`docs/designs/h1-wave6-extractor-iteration-preregistration-2026-07-12.md` lines
100–101). §11 separates the two questions into two phases. This packet specs that
architecture; it does not re-litigate whether two phases is right — that is the frozen
ruling.

**Method line this packet carries forward (house method as of §11):** proxy trips →
adjudicate → adjudication ambiguous → decide on PURPOSE, from source. Every guard below
that can trip is built on this ladder, not on a raw threshold alone.

---

## 1. PHASE A — GLOBAL STRATEGY ENUMERATION (new instrument)

### 1.1 Task framing

Phase A's task is **identical** to the task the three blind adjudicators performed
tonight (3-for-3 sensible, transcript-alone, per §9b of the pre-reg): *"How many DISTINCT
strategies — each with its own entry logic AND exit/management logic — does this video
teach? Enumerate them."* Their standard becomes the prompt's standard verbatim:

- **Distinct strategy** = a strategy that differs from every other enumerated strategy in
  its **entry logic OR its exit/management logic** (either axis is sufficient to be
  distinct; sharing one axis while differing on the other is still distinct).
- **NOT distinct — a VARIANT within one strategy**: timeframe changes (5m vs 15m chart),
  confirmation-mechanic changes (wait-for-engulfing vs set-a-passive-limit-order),
  target-R changes (3:1 vs 2:1) — these are configuration differences on the SAME
  entry/exit skeleton, enumerated as `variants[]` inside one strategy object. This
  matches the library's live variant-family ontology
  (`src/server/lib/slumhouse/premium-names.ts` — `familyKeyFor()` groups by archetype,
  `variantTag` carries timeframe/session/symbol detail as sub-strategy metadata, not a
  separate strategy identity).

### 1.2 Input

Whole transcript, single call, no chunking. This is the load-bearing property that makes
Phase A a genuinely NEW instrument rather than a bigger version of Phase B: Phase B's
quote-first anchoring is contiguous-span-local by construction (that locality is what
made it a good condition-grounding tool and a bad segmentation tool — §11's diagnosis).
Phase A needs the opposite property: a view wide enough to notice a second entry/exit
skeleton taught in a DIFFUSE or INTERLEAVED way (WEh's actual failure mode) rather than
in one contiguous block.

### 1.3 Output schema — new file `src/agents/kb/strategy-enumerator-schema.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "StrategyEnumeratorOutput",
  "type": "object",
  "additionalProperties": false,
  "required": ["strategies"],
  "properties": {
    "strategies": {
      "type": "array",
      "description": "Distinct strategies taught in this video. Distinct = own entry OR exit/management logic. Empty array is honest if no strategy is taught.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["strategy_id", "name", "entry_summary", "exit_summary", "variants"],
        "properties": {
          "strategy_id": { "type": "integer", "minimum": 0 },
          "name": { "type": "string", "maxLength": 80 },
          "entry_summary": {
            "type": "string", "maxLength": 300,
            "description": "1-2 sentence entry logic — the axis that must differ for another strategy to count as distinct from this one."
          },
          "exit_summary": {
            "type": "string", "maxLength": 300,
            "description": "1-2 sentence exit/management logic — the other distinctness axis."
          },
          "variants": {
            "type": "array",
            "description": "Configuration differences on THIS strategy's skeleton (timeframe / confirmation mechanic / target). NOT separate strategies. Empty array if the speaker teaches only one configuration.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["variant_label"],
              "properties": {
                "variant_label": { "type": "string", "maxLength": 80 },
                "timeframe_note": { "type": ["string", "null"], "maxLength": 120 },
                "confirmation_mechanic_note": { "type": ["string", "null"], "maxLength": 120 },
                "target_note": { "type": ["string", "null"], "maxLength": 120 },
                "transcript_quote": {
                  "type": ["string", "null"], "minLength": 5, "maxLength": 150,
                  "description": "Optional locating quote for this variant — a hint for Phase B, not a hard grounding requirement (Phase B does its own quote-first grounding)."
                }
              }
            }
          }
        }
      }
    },
    "enumeration_note": {
      "type": ["string", "null"], "maxLength": 400,
      "description": "Free-text flag for ambiguous cases, e.g. 'two variants share an identical skeleton, differ only in TF/confirmation/target'. Surfaced for the over-enumeration fence's review, never scored directly."
    }
  }
}
```

### 1.4 Prompt spec — new file `src/agents/strategy-enumerator.md`

- Opens with the task framing verbatim from §1.1.
- **Over-split warning (textual half of Guard 1):** "Do NOT create a new strategy entry
  for every confluence or condition difference. Chart timeframe, confirmation trigger
  (e.g. wait-for-engulfing vs a passive limit order), and R-multiple target are
  CONFIGURATION differences — group them as `variants[]` inside ONE strategy object."
- **Under-split warning (textual half of Guard 1):** "If two teaching sections use
  genuinely different entry triggers or different exit/management rules, they are
  SEPARATE strategies even if they share surface vocabulary (e.g. both mention 'fair
  value gap') or an identical instrument/timeframe."
- **Ambiguity instruction:** if a case is genuinely undecidable on the same-skeleton
  axis (WEh's own adjudicator flagged this — "a reasonable adjudicator could score this
  as 1"), enumerate it EITHER way and use `enumeration_note` to flag the ambiguity —
  correctness downstream is decided by content-preservation (§10 ladder), not by
  Phase A picking the "right" number under pressure.
- Worked example: reproduce the WEh transcript's two-variant shape (opening-range 15m /
  passive-limit / 2:1 vs the 5m/engulfing/3:1 variant) as the canonical
  one-strategy-two-variants worked example, since it is the fixture this whole packet
  exists to fix.

---

## 2. HANDOFF CONTRACT — PHASE A → PHASE B

- **One Phase-B call per Phase-A-enumerated strategy.** If Phase A enumerates N
  strategies for a video, Phase B (the existing quote-first extractor,
  `src/agents/transcript-extractor-minimal.md` +
  `src/agents/kb/transcript-extractor-minimal-schema.json`) is invoked N times, each call
  SCOPED to exactly one Phase-A strategy object (its `entry_summary`, `exit_summary`, and
  `variants[]`). Variants do **not** get their own Phase-B call — they are extracted
  INSIDE the one scoped call for their parent strategy, as differences within that
  strategy's `entry_sequence` / `confluences` / `stop` / `targets` fields.
- **Scoping instruction injected into Phase B's call (prompt-assembly, not a schema
  change):** *"This call is scoped to ONE strategy: {entry_summary} / {exit_summary}. If
  the transcript teaches other strategies elsewhere, do NOT extract conditions for them
  — another call handles each of those separately."* This directly targets the pass-1
  failure: quote-first anchoring to contiguous evidence had no signal that it was
  looking at interleaved teaching from TWO skeletons: Phase A's summary is that signal,
  handed to Phase B before it starts quoting.
- **Variant checklist injection (the mechanism that actually rescues WEh):** for every
  entry in Phase A's `variants[]` for this scope, Phase B's prompt receives an explicit
  checklist item: *"Variant '{variant_label}' — timeframe: {timeframe_note},
  confirmation: {confirmation_mechanic_note}, target: {target_note}. Attempt to
  quote-ground this variant's distinctives as their own entry_sequence step /
  confluence / target. If you cannot find a literal quote for a checklist item, do NOT
  drop it and do NOT invent a quote — emit it with the no-quote sentinel (§3 below)."*
  This converts Phase-A's global enumeration into a per-item obligation Phase B cannot
  silently skip, which is the direct fix for "quote-first anchoring merged interleaved
  variants and silenced the second" — Phase B is no longer discovering variant B by
  free-association within one contiguous span; it is checking off a pre-named list.
- **Orchestration location (build-time detail, not built by this packet):** this handoff
  wiring — calling Phase A once, fanning out N scoped Phase-B calls, assembling the
  per-call checklist string — lives in the orchestration layer alongside
  `src/engine/extraction/extractor_bridge.py` / `src/engine/extraction/pilot_conveyor.py`
  and the design-pool runner `scripts/h1_wave6_pass1_design_pool.py`. This packet does
  not verify or modify those files; it names them as the wiring's home for the build
  step.
- **Downstream assembly:** Phase B's N per-strategy outputs are concatenated into the
  same top-level `strategies[]` array shape the existing pipeline already consumes — no
  change to the OUTER schema the downstream conveyor (Phase-1 assembler, DSL guards,
  framework-overlay.ts) sees. The two-phase split is invisible past the extraction
  boundary; this preserves schema stability for every downstream consumer (critic,
  paper, prop sim, portfolio, export) per this agent's authority mandate.

---

## 3. PHASE B — THE NO-QUOTE SENTINEL (§8b, added this pass)

### 3.1 What is actually broken today

`src/agents/kb/transcript-extractor-minimal-schema.json` already types
`transcript_quote` as `["string", "null"]` at all four locations (`entry_sequence[]`,
`confluences[]`, `stop`, `targets[]`), and `required` only enforces the KEY's presence,
not non-null — so a null `transcript_quote` is already schema-LEGAL today. What is
**not** in place is the honest-intent signal: the shared description text (identical,
copy-pasted, across all four locations) reads *"Set null ONLY when the paired field is
itself null (e.g. `stop.anchor=null`...)"* — a sentence that describes `stop`'s
null-cascade pattern correctly but makes no sense pasted onto `entry_sequence[]` or
`confluences[]`, which have no "paired field" to cascade from. Today there is no
sanctioned path for "I extracted this condition but genuinely cannot find a literal
quote for it" on the two REQUIRED-quote locations — the model is left inferring from a
mismatched sentence, which is functionally the fabricate-or-drop trap §8b names.

### 3.2 The fix (minimal schema diff — description-only, no structural change)

At `entry_sequence[].transcript_quote` and `confluences[].transcript_quote` (the two
locations where `transcript_quote` is in `required`), replace the shared description
with location-specific sentinel-blessing text:

```json
"transcript_quote": {
  "type": ["string", "null"],
  "description": "A literal, contiguous substring copied VERBATIM from the transcript — the exact evidence for this condition. Checked by literal substring match; a quote that does not appear verbatim fails validation and routes UNANCHORED. Set null ONLY as the deliberate NO-QUOTE SENTINEL: you believe this condition is genuinely taught (directly, or as a checklist item from Phase A's variant list) but cannot find a literal contiguous quote for it. Do NOT invent a quote to fill this field, and do NOT drop the condition instead — null here is an honest, examined output, not a shortcut. A condition with a null quote here still counts toward coverage; it is excluded from the mechanical substring pre-filter and routed UNANCHORED for support scoring.",
  "minLength": 5,
  "maxLength": 150
}
```

`stop.transcript_quote` and `targets[].transcript_quote` keep the ORIGINAL cascade
wording unchanged (their null case genuinely is "the paired field is null" —
`stop.anchor=null`, or a target with no quote shouldn't be added at all per the existing
prompt instruction).

### 3.3 Prompt addition — new section "E. NO-QUOTE SENTINEL"

Placed in `src/agents/transcript-extractor-minimal.md` immediately after existing
section D (QUOTE-THEN-WRITE):

> ### E. NO-QUOTE SENTINEL — the honest third door
>
> Quote-then-write (section D) can corner you: you believe the trader taught a
> condition, but you cannot find a single literal, contiguous phrase that grounds it —
> often because the teaching is spread across several sentences, or because Phase A's
> variant checklist names something you can only paraphrase-locate. You have THREE
> options. Two are wrong:
>
> ❌ **Invent a quote that doesn't literally appear** — caught by the mechanical
> substring check, and it is fabrication.
> ❌ **Silently drop the condition** — caught by the coverage guard, and it is
> omission. If this was a Phase-A checklist item, dropping it reproduces the exact
> `WEhmadJArQo` failure this pass exists to fix.
>
> ✓ **Set `transcript_quote: null` and keep the condition.** This is the HONEST
> answer: "I extracted this but cannot ground it in one verbatim quote." It routes
> UNANCHORED downstream (not certificate-grade on its own) — that is the correct,
> fair consequence, not a punishment to avoid. The pipeline already handles
> UNANCHORED conditions correctly; your job is to be honest about which bucket a
> condition belongs in, not to force everything into ANCHORED.

### 3.4 Routing to the certificate (downstream flow spec)

- Mechanical pre-filter (Gate 3's substring check, reused): a condition with
  `transcript_quote != null` runs the literal substring check as today (pass → proceeds
  to semantic support scoring; fail → automatic support MISS, same as today).
- A condition with `transcript_quote == null` **skips** the substring check entirely
  (there is nothing to check) and is tagged UNANCHORED directly.
- **Coverage counting (unchanged mechanism, now correctly fed):** an UNANCHORED
  sentinel-null condition still counts as one spine condition for the Gate-2 coverage
  floor (≥90% aggregate, no single strategy loses >50%) — this is the entire point:
  coverage must not regress just because grounding failed on one item.
- **Support-rate accounting (new rule, needed because of the sentinel):** sentinel-null
  conditions are excluded from BOTH the numerator and denominator of the ≤8%
  support-miss target — they never claimed anchored support, so folding them into
  "miss" would double-penalize honesty, and folding them into "win" would let the
  sentinel game the target. They are reported as a separate, always-visible metric:
  **unanchored-via-sentinel count / rate**, tracked per video and in aggregate.
- **Anti-gaming soft ceiling (new, this pass — mirrors §7c's mirror-infidelities
  instinct):** the sentinel is a legitimate honest door, but a model that routes
  everything hard through it would be trading elaboration/omission for a THIRD failure
  mode — grounding-avoidance-by-default. Soft, non-gating observability flag: if
  sentinel usage exceeds **15% of all quote-bearing conditions** on the design pool,
  that is reported and reviewed (not auto-failed) as a signal the model may be using
  the honest door as a shortcut rather than attempting quote-then-write first. This is
  advisory, not a fifth hard gate — the hard gates remain the four carried forward in
  §5.

---

## 4. THREE DESIGN-SPECIFIC GUARDS

### Guard 1 — Over-enumeration fence (bidirectional)

**What it defends against:** a degenerate Phase-A enumerator that splits every
condition-cluster into its own "strategy" would manufacture tiny, easily-certified
strategies — gaming the ≥1-clean-strategy-per-video bar by fragmentation.

**Concrete check (two-stage, reusing the exact §9a machinery already proven this
campaign):**

1. **Stage 1 — cheap screen, all design-pool videos.** Compare Phase A's
   `len(strategies[])` for each video against the SAME baseline Gate 2 already used
   (`gate2_gate3_report.json`'s per-video `strategies` field / the original 25-strategy,
   253-condition spent-16 reference from the pre-reg's Gate 2 baseline). A mismatch in
   EITHER direction trips the screen:
   - `enumerated_count > baseline_count` → **OVER-SPLIT trip.**
   - `enumerated_count < baseline_count` → **UNDER-SPLIT trip.**
   - The screen never fails the gate by itself (§9a's rule) — it only decides which
     videos need adjudication.
2. **Stage 2 — escalation.** A tripped video gets a fresh-context blind adjudicator
   (transcript alone, the §9b question) — UNLESS it is one of the three videos already
   adjudicated this campaign (`4cT8WTyxhYY`=1, `IyFioFkRgWo`=1, `WEhmadJArQo`=1-or-2),
   which are reused directly rather than re-asking an already-answered question.
3. **Routing:**
   - Phase A's count MATCHES the adjudicated count → trip was baseline error (as
     happened for `4cT8WTyxhYY`/`IyFioFkRgWo` against the OLD baseline) → Guard 1
     clears for that video.
   - Phase A's count DIFFERS from the adjudicated count → **content-preservation
     decider** (the §9→§10 ladder, one level down): does every distinct entry/exit
     skeleton the fresh adjudicator named survive SOMEWHERE in Phase B's eventual
     per-strategy output, regardless of how Phase A bucketed it? Content present →
     re-segmentation, not a failure (mirrors §10c exactly). Content absent → genuine
     Guard-1 failure.
   - `WEhmadJArQo` specifically: both 1 and 2 are non-trips (the adjudicator's own
     "reasonably 1" flag makes this the pre-declared ambiguous band); only 0 or 3+ trips
     it, and any trip still resolves through the content-preservation decider, never by
     ontology alone.
4. **A genuine, content-confirmed Guard-1 failure on this pass is a terminal-swing
   signal** (this is pass-2, the last swing per §11) — it feeds the pre-written Phase-1
   fork (pre-reg §5), not a further internal Phase-A iteration; the ≤2-pass budget is
   spent regardless of which lever tripped.

### Guard 2 — `WEhmadJArQo` permanent regression fixture

**What it defends against:** pass-2 silently reproducing pass-1's exact failure (the
motivating bug for this whole design).

**Concrete check (permanent, automated, runs on every future extractor change, not
just this pass):** run the full two-phase conveyor on `WEhmadJArQo`. Across however many
Phase-B strategy objects result (1 or 2 — ontology moot per §10c), mechanically verify
all three variant-B distinctives are present as EXTRACTED CONTENT — anchored (real
`transcript_quote`) OR sentinel-anchored (`transcript_quote: null`, still present as a
condition) — in `entry_sequence` / `confluences` / `stop` / `targets`, **never merely in
the freeform `speaker_concepts` appendix** (exactly where pass-1 let two of the three
leak without counting as real extraction, per
`docs/replay-results/h1-scripts/wave6-pass1-design-pool/extraction-vault/WEhmadJArQo.json`
lines 141–152):

1. **15-minute opening-range timeframe** — a `higher_timeframe`/`lower_timeframe` value
   of `"15m"` on at least one entry_sequence step or strategy scope, OR an explicit
   confluence/step naming the 15-minute chart.
2. **Passive-limit-order confirmation** — an entry_sequence step or confluence whose
   action/description names a LIMIT order placed at the FVG (distinct from the
   wait-for-engulfing confirmation already captured for variant A) — matching *"Instead
   of waiting for a retest, we're actually going to set a limit order on the FVG"*.
3. **2:1 target** — a `targets[]` entry with `r_multiple: 2` / `type: "r_multiple"`,
   distinct from and in addition to variant A's captured 3:1 target.

**Pass/fail:** all three PRESENT (anchored or sentinel) → PASS. Any of the three
ABSENT from every extracted-condition field across all resulting strategy objects →
FAIL, reproducing the exact pass-1 disease. This is written into the regression suite
as a standing fixture (e.g. a permanent test asserting these three predicates against
the live conveyor's `WEhmadJArQo` output) — it does not expire after pass-2 clears; it
guards every future extractor change this campaign makes from now on.

### Guard 3 — Phase-A birth fixtures (Law 1: fires-correctly-before-it-counts)

**What it defends against:** trusting a brand-new instrument's output on the design
pool or the fresh set before it has been shown to behave sensibly on cases where the
answer is already known — the campaign's engagement-evidence Law generalized to a new
instrument's FIRST use, not just a feature's dormancy.

**Two complementary fixture classes, both required before Phase A's output is trusted
anywhere else:**

**(a) Live birth assertions — Phase A run for real on the 3 adjudicated videos:**

| Video | Adjudicated ground truth | Birth assertion |
|---|---|---|
| `4cT8WTyxhYY` | 1 (high confidence) | Phase A MUST enumerate exactly 1. Enumerating 2+ is Guard 1's over-split fence firing on a KNOWN case — investigate before trusting Phase A on the rest of the design pool. |
| `IyFioFkRgWo` | 1 (medium confidence) | Same: exactly 1 required. |
| `WEhmadJArQo` | 1 OR 2 (ontology genuinely ambiguous per the adjudicator's own flag) | Phase A MUST enumerate 1 or 2. 0 (failure/crash) or 3+ (over-split) fails the birth assertion. AND, chained: whichever count Phase A picks, Guard 2's content check on the resulting Phase-B output must independently pass — WEh's birth assertion is double-stamped (Phase A's count-sanity AND Phase B's content-preservation), because this is the video the whole packet is built to fix. |

Failing any of these three BEFORE Phase A is trusted on the remaining 12 design-pool
videos (or the fresh 12) halts the pass — this is the instrument's fires-correctly gate,
not a statistical aggregate.

**(b) Synthetic guard-unit fixtures — proving the FENCE machinery, independent of what
Phase A actually outputs:** two hand-constructed test cases fed directly into Guard 1's
comparator/escalation logic (unit-test style, no live gemma call required):

- **Synthetic over-split case:** a mocked Phase-A output enumerating 4 strategies for a
  video whose baseline count is 1 (e.g. a synthetic `4cT8WTyxhYY`-shaped input). Assert
  the Stage-1 screen trips OVER-SPLIT and Stage-2 escalation fires.
- **Synthetic under-split case:** a mocked Phase-A output enumerating 1 strategy for a
  video whose baseline count is 3 (e.g. shaped like `2DXQqwKSwJE`, baseline 3 strategies
  per `gate2_gate3_report.json`). Assert the screen trips UNDER-SPLIT and escalation
  fires.

This second class exists because (a) alone only proves Phase A's MODEL behavior is
sensible today — it does not prove the GUARD's comparator code would catch a future
regression in either direction if Phase A's behavior silently drifted later. Both
classes are required; neither substitutes for the other.

---

## 5. GATES CARRIED FORWARD (with thresholds, and what changes for pass-2)

| Gate | Threshold (unchanged) | What pass-2 changes about it |
|---|---|---|
| **5-fixture parity** | `tsx scripts/wave26-gemma4-smoke-test.ts --parity-only` MUST report PASS. Any of the 5 frozen fixtures breaking gets updated + re-frozen with written per-fixture rationale, never silently loosened. | Phase B's schema diff is description-text-only (§3.2) at existing nullable fields — LOW structural risk, but still reruns per protocol. Phase A is a NEW instrument with no existing fixtures in this harness — it does NOT inherit the old 5-fixture set; Guard 3(a)'s three birth videos SERVE the equivalent founding-fixture role for Phase A specifically. Build-time design note: if a permanent Phase-A parity harness is wanted going forward, extend `wave26-gemma4-smoke-test.ts` (or a sibling script) with frozen Phase-A fixture pairs seeded from Guard 3(a)'s three videos — not required to clear pass-2, but recommended so Phase A gets the same standing protection Phase B already has. |
| **Coverage two-stage guard** | Aggregate ≥90% of 253 baseline spine conditions (≥228); no single baseline strategy loses >50% of its own original condition count. Screen → transcript-adjudication on trip → content-preservation decider on adjudication-ambiguous trips (the formalized §9a/§10 ladder). | Denominator mapping is corrected: the per-strategy floor is now evaluated per BASELINE strategy (which baseline conditions survived SOMEWHERE in pass-2's output, across however many Phase-B objects a video produced), not per pass-2 output array index — the index-based comparison is exactly what generated the false WEh trip in pass-1 (baseline 2 vs pass-1's 1, compared positionally). Sentinel-null conditions (§3.4) count toward this floor same as anchored ones. |
| **Design-pool support-miss ≤8%, one-rater semantic pass** | Measured on spent-16 only, never the fresh set. Mechanical substring pre-filter (free) → one-rater semantic pass on survivors. Doer≠grader preserved (rater ≠ pass-2 implementer). | Sentinel-null conditions are excluded from both numerator and denominator of the 8% target (§3.4) — reported separately as an unanchored-rate metric, with a 15%-of-quote-bearing-conditions soft ceiling as an advisory anti-gaming flag (non-gating). |
| **Doer≠grader independent grade** | A fresh-context independent grader re-derives every gate result from raw artifacts before pass-2 is declared cleared; a self-reported "all gates pass" is `status=CLAIMED`, not `VERIFIED`, until re-derivation runs. | Scope EXPANDS to cover: Phase-A birth fixtures (both classes, Guard 3), Guard 1's bidirectional trip/escalation/content-decider chain, Guard 2's permanent WEh regression check, and the corrected per-baseline-strategy coverage mapping — in addition to the four carried gates above. Nothing in this packet may be self-certified by whichever agent builds pass-2. |
| **`CLDEIsNpVRc` crash fold-in** | Resolved plumbing (transient Ollama+cloud double-miss, self-reference ruled out 3/3 clean re-runs) — closes as infra, folds into the 98.4% aggregate coverage baseline, per the pre-reg's §10 fold-in note. | No change; carried as a closed item, not reopened by pass-2. |

---

## 6. SCOPE + WHAT PASS-2 DOES NOT TOUCH

**In scope:** two new files (`src/agents/strategy-enumerator.md`,
`src/agents/kb/strategy-enumerator-schema.json`); targeted edits to
`src/agents/transcript-extractor-minimal.md` (new section E) and
`src/agents/kb/transcript-extractor-minimal-schema.json` (description-text fix at two
locations, §3.2); the Phase-A→Phase-B orchestration wiring (fan-out + checklist
injection, §2) in the extraction orchestration layer; the pass-2 regression suite
(Guard 1 comparator + escalation, Guard 2's permanent WEh fixture, Guard 3's birth
assertions, the corrected coverage denominator mapping).

**Explicitly OUT of scope (unchanged from pass-1's packet, still holds):** the
anchor-locator's generative-retrieval-vs-verify-only role (flagged, not decided, in the
pass-1 packet §4 — still a future pass's scope decision, untouched here), the
tier-1/tier-3 classification machinery, the two-stage cert schema, the downstream
conveyor's assembler/DSL guards/framework-overlay.ts defaults. None of these are edited,
retrained, or reconfigured by this packet or by pass-2's build.

**Downstream impact assessment (backtest-core authority mandate):** the two-phase split
is invisible past the extraction boundary (§2, downstream assembly) — the outer
`strategies[]` shape the Phase-1 assembler and every downstream consumer (critic, paper
engine, prop sim, portfolio optimizer, export) already reads is unchanged. The only
consumer-visible change is a NEW honest field state (`transcript_quote: null` as
sentinel) at two existing nullable fields, and a new UNANCHORED-via-sentinel bucket in
support-rate reporting — additive, not breaking. No public result schema is changed
without this documentation.

---

## 7. CONFIRMATIONS

- Designed against the **spent-16 gold regression corpus**
  (`docs/replay-results/h1-scripts/wave6-pass1-design-pool/extraction-vault/*.json`,
  `gate2_gate3_report.json`) and the pass-1 packet/pre-reg text **only**. The fresh
  Wave-6 sealed set (`docs/designs/h1-wave6-sealed-fresh-set-2026-07-12.json`) was
  referenced ONLY by filename/sha, never opened.
- No code, prompt, or schema file was edited by this packet. `src/agents/transcript-extractor-minimal.md`
  and `src/agents/kb/transcript-extractor-minimal-schema.json` were read-only inputs;
  the two new Phase-A files (`src/agents/strategy-enumerator.md`,
  `src/agents/kb/strategy-enumerator-schema.json`) do not yet exist on disk — their
  content above is a spec for the build step, not a delivered file.
- No commit was made.
- This packet stages the receipt required by `ratify-packet`'s autonomous-class flow:
  what & why (§0–§4), blast radius (§6), exact scope-locked change (§1–§3, file paths
  named), verification plan (§4–§5, all gates + guards with concrete checks), rollback
  (revert the two new files + the two targeted edits, one reversible commit pre-merge).
  Pass-2 BUILD may proceed via the agent-loop (scope-locked implementer → fresh-context
  independent grader) without further operator permission-wait — this is pre-live, not
  irreversible/live-capital class, per the 2026-07-11 operator amendment.
- This is the **last swing** of the ≤2-pass budget. If pass-2 clears every gate and
  guard in §4–§5: extractor freezes at its cleared SHA, and the terminal read proceeds
  on the fresh 12 exactly as pre-committed in the pre-reg §6/§11 (fresh-context
  conductor, unseal discipline, two independent blind control-gated raters, read ONCE,
  independent fresh-context re-verification, bar UNCHANGED at ≥60% all-conditions-clean
  + economics rider ≤~15). If pass-2 falls short on any gate or guard: the pre-written
  Phase-1 fork (pre-reg §5) fires, and its options (cloud-model extraction economics,
  human-in-loop extraction, source reconsideration) are decided AT that fork, with THAT
  evidence — not pre-decided here.
