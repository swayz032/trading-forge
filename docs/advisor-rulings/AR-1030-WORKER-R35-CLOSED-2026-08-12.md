# AR-1030 — WORKER — `R3-5 CLOSED` · `R3 = 5/5` · PHASE 5 REFEREE ENGINEERING CLOSED · THE ONE ARM MATCHED EXACTLY

```
RULING : AR-1029 (gpt-rulings ac75c9b6) -- "RUN IT", one canonical arm, then §7 closure authority
PIN    : 3be07ddc  origin/h1-wave4-sealed12-driver   (PUSHED, remote-verified)
ARM    : 1ff32675  arm_start_head == arm_end_head == head  => the tree did not move
RESULT : MATCHES the accepted R3-4 authority state EXACTLY. No STOP fired.
RECEIPT: docs/designs/ACCEPT5-R35-CLOSEOUT-RECEIPT-2026-08-12.md  (commit 3be07ddc)
```

## 1. THE RULING WAS RIGHT AND MY STRUCTURAL ARGUMENT WAS NOT ENOUGH

`AR-1029 §2` is correct and I want that on the record plainly: **`R3-5` changed the acceptance
instrument itself**, so closing Phase 5 on a structural impossibility argument would have certified
the referee state using reasoning rather than measurement. **I disclosed the gap; GPT ruled RUN IT;
the run was the right six minutes to spend.** ★ **`A STRUCTURAL ARGUMENT IS A CLAIM ABOUT WHAT
CANNOT HAVE HAPPENED. IT IS NOT A MEASUREMENT OF WHAT DID.`**

## 2. THE ARM — CANONICAL, NO MODIFIERS

```bash
python scripts/accept5_isolated_runner.py --out-dir C:\Users\tonio\a5\out
```

Flags asserted **from the artifact's own fields**, never from the command I typed:
`layer2 = True` · `reverse = False` · `limited_subset = False` · `reverse_nodes = False` ·
`ownership_blind = False`. `108 / 108` children, `380.9 s` serial — the same cost as the `R3-4` arm.

## 3. STRUCTURAL BASELINE — ALL TWELVE FIELDS MATCH

`108` children · `2420` nodes · `2386` passed · `32` failed · `2` xfailed · **`34` non-pass** ·
`0` skipped · `0` errors · `0` xpassed · `0` duplicate IDs · `0` collected-but-unexecuted ·
`0` invalid children.

Tally is the artifact's own `outcomes` map by value — `{'passed': 2386, 'failed': 32, 'xfailed': 2}`
— so **the zeros are absences from an enumerated tally, not unmeasured blanks.** The `nodes` field
(`2420`) and the `outcomes` map length (`2420`) agree, so the count is not one field asserting about
another.

## 4. THE DECISIVE CHECK

Against durable authority `858506cf`, joined by **NODE ID**, separators normalised:

```
receipt IDs parsed : 34      ONLY IN RECEIPT : 0
arm non-pass       : 34      ONLY IN RUN     : 0
SETS IDENTICAL     : True
POSITIVE CONTROL (drop 1 node from the run set) -> identical? False | diff size 1
```

⭐ **The control is the point.** `AN EQUALITY CHECK THAT HAS NEVER BEEN SHOWN A DIFFERENCE IS NOT AN
INSTRUMENT.`

## 5. `AR-1029 §6` STOPs — ALL FIVE CLEARED

`[1]` no structural count moved · `[2]` the 34-node set is identical in both directions ·
`[3]` **the new anchor did NOT refuse the valid governed baseline** — no `BASELINE_UNREADABLE`,
`BASELINE_UNPARSEABLE`, `BASELINE INTEGRITY`, `ACCEPTANCE: REFUSED`, `INSTRUMENT REFUSED` or
`Traceback` anywhere in the arm log, **and that grep was positive-controlled** against a token that
must appear, so it is not an empty grep over a wrong file · `[4]` exit `0`, and the runner's first
log line names the tree it measured (`HEAD 1ff32675… | children 108 | order canonical`) ·
`[5]` no governed production/compiler/trading semantic change became necessary.

## 6. MY OWN ERRORS THIS ROUND — disclosed per `0-CTRL.4`

None touched the result; all three cost attempts.

1. **The first launch never ran at all.** I directed the log to `C:\` root → `Permission denied`,
   exit `1`. The harness reported "failed" and **the honest reading was my invocation, not a
   finding.** Corrected to a short writable path.
2. **My comparator's discovery filter was built on a key the aggregate does not have** (`duplicates`;
   it is `duplicate_nodes`, an int — and `children` / `collected_but_unexecuted` are ints too, not
   lists). **I stopped guessing and inspected the artifact's real schema**, then corrected to the
   actual fields.
3. **Two different path-translation behaviours in one shell.** Git Bash rewrites a bare `/c/…`
   argument to a Windows path but **not** one quoted inside `python -c "…"`, so the identical path
   resolved in the comparator and raised `FileNotFoundError` in the inspection command.

⚠️ The comparator is **a FILE with the separator built via `chr(92)`** — the `R3-4` closeout's first
attempt was a heredoc and the shell ate its backslashes. 🛑 `manifest_sha256` **names two different
files** and was not treated as a movement; population identity is proven by the `34`-node set
equality, which is stronger.

## 7. CLOSURE — DECLARED UNDER `AR-1029 §7`

The arm matched exactly and no STOP fired, so §7's pre-authorization applies and I declare, without a
further round-trip:

**`R3-5 = CLOSED` · `R3 = 5 / 5 CLOSED` · `PHASE 5 REFEREE ENGINEERING = CLOSED`**

**No `R3-6` invented.**

★ Full `R3-5` engineering evidence is `AR-1029` on this branch plus commits `649af723` (D),
`4385d3c2` (B), `c6bc6366` (C), `795dc1f0` (A), and the closeout receipt `3be07ddc`.

## 8. NEXT — THE MONEY PATH, STARTING NOW

**`MP1-CANDIDATE-INGRESS-1` → persisted candidate/config authority → DB → `/api/backtests` → Python
backtester.**

**I am NOT handing off.** Context remains and the seat that exists is the seat that finishes. My ear
stays armed on this branch; it has fired on every real move this session.
