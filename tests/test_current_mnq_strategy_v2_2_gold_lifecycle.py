import pandas as pd
from research import current_mnq_strategy_v2_2_engine as b
from research import current_mnq_strategy_v2_2_gold_lifecycle as g


def t(s): return pd.Timestamp(s,tz=b.TZ)

def zone(side='R'):
    return b.Zone('z',side,99,101,100,2,.6,.8,.8,.8,.8,.8,.85,t('2026-03-25 09:00'),t('2026-03-25 08:00'),state=b.ZoneState.ACTIVE_RESISTANCE if side=='R' else b.ZoneState.ACTIVE_SUPPORT)

def features(rows):
    x=pd.DataFrame(rows,index=[t(r.pop('ts')) for r in rows])
    # Required strong_bar fields; defaults keep non-strong unless specified.
    for c,v in [('bf',.4),('rr',.8),('cl',.5),('be',False),('se',False),('atr',10.0)]:
        if c not in x: x[c]=v
    return x


def test_gold_g05_failed_bull_breakout_restores_resistance():
    rows=[
      {'ts':'2026-03-25 09:05','open':100,'high':102,'low':99.5,'close':101.75,'bf':.55,'rr':.9,'cl':.9,'atr':10},
      {'ts':'2026-03-25 09:10','open':101.7,'high':102,'low':98.5,'close':99.5,'bf':.75,'rr':1.3,'cl':.28,'atr':10},
    ]
    bars=features(rows); z=g.lifecycle(zone('R'),bars,None,t('2026-03-25 09:15'),b.Params())
    assert z.side=='R'
    assert z.state==b.ZoneState.ACTIVE_RESISTANCE
    assert g.FAILED_TAG in z.source


def test_true_strong_bull_acceptance_breaks_resistance():
    rows=[{'ts':'2026-03-25 09:05','open':100,'high':104,'low':99.5,'close':103.75,'bf':.9,'rr':1.5,'cl':.94,'atr':10}]
    bars=features(rows); z=g.lifecycle(zone('R'),bars,None,t('2026-03-25 09:10'),b.Params())
    assert z.state==b.ZoneState.BROKEN


def test_weak_breach_needs_later_15m_acceptance():
    rows=[{'ts':'2026-03-25 09:35','open':100,'high':102,'low':99.5,'close':101.75,'bf':.45,'rr':.8,'cl':.8,'atr':10}]
    bars=features(rows)
    hidx=[t('2026-03-25 09:30')]
    h15=pd.DataFrame({'open':[100],'high':[103],'low':[99],'close':[102]},index=hidx)
    before=g.lifecycle(zone('R'),bars,h15,t('2026-03-25 09:44'),b.Params())
    after=g.lifecycle(zone('R'),bars,h15,t('2026-03-25 09:46'),b.Params())
    assert before.state!=b.ZoneState.BROKEN
    assert after.state==b.ZoneState.BROKEN
