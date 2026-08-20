# AR-1383 — WORKER 1 — AR-1376A provenance hardening item CLOSED (raw-to-canonical proof, all three round-2 candidates)

**Date:** 2026-08-20
**Worker branch:** `claude/worker1-h1-20260815`
**Ruling followed:** AR-1376A (`7fe56643c0b1cd1edc51af02e82262917e91aace`) §4.
**Disposition: non-blocking hardening item CLOSED same-round, per §11c zero-carry-forwards. Does not gate or delay the GPT-5.6 semantic audits already authorized and in flight.**

---

## WHAT WAS REQUIRED

AR-1376A §4 found that `7ieYBa7Z-Hg`'s raw Opus response SHA (`0f76914b...`) differs from its frozen candidate SHA (`c253de8f...`), traced to the freeze script's `json.loads` → `json.dumps(indent=2, ensure_ascii=False)` re-serialization. GPT ruled this is very likely pure formatting normalization, not a semantic alteration — but required it be **proven**, not merely asserted, before any round-2 survivor may advance past semantic audit to certifier/compiler: no duplicate object keys, a duplicate-key-rejecting parse succeeds, and canonical re-serialization of the parsed object exactly equals the frozen bytes, for all three cases.

## PROOF (MEASURED HERE, `scripts/_worker_raw_to_canonical_proof.py`)

| video_id | duplicate keys | raw SHA == frozen SHA | canonical re-serialization == frozen bytes |
|---|---|---|---|
| `E8Wg6tFPYjo` | none | `True` (byte-identical) | `True` |
| `7ieYBa7Z-Hg` | none | `False` (formatting differs) | `True` |
| `1HFoStW_wsc` | none | `True` (byte-identical) | `True` |

For `7ieYBa7Z-Hg` specifically: `json.loads` with an `object_pairs_hook` that raises on any repeated key succeeded without error (confirms no duplicate keys), and re-serializing that parsed object with the exact transformation the freeze script uses reproduces the frozen `fresh_source_candidate.json` byte-for-byte. This proves the raw/frozen SHA divergence is confined to whitespace/formatting (the fresh Opus reader's own JSON likely used different indentation or key spacing) and carries zero semantic difference — not an assumption, a direct byte comparison.

Proof artifact: `docs/replay-results/gpt-engineering/opus-transcript-first-diagnostic/reconstruction-round-2-fresh-opus/raw-to-canonical-provenance-proof.json`.

## DISPOSITION

Closed same-round. This does not touch, delay, or gate the three GPT-5.6 semantic audits already authorized by AR-1376A §5 and awaiting the controlling GPT-5.6 Sol seat — those remain the next money-path action, not this worker's. This closes the one open item standing between a future clean survivor and certifier/compiler eligibility, so it doesn't become a later carry-forward.

## PEER HANDSHAKE DEVIATION (carried forward)

Worker 2 remains reported closed for this session; continuing without the worker-onboarding §2b HELLO/ACK exchange per operator instruction.
