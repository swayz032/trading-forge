# Claude rung — Phase-A birth gate, DRAW-1 (2026-07-13)

Model: claude-opus-4-8[1m] (frozen). Instrument: strategy-enumerator.md (UNCHANGED, 3-rule standard). 6 fresh-context enumerators, blind to windows.

| Fixture | window | Claude draw-1 | verdict |
|---|:--:|:--:|---|
| WEhmadJArQo | 1-or-2 | 1 | IN — Rule-3 variants |
| R5L890juvRw | exactly 2 | 2 | IN — opposition split (continuation vs mean-reversion) |
| IyFioFkRgWo | exactly 1 | 1 | IN — breakdown=Rule-1 mention; captured 200-EMA variant |
| 4cT8WTyxhYY | exactly 1 | 1 | IN — filters grouped, mirror not split |
| E9MzEC_yNoM | 2-or-3 | 2 | IN — sweep-fade split from continuation |
| -igpOZs8LsM | exactly 1 | 1 | IN — other SMC models = deferred mentions |

**DRAW-1: 6/6 in-window, all clean canonical reasoning.** Both opposition cases (R5L890, E9MzEC) split correctly; both Rule-1 mention cases (IyF, -igp) held; config variants grouped (WEh, 4cT8). Notably Claude CAPTURED the 200-EMA variant that gpt-5.4 silenced — which frontier-v3's coverage contract makes binding on Phase-B. (gpt-5.4 draw-1 was 4/6 noisy; Claude 6/6 clean.)

## Remaining for the FORMAL birth gate (per k=5 pin)
4 more draws per fixture (24 dispatches) → k=5 modal consensus, mode-in-window + >=4/5 stability + content survival. Then design-pool 16 on frontier-v3 (joint bar). Draw-1 = 6/6 is a strong leading indicator of Claude's Phase-A stability.
