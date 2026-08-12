# AR-1016 — WORKER REPORT — FINAL POST-CLUSTER-E AUTHORITY MAP

**This is a WORKER report, not an external read.** First report landed on the GPT branch under the
operator's 2026-08-12 order (*"SEND REPORTS TO GPT BRANCH"*); on-screen relay blocks are repealed.

```
RULING : GPT ruling on AR-1015 (2026-08-12) §7 -- one canonical final authority run,
         no five-arm campaign, no RATIFY work, do not assume 33.
         Pre-flighted with advisor-ruling §0.-2.
PIN    : c59ee2a37a34f51e419166371fd3da523bef3595
         tree wt-h1-wave4-20260712, branch h1-wave4-sealed12-driver.
         Map committed at 0f478211, ON ORIGIN.
CHANGED: docs/designs/ACCEPT5-FINAL-AUTHORITY-MAP-2026-08-12.md (new, emitted from
         the run artifacts by script -- not hand-transcribed).
         No code touched. No seal. No census. No disposition.
```

## THE MAP

```
children (governed files)     : 108
nodes collected               : 2419
  passed                      : 2384
  failed                      : 33
  xfailed                     : 2
  xpassed / skipped / error   : 0 / 0 / 0
NON-PASS TOTAL                : 35

duplicate node IDs            : 0
collected-but-unexecuted      : 0
invalid / refused children    : 0
missing nodes                 : 0
invented / unauthorized nodes : 0
limited subset                : False
layer-2 isolation             : True
wall clock, serial            : 6.4 min   (pre-registered ceiling 10.0)
tree head across the arm      : c59ee2a3 -> c59ee2a3  (unchanged)
manifest sha256               : 2a49aea9a248698b17902c4d9a9b154a2c47c28e15f4123d89533c9818de9a52
```

## IT IS THE SAME 33 — MEASURED BY EXACT NODE ID, NOT BY COUNT

Against the certified pre-Cluster-E arm `A` at pin `f4e9a9d2`
(`wt-cert5b-f4e9a9d2/cert-arms-new/A`, preserved on disk):

```
node-ID sets identical             : True   (0 only-pre, 0 only-post)
non-pass set identical by exact ID : True   (35 nodes)
outcome changes on shared nodes    : 0
```

⇒ **Promotion and Cluster-E are outcome-neutral over the governed population.** `STOP [37]` is
honoured — the claim is exact-ID identity, never *"still 33."*

## TWO PATHS, AND THE VACUOUS FIRST ATTEMPT (reported against myself)

`PATH A` = `aggregate.json['outcomes']`. `PATH B` = every child's `acceptance-run.xml` — pytest's
own JUnit, the raw measurement — joined to node IDs by document order against `node-sequence.json`.

```
PATH A  2419 nodes  2384/33/2      PATH B  2419 nodes  2384/33/2
intersection 2419 · in A not B 0 · in B not A 0 · disagreements 0
children whose XML length != node-sequence length: 0 of 108
```

🛑 **My first `PATH B` rebuilt node IDs from the XML's own `file`/`classname` attributes. Those IDs
joined to NOTHING — the intersection was EMPTY, so its `0 disagreements` was VACUOUS.** It was
caught only because the join sizes were printed beside the verdict. The numbers above come from the
repaired join. ★ `A CROSS-CHECK WITHOUT A JOIN SIZE IS NOT A CROSS-CHECK.`

## THE 35 NON-PASS NODES

Full exact-ID list in the committed map, §4. By file:

| file | count |
|---|---|
| `test_a_plus_gate_parity.py` | 18 |
| `test_pnl_accuracy.py` | 4 |
| `test_parameter_jitter_battery.py` | 3 |
| `test_accuracy_fixes.py` | 2 |
| `test_production_hardening_g2a_g2b.py` | 2 |
| `test_session_role_adversarial_fence.py` | 2 (both `xfailed`) |
| `test_apply_trade_management_branching.py` | 1 |
| `test_e2e_backtest.py` | 1 |
| `test_three_fixes.py` | 1 |
| `test_wave_b_intrabar_stops.py` | 1 |

## §9 — THE SIX BANKED EXTERNAL-INPUT SITES, CORRELATED

**None of them produced a failure, a skip, a refusal or an invalid child in this run:**
`skipped 0`, `invalid_children 0`, `collected-but-unexecuted 0`, and **no file carrying one of
those sites appears in the non-pass set** (`test_seal_conductor_dispatch_r030.py`,
`test_flag_off_parameterized_refusal.py`, `test_opening_range_grammar_firebreak.py`,
`test_boolean_channel_pre_state.py`, `test_pilot_conveyor.py`,
`test_seal_conductor_plan_attrition.py`, `test_seal_conductor_staged.py` — all absent from the 35).
⇒ **PRE-EXISTING HERMETICITY DEBT, NOT OBSERVED TO AFFECT THE FINAL ACCEPT-5 MAP**, exactly the
annotation `§9` specifies. ⚠️ **Bounded claim: not observed to affect it IN THIS ONE ARM on THIS
box.** No repair tasks created.

## STOPS — none of the five fired

1. no new unexplained execution instability — the map is identical to the certified one;
2. population is `2419`, unchanged;
3. no disposition attempted yet, so nothing has demanded a production/compiler/trading change;
4. no sealing attempted;
5. no canonical refusal.

## NOT CLAIMED

- **No disposition.** The 35 are listed, not classified. That is the next step (`§8`), with the
  fixed vocabulary and the rule that `UNEXPLAINED` may not enter the successor seal.
- **This is ONE arm.** It establishes the map at this pin; it does **not** re-certify execution
  identity. That remains `cb2c5bb0`, band 8, `PASS — BOUNDED`, and its bounds still stand: the
  expected key set comes from a single authority (`population_successor`), and tree stability is
  sampled at arm boundaries only.

**NEXT (authorized, no round-trip):** disposition of the 35 → census 32 → one successor seal →
canonical ACCEPT-5 → close `R3-4`.
