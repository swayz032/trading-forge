# GPT EXTERNAL ADVISOR RULING — AR-1281A

## VERDICT

**AR-1281: PASS FOR THE AUTHORIZED sVkm CONFLATION JUDGMENT. THE SEMANTIC CONFLATION AXIS IS CLOSED: PASS / TERMINAL READ CLEAN. THE FROZEN G2 EIGHT REMAIN NO-GO BECAUSE THEY ARE NOT YET PROVEN SUFFICIENT TO PRODUCE A CERTIFICATE. NEXT: ONE ZERO-MODEL CERTIFICATION-SEAM PACKET.**

Worker head graded: `e85aa66e5f34e406ea9214db0ec6d56c691cda28` (substantive AR-1281 work at parent `95351c7676c2af2ff89a8dfc2376550ff38a1324`).

The GPT-5.4 result is coherent with the pinned mirror-vs-fusion law and with the strategy object. **No quality anomaly was found; no GPT-5.6 Sol escalation is warranted.**

## 1. AR-1281 AUTHORIZED JUDGMENT — PASS

Independent repository inspection confirms the durable verdict artifact pins:

```text
video_id          sVkmZklJDHI
strategy_index    0
strategy_name     fvg_breakout_range_1m_5m
transcript_sha256 df72444f70e8c79db0e1692867913f14d37c18fd063f681a2b562fe103ce99cc
extraction_sha256 c37ff26f753449c35b6ec0402a3152dc287a8ae427eb0d86661b3fb43ec01823
grader git blob   8b844b170f2095341b73b2af65432b441967a04b
model             gpt-5.4
service tier      flex
reasoning effort  high
judgments_made    1
```

The returned semantic verdict is:

```text
verdict                  PASS
is_single_coherent_trade true
fused_pair               null
```

The reasoning correctly treats long/short as context-selected mirror alternatives around one opening-range -> breakout -> FVG -> third-candle-close -> wick-stop -> 2R skeleton, not simultaneous contradictory setups.

The artifact records `9260` total tokens and `$0.02315` as the MeteredCapGuard pricing estimate, explicitly **not a billed figure**. Billing/free-token application is outside this repository artifact; do not report `$0.02315` as actual cash charged.

## 2. TERMINAL-READ CONJUNCT — CLOSED

The Worker’s deterministic proof is valid on the narrow question it measures:

```text
conflation=None   -> INDETERMINATE / clean=false
conflation=PASS   -> CLEAN         / clean=true
conflation=REJECT -> REJECTED      / clean=false
```

Production `terminal_read_grade()` therefore no longer blocks sVkm once the actual PASS is supplied.

However, the proof script itself still prints `CONFLATION_PASS_ONLY_FROZEN_G2_REMAINS` and labels `pilot_grade` as the “frozen-eight/anchoring axis.” **That headline is now known false/over-broad by the Worker’s own F-1 finding.** The report correctly withholds the claim; the script must be corrected in the next packet so a stale executable witness cannot re-assert it later.

## 3. F-1 IS REAL — BUT THE ROOT CAUSE IS A CERTIFICATION SEAM, NOT FOUR MISSING NUMBERS

The canonical certificate requires every condition to have `classifying_tier in (1,3)` before `pilot_grade` can pass. The current certificate has all 12 conditions unclassified.

The frozen Opus route covers 12 conditions as:

```text
4  ACCEPTED_PENDING_CERTIFICATION  (excluded from isolated fallback)
8  unresolved/held/red             (the frozen isolated queue)
```

The Worker was correct that a perfect 8/8 isolated-evidence outcome is **not by itself proof** that all 12 certificate conditions will become classified.

But do **not** “fix” this by mechanically stamping the four accepted rows as Tier 3.

The repository explicitly defines `ACCEPTED_PENDING_CERTIFICATION` as:

> every mechanical/relevance/fidelity gate passed; **NOT a certification**.

And the final G2 evidence consumer explicitly refuses to issue anything stronger than `GREEN_PENDING_CERTIFICATION`.

The actual certificate has only two legal classifying paths:

```text
Tier 1: deterministic Tier1Detection -> classifying_tier = 1
Tier 3: control-gate-passing Tier3Verdict -> classifying_tier = 3
```

A route-level `ACCEPTED_PENDING_CERTIFICATION` disposition is neither of those things.

Therefore the real missing bridge is:

```text
final approved Opus evidence
        -> existing pilot_conveyor anchor/proposal seam
        -> deterministic Tier-1 read where possible
        -> existing blind Tier-3 packet only for true residual fall-throughs
        -> control-gated Tier3Verdict data
        -> finalize_certificate
```

That seam must be measured before any more semantic/model spend.

## 4. NEXT WORKER PACKET — AR-1282: CERTIFICATION-SEAM MEASUREMENT + MINIMAL WIRING

Actor: ordinary bound Worker-1.

**Zero model calls. Zero frozen-G2 calls. Money-path only.**

### A. Reconstruct the intended contract from production code

Treat these as authorities, not prose guesses:

- `src/engine/extraction/opus_phase1_route.py`
- `src/engine/extraction/g2d_finalizer.py`
- `src/engine/extraction/pilot_conveyor.py`
- `src/engine/extraction/cert_assembler.py`

Prove, with executable paths, exactly how a final route’s accepted evidence is supposed to become input to `prepare_strategy` / `finalize_certificate`.

### B. Exercise ONLY the 4 already-accepted route rows

Build the smallest deterministic adapter/harness that supplies the four currently `ACCEPTED_PENDING_CERTIFICATION` route quotes/spans to the existing pilot conveyor as evidence proposals.

For the other eight rows, **do not use their rejected/held batch evidence as if accepted** and do not fabricate successful isolated returns. They must remain unresolved/declined in this measurement.

Run the existing Tier-1 machinery on the four accepted rows and report, condition by condition:

```text
ACCEPTED route row
 -> anchored/proposal accepted?
 -> Tier-1 fires and classifies?       YES/NO
 -> if NO, exact Tier-3 packet item produced
```

Required headline counts:

```text
accepted_route_rows                 = 4
accepted_rows_classified_at_tier1   = X
accepted_rows_residual_tier3        = 4-X
frozen_route_rows_unresolved        = 8
```

### C. Do not convert route acceptance directly into Tier3Verdict

Mutation/negative controls must prove:

1. `ACCEPTED_PENDING_CERTIFICATION` alone cannot manufacture `classifying_tier=3`.
2. a held/refused/red route row cannot enter the accepted-proposal set.
3. a quote/span mismatch refuses.
4. a Tier-3 verdict with `control_gate_passed=false` cannot classify.
5. missing Tier-3 verdict leaves the residual condition `classifying_tier=None`.
6. only the existing Tier-1/Tier-3 contracts can satisfy `every_condition_classified`.

### D. Prove the post-G2 continuation without spending G2

Using fixtures/synthetic DATA only where needed, prove the shape:

```text
future final G2 route becomes GREEN_PENDING_CERTIFICATION
 -> all 12 final approved evidence rows feed the same adapter
 -> Tier-1 runs on each approved evidence row
 -> only residual Tier-1 fall-throughs populate the blind Tier-3 packet
 -> Tier-3 verdicts, if later authorized and control-gate-passing, feed finalize_certificate
```

Do **not** fabricate semantic PASS verdicts and call them real. A synthetic reachability control may prove the pathway can turn green, but must be labeled synthetic/control.

### E. Repair the stale AR-1281 proof headline

Update `scripts/ar1281_terminal_read_proof.py` so PASS means only:

```text
CONFLATION_PASS_TERMINAL_READ_CLEAN
```

It must no longer state that only frozen G2 remains unless it mechanically checks the certificate’s classification completeness and all other live conjuncts.

### F. Report the exact next authorization surface

AR-1282 must end with one of:

```text
FOUR_ACCEPTED_CLASSIFY_TIER1_ALL — frozen 8 are still evidence work; no extra certification call for these four
FOUR_ACCEPTED_HAVE_TIER3_RESIDUALS — report exact residual count and exact pre-existing blind packet items
CERTIFICATION_SEAM_MISSING — name the smallest missing production seam; do not invent classification
```

Then separately state what would remain **after** the frozen eight turn the final route green: expected Tier-1 count and residual Tier-3 adjudication count, with the latter treated as an estimate unless executable evidence proves an exact value.

## 5. FAST + ROBUST / NO DETOURS

AR-1282 must not touch:

- control-plane bootstrap;
- PowerShell guard work;
- CLAUDE.md/token-plan refactor;
- frozen G2 queue/receipts/native manifest;
- Opus dispatch;
- Agent/subagent dispatch;
- GPT-5.4/5.6 or other paid/cloud judgment;
- compiler implementation;
- broad backtesting/PAPER/Topstep.

No architecture rewrite. Reuse the existing pilot conveyor and certificate contracts. If the seam already exists, wire/reuse it. If it does not, build only the smallest missing adapter with production-path tests.

## 6. FROZEN / BRANCH / CI STATE

Independent GitHub comparison from previously graded `b39786ba...` to current `e85aa66e...` shows two commits. Changed paths are the AR-1281 runner/proofs/verdict/report plus `docs/designs/SYSTEM-INVENTORY.md`; no frozen queue/receipt/settings/toolbox path changed.

At review:

```text
frozen queue entries = 8
attempts             = {}
READY                = 8
SPENT                = 0
G2 receipts          = README.md only
toolbox branch       = b6c702821bc48281b02e16773c7c277ae17fb03f
```

**CI: NONE; tests are local-only evidence.** GitHub exposes no combined statuses and no workflow runs at Worker head `e85aa66e5f34e406ea9214db0ec6d56c691cda28`.

## OPERATOR DIRECTIVE

**AR-1281 PASSES. GPT-5.4’S sVkm CONFLATION VERDICT IS ACCEPTED; NO GPT-5.6 SOL ESCALATION IS NEEDED. THE SEMANTIC CONFLATION LOCK IS CLOSED. DO NOT SPEND THE FROZEN EIGHT YET. AR-1282 IS A ZERO-MODEL MONEY-PATH PACKET THAT MEASURES/WIRES FINAL OPUS EVIDENCE INTO THE EXISTING PILOT CONVEYOR, DETERMINISTICALLY CLASSIFIES WHATEVER THE FOUR ALREADY-ACCEPTED ROWS CAN CLASSIFY AT TIER 1, AND EXPOSES ANY TRUE TIER-3 RESIDUAL WITHOUT INVENTING A VERDICT. THEN WE WILL KNOW THE EXACT REMAINING CERTIFICATION CALL SURFACE BEFORE SPENDING G2. TONIO HAS ZERO TECHNICAL STEPS.**