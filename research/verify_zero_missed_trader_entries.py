"""Independent check of MISSED_TRADER_ENTRY = 0.

The regrade reports only the FIRST decision through window end. If the bot fired early and
that early entry is what got reported, a later candidate matching the trader could be
invisible — and "0 missed" would be an artifact of reporting, not a property of the kernel.

The X-ray sees every candidate, so it can answer directly: at the trader's own decision
clock, in the trader's own direction, did a surviving candidate exist?
"""
import io
import json
from datetime import date

import pandas as pd

from research import current_mnq_strategy_v2_2_engine_final as old
from research import current_mnq_strategy_v2_4_engine as v24
from research.current_mnq_strategy_v2_4_candidate_xray import xray_session

SC = 'research/current_mnq_strategy_v2_4_frozen_14_case_scorecard_2026_08_21.json'
DATA = 'research/_mnq_v24_replay_lab_v3/data'
LOCK = 'research/current_mnq_strategy_v2_2_data_lock.json'

sc = json.load(io.open(SC, encoding='utf-8'))
entries = [c for c in sc['cases'] if c['trader_state'].startswith('ENTER')]
print(f'trader-entry cases: {len(entries)}\n')

from pathlib import Path
observed = old.download_pinned(Path(DATA), include_tick=False)
old.verify_manifest(observed, json.loads(Path(LOCK).read_text()))
raw5 = old.load_csv(Path(DATA) / Path(old.DATA_FILES['5m']).name)
raw1 = old.load_csv(Path(DATA) / Path(old.DATA_FILES['1m']).name)
env = old.prepare(raw5, raw1)
p = v24.Params()

WANT = {'ENTER_LONG': 'L', 'ENTER_SHORT': 'S'}
rows = []
for c in sorted(entries, key=lambda x: x['session']):
    xr = xray_session(env, date.fromisoformat(c['session']), p)
    tclock = pd.Timestamp(c['trader_decision_clock'])
    want = WANT[c['trader_state']]
    surv = [r for r in xr['records'] if r['outcome'] == 'SURVIVED_TO_RANKING']
    same_dir = [r for r in surv if r['direction'] == want]
    # A survivor within +/- 10 minutes of the trader's own clock, same direction.
    near = [r for r in same_dir
            if abs((pd.Timestamp(r['clock']) - tclock).total_seconds()) <= 600]
    exact = [r for r in same_dir if pd.Timestamp(r['clock']) == tclock]
    rows.append({
        'session': c['session'],
        'trader': c['trader_state'],
        'mismatch': c['mismatch_class'],
        'survivors_total': len(surv),
        'survivors_same_direction': len(same_dir),
        'survivors_within_10min_of_trader': len(near),
        'survivors_at_exact_trader_clock': len(exact),
    })
    print(f"  {c['session']}  {c['trader_state']:12} {c['mismatch_class'][:34]:34} "
          f"surv={len(surv):3} sameDir={len(same_dir):3} "
          f"near={len(near):2} exact={len(exact)}")

print()
missed_really = [r for r in rows if r['survivors_within_10min_of_trader'] == 0]
print(f'trader entries with NO same-direction survivor within 10 min: {len(missed_really)}')
if missed_really:
    for r in missed_really:
        print(f"   {r['session']} {r['trader']} — the kernel had no comparable candidate")
print()
print('VERDICT ON MISSED_TRADER_ENTRY = 0:')
if not missed_really:
    print('  SUPPORTED — every trader entry has a same-direction surviving candidate near')
    print('  its clock, so zero-missed is a property of the kernel, not of first-decision')
    print('  reporting. The kernel finds them; it also finds ~20 others.')
else:
    print(f'  REFUTED — {len(missed_really)} trader entries have no comparable candidate.')
    print('  The reported zero would then be an artifact of first-decision reporting.')
io.open('C:/Users/tonio/AppData/Local/Temp/claude/C--Users-tonio-Projects-trading-forge/'
        '84d6e39c-3f7a-4c2d-bb4e-6f1a9d8811a2/scratchpad/missed_check.json',
        'w', encoding='utf-8').write(json.dumps(rows, indent=2))
