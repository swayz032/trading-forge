# AR-1320B Section 4 — Rival-Role Comparator Confound Measurement

**Script:** `scripts/ar1320b_rival_role_confound_measurement_tmp.py`
**Output artifact:** `docs/replay-results/svkm-extraction-certified/grade/opus-v2/ar1320b_rival_role_confound_measurement.json`

Read-only / derived-artifact measurement. `evidence_relevance.py`, `g2d_finalizer.py`,
`opus_phase1_route.py`, `term_equivalence.py`, the 0.10 floor, and every frozen historical
artifact are unedited. Zero new Agent/Task/model calls. No synonym/alias added. The committed
regrade (`opus_phase1_route_t1_g2d_final_ar1314b.json`, RED, 6/12) was reproduced byte-identically
before any measurement ran (asserted in the script) and is unchanged by this pass.

## Bug caught and fixed in my own script before trusting its output

First run of Safety Control 1 reported `entry_sequence[0].action`, `entry_sequence[3].action`,
`stop.rationale`, `targets[0].rationale` as FAIL (`own_score=0.000`) — which would mean the 6/12
route was silently broken. It was not: those four rows were accepted via the **batch** answers,
not the isolated-fallback recovery, so my script's `isolated_results` dict (built only from the
8 isolated-recovery files) was empty for them and silently substituted `""` as their evidence.
Fixed by reading each row's actual evidence from `outcome_by_ref[ref]["quote"]` — the value
`finalize()` itself used — instead of re-deriving it from only one of its two possible sources.
Re-run after the fix: Control 1 passes cleanly (see below). Flagging this per the standing
"findings against yourself" rule rather than only reporting the corrected numbers.

## Part B — deterministic table, currently `REFUSED_RELEVANCE` rows (control/full rival set)

| condition_ref | role | own score | best rival | rival role | rival score | relationship |
|---|---|---|---|---|---|---|
| `entry_sequence[0].rationale` | rationale | 0.016 | `entry_sequence[0].action` | action | 0.321 | SAME_ENTRY_STEP |
| `entry_sequence[2].action` | action | 0.278 | `entry_sequence[3].action` | action | 0.297 | ADJACENT_ENTRY_STEP |
| `entry_sequence[2].rationale` | rationale | 0.000 | *(none — zero overlap with every rival)* | — | 0.000 | NO_RIVAL |
| `entry_sequence[3].rationale` | rationale | 0.106 | `entry_sequence[3].action` | action | 0.213 | SAME_ENTRY_STEP |

## Part C — counterfactual rival-set variants (measurement only)

Three variants per row, all using the row's own real evidence quote, all still scored by the
unmodified `evaluate_evidence_relevance()`:

- **control** — full 11-rival set (= current production behavior).
- **same_field_role** — rivals restricted to conditions sharing the same field role
  (`action`/`rationale`/`description`) as the row under test.
- **exclude_same_step_sibling** — full rival set minus only the exact same-numbered
  `entry_sequence[N]` sibling of the *opposite* role (e.g. for `entry_sequence[3].rationale`,
  excludes only `entry_sequence[3].action`).

| condition_ref | variant | grounded | own | best rival |
|---|---|---|---|---|
| `entry_sequence[0].rationale` | control | false | 0.016 | 0.321 |
| `entry_sequence[0].rationale` | same_field_role | false | 0.016 | 0.058 |
| `entry_sequence[0].rationale` | exclude_same_step_sibling | false | 0.016 | 0.297 |
| `entry_sequence[2].action` | control | false | 0.278 | 0.297 |
| `entry_sequence[2].action` | same_field_role | false | 0.278 | 0.297 |
| `entry_sequence[2].action` | exclude_same_step_sibling | false | 0.278 | 0.297 |
| `entry_sequence[2].rationale` | control | false | 0.000 | 0.000 |
| `entry_sequence[2].rationale` | same_field_role | false | 0.000 | 0.000 |
| `entry_sequence[2].rationale` | exclude_same_step_sibling | false | 0.000 | 0.000 |
| `entry_sequence[3].rationale` | control | **false** | 0.106 | 0.213 |
| `entry_sequence[3].rationale` | same_field_role | **true** | 0.106 | 0.013 |
| `entry_sequence[3].rationale` | exclude_same_step_sibling | **true** | 0.106 | 0.013 |

## Safety controls

**Control 1 — the 6 currently `ACCEPTED_PENDING_CERTIFICATION` rows stay grounded, every variant:**
PASS, all 18 checks (6 rows x 3 variants), after the evidence-lookup bug above was fixed.

**Control 2 — the RED-A char-19546 disclaimer span
(`src/engine/tests/test_evidence_relevance.py::test_red_a_...`) must stay MISGROUNDED against every
one of the 12 real conditions, every variant:** PASS, all 36 checks (12 conditions x 3 variants).
The known generic-disclaimer defect the gate was built to catch is not resurrected by any tested
counterfactual.

## Per-row interpretation — precise, not generalized

**`entry_sequence[0].rationale` and `entry_sequence[2].rationale` — rival-set-independent
failures.** Identical own/rival scores across all three variants. `entry_sequence[0].rationale`
fails on `MISGROUNDED_BELOW_FLOOR` (0.016, floor 0.10) and `entry_sequence[2].rationale` on
`MISGROUNDED_NO_OVERLAP` (0.000) — both are about the evidence's own coverage of the condition
text, not about which rival it's compared against. No rival-set narrowing can rescue a floor/
zero-overlap failure. This is consistent with (does not newly re-prove, since these two failure
modes were never rival-comparison shaped to begin with) the AR-1313/AR-1314C+D findings for these
rows.

**`entry_sequence[2].action` — fails identically under all three tested variants, but neither
tested variant actually removes its real rival.** Its rival is `entry_sequence[3].action` — an
*adjacent-step, same-role* sibling. `same_field_role` keeps it (both are `action`); my
`exclude_same_step_sibling` variant only excludes the *same-numbered, opposite-role* sibling
(`entry_sequence[2].rationale`), which was never the rival for this row. **I have not tested a
variant that excludes adjacent-step same-role rivals, so "no narrow discriminator exists for this
row" is NOT established by this measurement** — only that the two variants I did test don't touch
its actual competing condition. Reporting the gap rather than concluding a negative I did not
prove.

**`entry_sequence[3].rationale` — a real, precise candidate seam, both safety controls hold.**
Under `control` it fails (0.106 vs 0.213 against its own sibling `entry_sequence[3].action`).
Under BOTH `same_field_role` and `exclude_same_step_sibling` it passes (0.106 vs 0.013), because
both variants remove `entry_sequence[3].action` from the rival pool by different mechanisms (role
filter vs. explicit step-sibling exclusion) and no other condition rivals it as closely. This
matches the architectural signal AR-1320B section 3 named directly: a rationale legitimately
explains the same event its sibling action encodes, so its correct grounding text naturally
shares vocabulary with that action — the comparator penalizes that as if it were the RED-A
disclaimer-style generic reuse, when it is not the same defect shape (disclaimer text is unrelated
to any condition; this text is specifically about the row's own explained event).

## Decision rule per AR-1320B §4.D

`entry_sequence[3].rationale` qualifies: a narrow, mechanically-defined rival relationship already
encoded by the existing `condition_ref` structure (same-numbered-entry-step, opposite role)
removes the false sibling competition, while the RED-A disclaimer control and all 6 accepted rows
remain correctly discriminated. **Reporting this as a candidate seam. Not implementing it.**

`entry_sequence[2].action` does not yet have an established answer either way — the relevant
counterfactual (exclude adjacent-step same-role rivals) was not part of this measurement's 3
variants and would need its own run before any conclusion, positive or negative, is defensible.

`entry_sequence[0].rationale` and `entry_sequence[2].rationale` are floor/overlap failures that no
rival-set change can address; they are out of scope for a rival-role seam by construction, not by
absence of testing.

## Confirmation

- Zero new Agent/Task/model calls (direct calls to the unmodified `evaluate_evidence_relevance()`,
  same inputs `finalize()` uses, plus the counterfactual rival-set variants — all measurement).
- No production file, gate, floor, or term-equivalence table edited.
- No synonym/alias added.
- The RED-A disclaimer positive control and all 6 currently-accepted rows verified to remain
  correctly discriminated under every tested variant.
- The committed 6/12 RED result is unchanged by this pass (measurement only).
