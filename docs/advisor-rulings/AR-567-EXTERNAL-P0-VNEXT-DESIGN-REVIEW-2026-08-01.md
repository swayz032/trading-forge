# External GPT review — `P0-vNext` design after `AR-566` / `AR-567`

**Reviewed object:** campaign commit `a6a52f6b5244cc8bfe4add23f7d1d469d85fa353`, design blob `429e1ced730f396d005172242d84da942b03906b`, SHA-256 `85863baddab45415bf2c2346add0b589e8b176bb4efb07f3d817015adf1873b7`.

**Newest worker report read before publication:** `AR-567`. Its consumer-binding correction is present in the reviewed object and is sustained.

**RULING ID / TASK ID / DECISION:** external review of `AR-566` plus `AR-567` · **REVISE**. Keep implementation blocked. The design now has a materially better proof matrix and the caller-side scope escape is closed, but Claim A and Claim B are still not type-separated for two axes, the one mapping declared unknown is already knowable from the pinned source, and the Phase-1 refusal names the wrong missing artifact.

The useful architectural result is sharper than “no profile exists”: **this `P0-vNext` frame is a parity-fixture instrument, not a Phase-1 admission frame.** Blueprint v4 does not need a wholesale rewrite. Its Phase-1 path needs an explicit two-surface split: preserve this gate as a prerequisite over the 12 parity fixtures, and build the eventual compile-fidelity/admission gate over the actual Tier-A population.

## Claims verified

- **[MEASURED HERE, campaign tree, commit above]** `AR-567` replaced the unsafe “narrow and print” permission with a consumer contract binding `consumer_id`, required claims, `scope_id`, and digest. The old sentence is absent and the new binding is present.
- **[MEASURED HERE, campaign tree]** §10 contains 22 attacks plus one unmutated control. Every row names a catcher, including the same-wrong-value-in-both-lanes attack required to separate agreement from frozen-ledger conformance.
- **[MEASURED HERE, campaign tree]** §2 names the projected wire paths for all seven axes and distinguishes `MISSING` from JSON `null`.
- **[MEASURED HERE, campaign tree]** The refusal `NO SOUND PHASE-1 PROFILE AVAILABLE` is correct **for this 12-fixture / 301-cell frame**. No declared cross-population join key exists. Reproducing the worker's exact-name comparison as `ledger.fixture ↔ tier-a.specs[].stub` yields zero overlap; that proves the names/populations differ, not that the Tier-A population lacks an enumerator.
- **[MEASURED HERE, Blueprint v4]** Phase 1 still requires at least one Tier-A spec with all load-bearing conditions concretely bound plus calibrated compile-fidelity forensics. A green over synthetic parity fixtures cannot satisfy either leg.

## F-1 — two “axes” are not projected values; they are predicates whose operands come from Claim B

The ledger’s asserted values establish the type mismatch:

| axis | asserted cells | ledger value type / examples |
|---|---:|---|
| `reason_names` | `4` | strings: `lunch_blackout`, `overnight` |
| `reason_excludes` | `4` | string: `session_zone_refused_uncomputable_window` |

But design §2 calls their normalizations a “substring/zone-naming predicate” and an “exclusion predicate.” Those predicates return booleans; §3 says Claim B compares the projected value with `cell.value`, which is a string. Both statements cannot be implemented literally.

The pinned gate shows why this happened. At `c304b098`, `checkOracle()` does not project either axis. It reads the oracle operand directly:

- `reason_names`: `got.reason.includes(want.reason_names)`;
- `reason_excludes`: reject when `got.reason.includes(want.reason_excludes)`.

That is valid as **Claim B evaluation**, but it is inadmissible as **Claim A projection** because `want.*` comes from the ledger being judged. If Claim A computes a boolean using `cell.value`, agreement is no longer independent of conformance; changing the frozen expectation changes what the two lanes are said to “agree” about.

**Required split:**

1. `project(lane)` reads only the lane and a frozen, ledger-independent normalization contract. For all three reason axes it must retain `MISSING` / `null` / canonical reason string. Claim A compares that projection between TS and Python.
2. `evaluate(cell, projection)` runs only for Claim B. `reason_null` compares the derived nullness boolean; `reason_names` applies the ledger string as a required substring/zone token; `reason_excludes` applies it as a forbidden substring.
3. Claim A must not read `cell.value`, `authority_citation`, or any oracle expectation.

Add a pre-registered mutation specific to this boundary: change only one asserted `reason_names` or `reason_excludes` ledger value while lane outputs remain fixed. Required result: Claim A’s projection and verdict are byte-identical; Claim B alone changes and names the cell. Also run the same-wrong-reason-in-both-lanes attack so Claim A stays green while Claim B goes red. Without both directions, §10 row 3 can pass while the claims still share a hidden input.

## F-2 — the declared-unknown TypeScript source-to-wire map is present in the pinned executable source

Design lines 73 and 233 call the TS-source-field ↔ wire-name mapping unknown. **[MEASURED HERE, pinned object `c304b098`]** it is explicit:

| TypeScript source field | projected wire key | executable source |
|---|---|---|
| `bindable` | `bindable` | `BINDING_KEY_MAP`, lines 259–270 |
| `primitive` | `primitive` | same |
| `approximation` | `approximation` | same |
| `reason` | `reason` | same |
| `sessionZone` | `session_zone` | same |

`projectExhaustively()` at lines 285–338 checks the raw and mapped key sets in both directions, and `tsBindingPlanAsPyShape()` at lines 349–359 applies that mapping. Python’s `ConditionBinding` and `to_dict()` at `spec_family_bindings.py:407–430` emit the corresponding snake-case keys directly.

This is not an admissible unknown. It is a one-file-short read. Freeze the mapping in the design, including the Python source fields and `to_dict()` wire names, and bind the implementation to it. The existing “change a path or normalizer” proof should attack this table, not a newly invented surrogate.

## F-3 — the Phase-1 refusal is right, but the named unblocking artifact already exists in structural form

**[MEASURED HERE, campaign tree]** `docs/replay-results/h1-battery/tier-a-compile-census.json` is committed and contains:

- `11` selected specs with `11` unique `stub` identities;
- `99` condition rows;
- `53` rows marked `load_bearing_spine=true`;
- all `11` specs carrying at least one such row;
- a selection rule and per-spec/condition provenance fields.

That is already an artifact that structurally does the two things design line 127 says are missing: enumerate Tier-A specs by identity and mark their load-bearing conditions. Its freshness and semantic authority are **not established by this review**, and its own `extraction_source` points at a historical sealed-read surface. It therefore cannot simply be promoted to the Phase-1 denominator. But “author an enumerator” is no longer the missing step.

The actual missing object is a **current, authority-ratified Tier-A compile-fidelity membership/conformance surface** (or an independently approved mapping into one), keyed at least by:

`tier_a_spec_id × condition_id × required fidelity axis`, with exact current spec hashes, load-bearing membership, authority citations, and a consumer profile frozen before results.

The current P0-vNext ledger cannot supply that object: its universe is 12 synthetic parity fixtures and 43 rows. The Tier-A universe is 11 real strategy specs and 53 load-bearing conditions. Zero filename/stub overlap is evidence that these are different populations, not evidence that the Tier-A population lacks an enumerator.

**Blueprint v4 consequence:** retain P0-vNext as a parity-instrument prerequisite. Amend the Phase-1 plan to name a separate Tier-A fidelity gate after the current-baseline/truth freeze. Do not manufacture a join from parity fixtures to Tier-A specs, and do not call P0-vNext Claim B compile fidelity.

## F-4 — correct the proof-matrix caption

`AR-566` calls the table “23 mutations.” Section 10 has 23 numbered rows, but row 23 is the clean control: **22 mutations and one clean control**. The matrix size is 23; the mutation count is 22. Correct the report/design caption so the control is not rhetorically converted into an attack.

## Evidence independently checked / tests rerun

- The reviewed design path is clean at `a6a52f6b`; `git hash-object` returns the blob above and the working file SHA-256 is recorded above.
- Parsed the 301 ledger cells independently: seven axes × 43 rows; `reason_names=4 ASSERTED`, `reason_excludes=4 ASSERTED`, with the values shown above. Positive control: `reason_null=29 ASSERTED` and its values are booleans, proving the axis/value extraction was live.
- Opened the pinned TypeScript and Python executable lines quoted above; no comment-only inference is used.
- Parsed the Tier-A census and recomputed `11` specs, `99` conditions, and `53` load-bearing rows from member records rather than trusting summary captions.
- Parsed the ledger’s 12 fixture names and compared them with the 11 Tier-A stubs. Exact intersection is empty; positive control: all 301 ledger cells resolve to one of the 12 ledger fixture names.
- No implementation exists, so no runtime suite can yet prove the proposed gate.

## Architecture invariants touched

- Claim A agreement must be independent of Claim B’s expected values.
- Parity agreement, frozen-ledger conformance, authority correctness, and Phase-1 compile fidelity are four different claims.
- A profile is valid only for the population whose identities it actually contains.
- A prerequisite closing is not Phase 1 exiting; Phase 1 exiting is not a trading-ready strategy.

## Failed or unproven conditions

- Projection/evaluation separation is not yet specified for `reason_names` and `reason_excludes`.
- The TS/Python source-to-wire mapping is not yet carried into the design, although it is measurable.
- No current authority-ratified Tier-A fidelity ledger/profile exists in the reviewed object.
- The 140 parity-ledger values remain authority-semantics-unverified; 14 cells remain agreement-only.
- CI execution and all implementation behavior remain unproven.

## Required corrections / files and scope allowed

**Design only:** revise `docs/designs/P0-VNEXT-DESIGN-2026-08-01.md`, the normal worker report, and a narrow Blueprint-v4 Phase-1 addendum or table correction if the main advisor chooses to carry the two-surface split there. Do not implement P0-vNext yet. Do not edit the ledger, oracle, Tier-A census, engine, database, Gate B, deployment, or runtime lanes in this correction.

## Acceptance commands / observable checks

1. The design contains separate `project(lane)` and `evaluate(cell, projection)` contracts; a structural sweep proves Claim A reads no ledger/oracle expectation.
2. The two reason-string mutations described in F-1 are pre-registered with named catchers and a clean control.
3. The five TypeScript/Python source-to-wire mappings above are enumerated from the pinned source and no longer labelled unknown.
4. Phase-1 text says the existing Tier-A census is a historical structural enumerator, while the missing artifact is current authority-ratified Tier-A fidelity membership/conformance—not another parity-fixture profile.
5. The proof caption says `22 mutations + 1 clean control`.

## Stop condition

If Claim A requires `cell.value` or another expectation from the ledger/oracle, stop: agreement has been coupled to conformance. If a Phase-1 profile must map synthetic fixture identities to Tier-A identities without an independently authorized join, stop: the gate is measuring the neighbouring population.

## Lesson to persist

> **A predicate’s operand is part of its authority.** If “projection” needs the expected answer to decide what to project, agreement has already consumed the oracle.

> **A test corpus can certify an instrument; it cannot become the production admission population by acquiring a profile name.**

**External recommendation:** sustain AR-567’s consumer binding and AR-566’s improved mutation matrix, revise the three boundaries above, and keep implementation blocked pending another exact-object review.
