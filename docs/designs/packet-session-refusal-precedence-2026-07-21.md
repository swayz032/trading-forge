# PACKET — Session Refusal Precedence + Wrapping-Window Refusal (2026-07-21)

**Surface:** `src/engine/spec_family_bindings.py` (instrument).
**Flag:** `TF_SESSION_ROLE_RESOLVER_ENABLED` — **stays OFF throughout.** No live exposure.
This defect is a named **FLAG-ON BLOCKER** and gates any future promotion of that flag.
Every "after" figure below is a **labeled hypothetical** measured by forcing the flag ON in a probe.

---

## 1. WHAT & WHY NOW — with receipts

### 1a. The defect, reproduced (COMPUTED, this worktree, HEAD `4e8cd4ba`)

The orphan-zone refusal is consulted **after** the role resolver
(`src/engine/spec_family_bindings.py:2231` resolver consult, `:2319` refusal), so turning the
flag ON converts a correct refusal into a bind.

Corpus sweep over all 395 distinct `WAIT_SESSION` objects found under `docs/**/*.json`:
**9** objects reach the refusal path (`resolve_session_keyword` → None **and**
`refused_session_zone` → not-None). Of those, **2 are preempted** by the role resolver:

| object (truncated) | refused zone | role zone (flag ON) |
|---|---|---|
| `new york market open or pre market` | `overnight` | **`ny_am`** |
| `overnight/pre-market range: … from 400 p.m. EST all the way until 9:30 a.m. EST …` | `overnight` | **`ny_am`** |

Flag OFF both are `bindable=False, reason=session_zone_refused_uncomputable_window:overnight`.
Flag ON both are `bindable=True, session_zone=ny_am`.

> **★ CORRECTION TO THE DISPATCHING BRIEF.** The brief named **one** preempted object.
> There are **two**. `new york market open or pre market` is a second, independent instance:
> a disjunction whose second disjunct is uncomputable, bound to the first disjunct's zone.

### 1b. Why `ny_am` is the complement of what was taught

The taught window is **16:00 → 09:30 ET**, which **wraps midnight**. `ny_am` is
`(420, 600)` minute-of-day = **07:00–10:00 ET**, inside the RTH day session — the
**complement** of the overnight range the text teaches. Confirmed by direct read of
`_REAL_ZONE_INTERVALS` (`:1800`).

### 1c. ★ THE BRIEF'S ROOT-CAUSE ATTRIBUTION IS WRONG — and this is the load-bearing finding

The brief attributes the inversion to the colon-less token: *"because the transcript renders
'400 p.m.' without a colon, that token never matched."*

The colon-less miss is **real but is not the cause**. COMPUTED:

- `_SESSION_CLOCK_TOKEN_RE` does **not** match `400 p.m.` (3 digits defeat `\d{1,2}` +
  mandatory-meridiem), and **does** match `4:00 p.m.`. The brief is right about the token.
- But the inversion **reproduces with perfectly well-formed colon-ful tokens**:

  | synthetic input | tokens parsed | min/max span used | zone |
  |---|---|---|---|
  | `trade the range from 4:00 p.m. eastern until 9:30 a.m. eastern on the NYSE` | 960, 570 | (570, 960) | **`ny_pm`** |
  | `from 11:00 p.m. to 2:00 a.m. eastern the market is quiet, avoid entries` | 1380, 120 | (120, 1380) | **`ny_am`** |

  Both are the **complement** of the taught window. Neither involves a colon-less token.

- **Therefore the naive fix makes it differently wrong.** If the colon-less token were fixed
  so `400 p.m.` parsed to 960, the corpus row's span becomes `min/max{960, 570} = (570, 960)`
  → **`ny_pm`** — still the RTH day, still the complement. COMPUTED.

**The actual root cause is the `min/max` anchor span itself.** A wrapping window's
`min`/`max` are its *interior* endpoints, so the derived span is exactly the complement of
the taught range. The colon-less miss merely degraded the corpus instance to a *single*
anchor (570), which then took the `lo == hi → hi = lo + 1` branch and landed in `ny_am`.
Two different paths, one shared defect: **`min/max` cannot represent a wrapping window.**

### 1d. Scale — the wrapping defect is LATENT on today's corpus, and the tokenizer is what hides it

Census over the 395 objects: **8** carry ≥1 clock token; **1** has a backwards-going token
sequence, and it is not a true wrap (repeated `9:30` listings), currently `zone=None`.
So **0 corpus objects are currently mis-bound via the wrapping path.**

That is not reassurance — it is the reason to fix (ii) **now**: the wrapping path activates
the moment anyone fixes the tokenizer, which is the obvious next change and which the brief
itself recommends. Fixing (ii) first is what makes the tokenizer fix safe.

### Repro commands

```
python <scratchpad>/repro1.py    # corpus sweep: 9 refusal-path objects, 2 preempted
python <scratchpad>/repro2.py    # mechanism: token parse, anchor span, complement proof
python <scratchpad>/synth.py     # synthetic control (§3 of MECHANISM)
python <scratchpad>/synth2.py    # wrapping-window probes
python <scratchpad>/census.py    # wrapping census over 395 objects
```

---

## 2. BLAST RADIUS

| surface | effect |
|---|---|
| **Flag-OFF behaviour (the only live state)** | **PROVABLY UNCHANGED.** With the flag OFF the resolver block at `:2231` does not execute at all, so reordering it against the refusal block changes no reachable path. Asserted by test, not by argument. |
| `test_spec_family_bindings.py` | 292 green at baseline; must stay 292 green + new tests. |
| `test_session_role_adversarial_fence.py` | **SEALED, NOT EDITED.** 17-red at HEAD, pre-existing. Re-measured after the change to confirm still exactly 17 — no new red, none silently fixed. |
| Graded constants `2/21/4` and the grade's `n` | **NOT TOUCHED.** Owned by the population-completion unit; moves by grading, never by side-effect. |
| 77 sealed corpus | **UNTOUCHED.** |
| `session_windows.py` boundary constants | **UNTOUCHED.** `_REAL_ZONE_INTERVALS` mirror not edited. |
| Pin (b2) `EMIT ⊆ COVERED` | Unaffected — no key added to `SESSION_KEYWORDS`; the change only ever *removes* binds. |
| Downstream `spec_condition_compiler` unbound pass-through | A flag-ON refusal takes the documented `if not b.bindable: np.ones` pass-through. Flag is OFF, so **no live signal change**. |

**Direction of change is strictly refusal-increasing under flag ON.** No input that is
currently unbound becomes bound. Zone binds only ever become refusals.

---

## 3. THE EXACT CHANGE — SCOPE-LOCKED

**(i) Refusal precedence.** Move the orphan-zone refusal block **above** the role-resolver
consult in `_bind_condition_dispatch`. A phrase naming a refused zone is refused
**regardless of flag state**. The refusal survives the flag unconditionally.

**(ii) Wrapping windows are explicitly REFUSED, never complement-bound.** Derive the anchor
span from the **text-ordered** token sequence rather than `min`/`max`. If any adjacent pair
goes backwards, the window wraps midnight → return a named refusal
`wrapping_window_unrepresentable`, carried on `SessionRoleResult.refusal` and surfaced as the
binding's `reason`.

Chose **refuse** over **represent**, deliberately: a window that wraps midnight *is* an
overnight window, and `overnight` is precisely the orphan zone `is_in_killzone()` cannot
evaluate. Representing it could only ever bind a *fragment* of what was taught — the same
class of error, smaller. The module's own stated philosophy ("a miss is honest, a false
positive silently binds the WRONG window") selects refusal.

### EXPLICITLY OUT OF SCOPE

- **The colon-less `400 p.m.` tokenizer gap.** Real (§1c), but widening the tokenizer widens
  the recognition surface against an already-17-red sealed fence. (ii) is what makes this
  safe to do later; doing both together would confound the measurement.
- **The anchor-trap binds (2 of 4, §MECHANISM).** A single *instant* binding a 3-hour
  killzone is a separate defect with a separate fix (require a span, not a point). Named,
  measured, and left alone.
- Any change to `SESSION_KEYWORDS`, `REFUSED_SESSION_KEYWORDS`, `_REAL_ZONE_INTERVALS`,
  `session_windows.py`, the graded constants, or the sealed corpus.

---

## 4. VERIFICATION PLAN — the empirical proof shipping with it

1. **Flag-OFF invariance, asserted not argued** — for all 9 refusal-path corpus objects,
   binding tuple `(bindable, reason, session_zone)` identical before/after.
2. **The refusal survives the flag** — both preempted objects refuse under flag ON **and**
   flag OFF, with the same `session_zone_refused_uncomputable_window:overnight` reason.
3. **Wrapping windows refuse with the named reason** — the three synthetic wrapping inputs
   return `wrapping_window_unrepresentable`, never a zone.
4. **Midnight boundary** — the representation owes its own boundary tests: a span ending
   exactly at 00:00, one starting exactly at 00:00, and a same-minute pair.
5. **Non-wrapping is untouched** — the 4/4 window teachings still hit their zones; ordered
   derivation is proven equal to `min`/`max` on every monotone input.
6. **Sealed fence re-measured** — still exactly 17 red, same ids.
7. **No `assert` for the new gate**; guard refusals exit 2; cross-check asserts stay armed.

---

## 4b. VERIFICATION — RESULTS (all COMPUTED post-implementation)

Baseline captured from an **isolated worktree pinned to `4e8cd4ba`** (`C:/tfbase`,
`git rev-parse HEAD` printed from inside it), per the "any count that enters a receipt"
rule. Arms proven distinct: the pinned module lacks
`SESSION_WRAPPING_WINDOW_UNBOUND_REASON` and `_session_anchor_sequence_wraps_midnight`
(both `hasattr` → False).

| # | check | boundary | result |
|---|---|---|---|
| V1 | flag-OFF binding tuple `(bindable, reason, session_zone)` unchanged | all **395** WAIT_SESSION objects | **0 differ** — PASS |
| V2 | refusal survives the flag, both arms agree | all **9** refusal-path objects | **9/9** refuse in both arms — PASS |
| V3 | wrapping windows refuse by name | 3 colon-ful wrapping inputs | `wrapping_window_unrepresentable`, zone `None` — PASS |
| V3b | orphan-zone refusal outranks wrapping refusal | text tripping **both** gates (positive control asserts it genuinely trips the wrap gate, so the check is not vacuous) | PASS |
| V4 | midnight boundary | 9 sequences incl. `[1320,0]`, `[0,120]`, `[0,1439]`, `[1439,0]`, `[570,570]`, `[]` | PASS |
| V5 | non-wrapping teachings still bind | 4 synthetic, one per real killzone | **4/4** — PASS |
| V5b | no monotone sequence is ever called a wrap | 2000 pseudo-random, seed 7 (reconciles against sortedness — outside the wrap test's own pipeline) | PASS |
| V6 | sealed adversarial fence | `test_session_role_adversarial_fence.py` | **17 red before, 17 red after, `diff` of FAILED ids IDENTICAL** — no new red, none silently fixed |
| V7 | `test_spec_family_bindings.py` | 292 baseline | **316 pass** (292 + 24 new), 0 fail |
| V8 | all 9 direct-consumer test modules | — | **307 pass**, 0 fail |
| V9 | **red-proof**: new assertions fail on pre-fix code | run against pinned `4e8cd4ba` | **5 armed assertions go RED** — PASS |

Verification script exits **2** on any failure (guard refusal), never `assert`.

### ★ V10 — CROSS-LANGUAGE RECONCILIATION (outside the Python pipeline entirely)

`src/server/lib/spec-family-bindings.ts` is the TS mirror. It implements **no role resolver
at all** — its WAIT_SESSION order is `resolveSessionKeyword()` → `refusedSessionZone()` →
refuse (`:269-289`). Executed against both preempted objects (`tsx`, unmodified mirror):

```
{"bindable":false,"reason":"session_zone_refused_uncomputable_window:overnight","sessionZone":null}
{"bindable":false,"reason":"session_zone_refused_uncomputable_window:overnight","sessionZone":null}
```

- **PRE-FIX Python, flag ON:** `bindable=True, zone=ny_am` → **DIVERGED from the mirror.**
- **POST-FIX Python, flag ON:** byte-identical to the mirror above.

So the defect was **also a latent cross-language parity break**, and the fix is corroborated
by an implementation that was written independently and never changed. This is the
reconciliation-against-something-outside-its-own-pipeline check; the greens above are
necessary, this is the sufficient one.

### ★ TWO BUGS THIS PACKET'S OWN FIRST CUTS SHIPPED — caught by test, not by review

Both from one wrong premise: *"the order anchors were discovered is the order they appear
in the text."*

1. Discovery order put the anchor-phrase minute first regardless of position →
   `[570, 180, 570]` phantom wrap. Graded bound-and-concrete count moved **8 → 6**.
2. Sorting by text position fixed that but not the real problem: an anchor phrase is a
   descriptive **gloss**, not a range endpoint, and can follow the endpoints it describes →
   `[570, 585, 570]` phantom wrap. Count moved **8 → 7**.

Resolution: the wrap test reads **clock tokens only**, in `finditer` order. Both cases are
pinned by `test_anchor_phrase_gloss_is_not_read_as_a_range_endpoint`.

**The graded constants are what caught both.** They are owned by the population-completion
unit and must never move by side-effect — and because they must not move, their movement was
a working alarm. Final state: `bound_count == 8` assertion green, constants untouched.

## 5. ROLLBACK

Single-file, additive, forward-only. Revert = one forward commit restoring the two blocks'
order and dropping `SessionRoleResult.refusal` + the wrapping check. No migration, no
artifact, no state. The flag is OFF, so rollback has **zero** live surface.
