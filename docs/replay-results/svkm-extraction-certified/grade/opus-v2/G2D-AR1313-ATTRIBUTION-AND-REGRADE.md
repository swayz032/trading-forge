# AR-1313 — Source-Truth Attribution Table + One Bounded Correction + Regrade

**Ruling followed:** AR-1312B, "AR-1313 — FAST SOURCE-TRUTH ATTRIBUTION / CORRECTION LANE." Zero new Agent/Task/model calls throughout — everything below is deterministic re-scoring of already-recovered evidence through the unmodified `evidence_relevance.py` / `source_fidelity_guard.py` / `span_collision.py` gates, plus one existing-mechanism substitution.
**Scripts:** `scripts/g2d_ar1313_attribution_tmp.py` (candidate re-scoring), `scripts/g2d_ar1313_regrade_tmp.py` (the one corrected regrade).
**Prior state:** Lane 1 result (`089e0373`, accepted by AR-1312B): RED, 4/12, all 8 rows same disposition class as the original batch route.

## Correction to my own prior report

AR-1312B correctly rejected my Lane-1 framing that the 5 relevance failures were broadly "a known frozen-gate limitation." I had not checked what normalization already exists. It does: `evidence_relevance._terms()` already imports `term_equivalence.equivalence_tokens` (FVG ↔ fair value gap, timeframe spellings, etc. — AR-1239's repair, motivated by AR-1225). The failures below are NOT a vocabulary gap the gate is missing; each has a distinct, provable cause, established below with actual gate scores rather than opinion.

## Attribution table (all 8 rows, primary classification)

| condition_ref | classification | evidence for the classification |
|---|---|---|
| `entry_sequence[0].rationale` | `OTHER_EXPLICIT_BLOCKER` (see note) | primary quote: own=0.016. Tested the one secondary candidate the agent's grounding notes offered ("Because the 9:30 candle is when New York opens... most volatile session..."): own=**0.097**, still below the 0.10 floor. Not an `EVIDENCE_PACKAGING_TOO_NARROW` fix — the better candidate still fails. Not claiming `TRUE_RELEVANCE_GATE_LIMITATION` either: the condition text ("This establishes the initial volatility range for the trading session") conflates two separate trader statements — the mechanical range-marking action, and a *later, separate* remark about why 9:30 is volatile — and I cannot prove the condition itself is source-faithful as a single claim. Flagging as an explicit unresolved blocker rather than assigning it to a class I can't fully justify. |
| `entry_sequence[1].action` | `UPSTREAM_DUPLICATE` (F37) | Paired with `confluences[1].description`; both encode "1m candle closes outside the 5m range." 0.86 term-overlap, correctly `HELD_DUPLICATE_ROLE_AMBIGUITY`. No existing duplicate-role-linking seam found (searched `src/engine/extraction` for revision/correction/role-link/duplicate-of naming — none exists). Per the ruling, HOLD left intact; absence reported, not architected around. |
| `entry_sequence[1].rationale` | `EVIDENCE_PACKAGING_TOO_NARROW` → corrected, see below | Primary (JSON `quote` field only): own=0.000, `MISGROUNDED_NO_OVERLAP`. The SAME already-recovered agent response's prose separately named a secondary literal quote — "That gives us an idea of the direction in which the market wants to go for the day." — which my quote-extraction script never captured because it only parsed the `quote` field. Standalone re-test: own=**0.247**, rival=0.000, `GROUNDED=True`. No composition needed (single span suffices) — checked and confirmed the existing antecedent-composition seam is not required here. |
| `entry_sequence[2].action` | `TRUE_RELEVANCE_GATE_LIMITATION` | Condition text ("Wait for a Fair Value Gap (FVG) sequence to form outside of the 5-minute range") is near-verbatim of the trader's own words; the quote is literal and on-topic. own=0.278 vs rival=0.297 against `entry_sequence[3].action` ("Enter the trade... on the closure of the third candle of the FVG sequence") — a DIFFERENT, genuinely FVG-related condition. `term_equivalence`'s FVG normalization is already active on both sides and does not help here: the gate cannot discriminate "wait for X to form" from "enter on X's close" using term-set overlap when both conditions are legitimately about the same FVG vocabulary. This is a structural discrimination limit of a term-overlap metric between two closely related sibling conditions, not a missing synonym — proven, not asserted. |
| `entry_sequence[2].rationale` | `SOURCE_FIDELITY_OVERCLAIM` (F39) | Matches GPT's F39 finding verbatim: the agent's own recovered notes flagged `"high-probability"` as unsupported — the trader explicitly says "this model is not perfect... You are going to lose on this model," never a probability claim. own=0.000 at relevance (blocked before ever reaching fidelity), but the root cause is the condition text's unsupported strengthening, not the locator. |
| `entry_sequence[3].rationale` | `SOURCE_FIDELITY_OVERCLAIM` (F39) | Matches GPT's F39 finding verbatim: the agent's own recovered notes flagged `"minimizes entry risk"` as having no grounding anywhere in the transcript, while the mechanical third-candle-close entry rule is grounded. |
| `confluences[0].description` | `SOURCE_FIDELITY_OVERCLAIM` (F38) | `RED_SOURCE_FIDELITY`, `TIMING_WINDOW_WIDENING`: source states a point in time ("at 9:30 a.m. Eastern time"); condition widens it into a "during the session" window. Already correctly RED at the fidelity gate — no change needed to the gate, the extracted condition needs the correction. |
| `confluences[1].description` | `UPSTREAM_DUPLICATE` (F37) | Same pair as `entry_sequence[1].action`, same reasoning. |

## The one bounded correction actually applied

Only `entry_sequence[1].rationale`'s **isolated_results value** was changed, from the narrowly-parsed primary quote to the already-recovered secondary quote. This is not a new architecture, not a synonym/alias, not a gate change — it corrects a bug in my own Lane-1 quote-extraction adapter (`_extract_quote()` only read the JSON `quote` field and discarded valid literal grounding text the same agent response already surfaced in prose). No F38/F39/F37 condition-text corrections were applied — **searched for an existing extraction-text-correction / duplicate-role-linking seam under `src/engine/extraction/` and found none** (checked for revision/correction/amendment/role-link/duplicate-of naming). Per the ruling, that absence is reported, not architected around, in this packet.

## Regrade result

**Still RED. Still 4/12 accepted — same count, but the disposition composition changed and got MORE PRECISE, not just reshuffled:**

`disposition_counts`: `REFUSED_RELEVANCE` 5→**4**, `RED_SOURCE_FIDELITY` 1→**2**, `HELD_DUPLICATE_ROLE_AMBIGUITY` unchanged at 2.

`entry_sequence[1].rationale` now clears relevance cleanly (own=0.247) and reaches the fidelity gate for the first time — where it correctly REDs on a genuine, previously-invisible finding: **`CERTAINTY_INFLATION`** — *"condition asserts 'confirms'; the source offers no certainty attached to this proposition, only a hedge (‘gives us an idea…’)."* The condition text claims the breakout **confirms** direction; the trader only ever says it **gives an idea** of direction — a hedge, not a confirmation. This is a new, more accurate diagnosis of the same row's real defect, uncovered only because the packaging bug was fixed first. It is not a green result, and it should not be treated as one.

Full new route record: `opus_phase1_route_t1_g2d_final_ar1313.json` (new artifact; `opus_phase1_route_t1.json` and the Lane-1 `..._g2d_final.json` are both preserved as history, not rewritten).

## Confirmation

- Zero new Agent/Task/model calls.
- No synonym/alias added; no relevance/fidelity/collision gate modified or bypassed.
- No condition-text correction applied (no seam found; absence reported per F37/F38/F39).
- One evidence-selection correction applied, using only already-recovered text from the same agent response, with the antecedent-composition seam explicitly checked and found unnecessary.
- Result remains RED. Reported as-is.

**NEXT:** Lane 2 (F36 async-capture repair via `SubagentStop`, off-live only) remains the only open authorized item — not started this pass.
