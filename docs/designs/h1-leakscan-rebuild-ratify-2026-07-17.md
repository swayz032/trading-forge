# H1 LEAK-SCAN REBUILD — RATIFY PACKET (2026-07-17)

> Frozen-instrument change, AUTHORIZED + specified by ADVISOR-RULINGS **R-022** (AR-011/AR-012). Implementer + independent grade (doer≠grader). This packet is the receipt.

## THREAT MODEL (R-022, stated explicitly — the frame that decides everything)
Tier-3 packets are built by OUR OWN deterministic builder (`_build_tier3_packet`) from OUR OWN artifacts. There is NO adversary crafting packets. The scan defends against **builder bugs — and builders COPY bytes; they never paraphrase.** Every design choice below follows from this.

## 1. WHAT & WHY NOW
`pilot_conveyor.blinding_leak_scan` has a CONFIRMED measurement-corrupting false-positive (AR-011): check 2's lexical denylist is substring-matched over the WHOLE packet incl. the trader's `quote_anchor.verbatim`, and the 3-char token `"dri"` fires on the real trader word "drift" — HALTing 2/7 rehearsal strategies on legitimate vocabulary. On the once-only seal-day read this deflates `terminal_read_clean_fraction` → the ≥60% bar could fail on a scan artifact, burning the twelve. Plus a real (narrow) cross-item leak gap (AR-012 Bypass 1). Repro: `blinding_leak_scan` on a 2DX packet whose quote contains "drift" → `forbidden_token:dri`.

## 2. BLAST RADIUS
- Modifies FROZEN `pilot_conveyor.blinding_leak_scan` (+ `_FORBIDDEN_TOKENS`). The sealed pilot (0/16) already RAN under the old version and is NOT re-scored (R-022.4 historiography addendum). Verify NO other ACTIVE consumer depends on the old false-positive behavior (grep callers).
- Consumer that matters: the sealed-12 driver Module D (`run_rater_layer_stage`). After the fix, the 2 falsely-HALTed rehearsal strategies must PASS.

## 3. THE EXACT CHANGE, SCOPE-LOCKED
**A · Rebuild `blinding_leak_scan` as two layers (R-022.1):**
- **Layer 1 — machinery KEYS (snake_case identifiers: `correct_role`, `gold_label`, `answer_key`, `ground_truth`, `expected_role`, `is_control`, `control_answer`, `control_gate_item_ids`, `class_distribution`, …): scanned EVERYWHERE, INCLUDING the quote.** Underscored keys cannot occur in natural transcript speech → zero false-positive; catches wrong-artifact inclusion (a builder pulling grade files drags keys in, even into a quote field). This TIGHTENS (the quote was the one place keys could previously hide).
- **Layer 2 — word-form tokens (`demotion`, `verdict`, `rationale`, `tally`, `outcome`, …): spec-side fields ONLY (EXCLUDE `quote_anchor.verbatim` per check-3's frozen rationale), WORD-BOUNDARY matched (`\b`), NO sub-word fragments.** Full `_FORBIDDEN_TOKENS` AUDIT: every token classified as a Layer-1 key or a Layer-2 word; each Layer-2 word justified distinctive-and-boundary-safe or REMOVED; the 3-char `"dri"` fragment ELIMINATED (replace with the proper word form if one is justified, else drop).
- Keep check 1 (structural allowlist/pre-filled) and check 3 (same-item Stage-2 leak, quote-excluded) UNCHANGED — their rationale stands.

**B · Supplementary CROSS-ITEM check (R-022.2, Bypass 1):** an ALL-ITEM check that no OTHER item's FULL `extracted_condition_text` (NORMALIZED full-string match — whole string, NEVER phrase/substring overlap) appears in any Stage-1-visible field of a different item. Full sentence-length strings don't coincide across conditions; naturally-shared phrases won't trip it. Implement in the scan (preferred: house-standard guarantee) OR the Module-D dispatch layer (implementer's choice) — fail-closed HALT on a hit.

**OUT OF SCOPE:** check 2 semantic/paraphrase layer (R-022.3: adversarial-only under the threat model — NO CHANGE; record the revisit-trigger). Do NOT touch terminal_read_grade, the certified reader, Module A/B/C, or `h1_pilot_phase3_finalize.py` (frozen; it consumed the scan but the pilot is done). Do NOT weaken checks 1/3.

## 4. VERIFICATION PLAN (BOTH POLARITIES, R-022.1/2)
- FALSE-POSITIVE fixed: the 2 falsely-HALTed rehearsal strategies (`2DXQqwKSwJE__s1`, `__s2`) now PASS the scan (packets inspected genuinely leak-free — the only matches were "drift"/"drifted").
- TRUE-leak still HALTs: fresh fixtures — (i) a machinery KEY planted IN the quote → Layer-1 HALT; (ii) a Layer-2 machinery WORD planted in a spec-side field → HALT; (iii) another item's FULL condition text planted in a Stage-1 field → cross-item HALT; (iv) a naturally-shared PHRASE across two items → PASS (no false-trip).
- `_FORBIDDEN_TOKENS` audit table (token → Layer 1/2 → justification/removed) in the receipt.
- Direction-check (stated honestly): this moves clean-fraction TOWARD pass — normally suspect — LICENSED because the current behavior is demonstrated measurement corruption; the compensating Layer-1 key-tightening rides in the same change.
- Regression: full extraction suite green; grep callers of blinding_leak_scan, confirm no active consumer breaks.

## 5. ROLLBACK
Revert `blinding_leak_scan` + `_FORBIDDEN_TOKENS` + the supplementary check. Pre-live; no live default. The sealed pilot record is untouched (addendum only).
