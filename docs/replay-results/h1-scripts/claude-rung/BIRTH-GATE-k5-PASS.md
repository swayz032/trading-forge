# Claude rung — Phase-A birth gate k=5: PASS (2026-07-13)

Model claude-opus-4-8[1m]. Instrument strategy-enumerator.md (unchanged). 5 fresh-context draws per fixture, blind.

| Fixture | draws | mode(n/5) | window | verdict |
|---|---|:--:|:--:|---|
| WEhmadJArQo | [1,1,1,1,1] | 1(5) | 1-or-2 | PASS |
| R5L890juvRw | [2,2,2,2,2] | 2(5) | exactly 2 | PASS (opposition split every draw) |
| 4cT8WTyxhYY | [1,1,1,1,1] | 1(5) | exactly 1 | PASS |
| -igpOZs8LsM | [1,1,1,1,1] | 1(5) | exactly 1 | PASS |
| IyFioFkRgWo | [1,1,1,1,(1)] | 1(>=4) | exactly 1 | PASS (200-EMA variant captured every draw) |
| E9MzEC_yNoM | [2,2,2,(2),(2)] | 2(>=3 unanimous) | 2-or-3 | PASS (sweep-fade split every draw) |

**6/6 count-in-window, PERFECT stability** — every draw unanimous, zero wobble (contrast: gpt-5.4-mini 4/6 noisy, gpt-5.4 needed k=5 to stabilize). Content survives at enumeration level: both opposition setups (R5L890, E9MzEC), the 200-EMA variant (IyF — the exact content gpt-5.4 silenced), Rule-1 mentions held. 3 trailing draws (IyF-4, E9M-4/5) confirm, don't change, the modes.

## → DESIGN POOL 16 on frontier-v3 (next phase)
Claude Phase-A (k=5) + Phase-B (coverage contract) over the 16 → JOINT bar (grounding <=8% AND content-preservation clean, gpt-5.4 on the content panel + coverage lint). STOP at the joint-bar verdict (operator/Tonio per outcome). Subscription-paced, $0.
