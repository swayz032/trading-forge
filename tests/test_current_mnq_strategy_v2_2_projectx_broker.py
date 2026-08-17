from dataclasses import replace
from pathlib import Path
import pytest

from research import current_mnq_strategy_v2_2_projectx_broker as b
from research.current_mnq_strategy_v2_2_live_safety import PersistentOneTradeLock


class Resp:
    def __init__(self,data,status=200): self.data=data; self.status_code=status
    def raise_for_status(self):
        if self.status_code>=400: raise RuntimeError(f'HTTP{self.status_code}')
    def json(self): return self.data


class FakeSession:
    def __init__(self): self.headers={}; self.calls=[]; self.orders=[]; self.positions=[]
    def post(self,url,json=None,timeout=None):
        self.calls.append((url,json))
        if url.endswith('/Auth/loginKey'): return Resp({'success':True,'token':'t'})
        if url.endswith('/Account/search'): return Resp({'success':True,'accounts':[{'id':7,'canTrade':True,'isVisible':True}]})
        if url.endswith('/Contract/available'): return Resp({'success':True,'contracts':[{'id':'CON.F.US.MNQ.M26','activeContract':True,'tickSize':.25}]})
        if url.endswith('/Order/searchOpen'): return Resp({'success':True,'orders':list(self.orders)})
        if url.endswith('/Position/searchOpen'): return Resp({'success':True,'positions':list(self.positions)})
        if url.endswith('/Order/place'): return Resp({'success':True,'orderId':123})
        if url.endswith('/Order/cancel'): return Resp({'success':True})
        if url.endswith('/Position/closeContract'): return Resp({'success':True})
        return Resp({'success':False,'errorCode':1,'errorMessage':'unknown'})


def make(tmp_path):
    s=FakeSession(); broker=b.ProjectXBroker(7,username='u',api_key='k',session=s)
    lock=PersistentOneTradeLock(tmp_path/'state.json')
    ctx=b.ArmContext('2026-03-23',7,'CON.F.US.MNQ.M26','LONG',15,123456,17.25,40.0,0.0,.5)
    health=b.RealtimeHealth(True,True,1.0,24000,24000.25)
    return s,broker,lock,ctx,health


def test_arm_builds_unique_market_order_with_server_brackets(tmp_path):
    s,broker,lock,ctx,health=make(tmp_path)
    state,p=broker.arm(ctx,health,lock)
    assert p['type']==b.ORDER_MARKET and p['side']==b.SIDE_BUY and p['size']==15
    assert p['stopLossBracket']=={'ticks':69,'type':b.ORDER_STOP}
    assert p['takeProfitBracket']=={'ticks':160,'type':b.ORDER_LIMIT}
    assert p['customTag'].startswith('MNQV22-2026-03-23-LONG-')


def test_wrong_roll_contract_refuses(tmp_path):
    _,broker,lock,ctx,health=make(tmp_path)
    bad=replace(ctx,session='2026-03-13',contract_id='CON.F.US.MNQ.M26')
    with pytest.raises(RuntimeError,match='CONTRACT_MISMATCH'):
        broker.arm(bad,health,lock)


def test_unhealthy_realtime_refuses(tmp_path):
    _,broker,lock,ctx,health=make(tmp_path)
    with pytest.raises(RuntimeError,match='REALTIME_HUB_UNHEALTHY'):
        broker.arm(ctx,replace(health,market_hub_connected=False),lock)


def test_open_position_or_working_orders_refuse(tmp_path):
    s,broker,lock,ctx,health=make(tmp_path)
    s.positions=[{'contractId':'CON.F.US.MNQ.M26','type':1,'size':1}]
    with pytest.raises(RuntimeError,match='OPEN_POSITION_EXISTS'):
        broker.arm(ctx,health,lock)
    s.positions=[]; s.orders=[{'id':9}]
    with pytest.raises(RuntimeError,match='WORKING_ORDERS_EXIST'):
        broker.arm(ctx,health,lock)


def test_submit_reconciles_then_consumes_daily_lock(tmp_path):
    s,broker,lock,ctx,health=make(tmp_path)
    state,p=broker.arm(ctx,health,lock)
    oid=broker.submit_armed(state,p,lock)
    assert oid==123 and lock.load(ctx.session).traded
    with pytest.raises(RuntimeError,match='ONE_TRADE_ALREADY_USED'):
        broker.submit_armed(lock.load(ctx.session),p,lock)
