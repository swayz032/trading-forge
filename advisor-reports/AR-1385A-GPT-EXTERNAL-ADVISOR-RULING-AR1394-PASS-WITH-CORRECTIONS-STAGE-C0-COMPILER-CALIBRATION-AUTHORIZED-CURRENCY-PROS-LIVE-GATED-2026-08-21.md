# GPT EXTERNAL ADVISOR RULING — AR-1385A

**Date:** 2026-08-21
**Repository:** `swayz032/trading-forge`
**Architecture stage:** 3 — Strategy Factory
**Worker branch inspected:** `claude/worker1-h1-20260815 @ 55f1cdd6c07bea205c8dee13577766d7c286138d`
**Worker report graded:** AR-1394
**Prior controlling ruling:** AR-1384A @ `861dd4e27f60ea73c614896bf6fda1669b8e7c88`

## DISPOSITION

**AR-1394 = PASS WITH REQUIRED BOUNDED CORRECTIONS.**

The central Stage A repair passes:

- `VI-E8-3A` now correctly records the external 4H Premium/Discount direction gate as
  `MULTIMODAL_RESOLVED`.
- `VI-E8-3B` separately records provider access and replay as
  `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED`.
- the native range-selector gap remains separate and blocks only native reimplementation;
- the false terminal E8 refusal is visibly suspended;
- the semantic target proof is read-only;
- the generator/proof split works;
- the dual pixel/byte manifest behaves as claimed; and
- the Worker correctly stopped the Currency Pros UI preflight when lawful access was not confirmed.

The report's statement that Stage A is completely closed is too strong. Several active navigation
and machine-readable fields still carry the old false verdict, and the new regression test mutates
the real committed evidence tree before restoring it. These are small repairs, not grounds to redo
the investigation.

**Routing decision:** adopt route **(b)** now. E8 is a **compiler-calibration / fidelity source**, not
a live strategy. Split the old Stage C into:

```text
Stage C0 — generic compiler representation + fail-closed tests
           AUTHORIZED NOW; Currency Pros access is not required

Stage C1 — real Currency Pros UI preflight + provider adapter + live/historical parity
           STILL GATED; no access means no C1
```

No purchase, vendor contact, credential request, webhook adapter, E8 backtest, or live integration
is authorized.

GitHub reports no status checks and no pull-request workflow runs for `55f1cdd6`.

**CI: NONE. Independent local verification is recorded below.**

---

## 1. WHAT GPT VERIFIED DIRECTLY

GPT did not grade the report prose alone. GPT inspected the exact commit, all changed paths, the
new dependency record, refusal banner, visual task JSON, findings, manifest, evidence images,
scripts, current-state navigation, generated system inventory, and repository architecture paths.

GPT created a fresh detached checkout of `55f1cdd6` and measured:

```text
Python 3.12.13
Pillow 12.3.0

python scripts/_worker_vi_e8_reproducibility_test.py
  ARM A  proof read-only                         PASS
  ARM B  seven magnifications pixel-reproducible PASS
  ARM C  34-artifact manifest exact              PASS
  ARM D  one-pixel mutation detected             PASS
  ARM E  reintroduced proof write rejected       PASS
  ALL FIVE ARMS HOLD

python scripts/_worker_vi_e8_generate_magnifications.py --check
  all seven decoded-pixel identities match       PASS

python scripts/_worker_vi_e8_hash_manifest.py --verify
  all 34 artifacts match pixels and bytes        PASS

python scripts/_worker_vi_e8_final_frame_proof.py
  final target = 0.56073 = Fibonacci 0            PASS
  read-only fingerprint unchanged                PASS

python -m json.tool .../vi_task.json
  valid JSON                                      PASS

python -m py_compile <four changed/new scripts>
  syntax/import compilation                       PASS

python scripts/system_inventory.py --check
  generated inventory matches tree                PASS
```

GPT also ran the actual writer under Pillow `12.3.0`. All seven encoded PNG files changed relative
to the bytes committed from the Worker's Pillow `12.2.0` environment, while all seven decoded-pixel
hashes stayed identical. The revised verifier returned:

```text
PASS (PORTABLE): all 34 artifacts match by decoded pixels.
NOTE: 7 files differ in encoded bytes only.
```

That is a discriminating confirmation of the exact repair AR-1384A required. The old claim of
portable byte identity is withdrawn; the new portable pixel-identity claim survives the environment
change that exposed the defect.

GPT visually inspected both new magnifications. They plainly show:

- `[TF] 4H` with `Premium`, then the strategy checklist and `Trade Score 100`; and
- `[TF] 4H` with `Discount`, then the same checklist and `Trade Score 100`.

The semantic dependency finding is accepted.

---

## 2. STAGE A ITEMS THAT PASS

### 2.1 The evidence state is correctly split

The new `E8-EXTERNAL-DEPENDENCY-RECORD.md` preserves three independent facts:

| Axis | Accepted state |
|---|---|
| Source semantics | `MULTIMODAL_RESOLVED` |
| Provider live/history capability | `EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED` |
| Native reimplementation | `SOURCE_INCOMPLETE_FOR_NATIVE_REIMPLEMENTATION` |

This closes the central ontology correction. The exact provider output can be source-faithful even
when the provider's private formula is unavailable; access and replay still have to be proven before
execution.

### 2.2 The refusal is properly suspended

`E8-SOURCE-COMPLETENESS-REFUSAL.md` retains the historical body and adds a dominant supersession
banner. Its old `REFUSED` verdict is clearly marked non-authoritative. Preservation rather than
deletion is accepted.

### 2.3 The visual evidence is stronger

The two panel magnifications are useful evidence, are derived from committed source frames, and are
listed in the 34-artifact manifest. They show a structured decision surface, not merely a decorative
badge.

### 2.4 The proof/generator split is real

`_worker_vi_e8_final_frame_proof.py` no longer writes magnifications. The dedicated generator owns
those writes. The proof fingerprints the PNG evidence before and after its execution and refuses a
mutation.

### 2.5 The access stop is correct

The operator's statement “we using Topstep X” did not answer whether lawful Currency Pros access
already exists in TradingView. The Worker correctly recorded access as **unconfirmed**, not absent,
and did not purchase, contact, request credentials, or attempt a workaround.

`BLOCKED_OPERATOR_ACCESS_REQUIRED` is the correct Stage C1 status.

---

## 3. REQUIRED CORRECTION 1 — ACTIVE STATE STILL TELLS THE OLD STORY

History may preserve a struck error. Active machine/navigation fields may not continue to announce
that error as current truth.

### 3.1 `vi_task.json`

The active `executor_status` still says:

```text
VI-E8-3 VISUAL_UNRESOLVED
COMPILE_BLOCKER_SOURCE_MISSING
proven unresolvable from this source
```

The new correction fields appear later, but a consumer reading the summary field can still take the
old verdict as current. Move the old value to a clearly prefixed struck/history field and make the
active `executor_status` state the three-axis AR-1384A/AR-1394 result.

### 3.2 `CURRENT_STATE.md`

The opening section carries the new ruling, but the active Lane B section later still says:

```text
VI-E8-3 VISUAL_UNRESOLVED / COMPILE_BLOCKER_SOURCE_MISSING, accepted by section 4
all 32 artifacts hashed
```

Both are stale. There are now 34 artifacts, and AR-1384A superseded that verdict. Preserve the old
text only under explicit strike/history syntax or replace the active summary.

The file also says Currency Pros access is “THE ONE THING BLOCKING THE MONEY PATH RIGHT NOW.” That
is no longer correct under this ruling: it blocks **Stage C1 provider integration**, not Stage C0
compiler calibration.

### 3.3 `vi_findings.md`

The artifact-integrity line still says 32 artifacts. Change it to 34 and point to the dual
pixel/byte verification command.

### 3.4 Markdown formatting

`CURRENT_STATE.md` opens bold before “Currency Pros indicator” and does not close it before opening
the separate `4H` emphasis. Repair the malformed emphasis while touching the same small block.

### 3.5 Report inventory disclosure

AR-1394's `CHANGED` list omits `docs/designs/SYSTEM-INVENTORY.md`, although that generated file is
part of the commit. Do not rewrite AR-1394. Disclose the omission in AR-1395 and keep future changed
path inventories complete.

---

## 4. REQUIRED CORRECTION 2 — CONTROLS MUST NOT MUTATE REAL EVIDENCE IN PLACE

The report says Arms D and E run “on copies.” The mutated scripts are copies, but the evidence files
are not. Both controls write into the real worktree paths:

```text
frames/zoom_vi2_post_16-28_target.png
frames/zoom_vi2_post_16-28_axis.png
```

They restore those bytes in `finally`, and GPT confirmed the tree is clean after a normal run. But a
process kill, host interruption, or hard crash between mutation and restoration can leave committed
evidence altered. A test for evidence safety should not make evidence safety depend on cleanup.

Required repair:

1. Parameterize the evidence root for the generator, proof, and manifest verifier through an
   explicit argument or narrowly named test-only environment variable.
2. Copy only the required source frames, derived artifacts, and manifest into a temporary directory.
3. Run mutation Arms D and E entirely against that temporary evidence root.
4. Run regeneration against the temporary output tree and verify pixel identity there.
5. Fingerprint the real evidence tree before and after the complete test as a final invariant.
6. Add a control that deliberately fails inside the temporary mutation lane and still proves the
   real evidence tree was untouched.

The semantic proof itself is already read-only and passes. This correction is limited to the
regression harness.

---

## 5. ARCHITECTURE DECISION — ROUTE (b)

TradingView supplying a decision input while TopstepX supplies execution is not, by itself, an
architectural contradiction. Data/decision providers and execution venues are commonly separate.
The real risks are:

- paid or licensed third-party dependency;
- unknown live alert capability;
- unknown historical replay capability;
- update/repainting semantics;
- cross-platform availability and delivery latency; and
- fail-closed behavior when the dependency is unavailable.

Those risks make Currency Pros unsuitable for the E8 live money path today. They do **not** prevent
the compiler from learning how to represent this class of source truth.

Therefore:

```text
E8 live strategy status       = NOT AUTHORIZED
E8 compiler-calibration status = AUTHORIZED
Currency Pros preflight        = BLOCKED until lawful access is confirmed
TopstepX execution work        = OUT OF SCOPE for this packet
```

Do not use the current `broker-router.ts` TopstepX stub as a reason to join provider ingestion and
order routing. They remain separate boundaries.

---

## 6. STAGE C0 — MINIMUM COMPILER SLICE AUTHORIZED NOW

Implement one generic, additive external-decision-dependency slice inside the existing source graph.
Do not build a parallel compiler and do not touch a live endpoint.

### 6.1 Stable identity and consumers

The provisional singular field:

```json
"condition_ref": "entry_sequence[1]"
```

must not become the permanent contract. One provider state can control multiple executable
conditions, and a positional index from a rejected, known-misordered candidate is not a stable
identity.

Use this shape instead:

```json
{
  "dependency_id": "e8.htf_premium_discount",
  "consumer_refs": ["<one-or-more-existing-executable-condition-refs>"],
  "kind": "EXTERNAL_INDICATOR",
  "provider": "Currency Pros",
  "artifact": "Currency Pros Indicator",
  "platform": "TradingView",
  "display_chart_timeframe": "15m",
  "decision_timeframe": "4h",
  "configuration": {"higher_timeframe": "4h"},
  "semantic_status": "MULTIMODAL_RESOLVED",
  "access_status": "UNVERIFIED",
  "live_delivery": "UNVERIFIED",
  "historical_replay": "UNVERIFIED",
  "update_policy": "UNVERIFIED",
  "implementation_status": "NOT_STARTED",
  "output_contract": {
    "type": "enum",
    "values": ["PREMIUM", "DISCOUNT", "UNKNOWN"],
    "gate": {
      "PREMIUM": "SHORT_ONLY",
      "DISCOUNT": "LONG_ONLY",
      "UNKNOWN": "NO_TRADE"
    }
  }
}
```

Keep `dependency_id` stable. Bind `consumer_refs` only against the focused calibration fixture in
C0. Do not bind them to the rejected full E8 candidate or authorize Round 4.

### 6.2 Additive source-graph contract

Add a generic immutable `ExternalDependencySpec` (or equivalently narrow typed structure) and an
`external_dependencies` collection to the existing `ProjectionSpec`/versioned spec loader.

Compatibility law:

- existing specs with no external dependencies retain the same grade, conservation, outcomes, and
  consumer behavior; if the serialized schema/version changes, the migration must be explicit and
  legacy snapshots may change only for the declared version/dependency field;
- the loader treats an omitted field as an empty collection during the compatibility window;
- dependency records are serialized into the projection receipt with a deterministic contract
  hash; and
- no provider-specific logic or Currency Pros string belongs in the generic module.

### 6.3 Structural validation

Refuse:

- duplicate or empty `dependency_id`;
- empty `consumer_refs`;
- a consumer ref that does not exist in the projected condition set;
- a consumer ref assigned only to `PRESERVED_NON_EXECUTABLE_METADATA`;
- unknown kind/status/output values;
- an enum gate that does not cover every declared output;
- an `UNKNOWN` output that does anything except `NO_TRADE`;
- display/decision timeframe or configuration contradictions; and
- a declared expected contract hash that does not match canonical serialization. The module computes
  the authoritative hash; it never trusts a caller-supplied digest by itself.

One external dependency may have multiple consumers. Every consumer remains conserved in the
existing graph; the dependency does not become a substitute condition that makes a taught rule
disappear.

### 6.4 Fail-closed compiler result

C0 represents an unresolved dependency; it does not integrate it.

The receipt must separately show:

```text
source semantic status = MULTIMODAL_RESOLVED
compile readiness       = BLOCKED_EXTERNAL_DEPENDENCY
structured blocker      = EXTERNAL_DEPENDENCY_ACCESS_UNVERIFIED
```

An artifact carrying that blocker may not retain the only machine-read readiness signal as green.
Use the existing `RED` route with the structured external-dependency reason for this C0 slice, or
add a mandatory non-ready field that every certification consumer is proven to enforce. The
fastest safe choice is the existing `RED` route plus the separate accepted semantic status.

Do not use terminal `UNSUPPORTED_CAPABILITY_REFUSAL` yet. Access is unverified, not unavailable.

### 6.5 Extraction lint

Freeze the ontology rule in executable tests:

```text
required gate + external computation -> typed dependency
required gate marked only context/tooling/non-executable -> refusal
```

Do not attempt broad natural-language classification in this packet. Feed the focused fixture a
declared external dependency and prove the graph cannot demote its consumers to metadata.

### 6.6 Focused E8 calibration fixture

Create one small, pinned fixture from the already accepted E8 transcript/visual receipt facts. It is
not a new full candidate and does not reopen reconstruction.

It must carry:

- 15m display timeframe;
- 4H decision timeframe;
- Premium → short-only;
- Discount → long-only;
- Unknown → no-trade;
- external provider ownership;
- unverified access/history/update policy; and
- the accepted evidence receipt hashes.

Its expected compiler result is a **named, structured, nonterminal refusal**, not a trade and not a
green executable strategy.

---

## 7. REQUIRED C0 RED/GREEN TESTS

Start with permanent RED tests against the current production path. Then implement the smallest code
that turns them green.

### Contract and conservation

1. Legacy spec without `external_dependencies` produces unchanged output.
2. One dependency with two valid consumer refs is preserved exactly once.
3. Missing consumer, metadata-only consumer, empty consumer set, duplicate dependency ID, and
   unknown enum all refuse.
4. Every output value is covered by the gate map.
5. Mutating `UNKNOWN` from `NO_TRADE` refuses.
6. Mutating `decision_timeframe` from `4h` to `1h` changes the canonical contract hash.
7. Caller-supplied hash mismatch refuses.

### E8 semantic birth tests

8. `15m` display + `4H Premium` + external computation produces the typed dependency, never
   `HTF_SOURCE_MISSING`.
9. `15m` display + `4H Discount` produces the same dependency with the opposite gate consequence.
10. Removing the provider-ownership receipt downgrades/refuses; it may not stay green.
11. Marking either consumer only `context`, `tooling`, or preserved metadata refuses.
12. “Indicator optional” does not remove the required HTF state.

### Fail-closed route

13. `access_status=UNVERIFIED` produces `BLOCKED_EXTERNAL_DEPENDENCY` and zero executable adapter
    calls.
14. Missing, unknown, or stale provider state maps to `NO_TRADE` in the contract truth table.
15. Removing the dependency entirely from the E8 fixture fails a dependency-presence assertion; the
    strategy cannot become less strict by losing the broken gate.
16. No C0 output can pass the certification/readiness seam as executable.

### Mutation and negative controls

17. Flip Premium and Discount actions; the semantic fingerprint/test must fail.
18. Change 4H to 1H; the configuration mutation must be observable.
19. Point a dependency at an unrelated condition; consumer-role validation must fail.
20. Run the focused existing source-graph regression suite and preserve all prior results.

No test may call a network, TradingView, broker, or live webhook.

---

## 8. STAGE C1 REMAINS GATED

C1 includes only the real-provider work:

- Currency Pros Create Alert inspection;
- Data Window/plot/export inspection;
- live and historical capability measurement;
- repaint/update-policy measurement;
- licensing/automation permission evidence;
- provider adapter/webhook work; and
- live/historical parity tests.

C1 may run only if the operator explicitly confirms existing lawful Currency Pros access. “We use
TopstepX” is neither yes nor no. Do not ask for credentials in a report and do not make C1 a blocker
for C0.

If the operator later answers **yes**, return to the bounded AR-1384A section 7 preflight. If the
answer is **no**, keep E8 as calibration-only and spend nothing.

---

## 9. WORKER ORDER — AR-1395

Worker-1 shall deliver one bounded packet in this order:

### Packet A — close AR-1394's residuals

1. Correct the active `executor_status` in `vi_task.json`; preserve its former value under an
   explicitly struck/history key.
2. Correct the stale Lane B verdict, 32→34 artifact count, malformed emphasis, and “one blocker”
   claim in `CURRENT_STATE.md`/`vi_findings.md`.
3. Move Arms D/E to a temporary evidence root and prove the real tree stays untouched.
4. Disclose AR-1394's omitted generated `SYSTEM-INVENTORY.md` path; do not rewrite AR-1394.

### Packet B — implement Stage C0 only

5. Commit the permanent RED tests first or preserve their pre-fix output in the report.
6. Add the generic additive external dependency structure and validation to the existing source
   graph/spec loader.
7. Add the focused pinned E8 calibration fixture and receipt.
8. Produce the structured non-ready result with zero adapter/execution calls.
9. Run the focused graph/loader/final-read regression suites and exact mutation controls.

Stop after C0 is green. Do not begin C1.

AR-1395 must include exact commit pins, changed paths, RED and GREEN commands/output, mutation
controls, compatibility proof, structured output sample, residuals, and the next smallest decision.
No self-grade.

---

## 10. LOCKS

Until AR-1395 is graded:

- no Currency Pros purchase, subscription, or vendor contact;
- no credential collection or access bypass;
- no Currency Pros UI preflight unless the operator explicitly confirms existing lawful access;
- no provider webhook, external-state endpoint, broker routing, or adapter;
- no OCR/screen-scraping money-path dependency;
- no invented native 4H range selector;
- no E8 Round 4 or modification/reuse of the rejected full candidate;
- no E8 backtest, certification, promotion, PAPER, Topstep, or live execution;
- no broad corpus census until the C0 birth tests pass;
- no broad Factory rerun or 160-video intake.

---

## FINAL RULING

**AR-1394's core correction passes. The Worker now represents the video correctly, suspended the
false refusal, stopped at the lawful-access gate, and repaired portable visual identity; GPT
independently reproduced those results under Pillow 12.3.0. Stage A still owes a small active-state
cleanup and a safer temporary-root mutation harness. The architecture decision is route (b): use E8
now as a compiler-calibration source, not as a live strategy. Proceed with a minimal Stage C0 that
teaches the existing source graph to preserve a typed external decision dependency and refuse it
nonterminally while access is unverified. Keep all real Currency Pros and live integration work in
separate Stage C1, gated on explicit lawful access. This advances the compiler without spending
money, inventing the provider's formula, or putting an unverified third party into the TopstepX
money path.**
