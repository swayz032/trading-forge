#!/usr/bin/env python3
"""Account-bound risk state for TopstepX simulated-account automation.

The broker balance is the source of truth for current balance. A local account
configuration defines the account's starting balance and max-loss distance, while
persistent EOD high-water state derives a conservative trailing floor. The signal
cannot supply or override these values.

The floor rule is intentionally configurable/account-bound instead of inferred
from strategy P&L. Updating EOD high-water is a separate explicit operation; an
intraday winning trade never moves the persisted floor by accident.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path

from research.current_mnq_strategy_v2_3_topstep_risk import RiskEnvelope


@dataclass(frozen=True)
class AccountRiskConfig:
    account_id: int
    account_size_label: str
    starting_balance: float
    max_loss_distance: float
    platform_max_micros: int = 50
    min_same_stop_survival: int = 3
    lock_trailing_floor_at_starting_balance: bool = True

    def validate(self) -> None:
        if self.account_id <= 0:
            raise RuntimeError("RISK_CONFIG_ACCOUNT_INVALID")
        if self.starting_balance <= 0 or self.max_loss_distance <= 0:
            raise RuntimeError("RISK_CONFIG_BALANCE_INVALID")
        if self.platform_max_micros <= 0:
            raise RuntimeError("RISK_CONFIG_PLATFORM_LIMIT_INVALID")
        if self.min_same_stop_survival < 2:
            raise RuntimeError("RISK_CONFIG_SURVIVAL_INVALID")


@dataclass
class AccountRiskState:
    schema_version: int
    account_id: int
    highest_eod_balance: float
    last_eod_session: str | None = None


class AccountRiskStore:
    SCHEMA = 1

    def __init__(self, config: AccountRiskConfig, state_path: str | Path):
        config.validate()
        self.config = config
        self.path = Path(state_path)

    @staticmethod
    def _hash(payload: dict) -> str:
        raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        return hashlib.sha256(raw).hexdigest()

    def _initial(self) -> AccountRiskState:
        return AccountRiskState(
            schema_version=self.SCHEMA,
            account_id=self.config.account_id,
            highest_eod_balance=self.config.starting_balance,
            last_eod_session=None,
        )

    def _atomic_write(self, state: AccountRiskState) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(state)
        wrapper = {"payload": payload, "sha256": self._hash(payload)}
        fd, tmp = tempfile.mkstemp(prefix=self.path.name + ".", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(wrapper, f, indent=2, sort_keys=True)
                f.flush(); os.fsync(f.fileno())
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def load(self) -> AccountRiskState:
        if not self.path.exists():
            state = self._initial()
            self._atomic_write(state)
            return state
        try:
            wrapper = json.loads(self.path.read_text())
            payload = wrapper["payload"]
        except Exception as exc:
            raise RuntimeError("RISK_STATE_CORRUPT") from exc
        if wrapper.get("sha256") != self._hash(payload):
            raise RuntimeError("RISK_STATE_CHECKSUM_MISMATCH")
        state = AccountRiskState(**payload)
        if state.schema_version != self.SCHEMA:
            raise RuntimeError("RISK_STATE_SCHEMA_MISMATCH")
        if state.account_id != self.config.account_id:
            raise RuntimeError("RISK_STATE_ACCOUNT_MISMATCH")
        if state.highest_eod_balance < self.config.starting_balance - self.config.max_loss_distance:
            raise RuntimeError("RISK_STATE_HIGH_WATER_INVALID")
        return state

    def record_eod_balance(self, session: str, broker_balance: float) -> AccountRiskState:
        """Advance high-water only from an explicitly reconciled EOD balance."""
        balance = float(broker_balance)
        if not (balance > 0):
            raise RuntimeError("RISK_EOD_BALANCE_INVALID")
        state = self.load()
        state.highest_eod_balance = max(float(state.highest_eod_balance), balance)
        state.last_eod_session = str(session)
        self._atomic_write(state)
        return state

    def trailing_floor(self, state: AccountRiskState | None = None) -> float:
        state = state or self.load()
        initial_floor = self.config.starting_balance - self.config.max_loss_distance
        trailing = float(state.highest_eod_balance) - self.config.max_loss_distance
        floor = max(initial_floor, trailing)
        if self.config.lock_trailing_floor_at_starting_balance:
            floor = min(floor, self.config.starting_balance)
        return float(floor)

    def envelope_from_broker_account(self, account: dict, *, dll_remaining: float | None = None) -> RiskEnvelope:
        if int(account.get("id", -1)) != self.config.account_id:
            raise RuntimeError("RISK_BROKER_ACCOUNT_MISMATCH")
        if account.get("canTrade") is not True:
            raise RuntimeError("RISK_BROKER_ACCOUNT_CANNOT_TRADE")
        if "balance" not in account:
            raise RuntimeError("RISK_BROKER_BALANCE_MISSING")
        balance = float(account["balance"])
        if not (balance > 0):
            raise RuntimeError("RISK_BROKER_BALANCE_INVALID")
        state = self.load()
        floor = self.trailing_floor(state)
        if balance <= floor:
            raise RuntimeError(f"RISK_MLL_HEADROOM_EXHAUSTED:{balance:.2f}<={floor:.2f}")
        return RiskEnvelope(
            account_size_label=self.config.account_size_label,
            current_balance=balance,
            mll_floor=floor,
            dll_remaining=dll_remaining,
            platform_max_micros=self.config.platform_max_micros,
        )
