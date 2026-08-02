# External GPT Advisor Response — AR-552 Manifest Closeout

**Date:** 2026-08-01  
**Object reviewed:** closeout commit `05bea4e5`; packet blob `619419dc42a4be88a889fe8ca1247e6c9008fc0b`; ledger blob `1551c7e56480caff7d70a580e1f7a2c7ef644203`  
**Decision:** **REVISE. Preserve P1/P2's substantive 301-cell closure, but do not ratify the broader claim that the complete manifest is guarded. One excluded-namespace false green remains. P0-vNext design may continue; implementation remains held.**

## 1. What independently reproduces

I ran the shipped verifier from the worker's recorded scratch path against the campaign tree.

```text
LEDGER INTEGRITY [clean control]: PASS (301 cells, 0 checks failed)
LEDGER INTEGRITY [NOOP: clone]: PASS
LEDGER INTEGRITY [NOOP: clone + reseal]: PASS
LEDGER INTEGRITY [NOOP: cells reversed (order is not content)]: PASS
clean control: PASS | noop controls GREEN: 3/3
ALL CASES DISCRIMINATE: True (31/31 mutants caught)
CLEAN_EXIT=0
```

The binding no-data-movement constraint also holds by an independent byte-level path:

```text
f362a80b:docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json
  -> blob 1551c7e56480caff7d70a580e1f7a2c7ef644203

05bea4e5:docs/designs/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json
  -> blob 1551c7e56480caff7d70a580e1f7a2c7ef644203
```

The tag also peels correctly:

```text
p1p2-frozen-source-universe-c304b098^{}
  -> c304b098b156106a5a81b714c7a5a3ed166d68ef
```

Therefore AR-552 is sound about the 31 registered mutants, the three no-op controls, the clean baseline, the tag, and the unchanged ledger bytes.

## 2. Novel false green — the excluded `digests` namespace is open

The packet's `canon_sha()` deliberately excludes the entire `digests` object (`P1-P2-TRUTH-FREEZE-PACKET-2026-07-31.md:582-597`). The new guard then checks the canonical digest plus only three named sibling fields (`:653-669`). It never asserts exact membership of the `digests` object.

I planted a new human-facing certification inside that excluded object without changing or resealing anything else:

```python
doc["digests"]["human_facing_certification"] = (
    "ALL VALUES IN THIS LEDGER ARE DESK-VERIFIED"
)
ok = check(doc, "NOVEL: unknown human claim added inside excluded digests object")
```

Measured result:

```text
DIGEST_KEYS_BEFORE ['canonical_document_sha256', 'cell_id_set_sha256',
                    'digest_definition', 'row_universe_sha256']
LEDGER INTEGRITY [NOVEL: unknown human claim added inside excluded digests object]:
  PASS (301 cells, 0 checks failed)
NOVEL_CHECK_RESULT True
ATTACK_EXIT=0
```

This is the same pattern AR-552 was meant to close: a human-readable claim can be added to a namespace outside the hash and the verifier reports green. The 31/31 result proves those 31 fixtures and nothing outside them.

The join key is exact: the planted field lives at `ledger.digests.human_facing_certification`; `canon_sha()` drops its parent object at packet line 591; the direct comparison loop enumerates only `row_universe_sha256`, `cell_id_set_sha256`, and `digest_definition` at lines 667-669. No executed path reads the planted key.

## 3. Required correction — close the object as a schema, not another field list

Do not add `human_facing_certification` to the list. That would close one fixture and preserve the class.

The property is:

> `doc["digests"]` and independently regenerated `exp["digests"]` have exactly the same key set, in both directions, and every value agrees.

Implement an exact-object comparison or an explicit bidirectional key-set comparison followed by value comparison. Retain the existing self-consistency check because it catches the distinct un-resealed adversary.

Acceptance must include:

1. clean control PASS;
2. all prior 31 mutants RED;
3. all three no-op controls GREEN;
4. added unknown digest key RED, naming the unexpected key;
5. deleted digest key RED, naming the missing key;
6. changed known digest value RED;
7. ledger blob still exactly `1551c7e56480caff7d70a580e1f7a2c7ef644203`.

Stop if the repair changes any ledger byte or widens into another census.

## 4. Architecture disposition

- **P1/P2 substantive truth membership:** preserve as closed. This attack changes neither the 43-row denominator nor any of the 301 cells.
- **R-524 §3 manifest closeout:** not closed yet. The data is protected, but one excluded report namespace still accepts arbitrary claims.
- **P0-vNext design:** continue. This finding should strengthen the design rule from “compare named digest fields” to “reject unknown or missing fields at every authority boundary.”
- **P0-vNext implementation:** remain held pending external review of the design, as already ordered.
- **P3 / Gate B / merge / deploy / release:** unchanged hold.

The missing START-RECEIPT is a real protocol miss but is not the basis of this technical decision; it cannot be repaired retroactively.

## 5. Residual scope

The current verifier is an embedded Markdown listing that imports `gen_p1p2` from a session-temporary scratch path. It is executable today because that path still exists, and the packet preserves the generator text, but it is not yet a standing repository/CI guard. Treat AR-552 as a closeout proof recipe, not continuous enforcement. P0-vNext must make the exact-schema and cell-derived checks part of the durable consumer rather than relying on this session's scratch module.

> `EXCLUDING AN OBJECT FROM A HASH REQUIRES CLOSING THE OBJECT'S KEY SET, NOT NAMING THE FIELDS YOU HAPPEN TO KNOW TODAY.`

> `A 31/31 MUTATION SCORE PROVES 31 REGISTERED SHAPES. THE NOVEL HUNT IS WHAT TESTS THE CLAIM'S BOUNDARY.`
