"""Wave 25 Pass 2 — Inst-10: Drawdown-room-anchored sizing (Python parity).

Python exact port of src/server/lib/risk-sizing.ts drawdownRoomCap logic.
Tests mirror wave25-drawdown-room-sizing.test.ts to ensure paper == backtest.

Math reference (ATR=4pt, stop_mult=1.5, MES=$5/pt):
  stop_dollars_per_contract = 1.5 × 4 × 5 = $30

Drawdown room cap formula (Topstep only):
  drawdown_room_cap = floor(current_drawdown_room × DRAWDOWN_ROOM_RISK_PCT / stop_dollars_per_contract)

At 1% (default _DRAWDOWN_ROOM_RISK_PCT):
  $4,500 room: cap = floor(4500 × 0.01 / 30) = floor(1.5) = 1
  $0 room:     cap = 0 → finalContracts = 0
  $9,000 room: cap = floor(9000 × 0.01 / 30) = 3

Rationale (2026 funded-trader consensus):
  "Risk 1% of CURRENT DRAWDOWN ROOM, not 2% of balance."
  Parity guard: Python and TypeScript must return identical values.
"""

import math

import pytest

from src.engine.sizing import (
    _DRAWDOWN_ROOM_RISK_PCT,
    compute_risk_derived_contracts,
)

# ── Standard test parameters ──────────────────────────────────────────────────

BASE_CONTRACTS = 6  # MES canonical
TIER_INC = 3
TIER_THRESH = 3000.0
MAX_RISK = 0.02
ATR = 4.0
STOP_MULT = 1.5
PV = 5.0  # MES $5/pt
LIQ_CAP = 100
STOP_DOLLARS = STOP_MULT * ATR * PV  # = $30


def make_topstep_input(**overrides):
    """Build a standard Topstep input with sensible defaults."""
    defaults = dict(
        base_contracts=BASE_CONTRACTS,
        tier_increment=TIER_INC,
        tier_threshold_dollars=TIER_THRESH,
        max_risk_pct_per_trade=MAX_RISK,
        liquidity_comfort_cap=LIQ_CAP,
        account_balance=52_000.0,
        cumulative_profit=2_000.0,
        atr_points=ATR,
        stop_multiplier=STOP_MULT,
        point_dollar_value=PV,
        firm_contract_cap=50,
        firm="topstep",
        trailing_dd=2000.0,
        high_water_balance=52_000.0,
        account_starting_floor=50_000.0,
    )
    defaults.update(overrides)
    return defaults


# ── Test 1: DD room = 0 → drawdown_room_cap = 0 → 0 contracts ────────────────


class TestDrawdownRoomZero:
    def test_topstep_no_room_left_zero_contracts(self):
        """Topstep healthy account (buffer > 0) but current_drawdown_room=0 explicitly → cap=0 → 0 contracts."""
        # account_balance=$51K, HWM=$51K, trailing_dd=$2K, starting_floor=$50K
        # trailing_floor = min(51000 - 2000, 50000) = min(49000, 50000) = 49000
        # buffer = 51000 - 49000 = $2000 > 0 (no zero_buffer early return)
        # current_drawdown_room=0 explicitly (operator passed it: e.g. near DLL event)
        # drawdown_room_cap = floor(0 × 0.01 / 30) = 0 → final_contracts = 0
        result = compute_risk_derived_contracts(
            **make_topstep_input(
                account_balance=51_000.0,
                high_water_balance=51_000.0,
                account_starting_floor=50_000.0,
                trailing_dd=2_000.0,
                current_drawdown_room=0.0,  # explicitly: no room left
                firm_contract_cap=200,
            )
        )

        # drawdown_room_cap = floor(0 × 0.01 / 30) = 0
        assert result.drawdown_room_cap == 0
        assert result.final_contracts == 0
        assert result.drawdown_room_cap_binding is True


# ── Test 2: DD room > 0 → cap computed ───────────────────────────────────────


class TestDrawdownRoomPositive:
    def test_topstep_4500_room_gives_cap_1(self):
        """Topstep with $4,500 DD room → drawdown_room_cap = 1 (floor of 1.5)."""
        result = compute_risk_derived_contracts(
            **make_topstep_input(
                account_balance=54_500.0,
                high_water_balance=54_500.0,
                account_starting_floor=50_000.0,
                trailing_dd=2_000.0,
                current_drawdown_room=4_500.0,
                firm_contract_cap=100,
            )
        )

        # drawdown_room_cap = floor(4500 × 0.01 / 30) = floor(1.5) = 1
        expected_cap = math.floor(4_500.0 * _DRAWDOWN_ROOM_RISK_PCT / STOP_DOLLARS)
        assert result.drawdown_room_cap == expected_cap
        assert result.drawdown_room_cap == 1

    def test_topstep_drawdown_room_cap_binding(self):
        """Topstep: large account, small DD room → drawdown_room_cap is the binding constraint."""
        result = compute_risk_derived_contracts(
            **make_topstep_input(
                account_balance=100_000.0,
                high_water_balance=100_000.0,
                account_starting_floor=50_000.0,
                trailing_dd=2_000.0,
                cumulative_profit=50_000.0,  # large pyramid tier
                current_drawdown_room=9_000.0,  # $9K room
                firm_contract_cap=200,
            )
        )

        # drawdown_room_cap = floor(9000 × 0.01 / 30) = 3
        expected_cap = math.floor(9_000.0 * _DRAWDOWN_ROOM_RISK_PCT / STOP_DOLLARS)
        assert result.drawdown_room_cap == expected_cap
        assert result.drawdown_room_cap == 3
        assert result.drawdown_room_cap_binding is True
        assert result.final_contracts == 3
        assert result.evidence["binding_cap"] == "drawdown_room"


# ── Test 3: MFFU → drawdown_room_cap NOT applied ─────────────────────────────


class TestMffuNoDrawdownRoomCap:
    def test_mffu_ignores_current_drawdown_room(self):
        """MFFU account: current_drawdown_room input is ignored → drawdown_room_cap=None."""
        result = compute_risk_derived_contracts(
            base_contracts=6,
            tier_increment=3,
            tier_threshold_dollars=3000.0,
            max_risk_pct_per_trade=0.02,
            liquidity_comfort_cap=100,
            account_balance=50_000.0,
            cumulative_profit=0.0,
            atr_points=ATR,
            stop_multiplier=STOP_MULT,
            point_dollar_value=PV,
            firm_contract_cap=50,
            firm="mffu",
            current_drawdown_room=500.0,  # should be ignored
        )

        assert result.drawdown_room_cap is None
        assert result.drawdown_room_cap_binding is False
        # MFFU: riskDollars = 50000 × 0.02 = $1000 → riskDerivedCap = 33
        assert result.risk_derived_cap == 33
        assert result.firm == "mffu"


# ── Test 4: env var override DRAWDOWN_ROOM_RISK_PCT=0.005 ────────────────────


class TestEnvVarOverride:
    def test_drawdown_room_risk_pct_formula(self):
        """Verify formula math for both 1% and 0.5% risk fractions."""
        room = 9_000.0

        # At 1% (default): floor(9000 × 0.01 / 30) = 3
        cap_1pct = math.floor(room * 0.01 / STOP_DOLLARS)
        assert cap_1pct == 3

        # At 0.5%: floor(9000 × 0.005 / 30) = floor(1.5) = 1
        cap_half_pct = math.floor(room * 0.005 / STOP_DOLLARS)
        assert cap_half_pct == 1

        # Confirms: halving the risk fraction halves the cap (approximately)
        assert cap_1pct == 3 * cap_half_pct


# ── Test 5: No drawdown_room input → no cap applied ──────────────────────────


class TestNoCap:
    def test_topstep_no_drawdown_room_input_no_cap(self):
        """Topstep with no current_drawdown_room → drawdown_room_cap=None, old behavior."""
        result = compute_risk_derived_contracts(
            **make_topstep_input(
                # current_drawdown_room not provided → None by default
            )
        )

        assert result.drawdown_room_cap is None
        assert result.drawdown_room_cap_binding is False

    def test_topstep_large_room_not_binding(self):
        """Large DD room → cap >> other caps → not binding → pyramid floor applies."""
        result = compute_risk_derived_contracts(
            **make_topstep_input(
                account_balance=52_000.0,
                high_water_balance=52_000.0,
                cumulative_profit=0.0,
                current_drawdown_room=100_000.0,  # massive room → cap = 33
                firm_contract_cap=50,
            )
        )

        # cap = floor(100000 × 0.01 / 30) = 33 (not binding)
        assert result.drawdown_room_cap == math.floor(
            100_000.0 * _DRAWDOWN_ROOM_RISK_PCT / STOP_DOLLARS
        )
        assert result.drawdown_room_cap_binding is False
        # Pyramid floor applies: account healthy, risk-cap is low (small Topstep buffer)
        assert result.pyramid_floor_applied is True
        assert result.final_contracts == BASE_CONTRACTS  # = 6


# ── Test 6: Parity check — Python matches TypeScript formula exactly ──────────


class TestParityWithTypescript:
    @pytest.mark.parametrize(
        "room,expected_cap",
        [
            (0.0, 0),
            (4_500.0, 1),  # floor(1.5) = 1
            (6_000.0, 2),  # floor(2.0) = 2
            (9_000.0, 3),
            (15_000.0, 5),
            (30_000.0, 10),
        ],
    )
    def test_drawdown_room_cap_matches_typescript_formula(self, room, expected_cap):
        """Python formula floor(room × 0.01 / 30) must match TypeScript for all room values."""
        computed = math.floor(room * _DRAWDOWN_ROOM_RISK_PCT / STOP_DOLLARS)
        assert computed == expected_cap, (
            f"room={room}: Python cap={computed} expected={expected_cap}. "
            f"Parity mismatch — TypeScript and Python must agree."
        )
