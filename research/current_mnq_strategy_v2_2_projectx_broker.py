#!/usr/bin/env python3
"""Fail-closed ProjectX/TopstepX broker adapter for MNQ v2.2.

Official REST endpoints used:
- POST /Account/search
- POST /Contract/available
- POST /Order/searchOpen
- POST /Order/place
- POST /Order/cancel
- POST /Position/searchOpen
- POST /Position/closeContract

The strategy does not become live-enabled by importing this module. `arm()` requires
an exact account, exact current contract, realtime health, flat position, no working
orders, and a successful one-trade/risk preflight. Server-side stop/target brackets
are attached to the entry order.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import os
import requests

from research.current_mnq_strategy_v2_2_contracts import projectx_contract_id
from research.current_mnq_strategy_v2_2_live_safety import (
    PersistentOneTradeLock, RiskLimits, SessionState,
    deterministic_client_order_id, preflight_refuse_reasons,
)

API_BASE = "https://api.topstepx.com/api"
ORDER_LIMIT = 1
ORDER_MARKET = 2
ORDER_STOP = 4
SIDE_BUY = 0
SIDE_SELL = 1


@dataclass(frozen=True)
class RealtimeHealth:
    user_hub_connected: bool
    market_hub_connected: bool
    feed_age_seconds: float
    last_quote_bid: float | None = None
    last_quote_ask: float | None = None

    @property
    def healthy(self) -> bool:
        return self.user_hub_connected and self.market_hub_connected


@dataclass(frozen=True)
class ArmContext:
    session: str
    account_id: int
    contract_id: str
    side: str
    qty: int
    signal_epoch_ms: int
    stop_points: float
    target_points: float
    daily_realized_unrealized: float
    estimated_slippage_points: float


class ProjectXBroker:
    def __init__(self, account_id: int, username: str | None = None,
                 api_key: str | None = None, api_base: str = API_BASE,
                 session: requests.Session | None = None):
        self.username = username or os.getenv("TOPSTEPX_USERNAME")
        self.api_key = api_key or os.getenv("TOPSTEPX_API_KEY")
        if not self.username or not self.api_key:
            raise RuntimeError("PROJECTX_CREDENTIALS_MISSING")
        self.account_id = int(account_id)
        self.api_base = api_base.rstrip("/")
        self.session = session or requests.Session()
        self.session.headers.update({"Content-Type":"application/json","accept":"text/plain"})
        self._authenticate()

    def _authenticate(self):
        r=self.session.post(f"{self.api_base}/Auth/loginKey",
                            json={"userName":self.username,"apiKey":self.api_key},timeout=30)
        r.raise_for_status(); data=r.json()
        if not data.get("success"):
            raise RuntimeError(f"PROJECTX_AUTH_FAILED:{data}")
        self.session.headers["Authorization"] = f"Bearer {data['token']}"

    def _post(self, path: str, payload: dict) -> dict:
        r=self.session.post(f"{self.api_base}{path}",json=payload,timeout=30)
        r.raise_for_status(); data=r.json()
        if not data.get("success"):
            raise RuntimeError(f"PROJECTX_API_FAILED:{path}:{data.get('errorCode')}:{data.get('errorMessage')}")
        return data

    def account_snapshot(self) -> dict:
        data=self._post("/Account/search",{"onlyActiveAccounts":True})
        matches=[a for a in data.get("accounts",[]) if int(a.get("id",-1))==self.account_id]
        if len(matches)!=1:
            raise RuntimeError("PROJECTX_ACCOUNT_NOT_ACTIVE_OR_AMBIGUOUS")
        a=matches[0]
        if not a.get("canTrade",False):
            raise RuntimeError("PROJECTX_ACCOUNT_CANNOT_TRADE")
        return a

    def available_contract(self, expected_contract_id: str) -> dict:
        data=self._post("/Contract/available",{"live":False})
        matches=[c for c in data.get("contracts",[]) if c.get("id")==expected_contract_id]
        if len(matches)!=1:
            raise RuntimeError("PROJECTX_CONTRACT_NOT_AVAILABLE")
        c=matches[0]
        if not c.get("activeContract",False):
            raise RuntimeError("PROJECTX_CONTRACT_NOT_ACTIVE")
        return c

    def get_working_orders(self) -> list[dict]:
        return list(self._post("/Order/searchOpen",{"accountId":self.account_id}).get("orders",[]))

    def get_open_positions(self) -> list[dict]:
        return list(self._post("/Position/searchOpen",{"accountId":self.account_id}).get("positions",[]))

    def get_open_position(self) -> int:
        positions=self.get_open_positions()
        net=0
        for p in positions:
            size=int(p.get("size",0)); typ=int(p.get("type",0))
            # ProjectX position type example: 1 = Long. Treat anything else as short
            # only after presence is confirmed; any nonzero position blocks new trade anyway.
            net += size if typ==1 else -size
        return net

    def cancel_order(self, order_id: int) -> None:
        self._post("/Order/cancel",{"accountId":self.account_id,"orderId":int(order_id)})

    def cancel_all(self) -> None:
        for o in self.get_working_orders():
            self.cancel_order(int(o["id"]))

    def flatten_contract(self, contract_id: str) -> None:
        self._post("/Position/closeContract",{"accountId":self.account_id,"contractId":contract_id})

    def flatten(self) -> None:
        for p in self.get_open_positions():
            self.flatten_contract(str(p["contractId"]))

    @staticmethod
    def _ticks(points: float, tick_size: float) -> int:
        x=points/tick_size
        if abs(x-round(x))>1e-9:
            raise RuntimeError("BRACKET_DISTANCE_NOT_TICK_ALIGNED")
        return int(round(x))

    def arm(self, ctx: ArmContext, health: RealtimeHealth,
            lock: PersistentOneTradeLock, limits: RiskLimits = RiskLimits()) -> tuple[SessionState, dict]:
        state=lock.load(ctx.session)
        account=self.account_snapshot()
        expected=projectx_contract_id(date.fromisoformat(ctx.session))
        if ctx.contract_id != expected:
            raise RuntimeError(f"CONTRACT_MISMATCH:{ctx.contract_id}!={expected}")
        contract=self.available_contract(expected)
        if not health.healthy:
            raise RuntimeError("REALTIME_HUB_UNHEALTHY")
        working=self.get_working_orders()
        positions=self.get_open_positions()
        if working:
            raise RuntimeError("WORKING_ORDERS_EXIST")
        if positions:
            raise RuntimeError("OPEN_POSITION_EXISTS")
        reasons=preflight_refuse_reasons(
            state=state, broker_position=0, requested_qty=ctx.qty,
            daily_realized_unrealized=ctx.daily_realized_unrealized,
            feed_age_seconds=health.feed_age_seconds,
            estimated_slippage_points=ctx.estimated_slippage_points,
            contract_identity_confirmed=True, limits=limits)
        if reasons:
            raise RuntimeError("LIVE_PREFLIGHT_REFUSE:"+"|".join(reasons))
        tag=deterministic_client_order_id(ctx.session,ctx.side,ctx.signal_epoch_ms)
        tick=float(contract.get("tickSize"))
        payload={
            "accountId": self.account_id,
            "contractId": expected,
            "type": ORDER_MARKET,
            "side": SIDE_BUY if ctx.side.upper()=="LONG" else SIDE_SELL,
            "size": int(ctx.qty),
            "customTag": tag,
            "stopLossBracket": {"ticks": self._ticks(ctx.stop_points,tick), "type": ORDER_STOP},
            "takeProfitBracket": {"ticks": self._ticks(ctx.target_points,tick), "type": ORDER_LIMIT},
        }
        return state,payload

    def submit_armed(self, state: SessionState, payload: dict,
                     lock: PersistentOneTradeLock) -> int:
        # Last-moment reconciliation immediately before submission.
        if self.get_working_orders() or self.get_open_positions():
            raise RuntimeError("LAST_MOMENT_RECONCILIATION_REFUSE")
        if state.traded:
            raise RuntimeError("ONE_TRADE_ALREADY_USED")
        data=self._post("/Order/place",payload)
        order_id=int(data["orderId"])
        # Mark trade lock as consumed immediately after broker accepts the order;
        # partial/zero fill still means the daily strategy bullet has been submitted.
        lock.mark_trade(state,str(order_id),int(payload["size"]))
        return order_id
