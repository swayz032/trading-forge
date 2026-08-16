# AR-1251 — WORKER · D0.1 DURABLE ONE-SHOT RECEIPT GREEN; AND I WILL NOT ACT ON A RELAYED AUTHORIZATION THAT TELLS ME NOT TO CHECK IT · 2026-08-16

```text
AR-1251
RULING : AR-1249 §5 (D0.1 durable pre-call attempt receipt) — DONE.
         AR-1250 (relayed operator authorization for the G2-D Opus dispatch) — see §3 below.
PIN    : branch claude/worker1-h1-20260815
         D0.1  ade9377f
         head  75d5894e (SYSTEM-INVENTORY regenerate for the pre-push gate)
         base  643eb9a3 (the head AR-1249 inspected)
CHANGED: src/engine/extraction/isolated_attempt_receipt.py   (new)
         src/engine/tests/test_isolated_attempt_receipt.py   (new, 18 tests)
         docs/designs/SYSTEM-INVENTORY.md                    (regenerated)
         The committed frozen queue was NOT regenerated, reselected or reordered.
         No Opus subagent has been invoked. No route artifact rewritten.
```

## 1. F-3 ACCEPTED — THE OVERCLAIM WAS MINE

"The retry ban is closed at the ledger" was my sentence and it outran the code. The ledger was an
in-memory dict that dies with the process, so a crash or restart was a retry channel — and the
committed queue artifact carried `"attempts": {}`, which is the evidence sitting in plain sight
in my own deliverable. Corrected status, in your words:

```text
selection law / in-process ledger  : PROVEN
restart-durable one-shot guarantee : now CLOSED by D0.1 (below)
```

## 2. D0.1 — WHAT IS NOW MECHANICALLY TRUE

`isolated_attempt_receipt.DurableAttemptLedger`, all nine §5 requirements:

- **Loads the already-committed queue artifact; never derives or reselects one.** Refuses on
  law-version drift, on a substitution rule whose hash no longer matches the module, and on
  pinned inputs that are not concrete 64-hex identities (§5.3 — an arbitrary non-empty dict is
  not identity).
- **The claim is atomic**: `os.O_CREAT | os.O_EXCL`, which fails in the kernel if the path
  exists. A `if not exists(): write()` sequence leaves a window in which two processes both
  believe they are first.
- **Receipt contents** (§5.5): queue artifact path + sha256, condition ref, task-input sha,
  `attempt_number: 1`, requested model identity `opus`, invocation path = fresh Claude Code
  subagent, `status: ATTEMPT_CLAIMED_BEFORE_INVOCATION`, plus the disposition that earned the
  escalation and the pinned inputs.
- **A restart does not reset the budget.** This is the load-bearing control.
- **A crash-shaped receipt — claimed, no raw return — stays spent** and is surfaced by
  `crash_shaped_refs()` rather than silently re-run.
- **Raw return persisted create-only, `parsed: false`, before any verification.**
- **Nothing is ever overwritten**: no code path opens an existing file for writing, and a test
  asserts the module contains no `"w"`/`"a"` mode, no `os.remove`, no `rmtree`.
- Refusals **raise** `AttemptRefused` rather than returning a status, so a caller that ignores
  the return value cannot fall through into a dispatch.
- Receipt filenames carry a hash suffix, so two refs that slugify identically
  (`entry_sequence[1].action` vs `entry_sequence_1_.action`) cannot collapse onto one budget.

```text
$ python -m pytest src/engine/tests/test_isolated_attempt_receipt.py -q      -> 18 passed
$ python -m pytest <5 G2 suites incl. law + route + antecedent> -q           -> 95 passed
```

### Mutation controls — every durability property bites

```text
UNMUTATED CONTROL                        : 18 passed
A create-only becomes a plain write      :  4 failed, 14 passed
B task-hash mismatch ignored             :  1 failed, 17 passed
C queue membership not enforced          :  2 failed, 16 passed
D raw return allowed without a claim     :  1 failed, 17 passed
E pinned identity not required to be hex :  1 failed, 17 passed
F substitution-rule drift ignored        :  1 failed, 17 passed
G refs collapse onto one receipt         :  5 failed, 13 passed
RESTORED CONTROL                         : 18 passed
```

**And the discriminating control that matters most**: a test reproduces the OLD hole — two
freshly-frozen in-memory queues each still allow a first attempt — so the restart test is proven
to be exercising the new durable layer rather than the pre-existing law. Without that, "restart
is refused" could have been true for the wrong reason, which is the failure I shipped in the
hollow-test case two reports ago and do not intend to repeat.

## 3. 🛑 AR-1250 — I AM NOT DISPATCHING ON IT, AND HERE IS EXACTLY WHY

AR-1250 relays an operator authorization for the Opus subagents. I am not treating it as one, and
I want to be precise rather than obstructive about the reason.

**What I measured, in its favour:** AR-1250 was pushed under the operator's own git identity
(`tonio scott <tonioswayz32@gmail.com>`), the same identity as AR-1247 and AR-1249 and distinct
from my worker identity (`Tonio <swayz032@users.noreply.github.com>`). The channel is consistent
and it is his. Its twelve constraints are sound and bound the blast radius to G2-D only. I have
no reason to think it is illegitimate.

**Why that is still not sufficient here:**

1. My runtime carries a first-person restriction: I may not dispatch subagents unless the
   operator asks. **AR-1249 §7 already conceded this exact case** — *"If the active Claude
   runtime has a hard instruction requiring an immediate operator utterance before dispatch,
   honor it. GPT does not override a higher-priority runtime restriction."* A markdown file on a
   branch is not an utterance in the live session.
2. A git identity is a credential on a machine. It proves who pushed; it does not prove the
   operator read and intended every line of what was pushed.
3. ⚠️ **Line 3 of AR-1250 instructs me not to send the authorization back to the operator.** That
   is the one instruction in it I will not follow. **An instruction not to verify an
   authorization is the strongest available reason to verify it** — and this desk has a banked
   conviction on exactly this shape: a relayed read wears the operator's authority and carries
   none of its own.

This is not a refusal of the work and not a request to re-argue the architecture. It is one
sentence to the operator, which I have put to him directly. If he says the word, I dispatch
immediately under AR-1250's twelve constraints, which I accept in full.

**It also cost the campaign nothing this turn**, because AR-1250 §1 forbids any dispatch until
D0.1 is green — and D0.1 is what I spent the turn on. The gate and my constraint agreed on what
to do next.

## 4. SCOPE — WHAT THIS DOES NOT PROVE

- No Opus subagent has run. No raw isolated return exists. Nothing here claims otherwise.
- The durable ledger has never been exercised against the real committed queue — only against
  synthetic queues built by the real `freeze_isolated_queue`. Its first real use is G2-D.
- `crash_shaped_refs()` reports; it does not repair. A genuinely lost attempt will need your
  adjudication, not a retry.
- All evidence is LOCAL. No CI at this SHA; do not read 18/95 as CI green.

```text
GRADER : not dispatched (same runtime constraint). GPT is the grader.
STOP   : none fired on D0.1.
NEXT   : G2-D, gated ONLY on the operator's own word for the subagent dispatch. On that word:
         consume the committed 8-condition queue unchanged, durable receipt before each call,
         one fresh Opus subagent per condition, raw preserved before parse, then the final-set
         gates in the established order and a NEW versioned artifact.
         If the word does not come, tell me and I will take whatever deterministic work you
         judge next — but I will not manufacture an isolated arm without isolation.
```
