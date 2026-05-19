#!/usr/bin/env python3
"""Track latest execution per workflow — used to verify Chrome-triggered runs."""
import json, urllib.request, sys, time

KEY = open('.env', encoding='utf-8', errors='replace').read().split('N8N_API_KEY=')[1].split()[0].strip('"')

def get(path):
    r = urllib.request.Request(f'http://localhost:5678/api/v1{path}',
                               headers={'X-N8N-API-KEY': KEY})
    return json.loads(urllib.request.urlopen(r, timeout=10).read())

def latest_exec(wid):
    d = get(f'/executions?workflowId={wid}&limit=1')
    items = d.get('data', [])
    return items[0] if items else None

# WORKFLOWS list (28 cron-only + SGL=already-tested)
WFS = [
    ('J0p8oYkONmN7pYn6', '3A-workflow-backup'),
    ('4qVyxZd29pQkGn9p', '5N-brave-video-discoverer'),
    ('26ruSYvIjqHGOhsd', '9A-nightly-self-critique'),
    ('7PgUY6Wa07aZbAPX', '5M-brave-news-watcher'),
    ('sAIrnCVB4iOsodsy', 'Weekly Strategy Hunt'),
    ('F6i4JoTdxgiyjHhM', '5L-quant-blog-harvester'),
    ('hPXhUaSC3ScznZE9', 'Strategy Tournament'),
    ('u0RcmfuClgRinXAX', 'Daily Portfolio Monitor'),
    ('lUenVARPUG1uz4OE', '5K-parallel-deep-research'),
    ('v4eSeAoaEErYp472', '0Z-openclaw-daily-report'),
    ('YuDGQkuej7qybPAB', 'Weekly Compliance Re-Parse'),
    ('Z4NcOCDbet8KzjDd', 'Nightly Strategy Research Loop'),
    ('gFwNlA3eCHbSb7en', 'Pre-Session Compliance Gate'),
    ('J8K0PfErL2v4W9Zw', '5O-supadata-transcript-pipeline'),
    ('X2IjKuYseGukxKDj', 'Macro Data Sync'),
    ('vlCaiWM7F0AH1RRY', '8A-idea-to-strategy'),
    ('66HEjQavpvirY6g5', '0A-health-monitor'),
    ('eaq72MwKwCjv7g7F', 'Pre-Session Skip Check'),
    ('RumAJUp4iS1TYlNm', '6D-compliance-gate'),
    ('m6aD7X4ioWfhWaS9', 'Monthly Robustness Check'),
    ('Ep2Zsu33tMOsaJbE', '5J-unified-search-router-scout'),
    ('LQtqeWAcNOlkqROH', '8B-source-quality-review'),
    ('WT9sVMzG83rg1L29', 'Daily Compliance Check'),
    ('PHcD2tFZpzr7kQGF', 'Anti-Setup Refresh'),
    ('eCr7cyb0aPArFCZc', 'Strategy Generation Loop'),
    ('MIIxmilbgZv3SUBh', '7A-auto-evolution'),
    ('pVT6svNTljjBoQbW', '11A-critic-optimization'),
    ('LayXj1mbHh4aGSM9', 'Post-Session Skip Review'),
    ('8HKXzNmo9KF59SBu', '10A-master-orchestration'),
]

mode = sys.argv[1] if len(sys.argv) > 1 else 'snapshot'

if mode == 'snapshot':
    # Print baseline: latest exec id per workflow (so we can detect new ones)
    out = {}
    for wid, name in WFS:
        e = latest_exec(wid)
        out[wid] = {'name': name, 'lastExecId': e['id'] if e else None,
                    'lastStatus': e.get('status') if e else None,
                    'lastStarted': e.get('startedAt') if e else None}
    with open('./tmp-n8n/baseline.json', 'w') as f:
        json.dump(out, f, indent=2)
    for wid, info in out.items():
        print(f"  {info['name'][:35]:<35} | last={info['lastExecId']} ({info['lastStatus']})")
elif mode == 'check':
    with open('./tmp-n8n/baseline.json') as f:
        baseline = json.load(f)
    new_runs = 0
    successes = 0
    fails = []
    for wid, name in WFS:
        e = latest_exec(wid)
        if not e:
            print(f"  [no exec] {name}")
            continue
        was = baseline.get(wid, {}).get('lastExecId')
        if str(e['id']) != str(was):
            new_runs += 1
            status = e.get('status', '?')
            mode_ = e.get('mode', '?')
            mark = 'OK' if status == 'success' else 'FAIL'
            print(f"  {mark:<4} | {name[:35]:<35} | new exec {e['id']} | {status} | mode={mode_}")
            if status != 'success':
                fails.append((name, wid, e['id'], status, mode_))
            else:
                successes += 1
        else:
            print(f"  -no-run- | {name[:35]:<35} | unchanged at {e['id']}")
    print()
    print(f"=== Summary: new_runs={new_runs}, successes={successes}, fails={len(fails)} ===")
    if fails:
        print("Failures:")
        for f in fails:
            print(f"  {f}")
