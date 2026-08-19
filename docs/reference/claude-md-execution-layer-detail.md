# Execution Layer — Full Detail (Pine parity wall, cost split, stub states)

> Moved verbatim from CLAUDE.md §7 during the 2026-08-18 token-optimization pass.

## §7. Execution Layer

### Execution routing is FIRM-SPECIFIC (corrected 2026-06-23)
**Topstep does NOT use TradersPost** — Topstep banned Tradovate/NinjaTrader on 2026-01-12 and
requires **TopstepX**. TradersPost is ONLY for MFFU / other prop firms + TradingView paper testing.

```
TOPSTEP (PRIMARY):   TF engine → broker-router → TopstepX REST/WS API → Topstep account
                     [STUB today — must BUILD when operator opens the account. No TradersPost.]

MFFU / other firms:  TF engine → broker-router → TradersPost webhook → Tradovate (broker) → account
                     Tradovate = the futures broker on TradersPost (demo for paper, live for funded).

TradingView paper-test: TradingView Pine alert → TradersPost → Tradovate demo (paper account)
```

**Note (M3, 2026-07-17):** the "TradingView paper-test" row above describes the FAMILY/operator's external Pine→TradersPost workflow — entirely outside the TF backend, unaffected by M3. This is distinct from the internal-engine PAPER-state promotion-evidence authority M3 changed (§8). Don't conflate the two: a family member's Pine-alert paper test on TradingView/TradersPost is a separate, always-external-broker workflow; a strategy's own PAPER lifecycle state inside TF now uses the internal engine exclusively.

### ★ The Pine parity wall — full Slumdawg does NOT ride through TradingView Pine
Pine cannot reproduce Style C / adaptive exits (one `strategy.exit()` only), the 11-factor weighted
confluence gate, multi-TF gating, ICT/SMT/volume-profile, or the RL challenger. The `exportability.py`
**`faithful` flag HARD-blocks** any Pine that would misrepresent the strategy (correct behavior).
So the institutional path for FULL Slumdawg is **TF engine → broker-router → (TopstepX | TradersPost)
DIRECT** — preserving everything. **TradingView Pine is for (a) the FAMILY's SIMPLE strategies
(different per member, §9) and (b) a visual monitor**, NOT for executing full Slumdawg. Parity-gap
status (deep-scan #8 w2, 2026-07-02): Strategy-Tester-vs-broker P&L reconciliation harness SHIPPED —
`npx tsx scripts/pine-broker-reconcile.ts --strategy <id> --csv <tester-export.csv>` (2-tick tolerance
per §8, both TradingView export shapes, `pine_parity.reconciliation_run` audit row); VWAP session-reset
unified to Globex 18:00 ET (deep-scan #6 Track D). Static Pine-vs-engine result-equivalence test
SHIPPED (deep-scan #22 Track X4, `src/engine/tests/test_ds22_x4_pine_engine_static_equivalence.py`): for the
faithful-archetype class, two independent oracles (real `generate_signals`/`_apply_stop_only_management` vs.
regex-extracted-and-reinterpreted compiled Pine text) must agree on entry/exit bar + price within 2-tick
tolerance; RED-proof meta-tests confirm the checker catches injected divergence. Full Slumdawg remains
untestable-by-design (Pine cannot express it — HARD-blocked, not a gap). The runtime reconciliation harness
(`pine-broker-reconcile.ts`) remains the operating control for live numerical parity on real market data — a
distinct, still-necessary check this static test does not replace. (Track Y4, `test_ds22_y4_strategy_shell_event_blackout.py`:
the DEFAULT live export path `compile_strategy()` → `strategy_shell` now emits the shared full FOMC/CPI/NFP
`_build_event_blackout_block()` — previously it shipped an NFP-only inline blackout, so family-distributed Pine
lacked the FOMC/CPI macro blackout the rest of the system enforces; RED-proof meta-test guards the regression.)

### Cost split (lean — don't double-pay)
- **Topstep accounts → TopstepX** ($14.50/mo sub covers Topstep accounts + the TopstepX copier). No TradersPost.
- **MFFU / other firms → TradersPost + Tradovate.** Operator's own multi-account copy-scaling on TradersPost
  (Pro $199 = 3 / Premium $299 = 6) is only for MFFU/other-firm accounts; Topstep copy is TopstepX-side.
- **Family:** each member = own TradersPost Starter ($49, futures = the 1 asset class) + own Tradovate demo→live + own device + a DIFFERENT simple strategy.

### Broker abstraction layer
`src/server/services/broker-router.ts` is the SINGLE SOURCE OF TRUTH for order routing. Today: TradersPost
path active (MFFU/other firms), TopstepX returns stub (`topstepx_not_configured`).

### Per-account broker mapping
`broker_accounts` table maps each account_id → firm_id + broker_type + Bitwarden vault ref. `instance_config.enabled_firms` controls which firms an instance allows.

---

