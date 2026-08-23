# ALGO-027 — Number collision fixed, SUNSET ORDER accepted, PRIORITY 1 started.

**Strategy head:** `d9fd823c5bf4` · PR #38 **DRAFT / DO NOT MERGE** · semantics NOT started ·
grade still in flight.

## 1. Housekeeping: two files share the number 026

Your **ALGO-026 SUNSET ORDER** landed at `bfc350e6` while I was writing my report, and mine
published to `c524d680` under the same number. Two different documents, one number.

**Yours keeps 026. Mine is renumbered to this packet, ALGO-027.** The ledger law is
last-number-wins, which would have handed 026 to mine — that is the wrong outcome when one of
the two is a ruling and the other is a report, so I am not invoking it. The file
`ALGO-026-TWO-MEASUREMENTS-2026-08-23.md` stays on the branch with its content intact; read it
as ALGO-027's body. Its findings are summarised in §3 below so nothing depends on the filename.

## 2. SUNSET accepted: zero Claude after 2026-08-27

Registered as a hard operating constraint. Any Claude time after the 27th is upside, never a
dependency. Your reprioritization is adopted as written:

- **PRIORITY 0** — the in-flight grade. Unchanged. Still out against pin `4d786333ccee`; the
  mechanism renders late rather than never and I am not calling silence failure a second time.
- **PRIORITY 1** — the **OPERATOR SELF-SUFFICIENCY PACK**, by 2026-08-26 EOD, regardless of how
  far semantics gets. **I am starting it now rather than holding it behind the grade**, because
  it is gate-free, it is the deliverable that survives sunset, and the grade's arrival time is
  not mine to control.
- **PRIORITY 2** — deployment prep, documentation only, no connection.

**On the deadline and the laws:** noted and agreed — it compresses idle time, never
verification. Nothing in the pack ships without the same red-proofs and positive witnesses as
everything else. If I cannot prove a piece of it, it goes in the runbook as an honest gap rather
than a reassuring sentence.

## 3. Your §2.1 (PRIORITY 2) is already delivered — and it feeds §1(c)

I completed the ProjectX prior-art assessment before the sunset order landed. Two results that
change the shape of PRIORITY 1(c):

- **No new adapter is needed.** `current_mnq_strategy_v2_4_shadow_runtime.py` **already imports
  `ProjectXBroker`**, five v2.x modules in total, and `API_BASE` is literally
  `https://api.topstepx.com/api`.
- **But the kill switch is untested.** Only 2 of 13 public methods are exercised by any test,
  and **safety-critical coverage is NONE** — `flatten`, `flatten_contract`, `cancel_all`,
  `cancel_order`, `get_open_position`, `get_open_positions`, `get_working_orders`.

**Your §1(c) asks me to "verify and document" the kill and heartbeat if they exist, or build the
minimal honest version.** They exist and they are unproven. So §1(c) is not documentation work —
it is: prove the flatten/cancel path offline with `FakeSession` tests, then document it. That
answers the question I raised in the previous packet; no ruling needed, and I have taken it as
the answer.

The other ALGO-025 measurement also landed: **09:30 is not one constant** — 30 code sites, four
roles, and the session-open **location anchor** (`kernel.py:132`, feeding
`build_entry_locations_v24`) is a hardcoded literal that a find-and-replace would move silently,
changing which S/R zones exist. The window amendment is a ROLE-1-only change; that hazard is now
pinned by tests so whoever writes the packet — Claude before the 27th or GPT after — cannot
trip on it.

## 4. What I am doing next, in order

1. **PRIORITY 1(c) first**, because it is the one with a measured hole: offline `FakeSession`
   coverage for the safety-critical broker methods, then the kill/heartbeat documentation.
2. **1(a) `ALGO-RUNBOOK.md`** — plain English, non-coder, start/stop/check/kill, what every
   alert means, how to run the 14-case exam and read it.
3. **1(b) self-explanation audit** — presentation only, no semantic change.
4. **1(d) GPT HANDOVER**, addressed to GPT directly.
5. **1(e) seat handovers.**

If the grade lands mid-way it takes precedence and semantics start; the pack resumes
immediately after, because it must exist by the 26th either way.

**No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision
in this packet.**
