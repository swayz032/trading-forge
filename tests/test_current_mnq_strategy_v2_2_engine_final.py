import pandas as pd
from research import current_mnq_strategy_v2_2_engine as base
from research import current_mnq_strategy_v2_2_engine_runtime as rt
from research import current_mnq_strategy_v2_2_engine_final as final


def t(s): return pd.Timestamp(s,tz=base.TZ)


def test_final_engine_installs_one_gold_lifecycle_everywhere():
    assert base.zone_state_at is final.zone_state_at
    assert rt.zone_state_at is final.zone_state_at


def test_final_engine_preserves_failed_breakout_as_original_resistance():
    z=base.Zone('z','R',99,101,100,2,.6,.8,.8,.8,.8,.8,.85,
        t('2026-03-25 09:00'),t('2026-03-25 08:00'),state=base.ZoneState.ACTIVE_RESISTANCE)
    idx=[t('2026-03-25 09:05'),t('2026-03-25 09:10')]
    bars=pd.DataFrame({
      'open':[100,101.7],'high':[102,102],'low':[99.5,98.5],'close':[101.75,99.5],
      'bf':[.55,.75],'rr':[.9,1.3],'cl':[.9,.28],'be':[False,False],'se':[False,True],
      'atr':[10,10],'volume':[1,1]
    },index=idx)
    zz=final.zone_state_at(z,bars,t('2026-03-25 09:15'),base.Params())
    assert zz.side=='R'
    assert zz.state==base.ZoneState.ACTIVE_RESISTANCE
    assert 'FAILED_BREAKOUT_RECLAIM' in zz.source
