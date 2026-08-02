# READER-VINTAGE CROSS-AUDIT PROTOCOL (R-062 #3) — 2026-07-20 (amended post-red-team, same day)

> **Status: FROZEN if and only if ruling R-075 exists in `ADVISOR-RULINGS.md` naming this file and its content hash.** Absent that, DRAFT binding nothing. Authored BEFORE any cold read is dispatched and BEFORE any tier-A battery result exists to interpret.
>
> **Two-path law (binding):** the executing agent re-verifies every anchor against disk at execution; frozen sources outrank this document. **Red-team record (R-062 standing rule):** pre-presentation adversarial pass returned 2 CRIT / 3 HIGH / 4 MED / 1 LOW — all ten folded (§8).

## §1 THE RISK BEING BOUNDED — with the dual-role disclosure (F3)

All 11 tier-A certificates came from ONE reader vintage (`h1-certified-reader-v3.2`). A systematic vintage defect (fabrication/distortion of a mechanic class) would replicate across all certificates and be invisible to within-vintage checks. A cold re-read by a different-vendor model bounds that risk on a sample. **DISCLOSED LIMIT: gpt-5.4 is NOT fully decorrelated — it served as a fail-closed certification panel judge (completeness/conflation/enum-consistency) on these same certificates, so tier-A membership is already conditioned on gpt-5.4 agreement on those axes.** The bound therefore EXCLUDES defect classes both vendors share or tolerate; the §4 unconditional human floor exists precisely so one layer of the audit is model-independent. This is a CORPUS-LEVEL bound, distinct from forensics Leg B (per-candidate, at candidacy); its result informs Leg-B vintage pinning (forensics pre-reg §5, `d3665c577347b70c`).

## §2 SAMPLE — fully determined; computed at freeze; nobody picks (F1)

- **Population artifact (pinned):** `docs/replay-results/h1-battery/tier-a-clean-strategy-receipt.json` — the 9 `clean_video=true` entries with per-video `n_clean_strategies`.
- **(i) Max-surface video:** highest `n_clean_strategies`; ties broken by BYTE-ORDER (ASCII/ordinal) lexicographic ascending on `video_id`. Result: tie 2–2 between `YqY0OkL5LMI` and `st5e-YJRfKc` → **`YqY0OkL5LMI`** ('Y' 0x59 < 's' 0x73).
- **(ii)+(iii) Seeded two-draw from the remaining 8 clean videos:** order them byte-order ascending, indexed 0..7 · seed `s` = SHA-256 of the manifest FILE BYTES (`docs/designs/h1-wave6-sealed-fresh-set-2026-07-12.json`) as a big-endian integer · pair index `k = s mod C(8,2) = s mod 28` · pairs `(a,b), 0 ≤ a < b ≤ 7` enumerated lexicographically `(0,1),(0,2),…,(6,7)`; the k-th (0-based) is the draw. **Computed at freeze (arithmetic in R-075): k=7 → pair (1,2) → `ExB66jcyKxg`, `LD1FEbwXU4o`.**
- **THE SAMPLE: `YqY0OkL5LMI` (2 certs) · `ExB66jcyKxg` (1) · `LD1FEbwXU4o` (1) — 4 of 11 certificates (~36%).** The agent re-derives the entire draw at dispatch (two-path); any disagreement with R-075's arithmetic is an ALARM, not a choice. No substitutions without a ruling; a substitution request is itself a finding.

## §3 COLD-READ CONDITIONS (isolation) — full ladder record cited (F4), prompt frozen verbatim (F9)

- **Reader: gpt-5.4, k=2 independent single-pass reads per video** (union of found content feeds §4 matching — more passes can only FIND real content, never fabricate a match for a true phantom, so k=2 shrinks false-phantom volume without hurting phantom detection). Cost stays in pennies.
- **The reader's FULL record on this corpus, disclosed:** birth gates 6/6 (count+content; mini FAILED 3/6) — but gpt-5.4 subsequently FAILED the design-pool joint bar twice with a "drops taught items" profile. Predicted consequence, stated now: an elevated MISSING-IN-COLD base rate (dropped items surface as unmatched certificate content), which is why k=2, why MISSING-IN-COLD is not an alarm class, and why the spot-check load is budgeted (§4). A reader that drops content is also weak at CONTRADICTING it — distortion detection is the bound's weaker axis, carried in the scope-line.
- **Inputs:** the persisted pipeline transcripts. **Attrition rule pre-committed (F7):** at dispatch the agent locates the persisted transcript artifacts and records their hashes; if a video's transcript is NOT durably persisted (the sealed read live-fetched into a scratchpad), the agent RE-FETCHES and DISCLOSES the transcript-drift dependency in the receipt (captions can drift; the receipt records fetch date + hash). Re-fetch-with-disclosure is always available — NOT-RUN cannot deadlock on transcript attrition. Shared-transcript risk (both readers consuming one corrupted transcript) remains explicitly out of scope, bounded by the standing manual `transcript-audit` routine.
- **Blindness:** no certificate, spec, strategy count, or campaign artifact in the cold reader's context. **PROMPT FROZEN VERBATIM (F9):** *"Watch this transcript of a trading video. List each distinct trading strategy the speaker actually teaches (not merely mentions). For each: the entry conditions, the exit logic, the direction (long/short/both), and any filters or session/timeframe requirements — all in the speaker's own terms. If the speaker teaches no strategy, say so."* No other task text. The receipt records the full request payload hash (prompt + transcript bytes); prompt-conformance to this frozen text is inside the independent grade's scope.

## §4 COMPARISON + OUTCOME SEMANTICS — governed spot-check (F2), floor (F3), EXTRA class (F6)

Working agent runs containment comparison with per-item receipts; independent grader re-derives ALL verdicts blind (Phases 1–2 AND every spot-check).
- **Phase 1 — enumeration containment:** each CERTIFIED strategy ↔ corresponding taught strategy in the cold union? Each COLD strategy ↔ present in certificates?
- **Phase 2 — mechanics containment:** for matched pairs, certificate's load-bearing mechanics (entry logic, direction, exit family, defining filters) present without material contradiction? Divergences enumerated.
- **Outcome classes:**
  - **PHANTOM** (certified content the cold union cannot find) → transcript spot-check before it counts.
  - **DISTORTION** (matched but load-bearing mechanic materially contradicted) → spot-check before it counts.
  - **MISSING-IN-COLD** (cold reader found nothing where the k=5-modal instrument did; spot-check confirms presence) → recorded, NOT alarmed.
  - **EXTRA-IN-COLD** (cold strategy absent from certificates) **(F6)** → recorded, spot-checked once, routed to the completeness/rate lane; not this audit's alarm.
- **SPOT-CHECK GOVERNANCE (F2):** every spot-check receipt QUOTES the exact transcript span relied on (or attests absence over a stated search of the full transcript); the independent grader re-derives each verdict blind (given only the certified mechanic + the transcript); a garbled/ambiguous transcript at the claimed location FAIL-CLOSES to CONFIRMED (phantom/distortion stands) unless a video-level check (watching the source) resolves it — never quietly dismissed. Spot-check load budget: if candidates exceed 12, that fact is itself reported before adjudication continues (volume is evidence about the reader, per §3).
- **UNCONDITIONAL HUMAN FLOOR (F3):** for each sampled video, ONE certified load-bearing mechanic — drawn by `s mod n_mechanics` over that certificate's enumerated mechanics, arithmetic in the receipt — gets the full transcript spot-check EVEN IF the cold read matched everything. At least one audit layer is model-independent by construction.

## §5 PRE-REGISTERED VERDICT RULE — with per-certificate quarantine (F5)

- **ALARM (vintage-level):** any CONFIRMED phantom, OR confirmed load-bearing distortions in ≥2 of 3 videos (threshold arbitrary-but-frozen, named as such). Consequence: NO tier-A battery interpretation until adjudicated by ruling; forensics Leg-B vintage decision inherits.
- **PER-CERTIFICATE QUARANTINE (F5), independent of the corpus verdict:** ANY confirmed phantom or distortion quarantines THAT certificate's battery interpretation pending its own disposition (e.g., early forensics Leg-B on that candidate) — a PASS never launders a known-defective certificate.
- **PASS:** zero confirmed phantoms, ≤1 video with confirmed distortions (those certificates quarantined regardless). **Scope-line wherever cited (F8):** "4 of 11 certificates covered; single-pass×2 cold reader; shared transcripts; cold vendor also served as certification panel judge — sensitive only to vintage-wide defect classes not shared by both vendors."
- **NOT-RUN** (dispatch/comparison cannot complete): blocks tier-A interpretation exactly as ALARM does, until run — with §3's attrition rule guaranteeing a run path always exists.

## §6 EXECUTION

- Agent dispatches (existing infrastructure), compares, files report; grader re-derives blind; advisor rules. Cost: 6 single-pass gpt-5.4 reads ≈ pennies per the campaign's benchmark pricing — inside the ≤$1/task envelope; if actual pricing exceeds it, HALT and surface before dispatch (no silent overrun).
- **Station (R-062 #3 verbatim): "rides before/alongside the first real-fidelity wave."** Must not preempt the in-flight 0.99 re-measure; the receipt MUST land before tier-A battery results are INTERPRETED. The gate is on interpretation.
- All artifacts (cold reads, request payloads, comparison tables, spot-check receipts, grade) under `docs/replay-results/` with hashes in the report.

## §7 WHAT THIS PROTOCOL IS NOT

Not a re-certification (certificates stand except quarantine/ALARM outcomes) · not forensics Leg B · not a transcript audit · not expandable mid-flight — adding videos, swapping readers, or re-running a "noisy" read requires a ruling BEFORE the action.

## §8 RED-TEAM DISPOSITION RECORD (all ten folded, 2026-07-20)

1. CRIT draw underspecified (algorithm/seed/population all ambiguous) → §2 fully determined: population artifact pinned, byte-order tie-break, explicit pair-unranking, seed = manifest FILE-BYTE hash, computed at freeze with arithmetic in R-075.
2. CRIT spot-check ungoverned (sole adjudicator, no doer≠grader) → §4 governance: span-quoting receipts, blind grader re-derivation, garbled-fail-closes-to-CONFIRMED, load budget.
3. HIGH "maximally decorrelated" overstated (gpt-5.4 co-certified these certificates) → §1 dual-role disclosure + §4 unconditional human floor + §5 scope-line.
4. HIGH selective citation (joint-bar failures omitted; predicted false-phantom flood) → §3 full ladder record + k=2 union + predicted base rate + budget.
5. HIGH PASS launders confirmed per-certificate defects → §5 per-certificate quarantine independent of corpus verdict; ≥2-of-3 labeled arbitrary-but-frozen.
6. MED cold-side containment had no outcome class → EXTRA-IN-COLD: recorded, spot-checked, routed to completeness lane.
7. MED transcripts scratchpad-fetched, NOT-RUN deadlock → §3 attrition rule: persist-or-refetch-with-disclosed-drift; deadlock impossible.
8. MED scope omitted coverage + detectable-class limits → §5 scope-line carries both.
9. MED prompt authored at dispatch by certificate-holding agent → §3 verbatim frozen prompt + payload hashes + grade-scope conformance.
10. LOW "$0.49 precedent" unverifiable from disk → struck; HALT-and-surface stands on its own.

*Authored by the money-path advisor (Fable) under R-062 #3; frozen at R-075 (see header condition).*
