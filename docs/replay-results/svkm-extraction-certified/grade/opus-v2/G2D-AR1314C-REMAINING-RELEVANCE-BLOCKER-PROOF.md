# AR-1320A Lane D follow-up — Proving the Two Remaining `REFUSED_RELEVANCE` Rows Are Gate Limitations, Not Fixable Bugs

**Continues:** `G2D-AR1314B-SOURCE-TRUTH-TEXT-CORRECTION-AND-REGRADE.md`, which left
`entry_sequence[2].rationale` and `entry_sequence[3].rationale` as still-`REFUSED_RELEVANCE`
after their wording corrections, with the open question of whether that is a fixable
evidence-packaging defect (as `entry_sequence[1].rationale` turned out to be under AR-1313) or a
genuine relevance-gate discrimination limit (as `entry_sequence[2].action` was already proven to
be under AR-1313).

**Method:** direct calls to the unmodified `evidence_relevance.evaluate_evidence_relevance()` gate
— the same function `g2d_finalizer.finalize()` calls internally — against literal candidate quotes.
Zero new Agent/Task/model calls. No gate touched. `scripts/ar1320a_probe_es3_relevance_tmp.py` is
the probe for `entry_sequence[3].rationale`; committed as evidence per this campaign's convention
for `_tmp.py` investigation scripts.

## `entry_sequence[3].rationale` — TRUE_RELEVANCE_GATE_LIMITATION, proven

Its recovered response (`entry_sequence_3_.rationale.952f94d75996.recovered.json`) is the
`EVIDENCE_PACKAGING_TOO_NARROW` shape: the primary `quote` field only grounds the "entering on the
closure" half of the condition; the response's own `notes` field separately names a second literal
span that grounds the "confirms the FVG structure" half:

> "in order for this fair value gap to be a valid fair value gap, the fair value gap has to
> actually be formed. And the way that happens is when the third candle of the sequence has been
> printed"

Verified verbatim in the transcript at offset 12574 (immediately preceded by "Now, what do I mean
by confirming?" — directly on-topic for "confirms").

This is the identical shape AR-1313 found for `entry_sequence[1].rationale`, so it was tested the
same way: standalone re-test of the primary quote, the secondary quote, and both composed, each
against the (already text-corrected) condition `"Entering on the closure confirms the FVG
structure."` with the same four sibling conditions as rivals.

```
primary alone:   own=0.167  best_rival=0.300  MISGROUNDED_NOT_DISCRIMINATING
                 rival: "Enter the trade (long or short) on the closure of the third
                        candle of the FVG sequence." (shared: "closure")
secondary alone: own=0.167  best_rival=0.417  MISGROUNDED_NOT_DISCRIMINATING
                 rival: "Wait for a Fair Value Gap (FVG) sequence to form outside of
                        the 5-minute range." (shared: "eq_fair_value_gap")
combined:        own=0.333  best_rival=0.500  MISGROUNDED_NOT_DISCRIMINATING
                 rival: "Enter the trade (long or short) on the closure of the third
                        candle of the FVG sequence." (shared: "closure", "eq_fair_value_gap")
```

All three fail, and all three fail to the **same rival**: `entry_sequence[3].action` — the
sibling condition that literally IS "enter on the third-candle closure." That is structurally
inevitable: `entry_sequence[3].rationale` explains *why* the entry-on-closure rule works, so any
grounding text for it will share vocabulary with the entry rule itself more than with the
rationale condition's own (shorter, more abstract) text — the exact discrimination-limit shape
AR-1313 already proved for `entry_sequence[2].action` against its own FVG-vocabulary sibling.

**Conclusion: `TRUE_RELEVANCE_GATE_LIMITATION`, not `EVIDENCE_PACKAGING_TOO_NARROW`.** Unlike
`entry_sequence[1].rationale`, composing the two spans does not clear the floor here — it raises
`own_score` (0.167 -> 0.333) but raises the best-rival score by more (0.300/0.417 -> 0.500),
because the composed text now contains vocabulary from *both* sibling conditions at once. No
further evidence substitution is authorized: the recovered response offers no third span, and
authoring a new candidate quote myself (rather than using one the isolated agent actually
surfaced) would be picking the answer by hand, not proving it — out of scope for this lane.

## `entry_sequence[2].rationale` — TRUE_RELEVANCE_GATE_LIMITATION, no alternate evidence exists

Its recovered response (`entry_sequence_2_.rationale.b4a5470ddf98.recovered.json`) offers only one
quote: `"As soon as we see this gap being printed outside of the range and confirming, then we can
enter the trade."` Its `notes` field explains why that quote semantically grounds both halves of
the condition and explicitly names "high-probability" as unsupported editorializing — but, unlike
`entry_sequence[1].rationale` and `entry_sequence[3].rationale`, it does **not** name a second
literal span. There is no alternate candidate to test.

`entry_sequence[0].rationale` was already exhaustively tested by AR-1313 (the one available
secondary candidate scored 0.097, just under the 0.10 floor) and no new candidate is available now
either.

**Conclusion: `TRUE_RELEVANCE_GATE_LIMITATION`.** The wording correction (removing "high-probability")
was still correct and necessary on source-fidelity grounds independent of this result — it is the
row's fidelity defect, not its relevance defect, that the text correction closed. The relevance
defect is a separate, unresolved gate limitation with no available fix under the "use only evidence
the isolated agent actually surfaced" discipline.

## Updated remaining-blocker classification (supersedes the "still open" framing in AR-1314B)

| condition_ref | classification | status |
|---|---|---|
| `entry_sequence[0].rationale` | unresolved (`OTHER_EXPLICIT_BLOCKER`, AR-1313) | no fix available, already exhaustively tested |
| `entry_sequence[1].action` / `confluences[1].description` | `UPSTREAM_DUPLICATE` (F37) | no repair seam exists; intentional HOLD |
| `entry_sequence[2].action` | `TRUE_RELEVANCE_GATE_LIMITATION` (AR-1313, proven) | structural, no fix |
| `entry_sequence[2].rationale` | `TRUE_RELEVANCE_GATE_LIMITATION` (this report, proven) | structural, no fix — no alternate evidence exists |
| `entry_sequence[3].rationale` | `TRUE_RELEVANCE_GATE_LIMITATION` (this report, proven) | structural, no fix — composition tested and fails |

No condition changed disposition as a result of this investigation (it is a proof pass, not a
correction pass) — the regrade output committed in `opus_phase1_route_t1_g2d_final_ar1314b.json`
stands unchanged at RED, 6/12. What changed is that the two previously-open relevance blockers are
now proven structural rather than merely observed, closing the diagnostic gap AR-1314B left open.

## Confirmation

- Zero new Agent/Task/model calls (direct gate-function calls only, same inputs the finalize()
  pipeline would use).
- No gate, floor, or term-equivalence table modified.
- No new evidence quote authored by hand; only quotes the isolated agent responses themselves
  already surfaced (primary field or notes) were tested.
- No historical artifact touched; this is a report + one committed probe script.
