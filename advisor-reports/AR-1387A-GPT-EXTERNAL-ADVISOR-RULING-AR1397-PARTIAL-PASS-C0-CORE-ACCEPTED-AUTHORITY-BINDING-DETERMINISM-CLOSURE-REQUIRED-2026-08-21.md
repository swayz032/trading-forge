# GPT EXTERNAL ADVISOR RULING — AR-1387A

**Date:** 2026-08-21

**Repository:** `swayz032/trading-forge`

**Architecture stage:** 3 — Strategy Factory

**Worker branch inspected:** `claude/worker1-h1-20260815 @ 860525ce757ed4aa6c03888ea552952ea19e6220`

**Worker report graded:** AR-1397

**Worker graded pin:** `39d60f49d4e96b6000e6f645feffb4d60a34ac95`

**Prior controlling ruling:** AR-1386A @ `725887a0b0ba8bde9322f114f400f83c3404444e`

## DISPOSITION

**AR-1397 = PARTIAL PASS. THE ORDERED C0 CORE REPAIRS PASS; STAGE C0 CLOSURE DOES NOT.**

The Worker made substantial, verifiable progress. GPT accepts the following repairs:

- only `MULTIMODAL_RESOLVED` semantics can become ready;
- implementation status gates independently from access;
- a dependency-bearing receipt cannot become executable merely by deleting or lying about
  `compile_readiness` while the dependency record remains present;
- malformed dependency containers, blank/absent stamps, and false ready values refuse;
- structured blocker causes and terminality now describe the actual blocking axes;
- the projection and seam consume one six-axis gate definition;
- `consumer_refs` emit in canonical order;
- the zero-call guard has real positive controls;
- the E8 fixture directly pins `15m` display, `4h` decision, Premium → `SHORT_ONLY`, Discount →
  `LONG_ONLY`, and no missing-source vocabulary; and
- the focused C0 truth table reaches exactly one ready row out of 729.

GPT independently reproduced **105/105 C0 tests**, **31/31 sibling source-graph tests**, and clean
`ruff`. With the downstream test dependencies present, the vertical compile suite produced
**21 passed / 3 failed**. All three failures are canonical-hash assertions, and GPT identified their
deterministic root cause below.

AR-1397's 7/10 independent grade is credible for its stated attack surface. It is not evidence that
the strategy-required dependency is enforced at the production seam. The report and the test both
explicitly admit that it is not. GPT also reached two new false-green paths on the final Worker head.

**Stage C1, E8 trading, PAPER, Topstep, and live execution remain locked.**

---

## 1. FINAL-PIN REVIEW, NOT REPORT-ONLY REVIEW

GPT inspected the complete final Worker chain through `860525ce`, including the one additive test
commit after the independently graded pin:

```text
7d50c19d  suspend the closed Worker-2 peer handshake
73ebace9  first AR-1386A repair
945c38f3  first grader-finding repair
1c800d16  second grader-finding repair; stamp required
cf18b04a  make GATING_AXES load-bearing in projection and seam
39d60f49  final independently graded production pin
4227add8  AR-1397 report and current-state update
860525ce  post-grade additive inertness positive control
```

The 7/10 grade therefore covers production code at `39d60f49`, but not the final additive test at
`860525ce`. GPT ran the final head directly.

Independent final-head verification:

```text
test_external_dependency_projection.py  105 passed
test_source_graph_projection.py           31 passed
test_svkm_v2_1_compile.py                  21 passed, 3 failed
ruff                                       PASS
```

The three vertical failures are not attributed to missing packages or to the external-dependency
logic. They all compare the locally produced receipt hash with the frozen `fd79f602...` pin.

No full engine sweep was run or claimed by GPT.

---

## 2. CRITICAL — THE REQUIRED 4H DEPENDENCY CAN STILL BE DELETED AND COMPILED

The report admits this at AR-1397 lines 193–205 and again at lines 224–227. The permanent test makes
the gap even clearer at `test_external_dependency_projection.py:1336-1356`:

```text
drop the required dependency
projection grade = GREEN_PENDING_CERTIFICATION
assert only that an external fixture can notice the missing id
```

That is detection by a test fixture, not enforcement by the compiler. The production seam does not
receive or independently load `required_dependency_ids`.

GPT replayed the real nine-canonical-node receipt on final head:

```text
blocked E8 dependency present                 -> CanonicalNodeNotAcceptedError
delete external_dependencies/readiness/blocker
re-stamp the receipt
leave grade=RED
build_certified_record()                      -> COMPILED 1 strategy
```

This is the exact “indicator optional” failure the operator was concerned about: a strategy becomes
less strict by losing the higher-timeframe gate. The plain receipt hash cannot distinguish “this
strategy legitimately requires no dependency” from “a required dependency was omitted before the
receipt was stamped.”

**Required law:** required external dependencies are an independently supplied compile authority,
not a fact inferred from the receipt being checked. The compile seam must compare the receipt with
that authority. A required dependency absent from the receipt refuses even when the receipt carries
a valid newly computed digest.

---

## 3. HIGH — SIX READY WORDS CAN MASQUERADE AS A VALID DEPENDENCY RECORD

`_derived_dependency_blockers()` at `svkm_v2_1_compile.py:256-302` checks container shape and the
six gate values. It does not validate the serialized dependency contract itself.

GPT attached this record to the real nine-node receipt, declared readiness, re-stamped it, and
called the real compile entry point:

```json
{
  "dependency_id": "forged.minimum-record",
  "access_status": "VERIFIED",
  "live_delivery": "VERIFIED",
  "historical_replay": "VERIFIED",
  "update_policy": "VERIFIED",
  "implementation_status": "VALIDATED",
  "semantic_status": "MULTIMODAL_RESOLVED"
}
```

Measured result:

```text
missing consumer_refs
missing provider/artifact/platform
missing display and decision timeframes
missing configuration and output contract
missing dependency contract hash
build_certified_record() -> COMPILED 1 strategy
```

Re-deriving readiness is necessary but incomplete. A record must first prove that it is the complete,
versioned dependency contract whose six readiness facts are being evaluated.

**Required law:** before reading readiness axes, the seam validates the complete serialized record,
recomputes its dependency contract hash, verifies identity/consumers/configuration/output gate, and
refuses missing, extra, duplicate, malformed, or hash-mismatched fields according to a versioned
schema.

---

## 4. HIGH — THE HASH DRIFT ROOT CAUSE IS ACTIVE SET-ORDER NONDETERMINISM

AR-1397 correctly disclosed that the mandatory stamp raised the severity of receipt-hash drift, but
mislocated the root cause in cross-platform float serialization. The immediate cause is earlier and
simpler.

`evidence_relevance.py:118-125` constructs `cond` and `shared` as Python sets, then performs
floating-point sums in set iteration order:

```python
total = sum(weights.get(t, 1.0) for t in cond)
return sum(weights.get(t, 1.0) for t in shared) / total, shared
```

Python deliberately randomizes set order between processes. Floating-point addition is not
associative, so last-bit score differences enter the receipt and change its SHA-256.

GPT ran the unchanged final head four times on the same Linux host, same Python line, same NumPy
version, varying only `PYTHONHASHSEED`:

```text
seed 0   46f018b2c6a73e89f54bf2eec447cf7f50e382bb6c2d68bf5010d0cd127bc21a
seed 1   1271b90b5ecd4314956bbd7c931baa70748998e3a7bc4659f1d28db2894be60b
seed 2   648cedccbb54847b962bc2bbb79c39683da2cd87aadb304c6156c58f71dd8f18
seed 42  c819548d80805d071cef64ee7c2e5716c0f4df9faf5b776debf6748bdb052422
```

This is not latent and not primarily an operating-system issue. The same machine produces four
different “canonical” receipts.

GPT then changed only the two reductions in memory to iterate `sorted(cond)` and `sorted(shared)`.
All four seeds produced the same candidate hash:

```text
a890b406ddd0d41afd3e7cb3d7c1c210fe4ad8dc20213d49fd9abd48ba164c31
```

That value is diagnostic evidence, not a pre-authorized replacement pin. The delivery must generate
and ratify its own new pin after the production fix.

**Required law:** fix nondeterminism where the scores are computed. Do not hide it by rounding only
inside the hash serializer. Sort every unordered collection before a floating reduction that enters
a certified artifact. Add a fresh-process hash-seed matrix. Then perform one explicit, atomic
rebaseline with a semantic-diff receipt proving dispositions, graph structure, condition text,
gates, and compiled behavior did not change.

---

## 5. MEDIUM — THE SHARED GATE AUTHORITY IS PUBLICLY MUTABLE

`GATING_AXES` is a normal module-level dictionary at `source_graph_projection.py:193-197`, and the
projection and seam intentionally share the same object. That prevents copy drift, but creates one
mutable point that can disable both checks together.

GPT executed `GATING_AXES.clear()` and reran the blocked E8 dependency. Measured result:

```text
grade             GREEN_PENDING_CERTIFICATION
compile_readiness READY_PENDING_CERTIFICATION
```

The current tests prove that every key presently in the map is consumed. They do not prove that the
map cannot be emptied or changed at runtime.

Make the shared authority immutable, for example as an immutable tuple of typed axis/value entries
or a read-only mapping. Add a positive control that mutation is rejected and confirm both consumers
still derive from that one immutable declaration.

---

## 6. ARCHITECTURE DECISION — DO NOT ADD HMAC IN THIS CLOSURE PACKET

AR-1397 proposes a keyed HMAC as the fix for deletion plus re-stamping. GPT does **not** authorize
that expansion in AR-1398.

An HMAC answers: “did someone without the signing key edit this receipt after an authorized producer
signed it?” It does not answer: “which dependency was this strategy required to declare?” A buggy
authorized producer that omits the dependency will faithfully HMAC-sign the omission. HMAC would add
secret creation, storage, rotation, test injection, and recovery failure modes without closing the
engineering defect that occurred here.

Use two separate controls for two separate questions:

1. **Plain canonical digest:** accidental post-production byte/content drift.
2. **Independent compile authority:** required dependency identity and contract membership.

Park HMAC/signature work until a receipt crosses an actually untrusted storage or transport boundary,
or a separately ruled threat model requires malicious-editor resistance. Do not turn an internal
compiler-calibration packet into a secret-management project.

---

## 7. WORKER ORDER — AR-1398, ONE BOUNDED CLOSURE PACKET

Do not reopen the video, build Currency Pros access, or redesign the compiler. Deliver one final C0
packet in this order.

### 7.1 RED tests first

1. Fresh subprocesses with `PYTHONHASHSEED=0,1,2,42` must produce byte-identical unstamped receipts
   and one identical canonical hash. The current code must fail this test before the repair.
2. On the real nine-node compile path, an independent authority requiring the E8 dependency must
   refuse a receipt from which dependency/readiness/blocker were deleted and which was re-stamped.
3. A re-stamped record containing only `dependency_id` plus the six satisfying axes must refuse for
   incomplete dependency schema/contract evidence.
4. Mutation of the shared gate-axis authority must raise rather than make the projection green.

### 7.2 Small production repairs

5. Make the `_score()` reductions deterministic by sorting the term sets before summation. Audit
   only the receipt-producing path for the same unordered-floating-reduction shape; do not launch a
   repository-wide numerical rewrite.
6. Add a versioned, immutable compile-authority object mapping every required dependency id to its
   pinned dependency contract hash. The real compile entry must receive/load that authority
   independently of the receipt. An explicit empty authority is allowed for a legacy strategy; an
   omitted/defaulted authority is not.
7. Validate each serialized dependency record completely at the compile seam and recompute its
   contract hash before re-deriving readiness axes.
8. Make `GATING_AXES` immutable while retaining one shared declaration consumed by projection and
   seam.
9. Preserve the current plain digest. No HMAC and no secret surface in AR-1398.

### 7.3 One controlled rebaseline and one grade

10. Regenerate the canonical receipt and all four legitimate pins once, in the same atomic delivery
    commit. Provide an old/new semantic diff. No hand-edited digest-only patch.
11. Run the 105-test C0 suite, 31-test sibling suite, all 24 vertical compile tests, certifier slice,
    `ruff`, and the new subprocess seed matrix. Report exact environment and results.
12. Freeze the delivery SHA, then run one independent adversarial grade against that final SHA.
    No post-grade commits. The grader must replay all four GPT counterexamples and include positive
    controls.

The packet stops when those checks pass. The pre-existing full-engine and `system-map:check` work
remain separately owned; do not mix `src/server/` cleanup into this repair.

---

## 8. BLUEPRINT / TOPSTEP RULING

This packet is useful breakthrough engineering because it converts the operator's correction into a
compiler invariant: a 15m chart may consume a provider-computed 4H Premium/Discount state, and the
strategy cannot trade when that required state is absent or unverified.

It is still **compiler calibration**, not the Blueprint Phase-1 exit. Blueprint v4 section 15.0
requires at least one current Tier-A strategy with every load-bearing condition concretely bound and
the compile-fidelity forensics gate calibrated. After that come Phase 2 battery/walk-forward/Monte
Carlo evidence and Phase 3 paper/shadow parity before Topstep.

Therefore the honest distance is:

```text
local C0 gate        one bounded repair packet from closure
real breakthrough    not yet; no current Tier-A fully-bound exit is proven here
Topstep              later; Phase 1 exit + Phase 2 + Phase 3 still required
```

Use the remaining Claude subscription window to close AR-1398 and leave a frozen, reproducible handoff.
Do not promise Topstep deployment by the subscription date and do not spend the window on HMAC,
another video round, broad intake, or report ceremony.

---

## 9. LOCKS

Until AR-1398 is independently graded and accepted:

- no Stage C1 provider work;
- no Currency Pros purchase, vendor contact, credential request, or access workaround;
- no webhook, external-state endpoint, broker routing, live adapter, or screen-scraping money path;
- no E8 backtest, certification, promotion, PAPER, Topstep, or live execution;
- no invented provider formula or native 4H range selector;
- no broad corpus census, Factory rerun, or 160-video intake; and
- no HMAC/secret-management expansion under this packet.

E8 remains a compiler-calibration source only. It is not selected as the Topstep strategy by this
ruling.

---

## FINAL RULING

**AR-1397 repaired the core fail-closed logic and deserves credit for doing so. It does not close
Stage C0 because the production seam still has no independent knowledge that the 4H dependency is
required; deleting it and re-stamping still compiles, and a six-field imitation of a dependency
record also compiles. The mandatory receipt pin is actively nondeterministic because relevance
scores sum Python sets in randomized order—GPT reproduced four hashes from four `PYTHONHASHSEED`
values on one host and reduced them to one by sorting the two reductions. Do not add HMAC. Bind
required dependency ids and contract hashes to independent compile authority, validate complete
records at the seam, make the shared gate map immutable, fix the unordered reductions, perform one
controlled rebaseline, grade the final pin once, and stop. That is the fastest robust route from the
operator's visual correction back to the Blueprint's real Tier-A compile-fidelity path.**
