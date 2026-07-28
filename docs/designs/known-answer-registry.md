# Known-answer registry (R-321 §2)

Cases whose truth was fixed by **independent measurement**, kept so any future
instrument can be checked against an answer it cannot reproduce by sharing the
same bug.

> **THE BEST CONTROL IS A CASE YOU ALREADY ANSWERED BY ANOTHER METHOD.** Stronger
> than a synthetic fixture, because its truth came from a different instrument.
> A synthetic fixture tests whether the code does what you just wrote; a
> known-answer case tests whether it agrees with reality as measured elsewhere.

Each entry records the value, how it was established, and the date. **Add one
every time a measurement lands** — each addition makes the next census cheaper
and harder to fool.

| # | Case | Answer | How it was established | Date |
|---|---|---|---|---|
| 1 | `session_windows.py` ↔ `killzone.ts` parity | **0 mismatches / 40,782 comparisons** | 5,826 UTC instants over 4 ET days incl. both DST transitions, second-level probes at all 18 boundaries; TS side by importing the real module; red-proved by ±1-minute boundary shifts (8 and 6 mismatches) | 2026-07-28 |
| 2 | `scheduler.ts` `withRetry` job count | **108** | regex extraction cross-checked against the `scheduler_jobs` union in `system-subsystem-registry.json` — 108/108, orphans 0, vanished 0 | 2026-07-28 |
| 3 | `playbook_router.py` `ALL_STRATS` | **174** (wave-4 worktree) / **181** (`runtime-production`) | Python import vs TS scrape, both diffs empty, on both checkouts | 2026-07-28 |
| 4 | `h1-sealed-read-frozen` MANIFEST | **275/275 match** | sha256 over the **committed blobs** (`git show HEAD:<path>`), not the working files; `* -text` proven in force via `git check-attr` | 2026-07-28 |
| 5 | Population-A de-approximated kinds | `named_sr_level`, `order_block_edge` | the existence proof that refuted the "approximate by nature" framing challenge | 2026-07-20 |
| 6 | Style C TS ↔ Python exit parity | enforced via **14 shared fixtures** | `style-c-exit-evaluator-parity.test.ts` and `tests/test_style_c_parity_2026_06_29.py` run the SAME fixture file through both engines | 2026-07-28 |

## How to use an entry as a control

1. Pick the entry your instrument *should* get right.
2. Assert the instrument's output on it **before** reading any other result.
3. Print `INSTRUMENT DEFECTIVE` and refuse to publish while it disagrees.

Worked example — the `mirrors` disposition (AR-304) used entry 1 and caught
**three** extractor defects it would otherwise have shipped: first-match referent
grabbing the file's own name, a test-file selector admitting `backtester.py` by
substring, and ruff lint codes read as referents.

## Caution: an entry constrains only what it measured

Entry 1 says the two implementations **agree**; it does not say the 18 boundary
minutes are correct against any external ICT source. Entry 6 says both engines
run the same fixtures; it does not say the fixtures' expected values were derived
independently of either engine. **Scope each control to the claim it actually
settled** — a known-answer case used past its scope is just another unverified
premise wearing a measurement's authority.
