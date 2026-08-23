"""The kill switch. Offline coverage for every safety-critical broker method.

ALGO-026 section 1(c) — the operator self-sufficiency pack — requires a one-action kill and a
dead-man signal, "verify and document if they exist, build the minimal honest version if not".
The prior-art assessment measured that they EXIST and that **not one of them was exercised by
any test**: `flatten`, `flatten_contract`, `cancel_all`, `cancel_order`, `get_open_position`,
`get_open_positions`, `get_working_orders`.

This file closes that. Offline by construction — an injected `FakeSession`, no socket, no
credential. It proves REQUEST SHAPING AND LOOP BEHAVIOUR, which is the honest limit: it cannot
prove TopstepX accepts the calls, and the ALGO-025 section 2.2 hard gate means nothing connects
until the ladder opens.

What is worth knowing about a kill switch is not that it sends one message when everything is
fine. It is what it does when there are several positions, when there are none, and WHEN ONE
CLOSE FAILS PART-WAY THROUGH. The last of those is measured here rather than assumed, and the
answer is recorded for the runbook.
"""
from __future__ import annotations

import pytest

from research import current_mnq_strategy_v2_2_projectx_broker as b


class Resp:
    def __init__(self, data, status=200):
        self.data, self.status_code = data, status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP{self.status_code}")

    def json(self):
        return self.data


class FakeSession:
    """Records every call. `fail_on` makes one endpoint raise, to test partial failure."""

    def __init__(self, orders=(), positions=(), fail_on=None, fail_after=0):
        self.headers = {}
        self.calls = []
        self.orders = list(orders)
        self.positions = list(positions)
        self.fail_on = fail_on
        self.fail_after = fail_after

    def post(self, url, json=None, timeout=None):
        self.calls.append((url, json))
        if self.fail_on and url.endswith(self.fail_on):
            n = sum(1 for u, _ in self.calls if u.endswith(self.fail_on))
            if n > self.fail_after:
                return Resp({"success": False, "errorMessage": "venue rejected"}, status=500)
        if url.endswith("/Auth/loginKey"):
            return Resp({"success": True, "token": "t"})
        if url.endswith("/Order/searchOpen"):
            return Resp({"success": True, "orders": list(self.orders)})
        if url.endswith("/Position/searchOpen"):
            return Resp({"success": True, "positions": list(self.positions)})
        if url.endswith("/Order/cancel"):
            return Resp({"success": True})
        if url.endswith("/Position/closeContract"):
            return Resp({"success": True})
        return Resp({"success": False, "errorMessage": "unknown"})

    def endpoints(self, suffix):
        return [(u, j) for u, j in self.calls if u.endswith(suffix)]


def _broker(**kw):
    s = FakeSession(**kw)
    return s, b.ProjectXBroker(7, username="u", api_key="k", session=s)


POS = [{"contractId": "CON.F.US.MNQ.M26", "size": 15, "type": 1},
       {"contractId": "CON.F.US.MES.M26", "size": 3, "type": 2}]
ORD = [{"id": 111}, {"id": 222}, {"id": 333}]


# --- flatten -----------------------------------------------------------------------------

def test_flatten_closes_EVERY_open_position_not_just_the_first():
    """A kill switch that stops after one position is not a kill switch."""
    s, br = _broker(positions=POS)
    br.flatten()
    closed = [j["contractId"] for _, j in s.endpoints("/Position/closeContract")]
    assert closed == ["CON.F.US.MNQ.M26", "CON.F.US.MES.M26"], closed


def test_flatten_on_a_flat_account_sends_no_close_and_does_not_raise():
    s, br = _broker(positions=[])
    br.flatten()
    assert s.endpoints("/Position/closeContract") == []


def test_flatten_contract_addresses_the_right_account_and_contract():
    s, br = _broker()
    br.flatten_contract("CON.F.US.MNQ.M26")
    (_, payload), = s.endpoints("/Position/closeContract")
    assert payload == {"accountId": 7, "contractId": "CON.F.US.MNQ.M26"}


def test_a_failed_close_ABORTS_and_leaves_later_positions_OPEN():
    """MEASURED, not assumed, and it is the runbook's most important line.

    `flatten()` loops and each close raises on a non-2xx. So a venue rejection on the FIRST
    contract stops the loop and the SECOND position is never closed. The operator must know
    that a failed "stop everything" can leave him partly in the market, and that the correct
    response is to run it again and then check positions - not to assume flat.
    """
    s, br = _broker(positions=POS, fail_on="/Position/closeContract", fail_after=0)
    with pytest.raises(RuntimeError):
        br.flatten()
    attempted = [j["contractId"] for _, j in s.endpoints("/Position/closeContract")]
    assert attempted == ["CON.F.US.MNQ.M26"], attempted
    assert "CON.F.US.MES.M26" not in attempted, (
        "if this ever changes so flatten continues past a failure, that is an IMPROVEMENT - "
        "update this test deliberately and update the runbook line with it")


# --- cancel ------------------------------------------------------------------------------

def test_cancel_all_cancels_EVERY_working_order():
    s, br = _broker(orders=ORD)
    br.cancel_all()
    ids = [j["orderId"] for _, j in s.endpoints("/Order/cancel")]
    assert ids == [111, 222, 333], ids


def test_cancel_all_with_no_working_orders_is_a_silent_no_op():
    s, br = _broker(orders=[])
    br.cancel_all()
    assert s.endpoints("/Order/cancel") == []


def test_cancel_order_addresses_the_right_account():
    s, br = _broker()
    br.cancel_order(999)
    (_, payload), = s.endpoints("/Order/cancel")
    assert payload == {"accountId": 7, "orderId": 999}


def test_a_failed_cancel_ABORTS_the_rest():
    """Same shape as flatten, recorded for the same reason."""
    s, br = _broker(orders=ORD, fail_on="/Order/cancel", fail_after=1)
    with pytest.raises(RuntimeError):
        br.cancel_all()
    ids = [j["orderId"] for _, j in s.endpoints("/Order/cancel")]
    assert ids == [111, 222], ids


# --- position reads the kill path depends on ----------------------------------------------

def test_get_open_position_nets_long_against_short():
    s, br = _broker(positions=POS)
    assert br.get_open_position() == 15 - 3


def test_get_open_position_is_zero_when_flat():
    s, br = _broker(positions=[])
    assert br.get_open_position() == 0


def test_a_short_only_account_reports_negative():
    s, br = _broker(positions=[{"contractId": "C", "size": 5, "type": 2}])
    assert br.get_open_position() == -5


def test_get_working_orders_and_positions_report_what_the_venue_returns():
    s, br = _broker(orders=ORD, positions=POS)
    assert br.get_working_orders() == ORD
    assert br.get_open_positions() == POS


# --- the dead-man signal -------------------------------------------------------------------

def test_realtime_health_is_unhealthy_when_any_leg_is_down():
    """The heartbeat the operator relies on to notice silence."""
    ok = b.RealtimeHealth(True, True, 1.0, 24000, 24000.25)
    assert ok.healthy is True
    for bad in (b.RealtimeHealth(False, True, 1.0, 24000, 24000.25),
                b.RealtimeHealth(True, False, 1.0, 24000, 24000.25)):
        assert bad.healthy is False, bad


def test_the_safety_methods_are_now_all_exercised():
    """Closes the loop with the prior-art assessment: its finding must now be stale."""
    from research import current_mnq_strategy_v2_4_topstepx_prior_art as A
    still_dark = set(A.assess()["safety_critical_UNEXERCISED"])
    assert not still_dark, (
        f"still unexercised: {sorted(still_dark)} - this file was supposed to cover them")
