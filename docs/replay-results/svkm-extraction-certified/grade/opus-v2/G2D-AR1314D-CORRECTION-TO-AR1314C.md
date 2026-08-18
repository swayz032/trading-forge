# Correction to G2D-AR1314C — Two Overclaims Retracted (preserve-and-strike)

`G2D-AR1314C-REMAINING-RELEVANCE-BLOCKER-PROOF.md` is **not deleted or silently amended**. This
file strikes two specific claims in it and replaces them with what the same underlying data
actually supports. The probe itself (`scripts/ar1320a_probe_es3_relevance_tmp.py`) and its raw
output are unchanged and correct — only my interpretation of that output was wrong in two places.

## STRIKE 1 — "all three fail to the same rival" is false by the report's own numbers

AR-1314C's own quoted probe output:

```
primary alone:   best_rival=0.300  rival: entry_sequence[3].action   ("Enter the trade... on
                                          the closure of the third candle...")
secondary alone: best_rival=0.417  rival: entry_sequence[2].action   ("Wait for a Fair Value
                                          Gap (FVG) sequence to form...")
combined:        best_rival=0.500  rival: entry_sequence[3].action
```

That is **two distinct rivals**, not one: `entry_sequence[3].action` beats the primary and
combined quotes; `entry_sequence[2].action` beats the secondary quote alone. The report's
sentence "all three fail to the same rival" (and the paragraph built on it, framing this as one
single sibling absorbing all three variants) is retracted as stated.

**What the data actually shows, correctly stated:** the two source quotes pull in different
directions — the primary (closure-timing) quote's vocabulary is closest to the *entry* sibling;
the secondary (FVG-validity) quote's vocabulary is closest to the *FVG-forms* sibling. Composing
them does not average out to a win; it moves the combined score toward whichever single rival the
combination now resembles most (here, back to the entry sibling, at a higher absolute score than
the primary alone). This is arguably a *more* interesting finding than the retracted one-rival
version — the condition text semantically straddles two neighboring conditions' vocabulary, and no
tested combination discriminates itself from both simultaneously — but it must be described as
what it is: two different rivals for two different reasons, not one shared rival.

This does not change the bottom line for `entry_sequence[3].rationale` (all three tested variants
still fail the floor; the row is still not fixable with the evidence in hand), but the causal
story in AR-1314C for *why* was wrong and is corrected here.

## STRIKE 2 — "no alternate quote exists" does NOT prove `TRUE_RELEVANCE_GATE_LIMITATION` for `entry_sequence[2].rationale`

AR-1314C's classification of `entry_sequence[2].rationale` as `TRUE_RELEVANCE_GATE_LIMITATION`
rested entirely on: its recovered response offers only one quote and names no second span. That
is a true fact about the available evidence. It is **not** a fact about whether the relevance
gate itself is structurally insufficient — those are two different claims, and AR-1313's own
definition of `TRUE_RELEVANCE_GATE_LIMITATION` requires *proving* the gate is insufficient, not
merely observing that no further evidence exists to test.

The honest state is: **we exhausted the evidence we have** (one quote, no alternate offered), not
**we proved the gate cannot ground this condition under any evidence**. Those look similar but are
not the same claim — a hypothetical second isolated read of the same source material might have
surfaced grounding text the first read missed (exactly as happened for `entry_sequence[1].rationale`
and, per this same investigation, for `entry_sequence[3].rationale`'s secondary quote). The
one-shot law forbids re-dispatching that row to find out, so the question of packaging-defect vs.
gate-limitation is genuinely **UNDETERMINED for `entry_sequence[2].rationale`**, not resolved in
either direction.

## Corrected classification table (supersedes AR-1314C's table, which is struck for these two rows)

| condition_ref | AR-1314C claimed | corrected |
|---|---|---|
| `entry_sequence[2].rationale` | `TRUE_RELEVANCE_GATE_LIMITATION` (proven) | **`EVIDENCE_EXHAUSTED / UNDETERMINED`** — only one quote was ever recovered for this row and it does not ground the corrected condition text; whether a second isolated read would have found grounding text is unknown and, under the one-shot no-retry law, unknowable. Not proof the gate is deficient. |
| `entry_sequence[3].rationale` | `TRUE_RELEVANCE_GATE_LIMITATION`, "all three fail to the same rival" | `TRUE_RELEVANCE_GATE_LIMITATION` still stands (all 3 available evidence combinations tested and all fail the floor), but the mechanism is corrected: **two different rivals**, not one — see STRIKE 1. |

`entry_sequence[2].action` (AR-1313's original proof) is unaffected by this correction — that
finding used two named sibling conditions in direct competition and remains as reported.

## What this changes going forward

Nothing in the committed regrade output changes — no condition-text or evidence was altered by
this correction, only the classification/proof-strength of two report claims. The practical
takeaway: of the two open relevance blockers, only `entry_sequence[3].rationale` has been
positively shown to resist every available evidence combination. `entry_sequence[2].rationale`
remains genuinely unresolved — it should be reported as an open question with insufficient
evidence to classify, not as a closed, gate-side finding.

## Why this happened (for the record, not to excuse it)

I ran the probe correctly and reported its raw numbers correctly inside the table, but wrote the
prose summary from a generalization ("they all fail, therefore they all fail the same way") rather
than re-checking that generalization against the exact `rival` field I had just printed for each
of the three cases. Same failure class this campaign has repeatedly convicted: the field printed
was correct; the sentence built on top of it was not re-verified against that same field before
publication.
