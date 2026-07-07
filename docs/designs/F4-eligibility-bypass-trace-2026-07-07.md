# F-4 Eligibility Unregistered-Bypass — FROZEN diagnostic artifact (2026-07-07)

**Charter (Fable-5, pre-registered): FACTS ONLY. No fix, no "while I'm in here" hardening. Materiality PARKED as a
judgment item. A 7th-defect-with-live-pass-3-consequences smell = stop-and-park, not stop-and-fix.**

## DISPATCH PATH (code-anchored)
- Gate: `src/engine/context/eligibility_gate.py::evaluate_signal()` (the TAKE/REDUCE/SKIP decision). Wrapper
  `apply_eligibility_gate()` (same file, ~:245) computes playbook/location/structural-stop then calls evaluate_signal.
- Backtest path: `backtester.py` calls `apply_eligibility_gate` (E.3/E.4/E.5 guards; the run_class_backtest sibling
  carries it too per the Defect-5 audit).
- Live path: `paper-signal-service.ts` (grader cited :5554; line shifted). TS mirror of the registry normalization
  lives in `src/server/lib/eligibility-registration.ts` + `playbook-registration.ts`.

## BYPASS POINT (code-anchored)
- `eligibility_gate.py:84-109` — the `ds21` (deep-scan #21) unregistered-strategy branch. If `strategy_name`
  normalized (`.lower().replace("_","")`) is NOT in `playbook_router.ALL_STRATS`, it **returns `action="TAKE"` at
  line 109**, BEFORE the Hard-SKIP checks that begin at line 113.
- **INTENTIONAL, not accidental fail-OPEN:** the comment states it MIRRORS `backtester.py::passthrough_strategy_
  unregistered` for paper/backtest PARITY — if backtest bypasses unregistered, live must too, else live SKIPs every
  signal for names not in the 174-entry ALL_STRATS. (Corrects grader framing "fails OPEN".)

## SKIPPED-CHECK ENUMERATION (what the early TAKE at :109 evades)
The overlay Hard-SKIP checks (lines 58-73, 113+), all AFTER the bypass return, are skipped:
- **Check 0 (line 115, deep-scan #8): structural-stop exceeds per-symbol ceiling** — "Fires BEFORE all other gate
  checks", but it is line 115, AFTER the :109 bypass return → **SKIPPED by the bypass.**
- Kill-zone gate (#4, line 165). Liquidity-sweep gate (#5). 3R / confluence≥4 / bias-confidence (the A+ overlay).
- **What the code comment (line 95-96) CLAIMS still applies via SEPARATE framework/risk gates:** structural-stop
  ceiling, DLL, daily-trade-cap, lunch/PM taper, macro blackout, Stage-2 A+ confluence.

## ★ FLAGGED DISCREPANCY (fact, not verdict)
The comment claims **structural-stop ceiling still applies** (separate framework gate), YET **Check 0 (the in-gate
ceiling check) IS skipped** by the :109 bypass. These are consistent ONLY IF a SEPARATE downstream structural-stop-
ceiling gate exists AND fires for unregistered strategies. **Existence/firing of that separate gate NOT verified
tonight.** If it does not fire, an unregistered strategy skips the ceiling entirely — a real (currently-latent) gap.

## EXPOSURE (measured 2026-07-05, read-only live DB — recorded in the code comment)
- 0 of 120 current strategies are unregistered (ALL_STRATS expanded to 174 entries covering the graduated library).
- 0 are in PAPER+ (all CANDIDATE). → **LATENT safety-net, ZERO active live exposure today.** (Corrects grader's
  "7 archetypes bypass at full size in live paper" — stale/false for current state.)

## PASS-3 PENDING-RUNS IMPACT (fact) — NOT a 7th-defect-with-pass-3-consequences
The bypass is in the Gate-3 backtest path, but Gate 3 is a WITHIN-concept A/B (v2-baseline vs v3-shadow, SAME
strategy_name, SAME registration status) → any shared eligibility treatment (bypass or not) applies IDENTICALLY to
both arms and CANCELS in the revival delta. So it does NOT change the certified 9/9 revival or the 2 regressions.
Per the charter, this is NOT a stop-and-park for pass-3 (no verdict-altering consequence). Recorded, not acted on.

## MATERIALITY — PARKED (judgment, dawn)
(a) Does a separate downstream structural-stop-ceiling gate actually fire for unregistered strategies, or is Check 0
the only ceiling enforcement (making the bypass a real ceiling-skip)? (b) Are the 14 corpus concepts in ALL_STRATS
(did Gate-3 runs route through the bypass — irrelevant to the verdict per above, but relevant to characterizing the
runs)? (c) is the parity rationale sound, or should the FIX be "register all hand-coded archetypes + route archetype
signals through the gate" rather than "bypass to match backtest"? All three are rulings, not facts → dawn.

## GRADER CORRECTION (doer≠grader)
F-4 as written ("unregistered bypass returns TAKE before all 9 hard-SKIP checks; 7 archetypes at full size in live")
is CORRECTED: intentional parity bypass (not fail-OPEN); overlay-only (framework gates claimed-separate, ceiling
discrepancy flagged); 0 current exposure (not 7-at-full-size). BUT the grader corroborates the ds21 carry-forward AND
its re-look surfaced the Check-0-ceiling-vs-comment discrepancy — genuine triage value even where the grade was overstated.
