# GPT EXTERNAL ADVISOR RULING — AR-1375A

**Date:** 2026-08-20  
**Repository:** `swayz032/trading-forge`  
**Architecture stage:** 3 — Strategy Factory  
**Worker branch inspected:** `claude/worker1-h1-20260815 @ b120fa37dbb801cdf27b1369a1c69acd1641aa0f`  
**Prior controlling ruling:** AR-1374A @ `fdf9b1bff88def8f2fb69ccf62303aae56312459`  
**Report graded:** AR-1381  

## DISPOSITION

**AR-1381 = PASS AS A GENUINE BLOCKER / DISCLOSURE REPORT.**  
**THE THREE SELF-AUTHORED ROUND-2 CANDIDATES ARE NOT FACTORY AUTHORITY AND MUST NOT ENTER GPT-5.6 SEMANTIC AUDIT.**  
**THEY MAY REMAIN IN REPO AS QUARANTINED DIAGNOSTIC ARTIFACTS ONLY.**  
**A FRESH OPUS RETRY IS REQUIRED NOW, USING FILE-FIRST OUTPUT TRANSPORT INSTEAD OF TEAMMATE-MESSAGE DELIVERY.**  
**DO NOT BACKTEST. DO NOT EMIT GPT-5.6 TASKS FROM THE SELF-AUTHORED CANDIDATES.**

Worker 1 handled the transport failure correctly: it did not fabricate an Opus invocation receipt, did not claim fresh-reader isolation, explicitly stamped `fresh_reader:false`, `invocation_declared:false`, `factory_authority:false`, and stopped before semantic-task emission. That is the correct fail-closed behavior.

The fallback content may be useful as engineering diagnostics, but it cannot satisfy the permanent intake authority chain because the authoring seat was the same Worker/Sonnet session that already knew the exact prior semantic critiques. The required first semantic reader remains a fresh Opus lead reader.

GitHub reports no status checks and no workflow runs at current Worker HEAD.

**CI: NONE; tests/evidence are local-only plus repository inspection.**

---

## 1. WHY THE SELF-AUTHORED CANDIDATES ARE INADMISSIBLE

The permanent intake chain is:

`original transcript -> fresh Opus lead reader -> literal verification -> GPT-5.6 Sol semantic audit -> independent Claude attack -> deterministic certifier -> deterministic compiler`

AR-1381's fallback breaks the first independence boundary. Worker 1 had already read and authored the prior critiques in detail, then reconstructed the candidates itself. Literal cleanliness does not repair that provenance defect.

The Worker correctly recorded that defect in all receipts. Therefore:

- `E8Wg6tFPYjo @ b15bccd0...` — diagnostic-only, no Factory authority;
- `7ieYBa7Z-Hg @ 7b6c4ceb...` — diagnostic-only, no Factory authority;
- `1HFoStW_wsc @ 7eb0e9db...` — diagnostic-only, no Factory authority.

Do not delete or rewrite them. Preserve them as historical evidence of the disclosed fallback. Do not expose them to the fresh Opus readers.

---

## 2. TRANSPORT FIX — STOP USING TEAMMATE MESSAGES AS THE LOAD-BEARING RETURN PATH

The semantic-reader problem is not Opus reasoning; it is result transport. Two rounds have shown teammate-message delivery can be delayed or absent for transcript-scale work.

The next retry must make the result durable **before** the parent Worker depends on any chat/message return.

### Required file-first pattern

For each of the three videos, create a fresh reader task file that contains:

1. the same transcript-first authority law;
2. the AR-1374A atomic quote-binding law and case-specific rejection hazards;
3. the exact original transcript;
4. the strict candidate JSON output schema;
5. a unique designated output artifact path for that video;
6. an instruction that the fresh Opus reader's completion condition is to persist the exact JSON candidate to that path (or, if the agent runs in an isolated worktree, to commit that one output artifact and return its commit/blob identity through the runtime-supported durable mechanism).

Then dispatch **one fresh isolated Opus reader per video**, each given only its own task file.

### Transport hierarchy

Use the first mechanism actually supported by the Claude Code runtime:

1. **Preferred:** Opus writes the candidate JSON directly to the designated unique repo/worktree file; parent Worker reads the bytes from disk.
2. **If the agent has an isolated worktree:** Opus commits only its designated output artifact; parent imports/reads the exact committed blob by SHA.
3. **Only if neither durable-file route is supported:** stop and report the exact runtime/tool barrier. Do not substitute parent-authored reconstruction and do not treat teammate-message prose as the sole evidence channel.

The message channel may still be used for convenience/status, but it is no longer the load-bearing source of the candidate bytes.

---

## 3. FRESHNESS / ISOLATION LAW FOR THE RETRY

Each new Opus reader must satisfy all of the following:

- model override = Opus;
- fresh isolated reader context;
- receives only its task file;
- no legacy/Gemma semantics;
- no prior failed candidate JSON;
- no AR-1379/1380/1381 report prose beyond the bounded rejection hazards already encoded by AR-1374A;
- no self-authored fallback candidate visible;
- candidate bytes originate from the fresh Opus reader's durable output artifact;
- invocation/provenance receipt must truthfully attest the actual mechanism used.

Do not claim `fresh_reader:true` unless the output bytes can be tied to that actual fresh Opus invocation.

---

## 4. CASE-SPECIFIC AUTHORING CONSTRAINTS REMAIN UNCHANGED

### `E8Wg6tFPYjo`

- one top-level strategy unless source newly proves otherwise;
- correct quote-to-claim binding;
- one atomic proposition per quote-bearing object where practical;
- visualization/platform/practice material stays outside executable variants/management;
- preserve the taught 4H premium/discount -> sweep -> BOS+FVG -> 71% pending-limit logic.

### `7ieYBa7Z-Hg`

- one top-level setup unless source proves otherwise;
- preserve the explicit **50%-entry / stop-behind-70%** versus **candlestick-structure entry / candle stop** fork as co-equal source alternatives;
- do not rank either branch as primary/preferred without source authority;
- `30/50/70` remains descriptive retracement-depth evidence unless the transcript explicitly upgrades it into separate executable bots;
- no invented global target priority order;
- preserve conditional target rules where the source actually supplies conditions;
- unresolved arbitration stays unresolved.

### `1HFoStW_wsc`

- re-derive strategy count from transcript under the independence test;
- do not hard-code one strategy merely because the self-authored fallback landed on one;
- umbrella regime-routing evidence cannot independently create top-level strategy identities;
- event-anchor construction and higher-timeframe VWAP material remain context/filter unless complete independent trigger/stop/target identity is actually taught.

---

## 5. SAME-ROUND EXECUTION AFTER REAL OPUS OUTPUT ARRIVES

Do not stop after the three fresh Opus files land.

For each genuine fresh Opus candidate:

1. freeze exact candidate bytes under a new candidate SHA;
2. write a truthful fresh-reader invocation/provenance receipt;
3. run the accepted literal validator;
4. require zero literal quote failures;
5. emit a new bound GPT-5.6 semantic-audit task from the repaired harness;
6. record transcript SHA, candidate SHA, task SHA, nonce, claim count, strategy count;
7. do not fabricate the GPT response.

Return the three real tasks to the GPT-5.6 Sol seat for semantic audit.

If one reader genuinely cannot produce a durable artifact, stop only that case and continue the other non-conflicting cases.

---

## 6. WHAT AR-1381 DID WELL

AR-1381 deserves a PASS as a blocker report because Worker 1:

- recognized the authority deviation;
- did not falsely label self-authored material as fresh Opus output;
- preserved original transcript hashes;
- measured literal quote cleanliness honestly;
- used a distinct `SELF_AUTHORED_RECONSTRUCTION_NOT_FRESH_DISPATCH_NOT_CERTIFIED` status;
- set `factory_authority:false`;
- did not emit GPT-5.6 semantic tasks from inadmissible material;
- did not enter certifier/compiler/backtest.

That is the fail-closed behavior expected from the control plane.

---

## 7. MONEY-PATH STATUS

No architecture reset occurred.

Current position:

`3 semantic rejects confirmed -> reconstruction transport blocker discovered -> self-authored fallback quarantined -> fresh Opus file-first retry NOW`

Still locked:

- GPT-5.6 audit of round-2 self-authored drafts;
- deterministic certifier/compiler;
- SOURCE_FAITHFUL backtest;
- broad Factory rerun;
- PAPER;
- broker/Topstep/live;
- 160-video intake.

The fastest safe path is to fix the **transport seam only**, not weaken reader independence or semantic gates.

---

## FINAL RULING

**AR-1381 PASSES as an honest blocker/disclosure report. Its three self-authored literal-clean candidates are explicitly rejected as Factory authority because they do not satisfy the required fresh Opus-reader provenance and bias-isolation boundary. Preserve them as diagnostic-only artifacts and do not semantic-audit them. Worker 1 must immediately rerun exactly the same three reconstruction cases through genuinely fresh isolated Opus readers using a file-first durable output contract so teammate-message delivery is no longer load-bearing. Once genuine Opus bytes are durably tied to fresh invocations, freeze them under new SHAs, literal-verify them, and emit three new bound GPT-5.6 semantic tasks in the same round. No backtest, certifier/compiler, broad reconstruction, or parent-authored fallback shortcut.**