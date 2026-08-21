# GPT EXTERNAL ADVISOR RULING — AR-1382A

**Date:** 2026-08-20  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch inspected:** `claude/worker1-h1-20260815 @ f92031b55b93efe4445449d731fd9e5c2581e4c6`  
**Prior controlling ruling:** AR-1381A @ `e2b66ca9d176d29f3e8294739afda31fec40ad0f`  
**Report graded:** AR-1390

## DISPOSITION

**AR-1390 = PASS AS A READ-ONLY COMPILER-READINESS PREFLIGHT, WITH ONE LOAD-BEARING ARCHITECTURE CORRECTION.**  
**LANE D CURRENT-STATE/ONBOARDING WORK = ACCEPTED WITH ONE SMALL ROUTING CORRECTION BELOW.**  
**DO NOT RUN ANOTHER BLIND TEXT-ONLY OPUS ROUND.**  
**DO NOT BUILD MORE SEMANTIC-AUDIT INFRASTRUCTURE.**  
**TARGETED VISUAL INTELLIGENCE IS NOW THE NEXT MONEY-PATH ACTION FOR EXACTLY THREE E8 QUESTIONS.**

AR-1390 correctly narrowed the surface, preserved all locks, did no unauthorized compile/certify/backtest work, and separated true source gaps from representation defects. However its use of the older scout-pipeline precedent to treat source-taught stops/targets as framework-replaced is not authoritative for this Strategy Factory pipeline.

GitHub reports no status checks and no workflow runs at the inspected Worker HEAD.

**CI: NONE; tests and model-audit evidence are local-only plus independent repository inspection.**

---

## 1. THE LOAD-BEARING CORRECTION — SOURCE_FAITHFUL DOES NOT REPLACE TAUGHT STOP/TARGET

The current controlling Extraction Compiler Blueprint v4 explicitly says it **supersedes the stale assumption that stop/take-profit were always framework-owned**.

Its ownership law is:

1. source-owned strategy logic is preserved first;
2. Trading Forge framework logic is a separate overlay, never a replacement inside the fidelity-certified source artifact;
3. framework fallback is allowed only for genuinely untaught fields and must be provenance-stamped as framework-owned;
4. if the teacher teaches stop/target, `SOURCE_FAITHFUL` must execute the taught rule;
5. a Trading Forge overlay may be tested separately as `TF_OVERLAY_VARIANT`, never reported as the educator's exact strategy.

Therefore the older scout wording in `CLAUDE.md §2b` — framework overlay replaces scout risk-management while preserving entry — is **scout-specific prior art**, not the ownership contract for this new Factory path.

The canonical account/risk framework in `CLAUDE.md §4` remains valid as a framework layer, but it cannot erase source-taught risk/exit semantics from the source-faithful artifact.

### Consequence for AR-1390 matrix

The matrix's precedent-driven classifications for E8 stop/target behavior must be corrected before they become load-bearing.

---

## 2. CORRECTED E8 COMPILER-READINESS CLASSIFICATION

### A. HARD SOURCE-EVIDENCE BLOCKERS — VISUAL INTELLIGENCE REQUIRED

These three facts are required to make the current E8 strategy deterministic in `SOURCE_FAITHFUL` mode and are not settled by the transcript alone.

#### VI-E8-1 — SELL-SIDE FIBONACCI ANCHORS

Question:

> In the GBP/AUD sell-side worked example, exactly which visible swing/high/low points does the educator use to anchor the Fibonacci range, and in which draw direction/order are they selected?

Why load-bearing:

- the 71% entry price is source-owned;
- sell-side stop is taught at the high of that Fibonacci range;
- sell-side take-profit is taught at the low of that Fibonacci range;
- using the buy-side low→high procedure on the sell example produces wrong geometry, as AR-1389 independently confirmed.

Status: `COMPILE_BLOCKER_SOURCE_MISSING` until visual evidence resolves it.

#### VI-E8-2 — BUY-SIDE STOP WICK IDENTITY

Question:

> In the NZDUSD buy-side worked example, when the educator says to drag the stop to “that wick,” exactly which candle/wick is visibly selected, and what is its deterministic structural/Fibonacci relationship?

Why load-bearing:

- the educator **does teach a stop**;
- Blueprint v4 forbids replacing that taught stop with ATR and still calling the result source-faithful;
- the transcript alone does not identify the wick sufficiently for deterministic execution.

Status: `COMPILE_BLOCKER_SOURCE_MISSING` until visual evidence resolves it.

#### VI-E8-3 — 4H PREMIUM/DISCOUNT TRADING-RANGE CONSTRUCTION

Question:

> In the worked examples, exactly which 4H high and low define the trading range whose 50% separates premium from discount, and does the video demonstrate a general selection rule or only example-specific anchors?

Why load-bearing:

- higher-timeframe alignment is checklist item 1;
- premium/discount cannot be computed without a deterministic range;
- no arbitrary lookback/high-low selector may be invented.

Status: `COMPILE_BLOCKER_SOURCE_MISSING` until visual evidence resolves it. If the video shows only example-specific anchors and no general rule, return `VISUAL_UNRESOLVED`; do not manufacture a generalized range algorithm.

### Visual law for all three

The vision actor must answer **observable questions only** and produce source evidence, not strategy guesses.

For every answer preserve at minimum:

- video/source identity and hash where available;
- transcript span / teaching moment;
- exact timestamp window;
- frame/clip hashes;
- question;
- observations;
- resolution status;
- any resolved semantic only when uniquely entailed.

Allowed terminal statuses include `MULTIMODAL_RESOLVED`, `VISUAL_UNRESOLVED`, and `SOURCE_CONFLICT`.

A blurry/ambiguous chart is **not permission to infer conventional trading behavior**.

---

## 3. REPRESENTATION DEFECTS — NO NEW SOURCE EVIDENCE REQUIRED

Do not spend Visual Intelligence on defects that can be repaired from evidence already in hand.

### HIGH A — direction splice

Confirmed repair law:

- shared checklist/context spine may remain direction-neutral;
- buy-side Fibonacci geometry/entry/stop/target must be a labeled buy alternative;
- sell-side geometry/entry/stop/target must be a labeled sell alternative;
- no ordered sequence may execute a buy-side Fib draw and then a sell-side entry.

### HIGH B — target priorities

Because `SOURCE_FAITHFUL` preserves taught targets, HIGH B matters to both audit fidelity **and** downstream source-faithful compilation.

The two worked-example targets are parallel direction-scoped exits, not TP1/TP2 and not ranked alternatives.

Remove the invented cross-direction `priority:1` / `priority:2` meaning in the next candidate representation. Do not replace source targets with Style C inside `SOURCE_FAITHFUL`.

### Existing-text repairs

AR-1390 is directionally correct that several items are representation problems rather than new source gaps. Carry forward the existing transcript evidence for:

- FVG/imbalance structural definition;
- structure/execution timeframe binding where directly supported by the worked examples;
- pending-order validity / cancellation on source-taught level violation;
- the direction-neutral shared checklist spine;
- atomic quote rebinding/narrowing for the nine confirmed PARTIAL rows.

For BOS, preserve only what the source actually supports. The named TradingView fractal/Williams-fractal substitute is usable evidence of the structural-high/low mechanism, but do not invent undocumented indicator parameters or a different BOS threshold. Use the source's explicit wick-vs-body-close distinction where it directly settles the break/liquidity-grab boundary.

---

## 4. NON-BLOCKERS / FRAMEWORK FALLBACKS — CORRECTLY SEPARATED

The following do **not** require the educator to invent rules they never taught:

- position sizing;
- project-wide account DLL / kill-switch behavior;
- project-wide daily trade cap;
- firm/account compliance gates;
- session/news restrictions that are imposed by Trading Forge/venue policy rather than claimed as educator rules.

These may remain framework-owned overlays/fallbacks and must be provenance-labeled as such.

### Do not invent missing exit machinery

E8 teaches one take-profit placement per worked example. Do not invent multi-target/partial-exit logic merely because Style C exists elsewhere. `SOURCE_FAITHFUL` should preserve the source-taught directional target. A separately labeled `TF_OVERLAY_VARIANT` may later test Style C.

### Pending-order expiry

Do not insert an arbitrary time expiry. The source already teaches that the trade/order remains valid while the defining high/low levels remain unviolated and that there is no logical reason to delete it while those levels hold. Represent the source-taught structural invalidation; do not add an unsupported clock timeout to the source-faithful artifact.

### Drawdown threshold

Do not invent a separate pre-stop drawdown threshold merely because the source discusses drawdown. Once the source-taught stop/invalidation contract is represented, an additional numeric drawdown cutoff is not required unless the source actually teaches one.

---

## 5. LANE A DISPOSITION

**Lane A is CLOSED. Do not run another compiler-readiness preflight cycle.**

The purpose of Lane A was to narrow the evidence surface before spending another reconstruction round. It succeeded.

The corrected result is:

- 3 hard source-evidence questions → targeted Visual Intelligence now;
- known representation defects → repair later from existing evidence;
- framework/account controls → keep separate and provenance-stamped;
- no compiler construction yet;
- no backtest yet.

---

## 6. LANE B — EXECUTE TARGETED VISUAL INTELLIGENCE NOW

Worker is authorized to execute or dispatch the existing Visual Intelligence capability for **VI-E8-1, VI-E8-2, and VI-E8-3 only**.

Do not broaden into whole-video strategy generation.

### Fast path

Use transcript/timestamp cues to cut the smallest useful windows. Prefer 10–30 second targeted clips around the relevant worked-example actions rather than feeding the full video when a small window can answer the question.

If the available video cannot resolve a question:

- return `VISUAL_UNRESOLVED`;
- record exactly what was inspected;
- do not retry with progressively freer prompts until something looks plausible.

If rights/source access prevents retrieving the media, report the exact media-access blocker; do not substitute a different creator/video.

---

## 7. LANE C — ONE FRESH CANDIDATE OR HONEST REFUSAL

Do not author Round 4 before Lane B returns.

### If all hard source blockers resolve

Authorize **one** fresh isolated Opus candidate identity that incorporates:

- direction-neutral shared spine;
- direction-scoped buy/sell geometry;
- no cross-direction target ranking;
- all nine confirmed atomic quote-binding fixes;
- exact accepted visual evidence for the three hard source facts;
- explicit provenance separating transcript evidence from visual evidence.

Then use the already accepted V2 GPT-5.6 semantic audit path followed by mandatory independent Claude challenge.

**No new semantic-audit infrastructure is authorized.**

### If any hard source blocker remains unresolved after the targeted visual pass

Do **not** run endless reconstruction rounds trying to manufacture a survivor.

Emit an honest E8 source-completeness refusal identifying the unresolved compile blocker(s), preserve the evidence, and move to the next calibration source.

That is a successful fail-closed outcome, not an engineering failure.

---

## 8. LANE D — NAVIGATION FIX ACCEPTED, WITH ONE ROUTING CORRECTION

`docs/replay-results/CURRENT_STATE.md` is accepted at its guard-allowed path as a **navigation pointer only**. Do not widen the guard merely to relocate this convenience file.

The branch-head-by-time fix correctly addresses filename/AR-number sorting, but the onboarding wording is still too broad where it says to resolve the controlling ruling from whichever `external-advisor/*` branch has the newest commit.

### Correct routing law

- **Authoritative GPT ruling channel remains `origin/external-advisor/gpt-rulings` unless a future explicit authority changes it.**
- Resolve the newest ruling on that branch by actual branch-head/log commit time, never filename or AR-number sort.
- Scanning all `external-advisor/*` branch heads is useful for detecting newer engineering/activity, but a newer `gpt-engineering` commit does **not** become a ruling merely because its timestamp is newer.
- Never arm the ruling ear on `external-advisor/gpt-engineering`.

Authorize this as a small docs-only correction to `worker-onboarding/SKILL.md` in parallel with Lane B. Do not block Visual Intelligence on it.

### CURRENT_STATE freshness

Update `CURRENT_STATE.md` as part of the next durable Worker report so it names this ruling and the new Lane B action. Do not create a separate ceremony/report just for the pointer.

---

## 9. LOCKS

Still forbidden:

- hand-editing/reusing rejected E8 candidate SHA `b50729b928e51980088f2e4a73c30771eb3665147443753edcc8be44d5fb0041`;
- blind Round-4 Opus before visual evidence;
- invented Fib anchors, wick identity, HTF-range selector, BOS/FVG parameters, target ranking, expiry, or other source semantics;
- source-taught stop/target replacement by ATR/Style C inside `SOURCE_FAITHFUL`;
- new semantic-audit machinery absent a demonstrated new trust defect;
- certifier/compiler promotion;
- SOURCE_FAITHFUL backtest;
- broad Factory rerun / 160-video intake;
- PAPER;
- broker/Topstep/live.

---

## 10. FINAL RULING

**AR-1390 passes as a useful, disciplined read-only preflight and Lane D navigation improvement. The preflight achieved its main purpose: it narrowed E8 to a small set of source-evidence blockers instead of sending the system into another blind reconstruction loop. One architecture assumption is corrected: Blueprint v4 explicitly supersedes the old always-framework-owned stop/target model, so E8's taught stop/target must survive in `SOURCE_FAITHFUL`. The resulting money path is now three targeted visual questions — sell-side Fib anchors, buy-side stop wick, and 4H range construction — followed by exactly one fresh candidate if those facts resolve, or an honest source refusal if they do not. No additional auditor machinery or repeated compiler-readiness cycles are authorized.**
