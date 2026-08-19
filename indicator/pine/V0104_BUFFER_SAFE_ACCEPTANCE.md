# v0.10.4 Buffer-Safe Canonical Board Acceptance

Status: platform-parity research only; not live-decision-support approved.

This build exists because the first v0.10.3 TradingView run failed inside `f_gate_pair_5m()` / `f_build_board()` while the recent canonical-5m audit was using runtime-sized historical offsets.

Acceptance:
- no historical-buffer runtime error from `f_recent_clean_one`, `f_gate_pair_5m`, or source geometry helpers;
- explicit `max_bars_back()` sizing is applied only to `time`, `time_close`, `high`, and `low`, the built-in series accessed with dynamic offsets;
- no global 5000-bar buffer workaround;
- canonical 5m board request remains the host-timeframe-invariance source;
- Monthly -> Weekly -> Daily -> 4H -> 1H -> 15M -> 5M family contract remains intact;
- fresh-line source and recent-5m no-intersection gates remain intact;
- restored completed Daily/Weekly level bridge remains intact;
- `SLUMDAWG` short title and coach hide/show remain intact;
- TradingView compile/runtime is the authoritative platform gate.
