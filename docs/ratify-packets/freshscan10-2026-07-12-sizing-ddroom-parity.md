# Ratify-Packet — freshscan10 MED#1 (2026-07-12): backtest sizing drawdown-room parity

**STATUS: STAGED. Autonomous class (pre-live, default-OFF gated → invalidates no certified ref).**
Per the operator-amended `ratify-packet` skill (2026-07-11), this is NOT the irreversible/
live-capital class: it is instrument code but pre-live, and it ships **default-OFF** so the
default backtest behavior stays byte-identical (no frozen ref / certified band / golden fixture
re-baselined unless the operator opts in). It therefore proceeds: stage packet → implement via
agent-loop (scope-locked implementer → fresh-context independent grader) → post-hoc plain-English
summary to the operator (standing veto). **No permission-wait.** This packet is the receipt the
independent grader rules on.

Base: origin/hardening/phase-0 @ `2b825759`. Subsystem: capital-safety-sizing (backtest path).

> **Relationship to prior findings:** DISTINCT from the 2026-07-11 ledger's CAP-2
> (`sizing.py:498`, the SCALAR `compute_risk_derived_contracts` early-return path) and from the
> compacted-session main-path floor fix (`~sizing.py:674`). Those hardened the SCALAR path. MED#1
> is the **vectorized `compute_position_sizes` (sizing.py:990) backtest batch path**, which has
> **no `current_drawdown_room` parameter at all** — so no scalar fix can reach it. This is the
> gap that survived the scalar hardening.

---

## MED#1 — MED (instrument)

**File:** `src/engine/sizing.py:990` (signature) + `:1293-1318` (per-bar min chain + floor) — subsystem: capital-safety-sizing

**1. What & why (defect + receipt):** The vectorized backtest sizing path
`compute_position_sizes` never threads or applies the Inst-10 drawdown-room cap that the scalar
`compute_risk_derived_contracts` (`sizing.py:465-551`) and the TS live/paper path
`risk-sizing.ts` (`drawdownRoomCap`, ~775-777, 945-948) both apply for Topstep. So the backtest
sizes a Topstep strategy larger than paper/live will on the same fresh-buffer account state.

> Failure scenario (the DEFAULT Topstep case, not an edge): fresh Topstep 50K combine,
> MES strategy, ATR=4pts, stop_mult=1.5 → stop $30/contract, base_contracts=9, trailing-DD
> buffer $2,000. **PAPER/LIVE** (`risk-sizing.ts`, wired live at `paper-signal-service.ts:5521`):
> `drawdownRoomCap = floor(2000 × 0.08 / 30) = 5`, which binds the pyramid floor down to **5
> contracts**. **BACKTEST** (`compute_position_sizes`): the scalar call at `sizing.py:1159-1178`
> omits `current_drawdown_room` (the param does not exist on the signature at line 990), so the
> per-bar `min()` chain at `1293-1296` clamps only `pyramid_tier_per_bar / risk_derived_caps /
> effective_firm_cap_bar / liquidity_cap_bar` — **never a drawdown_room term** — and the
> healthy-account pyramid floor at `1301-1318` then floors back up to base=**9**. Result: backtest
> sizes **9 MES where live/paper sizes 5** (~80% over-size). Because the backtest also uses a fixed
> ~$50k proxy balance with a $2,000 buffer, `risk_derived_cap` is small and the floor engages on
> essentially EVERY default Topstep backtest → the 9-vs-5 gap is the default, not an edge case.

> Evidence (repro):
> - `grep -n "def compute_position_sizes" src/engine/sizing.py` → line 990; its signature
>   (`990-999`) has params `df, config, contract_spec, atr_period, max_contracts,
>   profit_scaling_tier, kelly_params, fomc_proximity` — **no `current_drawdown_room`**.
> - `sizing.py:1293-1296` — the per-bar min chain: `bar_sizes = np.minimum(pyramid_tier_per_bar,
>   risk_derived_caps); ...effective_firm_cap_bar); ...liquidity_cap_bar)` — no dd-room term.
> - `sizing.py:465-482` — scalar `compute_risk_derived_contracts` DOES compute
>   `drawdown_room_cap = floor(current_drawdown_room × _DRAWDOWN_ROOM_RISK_PCT /
>   stop_dollars_per_contract)` and folds it into its floor min() (`502-519`), with a docstring
>   claiming "Parity: identical to TypeScript risk-sizing.ts drawdownRoomCap computation".

**Independent verify (accuracy-validator, freshscan10 grade — both passes):** Confirmed
`compute_position_sizes` (the `risk_derived_pyramid` branch) never passes `current_drawdown_room`,
so `has_drawdown_room_input` is always False in the vectorized path and the per-bar min chain never
includes a dd-room term. Confirmed `risk-sizing.ts` computes+applies `drawdownRoomCap` and
`paper-signal-service.ts:5521` wires a live `currentDrawdownRoom`. **Real, not a false positive.**
Adversarial direction check: because `drawdown_room_cap` only ever participates as an additional
term in a `min()`/floor-clamp, its absence can only RAISE or HOLD `final_contracts` — it
structurally **cannot** cause the backtest to UNDERsize relative to paper. So no bad-edge strategy
is promoted via inflated apparent returns from undersizing; the divergence is CONSERVATIVE (it
over-states $ risk on the dollar-denominated B14/MC gates, which is the stricter direction).
**Correctly MED** (not a mis-downgraded HIGH) and **correctly packet-gated** (instrument sizing math).

**2. Blast radius:** Flipping the fix ON re-baselines every Topstep backtest's per-bar contract
counts → changes trade P&L, and the dollar-denominated B14 firm-breach / MC-ruin gate INPUTS
(these are NOT scale-invariant). The primary EDGE gates (Sharpe / PF / WFE / avg-R) ARE
scale-invariant, so promotion-edge verdicts do not move. **Default-OFF means byte-identical until
opt-in → no certified band / frozen-policy hash / golden fixture is invalidated at the default.**
When flipped ON, historical Topstep backtests become NON-comparable — the flagged strategies must
be re-run before comparing metrics or trusting them for promotion (same discipline as
`BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED`).

**3. Scope-locked change (PROPOSED):**
- Add `current_drawdown_room: Optional[float] = None` to `compute_position_sizes` (sizing.py:990).
- Gate behind a NEW env flag `BACKTEST_DRAWDOWN_ROOM_PARITY_ENABLED` (default **false**), mirroring
  `BACKTEST_STRUCTURAL_STOP_PARITY_ENABLED`.
- When the flag is true AND `current_drawdown_room is not None`: compute a per-bar
  `drawdown_room_cap_bar = floor(current_drawdown_room × _DRAWDOWN_ROOM_RISK_PCT /
  stop_dollars_per_contract_bar)` (mirroring the scalar `465-482` byte-for-byte) and add it as a
  term in the per-bar `min()` chain at `1294` (and clamp the healthy-floor `floored_val` at
  `1312-1313` by it too, so the floor cannot re-inflate above dd-room — same fix shape the
  firm/liquidity clamp already uses there).
- Thread `current_drawdown_room` from the backtest caller (`backtester.py`) where the Topstep
  trailing-DD buffer for the simulated account is known; pass `None` for non-Topstep firms
  (dd-room is Topstep-only — matches the scalar/TS gating).
- **OUT of scope:** the scalar `compute_risk_derived_contracts` (already correct); the TS
  `risk-sizing.ts` (already correct); non-Topstep firms; the default-OFF behavior (must stay
  byte-identical); Kelly/fixed sizing modes (dd-room applies to `risk_derived_pyramid` only).

**4. Verification plan:**
- A/B parity harness (flag ON vs OFF) on ≥2 real Topstep strategies proving the 9→5 contract change
  on the default fresh-buffer case and quantifying the metric delta (ship the receipt).
- Flip-enumeration test: `BACKTEST_DRAWDOWN_ROOM_PARITY_ENABLED=false` → byte-identical to current
  output on a golden Topstep fixture (no drift).
- Unit test: `compute_position_sizes` with `current_drawdown_room=2000` + flag ON returns the
  dd-room-capped count (5) not base (9) on the fresh-Topstep fixture; RED-proofs a revert of the
  min-chain term.
- Cross-engine parity assertion: vectorized `compute_position_sizes` (flag ON) == scalar
  `compute_risk_derived_contracts` on the same account state (closes the very gap this packet fixes).
- Independent grade (doer≠grader) before land.

**5. Rollback:** Single-commit revert on the fix branch. Runtime kill: set
`BACKTEST_DRAWDOWN_ROOM_PARITY_ENABLED=false` (the default) → instant return to byte-identical
legacy behavior, no revert needed.

---

## Plain-English summary for the operator (standing veto; NOT a code decision)

Your backtests currently pretend your Topstep account can trade a bit **bigger** than it really
can on a fresh account (about 9 micro-contracts in the test vs the 5 your live safety rule would
actually allow when the account is new and the safety buffer is small). This makes the backtest a
touch **more cautious about risk, not less** — it assumes bigger losses than you'd really take — so
it never makes a losing strategy look like a winner. It's a "the test is stricter than real life"
gap, not a "the bot will over-trade your money" gap. Nothing about your live/paper trading is
affected — this is backtest-only.

The fix makes the backtest size exactly like your live rule, but it's shipped **turned OFF by
default**, so nothing changes until you (or the grader) decide to turn it on and re-run the
affected Topstep backtests. **No action needed from you right now** — this is logged as a known,
conservative, backtest-only residual on the path to a band-8 grade.
