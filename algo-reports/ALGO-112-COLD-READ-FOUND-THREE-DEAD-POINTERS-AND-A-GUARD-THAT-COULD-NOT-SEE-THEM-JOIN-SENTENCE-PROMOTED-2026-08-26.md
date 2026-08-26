# ALGO-112 — ALGO-111 executed. The join sentence opens GPT's first task, and it is now **materially better than what I wrote**: the join already exists at `levels.py:76-86` and already reads the exact two prices. **The cold read found three dead pointers, an orphaned sentence, stale SHAs — and a guard that was guilty of the trap the document it guards documents.**

**Strategy head:** `424a777f` (pushed, local == remote). **Suite:** 896 passed, 0 failed.
**Handover guard:** 12/12, and it now **derives** its path set. **PR #38:** DRAFT / DO NOT MERGE.
**Nothing semantic changed. Reserved-class asks remain UNSENT.**

---

## 1. THE ORDER, executed — and the entry improved while executing it

**"The join is the task; the arithmetic is trivial"** now opens GPT'S FIRST TASK as a standalone
callout with *"read that before the rest of this section"*, not a footnote. Your sequencing ruling
sits directly under it: **exceptional-swing first and ALONE**, with both of your reasons; the
established path's `0.20/0.80/0.05/0.30` provenance pass named as a **PRECONDITION, not a parallel
task**, and pointed at the mandatory positive control.

**Then writing the detail found something better than the sentence.**

> **`_pivot_close_away` (`levels.py:76-86`) ALREADY PERFORMS THIS JOIN — and already reads the
> exact two prices the ruled band needs.** `bar = h15.loc[row.t]`, a duplicate-index guard, and
> the **side mirror already correct**: `S` takes `bar.low` and `bar.close`, `R` takes `bar.high`
> and `bar.close`. It turns those two prices into a **fraction**. The band needs them as **the
> two edges**. That is the whole change.

GPT is told to **follow that function, not invent a second join**. Two things flagged with it:
it ends **`except Exception: return 0.5`** — a silent default that is fine for a quality score and
**unacceptable for a band edge**, since a failed join would produce a plausible zone unrelated to
the candle and nothing would go red; the band path must **fail loud or refuse the location**. And
I corrected my own ALGO-110 column claim against `levels.py:116`: the frame is
`{"t","confirm","side","price","wick","disp","atr"}` — it carries `wick` too, which I omitted, and
**no OHLC**, which was the load-bearing half.

## 2. THE COLD READ — you were right that it was the highest-value remaining act

I read it as someone who had never seen this campaign. It found real damage in the first 80 lines.

**THREE DEAD POINTERS in "Where everything lives"** — the map a newcomer uses first:
`KILL-AND-HEARTBEAT.md`, `SELF-EXPLANATION-AUDIT.md`, `SEAT-HANDOFF-TEMPLATES.md`. **All three are
`ALGO-`-prefixed on disk.** A cold reader following the map hit **three dead ends**, in the section
whose entire job is telling them where things are.

**An orphaned fragment at line 22** — *"test `tests/…` reads `ALGO-GPT-HANDOVER.md` by path."*,
lowercase, no subject — replaced with the warning it was truncated from.

**Stale SHAs in the header** (`abce4155`, ALGO-100C `602318c5`) presented as current state.
Replaced with **three commands that return the live answer**, each verified by running it
verbatim. The `git fetch` in the ladder command is load-bearing and **says so** — without it you
read whatever your clone last saw, *a stale answer that looks exactly like a current one.*

## 3. THE GUARD WAS GUILTY OF THE TRAP ITS OWN DOCUMENT DOCUMENTS

`test_every_path_it_names_actually_exists` passed the whole time those three pointers were dead,
because it checked **a typed list of five paths.**

> That is **trap 10 in the document under test** — *A HAND-MAINTAINED LIST CERTIFIES ONLY ITSELF;
> DERIVE POPULATIONS, NEVER TYPE THEM.*

It now **derives** the path set from the document, keeps the five as a **must-mention floor** (so
a handover that stopped naming the ground truth cannot pass by naming nothing), and carries its
own **`>= 15` floor** so a silently broken extractor cannot pass while checking nothing.

### 3.1 And my first version of that fix was GREEN on the original bug

I wrote the bare-basename filter as **`tok.startswith("ALGO-")`**. **The bug is a MISSING `ALGO-`
prefix** — so the filter excluded the exact case the guard exists for. **D1 went green.**

> **A GUARD WHOSE FILTER IS WRITTEN FROM THE FIXED SPELLING CANNOT SEE THE BROKEN ONE.**

The battery caught it because it plants **the original defect**, not a defect of my choosing —
the "I close the instance shown, not the class" pattern in its most literal form: I had just fixed the spelling, and I
wrote the detector against what I was now looking at. **Now 4/4 RED** (both broken spellings, a
bogus repo path, and the extractor floor), byte-exact restore `sha256`-verified, clean green. The
comment explaining this sits in the test, because the next person to tighten that filter will be
tempted by exactly the same shortcut.

## 4. WHAT I DID NOT DO

No semantic code changed — markdown and one test. No band was built. `kernel.py:205` untouched.
No admission magnitude moved. Nothing from B1 is on any pushed branch. Re-exam #4 not run. No
question of any kind went to the operator. **The engine-crash defect
`V24_TARGET_DISTANCE_LT_REACTION_CONTACT` (`target_policy.py:157-161`) is still carried and still
unfixed.**

## 5. ONE OBSERVATION FOR ALGO-113, not an ask

**Three of the last four defects I have found were in instruments, not in the strategy** — the
stale F2 anchor pin, the typed-list path guard, and the filter written from the fixed spelling.
That matches the handover's own line that instrument defects outnumber strategy defects roughly
four to one. **The cold read is the only technique that found the path guard**, because every
automated check agreed with itself. It is worth doing again on `ALGO-RUNBOOK.md` before sunset —
it is the document the *operator* reads, and it has never had one.

---

**Enumerated.** 1 markdown file + 1 test changed. Battery: 4 defects, all RED, byte-exact
`sha256`-verified restore. 3 documented commands run verbatim to verify. All prior
line-number citations still resolve. Handover guard 12/12; suite 896 passed / 0 failed at
`424a777f`.

No PnL, realized outcome, winner/loser label or clean-edge result participated in any decision in this packet.
