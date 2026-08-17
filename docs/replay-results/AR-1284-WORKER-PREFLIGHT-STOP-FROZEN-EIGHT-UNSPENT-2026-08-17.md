# AR-1284 — WORKER-1 PRE-FLIGHT STOP. FROZEN EIGHT UNSPENT (0/8). ZERO CALLS.

**Date:** 2026-08-17
**Worker:** worker-1 · lane `compiler-factory`
**Worktree:** `C:\Users\tonio\Projects\wt-claude-worker1-20260815`
**Branch / head:** `claude/worker1-h1-20260815` @ `96aefd4e9e82b2fe7a6d9c18877174d81f51bc7b`
**Ruling executed against:** AR-1283A @ `81c9ca1c` (`advisor-reports/AR-1283A-…-2026-08-17.md`)
**Outcome:** 🛑 **STOP — CONTRADICTION FOUND AT PRE-FLIGHT. NO AGENT/MODEL CALL WAS ISSUED.**

---

## 0. HEADLINE

AR-1284 §A's mandatory preflight **PASSES CLEANLY on all six fields**. The queue is intact and
every one of the eight attempts is unspent.

**I did not proceed to §B.** Three independently-measured facts mean the frozen-eight spend cannot
be executed *from this seat* under the law AR-1284 itself imposes. Per §0-CTRL.1 and AR-1284 §B
("if there is a mechanical dispatch/persistence anomaly suggesting the infrastructure itself is
unhealthy, STOP **before** burning additional unclaimed conditions"), I stopped before call 1
rather than discovering the problem after an irreversible spend.

```text
frozen queue state   BEFORE = 8 queued / 4 excluded / 0 claimed / receipts + 0
frozen queue state   AFTER  = 8 queued / 4 excluded / 0 claimed / receipts + 0
agent/model calls issued    = 0
one-shot calibration spent  = NO
```

---

## 1. §A PREFLIGHT — PASS, ON THE CANONICAL INSTRUMENT

Two instruments were run. `scripts/g2d_real_queue_preflight.py` prints its **own** field names
(`queue_count`, `ready`), which are *not* the names AR-1284 §A enumerates. So I additionally ran
`isolated_dispatch.preflight_real_queue()` — the function whose field names the ruling's wording
is taken from. Both agree.

```text
queued_count                       = 8            ✓ (§A requires 8)
excluded_count                     = 4            ✓ (§A requires 4)
claimed_refs                       = []           ✓
unclaimed_refs                     = all 8 frozen refs   ✓ (set-equality with queued_refs: True)
crash_shaped_refs                  = []           ✓
ready_for_dispatch                 = True         ✓
attempts_claimed_by_this_preflight = 0
queue_artifact_sha256              = 5935b1c6c03860b35e2aee9023f2c70c4630d2e75ef9bfa496024bb2b7efa939
```

Direct artifact read (the preflight script does not print `excluded_count`, so it was verified by
key, not by the query that selected it): `excluded` holds exactly 4 rows, all
`ACCEPTED_PENDING_CERTIFICATION`; `attempts = {}`; `max_attempts_per_condition = 1`; 8 + 4 = 12,
matching `derived_from.condition_count = 12`. The known cross-role pair
(`entry_sequence[1].action` ↔ `confluences[1].description`) is present as AR-1283A §1 describes.

**§A is satisfied. The blockers below are NOT §A field mismatches** — they are properties of this
*session*, which §A does not measure.

---

## 2. THE THREE BLOCKERS (each measured here)

### B-1 — `Agent` → `PreToolUse` traversal is STILL UNPROVEN, and this is the decisive one

AR-1272 §F-2 left this open and it has not been closed since. `claude-hook-bridge.mjs:239-272`
makes the subagent path fail-closed **if the hook fires**; but an ALLOWED call is consistent with
both *"the guard ran and permitted it"* and *"the hook never fired for `Agent` at all."* The guard
computes a per-call `_audit` record and then `delete copy._audit` discards it, so no log can settle
it retrospectively.

Why this is disqualifying *specifically* for AR-1284: the claim is written by the **guard**, not by
me (`g2d_precall_transition.py`: *"invoked by the pinned G2 pre-call guard, not by hand"*). So if
the hook does not fire, my Agent call dispatches a real Opus subagent with **no `.attempt`, no
`.dispatch` receipt, and no ledger entry** — an unbudgeted, unrecorded call. That is precisely the
failure the claim-before-call law exists to prevent, and it is unrecoverable: a call that may have
been delivered must never become repeatable.

I did **not** run the one discriminating test (forcing a DENY on the Agent path). Every variant is
either a second calibration call or a G2-shaped dispatch, and AR-1284 authorizes agent invocation
**only** for the eight frozen entries. Proving the control plane is not within my authorization,
and being wrong by one step would irreversibly spend a frozen attempt.

### B-2 — `strict_session: false`; the execution session's own precondition is unmet, and I cannot arm it

`.claude/worker1-hook-guard-manifest.json` → `g2_precall`:

```text
enabled        = true
strict_session = false
```

with the manifest's own explanation: strict mode is armed *"for the **DEDICATED eight-call
execution session only**, where every Agent/Task dispatch requires a permit and ordinary helper
work is simply not allowed. **This packet is not that session** … Flipping this to true is a
deliberate act for the execution session, not a default."*

Arming it means editing that manifest — which is **self-protected and never scope-overridable**
(AR-1263 §7A): *"a worker must never gain permission to edit the file that declares its own
permissions."* `.claude/` appearing in `edit_scope.allowed_prefixes` does not help; self-protection
is evaluated first. **I cannot self-authorize the session shape AR-1284 presumes.**

### B-3 — the frozen prompt bytes are unobtainable in this seat

The Agent call must carry the exact frozen prompt, hash-matched by the guard against
`native_call_manifest_t1.json` (`native_call_sha256` over `{model, subagent_type, prompt}`). The
only sanctioned emitter is `scripts/g2d_freeze_native_calls.py --emit-prompt`, and **the Bash fence
denies it as a protected surface** (measured — denial text: *"the freezer of the native-call
execution identity"*). This is AR-1272 §F-1 recurring exactly as that report predicted: *"a ruling
that says 'run this Bash to snapshot the queue' would be unexecutable. Worth knowing before the
eight-call session is written."*

Reconstructing the prompt by hand is not an option I will take: it is precisely what the freezer
exists to prevent, and CRLF translation has **already** silently corrupted this exact path once
(documented at `g2d_freeze_native_calls.py:206-213` — 25,948 chars in, 25,963 bytes out, invisible
because the Python round-trip normalised it back).

**I did not route around any of this.** The unguarded `PowerShell` tool (AR-1272 §F-5, outside the
`PreToolUse` matcher) would likely have executed the fenced script. Using a reported coverage gap
to bypass a guard that is correctly refusing me would destroy the credibility of this report.

---

## 3. THE SEVEN PRE-FLIGHT QUESTIONS (§0.-2)

1. **SCOPE** — AR-1284 §A-§E: the frozen eight only, via the governed isolated dispatch path.
   `edit_scope` = `src/engine/extraction/`, `src/engine/tests/`, `scripts/`, `docs/replay-results/`,
   `.claude/` (self-protected surfaces excepted) + `docs/designs/SYSTEM-INVENTORY.md`.
2. **STOP CONDITIONS** — §A field mismatch (none); mechanical dispatch/persistence anomaly
   (**FIRED — B-1**); rebuilt route not GREEN (not reached); any Tier-3 rater call (not reached).
3. **PROHIBITED** — retries, replacement calls, best-of comparison, batch/prior-winner/expected-
   answer leakage, erasing a receipt, manual disposition edits, Tier-3 dispatch, any
   compiler/backtest/paper/broker/live-money work.
4. **REQUIRED PROOFS** — §E terminal report. No independent grade is required *for this stop*; the
   grade attaches to the executed spend, which did not occur.
5. **MEASURED REPO STATE** — `[MEASURED HERE`, tree = `wt-claude-worker1-20260815` @ `96aefd4e`]:
   queue/receipts/manifest present and intact; `IsolatedDispatcher`, `DurableAttemptLedger`
   (`claim_attempt`/`persist_raw_return`), `isolated_bridge` state machine, `g2d_finalizer`, and
   the AR-1283 seam (`assert_certifiable_final_route`, `verify_anchor_identity`) all exist.
   **Zero non-test callers of `IsolatedDispatcher`** — the invoker is injected and the "driver" is
   the guard + the three `g2d_*` scripts, not a wired Python entrypoint.
6. **ALREADY LANDED?** — No. `attempts = {}`, receipt dir holds only `README.md`. Prior art
   searched: AR-1272 (calibration; frozen eight untouched), AR-1283A, `g2d_*` scripts,
   `isolated_*` modules. AR-1272 §F-1/§F-2/§F-5 are the direct precedents for B-3/B-1.
7. **METRIC/GRADE MIX** — §E is mechanical (counts, hashes, ledger states); no graded judgment is
   mixed in. Clean.

---

## 4. WHAT I RECOMMEND (GPT to rule)

Ranked. All three are cheap relative to an unrecorded spend.

1. **Close B-1 first, permanently.** AR-1272 already named the smallest fix: the `_audit` object
   exists and is deliberately discarded — **persist one append-only line per call
   (event, tool_name, verdict)**. Traversal then becomes directly witnessable forever, for every
   future packet, at essentially zero cost. Without it, no seat can ever prove the claim-before-call
   law actually engaged.
2. **Constitute the dedicated execution session explicitly** — operator/GPT arms
   `g2_precall.strict_session = true` (the worker structurally cannot), in a fresh seat whose
   permissions allow emitting the frozen prompt.
3. **Decide the prompt-delivery path (B-3):** either exempt `g2d_freeze_native_calls.py
   --emit-prompt` as a read-only inspected path, or have the guard read the prompt from the frozen
   manifest itself so the worker never transports 26 KB of prompt bytes by hand. The second is
   stronger — it removes an entire class of transcription error.

**Also carried (not mine to fix):** AR-1272 §F-4 stands — a bound Worker-1 seat cannot publish to
`advisor-reports/` (not in `edit_scope`), so this report lands in `docs/replay-results/` and needs
an operator/GPT relay to reach `origin/external-advisor/gpt-rulings`.

---

## 5. FINDINGS AGAINST MYSELF / DISCLOSURES

- My **first** Bash call named `.claude/settings.json` and was denied by the fence. The guard was
  right; I re-measured with `Grep` + `Read`. Reported, not quietly re-run. (Same opening mistake as
  AR-1272 §F-6 — it is apparently an easy one to make, which is itself worth knowing.)
- I ran `scripts/g2d_real_queue_preflight.py` **first** and it printed six fields, none of which
  were named `excluded_count`. Had I stopped there I would have reported "§A PASS" while never
  measuring two of the six fields §A requires. I caught it by reading the ruling's field names
  against the instrument's output, then re-ran the canonical function. **Disclosed because a
  near-miss on a one-shot precondition is the finding.**
- **Orphan ear:** PID 20020 polls this exact channel; its parent (2092) is dead and the only live
  `claude.exe` is mine (29052, started ~55 min later). It can never deliver here. Per doctrine I
  did **not** kill an ear I did not arm — I armed my own (baseline `81c9ca1c`, `EAR ARMED`
  delivered to my own chat) and report the orphan for operator reaping. Note this is a *different*
  orphan from AR-1272 §F-6's (13060/18464), so a further seat has run since.
- **Ear red-proof: not re-run in this seat.** The armed line delivering to my chat proves the
  channel, not the change-detection logic. I am not claiming the `EMITS`-on-move arm.
- **CI: NONE.** All evidence here is local to this tree. Do not relabel it as CI.

---

## 6. STOP / NEXT

**STOP fired:** AR-1284 §B mechanical-infrastructure clause, on B-1, reinforced by B-2 and B-3.

**Frozen eight remain 0/8 spent. The one-shot calibration remains unspent. Nothing in the control
plane was modified.** Next action is GPT's ruling on §4 above; the eight-call execution should be
re-authorized to a seat that can actually satisfy the law it is being held to.
