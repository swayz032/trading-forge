# v0.9 Trendline Family — TradingView Acceptance

Status: **PLATFORM PARITY / RESEARCH ONLY**. `LIVE_DECISION_SUPPORT_APPROVED=false` remains mandatory.

## Purpose

Validate the first Pine implementation of the frozen top-down trendline-family contract before any claim of platform parity.

## Operator workflow

1. Use NQ or MNQ and a 5-minute chart.
2. Add `slumdawg_platform_parity_v0_9_trendline_family.pine` unchanged.
3. TradingView prompts for **Build/freeze board at**. Click the current 5-minute bar.
4. Do not edit the research guard values during the geometry check.
5. Compare the generated GREEN/RED rays against the operator's approved pink-line examples.

## P0 acceptance cases

### A. Frozen geometry
- [ ] Every shown ray has two structural anchors.
- [ ] GREEN uses low-side structure; RED uses high-side structure.
- [ ] Once the board is frozen, incoming 5-minute candles do not move A, B, or slope.
- [ ] Pan/zoom/Reset Chart View does not change geometry.
- [ ] Reloading the chart reconstructs the same A/B geometry from the stored freeze timestamp.

### B. Top-down lineage
- [ ] Daily is the root family when a Daily line qualifies.
- [ ] Every accepted lower-timeframe child begins from the previous accepted parent's Point B.
- [ ] If an intermediate timeframe has no child, the next lower timeframe may inherit from the most recent accepted higher-timeframe parent.
- [ ] No isolated close-up 5M/15M ray appears without a higher-timeframe family.
- [ ] A same-path/redundant child is rejected rather than stacked on top of its parent.

### C. Clean chart controls
- [ ] All 10 Daily/4H/1H/15M/5M GREEN/RED visibility toggles exist and default ON.
- [ ] Turning a line OFF hides it only.
- [ ] Turning it back ON restores the exact same A/B ray.
- [ ] No timeframe/name label is printed on the trendline itself.
- [ ] Indicator status name remains `Slumdawg traders indicator` without input-value spam.

### D. Violation lifecycle
Research placeholder: one-tick penetration and two consecutive **source-timeframe confirmed closes** unless deliberately changed for a calibration test.

- [ ] A wick through a line alone does not mark VIOLATED.
- [ ] First adverse source-TF close enters breach count 1.
- [ ] A source-TF reclaim before the confirmation count resets the breach count.
- [ ] Required consecutive adverse closes latch VIOLATED.
- [ ] A violated line remains visible until a repair event; it is excluded from NEXT WALL while violated.

### E. Selective repair
- [ ] Configure one Repair time after a line is already VIOLATED.
- [ ] Every non-violated line is pixel/geometry identical before and after repair.
- [ ] Only violated slots are eligible for replacement.
- [ ] Replacement B must be later than the old B.
- [ ] Child replacements reconnect from the nearest accepted higher-timeframe parent's current Point B.
- [ ] If no qualified replacement exists, the old violated line remains and no forced line is drawn.
- [ ] Reload reconstructs the exact same repair result from the stored repair timestamp.

### F. Blue levels / scale regression
- [ ] PDH and PDL are always visible when valid and span the full chart.
- [ ] PWH/PWL appear only when the existing near-level display rule qualifies them; when visible they span the full chart.
- [ ] Hidden/unset geometry is `na`, never a transparent price-0 sentinel.
- [ ] Reset Chart View remains candle-readable.

## Evidence to capture

For each accepted case, retain:
- full TradingView screenshot including symbol/timeframe/coach;
- screenshot of relevant Inputs controls;
- freeze/repair timestamps;
- observed line A/B locations;
- compile result;
- reload/reset result;
- any mismatch against the operator's pink-line reference.

## Fail conditions

Stop platform promotion on any of the following:
- moving/chasing anchors;
- orphan close-up line;
- parent-child chain mismatch;
- valid line changing during repair;
- line recreated differently after reload;
- repair forcing a replacement with no qualified swing;
- Reset Chart View compression regression;
- trendline cross causing direction/GO/READY by itself;
- any source-contract or reference-engine test failure.
