# AR-1131 (worker) — **B-FAILCLOSED-1 + B-RISK-1 COMPLETE** at `83c6fa41`. **AND LANE C: THE REAL CERTIFICATION LANE IS FOUND, ITS LLM IS LIVE, AND ONE DECISION SEPARATES IT FROM CERTIFYING sVkm.**

**Seat:** Claude Code worker · **Date:** 2026-08-13
**Governing ruling:** AR-1130 (gpt-rulings `b21f78fd`)
**Engineering head on origin:** `83c6fa41` (impl `4727dbaa` + inventory regen)
**§9.2 remains OPEN and is NOT claimed.**

---

## 1. ORDER B-RISK-1 ✅ — YOUR TRACE WAS RIGHT, AND THE DEFECT REPRODUCES LIVE

You traced `source_risk` → `resolveSpecStopLoss()` → framework ATR 1.5 fallback. **Confirmed, and now demonstrated as a failing assertion rather than an argument.** With the transport line removed:

```
AssertionError: expected 'atr' to be 'source_structural'
```

**That is the money-path defect in one line:** a teacher-taught structural stop silently became the framework ATR stop, and the fixed-R target went with it.

**Transported VERBATIM, not validated.** `resolveSpecStopLoss` is the canonical authority for this contract's meaning; re-checking its shape in the onboarding parser would be the second semantic authority your §5 forbids. A test proves no reinterpretation happens: an unrelated `TF_OVERLAY_VARIANT` mode passes through untouched.

**All five of your required proofs are in**, plus the legacy ATR default confirmed byte-compatible.

## 2. ORDER B-FAILCLOSED-1 ✅

Presence is now decided on the **raw** field, validity by the parser, so a present-but-malformed carrier returns `ok:false` / `invalid_source_timeframe_roles` instead of an artifact with the field quietly gone.

**Your discriminators, both fired:** remove the fail-closed check → **6 tests fail**, legacy absent-carrier stays green. Remove the source-risk transport → **4 tests fail**. Restored **25/25**; regression **48 vitest** across the three onboarding suites; `tsc --noEmit` clean.

---

## 3. 🟢 LANE C — THE REAL CERTIFICATION LANE, ENUMERATED READ-ONLY

**I found it, and it is not the sealed conductor.**

```
pinned transcript BYTES  (sVkmZklJDHI · 25071 · sha256 df72444f…ce99cc)
  │
  ├─► extractor_bridge.invoke_real_extractor(transcript_text, video_id)
  │      ↳ binds to the BYTES DIRECTLY — the transcript is the INPUT, so your
  │        "bind to those bytes or REFUSE" is satisfied by construction, not by a check
  │      ↳ fail-closed: RealExtractorError on any failure,
  │        "never returns a partial/fabricated result"
  │
  ├─► npx tsx scripts/h1-extract-one.ts        [thin, side-effect-free wrapper; PRESENT]
  │      ↳ callScoutExtractLlm → gemma4:e4b-it-qat
  │        🟢 OLLAMA IS LIVE — verified against localhost:11434, model loaded
  │
  ├─► {video_id, instrument_classification, strategies[], rejected_strategies[]}
  │      ↳ THIS IS THE SHAPE produce_spec_artifact_from_record CONSUMES (it reads
  │        record["strategies"]), and it matches the tier-a provenance record keys
  │
  ├─► extractor_bridge.save_extraction() → VaultRecord{extraction_sha256}   [DURABLE]
  │
  ├─► pilot_conveyor.prepare_strategy() → tier-1/tier-3 → finalize_certificate()
  │      ↳ THE GRADING/CERTIFICATION STAGE you asked me to locate
  │      ↳ provenance: pilot_conveyor.extractor_version_pin() content-hashes the ACTIVE
  │        prompt+schema pair — a STRONGER pin than a git SHA, since it changes iff
  │        extractor BEHAVIOUR changed
  │
  └─► certified record → compile_certified_record (Spine-A) → .spec.json
```

**Every dependency is verified present and live. Nothing in this lane requires the SEAL-GO token.**

### 🛑 THE ONE DECISION — AND IT IS A REAL DIFFERENCE, NOT A FORMALITY

This lane produces `{instrument_classification, strategies, rejected_strategies}`. The **committed tier-a records additionally carry `reader_identity`, `dispatch_record`, `coaching_notes`, `coverage_notes`** — and `[MEASURED]` those four are stamped by **`sealed_read_driver`**, i.e. by the sealed *exam* apparatus, **not** by this lane.

So:

- **C-a — accept the vault + conveyor certificate as the "durable certified record" for sVkm.** Available today, no new authorization, binds to the pinned bytes. **Cost:** the record carries **no `reader_identity`**, so it is provenance-weaker than the 13 tier-a records and is **not** an apples-to-apples sibling of them.
- **C-b — require sealed-conductor provenance.** That is the exam apparatus, and it needs the SEAL-GO authorization **you withheld** in AR-1130 §7 — which would have to come from the operator, for this purpose.

**My recommendation: C-a**, with the record explicitly stamped as **extraction-certified, not exam-certified**, so nothing downstream can later read it as a sealed-exam artifact. §9.2's chain needs *"real certified source evidence"*, and this lane produces it from the pinned bytes through the real production extractor. The sealed apparatus exists to make a **blind evaluation** honest — that is a different guarantee from *"these are genuinely this teacher's words, extracted by the production extractor"*, and only the latter is what §9.2's vertical proof rests on.

**I have NOT run it.** Running it creates certified evidence, which is the boundary I stopped at in AR-1126 and am still standing on.

---

## 4. STATUS

| Order | State |
|---|---|
| B-FAILCLOSED-1 | ✅ COMPLETE, red-proofed |
| B-RISK-1 | ✅ COMPLETE, red-proofed, defect reproduced live |
| **Lane C enumeration** | ✅ **COMPLETE — route map above** |
| Lane C execution (certify sVkm) | 🛑 **needs your C-a / C-b ruling** |
| B-DB-ROUNDTRIP-1 | ⬜ NOT STARTED |
| D-REAL-1 | 🛑 **BLOCKED by `verify_spacing()` — see AR-1130 (mine, `83f9178b`)** |
| §9.2 | 🔴 OPEN, NOT CLAIMED |

⚠️ **You ruled AR-1130 before my AR-1130 landed, so you have not yet seen this:** real 5m data **loads fine** (1308 bars — the operator was right, the AWS keys were in `.env` and merely unexported), but **`RoleFrame.verify_spacing()` refuses it**, because it demands every gap equal the timeframe and real futures carry the CME 17:00–18:00 ET halt (`5m: 5.0 ×1303, 65.0 ×4`). **D-REAL-1 cannot pass until that predicate is ruled on.** My proposal — *every gap a positive integer multiple of the timeframe* — admits the halt and still convicts a 1m series labelled 5m.

**DISCLOSURES:** Lane C was **read-only**; nothing dispatched, nothing extracted, nothing certified · Ollama liveness verified by one HTTP GET to the local API · I did not read `h1-extract-one.ts` end-to-end, only its I/O contract and output shape — a side effect deeper in `callScoutExtractLlm` would not have been seen (the module docstring discloses one fire-and-forget `audit_log` telemetry insert) · no grader · no backtest · no trade.

**Three decisions now sit with you: C-a/C-b, the `verify_spacing` predicate, and the still-open R1 SEAL-GO position.** Unblocked work remaining on my side: **B-DB-ROUNDTRIP-1**, which I am starting.
