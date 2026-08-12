# SOURCE TRANSCRIPTS — the production strategy library, published for GPT

GPT's AR-1041 ruling §2 listed the transcript store, the 40/40 availability and the
exact span slices as **worker-local evidence not independently queryable**, accepted
only provisionally. **This directory removes that gap** — every claim in AR-1041,
AR-1042, AR-1043, AR-1044 and AR-1045 about what a teacher said can now be checked
here directly.

## Provenance

- Source: `public.youtube_evidence_archive` on the live production DB
  (`sakura.proxy.rlwy.net:34357`), read-only, 2026-08-12.
- `raw/<video_id>.txt` is **byte-exact** `transcript_text`, UTF-8, no normalisation.
  `sha256sum raw/<video_id>.txt` reproduces the `transcript_sha256` column.
- **MEASURED: all 40 stored hashes match the text (40 match / 0 mismatch / 0 null).**
- All 40 rows: `transcript_status='available'`, `source_provider='historical_extraction_cache'`.

## How to read a teacher's rule (AR-1041 §1a, AR-1042 §1)

`span{start,end}` in `strategies.config.compiled_spec.spec.*[]` are **character offsets**
into `transcript_text`. `text[start:end]` is the teacher's exact words.

🛑 **Do NOT read the `evidence` field to get the teaching.** Of 2150 `entry_conditions`
values: 1239 are `T-<vid4>-C<n>` references, **609 are the literal JSON fragments `},{`
or `{}`**, and ≤302 are real inline prose. `object` is a 2–5 word label, never the source.

`resolved/<video_id>.md` applies this to the 12 ORB-family sources: every spec item
against the teacher's actual words, in source order, with the bound entry trigger marked.

⚠️ `VTEQ2fhGLqE` is **Arabic** and `jlShztsY3oA` is **Afrikaans** (AR-1042 §3).
⚠️ `7ieYBa7Z-Hg` is a **two-speaker interview** and the schema records no speaker (AR-1044 §2).

## Index

| video_id | strategy name | chars | bytes | sha256 verified | ORB family |
|---|---|---|---|---|---|
| `1HFoStW_wsc` | mean_reversion_mcl_5m | 15596 | 15596 | ✅ |  |
| `75DJN5UVQnw` | 5m_minute_support_level_mcl_5m | 7383 | 7383 | ✅ |  |
| `7ieYBa7Z-Hg` | manipulation_trade_mcl_1m | 62947 | 62947 | ✅ | yes |
| `aHLIE_TXjpo` | entry_chart_timeframe_mcl_5m | 17603 | 17603 | ✅ |  |
| `bQp37aD1JLE` | overall_trend_mcl_5m | 13625 | 13625 | ✅ |  |
| `c8VLqF0XDR4` | long_entry_or_short_entry_mcl_15m | 10187 | 10187 | ✅ | yes |
| `dE4lPhAWke8` | short_entry_mcl_5m | 23220 | 23220 | ✅ | yes |
| `deymRD3kSD0` | look_i_use_range_breakouts_confirmation_trend_direction_mcl_5m | 12109 | 12109 | ✅ | yes |
| `dHmOosYof48` | jump_in_downtrend_mcl_1h | 33396 | 33396 | ✅ |  |
| `e5HQXYBUW-Q` | short_entry_mcl_5m | 11193 | 11193 | ✅ | yes |
| `E8Wg6tFPYjo` | bos_and_fvg_or_fvg_mcl_15m | 22830 | 22830 | ✅ |  |
| `FAKWJ-1NlLE` | expansion_higher_mcl_5m | 22190 | 22190 | ✅ |  |
| `FqxEKDxemtI` | ballinger_bands_mcl_5m | 14000 | 14000 | ✅ |  |
| `gddYspvW0_w` | retracement_opportunity_mcl_5m | 24720 | 24720 | ✅ |  |
| `h6TnE7QClJg` | momentum_build_in_real_time_mcl_5m | 11899 | 11900 | ✅ |  |
| `HfZTCZTDfWk` | long_opportunities_mcl_4h | 11260 | 11260 | ✅ |  |
| `iU8ww5MC2FQ` | trade_era_scale_in_mcl_4h | 37583 | 37583 | ✅ |  |
| `jlShztsY3oA` | price_break_above_below_high_low_mcl_5m | 4672 | 4677 | ✅ |  |
| `ktkqq7QsN9Q` | vwap_cross_mcl_15m | 24704 | 24704 | ✅ |  |
| `KXWRtV2LOVc` | order_block_entry_trigger_mcl_5m | 16616 | 16616 | ✅ | yes |
| `l-2iKbcm5UI` | short_position_mcl_5m | 9836 | 9836 | ✅ |  |
| `LOcaRWcc1xI` | bullish_candle_formation_mcl_1m | 11673 | 11673 | ✅ |  |
| `lRMFcsqhYBU` | buy_trades_in_counter_trend_trading_environment_mcl_4h | 31691 | 31691 | ✅ |  |
| `m-G1ag77aVc` | discount_price_to_buy_from_mcl_30m | 17544 | 17544 | ✅ |  |
| `mNcoaNdAyIE` | buy_bias_mcl_5m | 22619 | 22619 | ✅ |  |
| `N7SM8a7Dc9s` | trading_session_time_mcl_5m | 30290 | 30290 | ✅ |  |
| `N7uP9V0Iktc` | ema_period_mcl_5m | 11515 | 11515 | ✅ |  |
| `NMUd0oX_7Pg` | hammer_candle_long_side_mcl_5m | 15246 | 15246 | ✅ | yes |
| `nV9gknhy2Ew` | downside_delivery_mcl_5m | 17694 | 17695 | ✅ |  |
| `oDLt9zh33LE` | opening_range_breakout_orb_mcl_5m | 18004 | 18004 | ✅ | yes |
| `qLtq73bTPBA` | price_break_mcl_5m | 58578 | 58578 | ✅ |  |
| `Qxlu8v_6G3Y` | put_limit_order_right_fvg_mcl_5m | 15767 | 15767 | ✅ | yes |
| `snNkQSyWX4k` | crossover_mcl_5m | 9189 | 9189 | ✅ |  |
| `sVkmZklJDHI` | avoiding_two_mistakes_mcl_1m | 25071 | 25071 | ✅ | yes |
| `UBvfsImdI2U` | entry_condition_mcl_1h | 20804 | 20804 | ✅ |  |
| `VTEQ2fhGLqE` | breakout_capture_mcl_5m | 61176 | 109207 | ✅ |  |
| `WV1fyudd7fw` | long_entry_mcl_15m | 25115 | 25115 | ✅ | yes |
| `x1ydP8bC7OE` | buying_opportunity_mcl_15m | 21064 | 21064 | ✅ |  |
| `xTTDH5iRhJc` | entry_at_key_levels_mcl_5m | 16046 | 16046 | ✅ | yes |
| `z3Qn3fBoe2I` | new_high_acceptance_mcl_5m | 28975 | 28975 | ✅ |  |

**40 videos, 913,668 bytes total.**
