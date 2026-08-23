# ALGO-031 — ALGO-030 ratified. One added order: HARDEN `flatten()`/`cancel_all()` — a failed close must never abandon the rest. The loudest runbook line becomes code.

**Advisor:** Claude (Fable 5), ALGO seat. **Head at ruling:** algo branch `6bc7f93c`
(ALGO-030) [MEASURED, fetch]. **PR #38: DRAFT / DO NOT MERGE — unchanged.**

## 1. ALGO-030 ratified in full

Item 3 done (0/7 → 7/7, and it PROVED rather than documented — the defect it found is exactly
why). Item 6 1(a)+1(c) done — a runbook that leads with what does NOT exist, and a test that
runs every command the book documents, are both adopted as the standard ("a CLI is only proven
by running the CLI"). Item 1's derivation-layer start is exactly the ALGO-009 §6 shape: the
spec's SIX interactions named verbatim-pinned, APPROACH computed with the inside-the-band
subtlety, the classifier's distant-wick fix, and the fixture-was-wrong concession all correct.
Items 4/5 after the state machine — approved as sequenced. Publishing-and-continuing was right.

## 2. NEW ORDER — the flatten defect gets FIXED, not documented

ALGO-030 item 3 measured: **a rejected close aborts `flatten()` mid-loop and leaves later
positions open; `cancel_all()` shares the shape.** Under the post-sunset run-only law, a
procedure ("re-run, check by eye, close in the app") is a permanent operator burden for a
five-line code property. Order:

- `flatten()`, `flatten_contract()`, `cancel_all()` attempt EVERY position/order, collect
  failures, and raise at the END with a complete per-item report — never abort mid-loop. The
  emergency path's property: one rejection may not shield the rest of the book.
- Red-proof with the existing `FakeSession` arms: plant a mid-list rejection → all remaining
  items still attempted, the raise names exactly the failed ones; no-failure arm byte-identical
  behavior. Offline only; nothing connects; the §2.2 hard gate travels inside.
- The runbook's loudest line then updates to the honest residual ("if flatten reports failures,
  those named positions need the app") — a smaller, truer warning.

This is broker-adapter code, not strategy semantics — no gate applies beyond the standing
red-proof laws. Slot it inside Priority 1(c)'s scope; it should cost minutes at the current
pace.

## 3. Position acknowledged for the operator's distance question

Of the DONE checklist: items 3 and 6(a,c) DONE · item 1 in progress (derivation layer first
piece landed; story layer → four-route state machine → §7 mutation campaign remain) · item 2
gated on the finished brain · items 4/5 queued after the state machine · grade still out,
silence ≠ failure. The remaining distance to the breakthrough IS the brain: story layer + state
machine + mutation kills + the exam.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this ruling.
