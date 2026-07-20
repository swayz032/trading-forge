# RATIFY PACKET — Population-A level resolver (per-condition, named-object rows only)

**STATUS: STAGED, autonomous class.** Pre-live; no live default altered; the sealed 77,
frozen refs, promotion gates and sizing paths untouched; `approximation=False` remains
gated behind an independent grade. Authorization: **R-101 §1 BUILD IS GO.**

**★ CEILING, travelling in the scope-line from day one per R-101 §1 — AMENDED BY R-102 §2:**
**at most 6 of 16 level/zone rows de-approximate in this pass; a 7th is ROUTED-BUT-APPROXIMATE.**
This sentence appears wherever the result is cited. The delivery's DoD is de-approximating
the RESOLVABLE — never "fixing level/zone."

**R-102 §2 ruling on `swing` (n=1): BUILD THE ROUTING, WITHHOLD THE CLAIM.** The resolver
machinery is shared, so `swing` routes with the rest — but **de-approximation is granted
per-kind only where the audit population supports it, floor n≥2**, because §4's sharpened
check (two different-level conditions → two different series) is literally unrunnable inside
a kind of one. So: `named_sr_level` (4) and `order_block_edge` (2) may earn
`approximation=False` pending their per-kind audits; **`swing` stays `approximation=True`,
disposition UNVERIFIED-BY-SAMPLE**, until tier-a/tier-c grows its population to the floor.
**A detector that cannot be distinguished from luck does not get the flag, however plausible
its single member looks.**

---

## 1. What & why now — with receipts

The prior sub-wire (`packet-levelzone-subwire-2026-07-20.md`) routed level/zone conditions
to `retest_touch_check` but production feeds it a **bars-only EMA(20) proxy** as `level`
(`spec_condition_compiler.py:638`) — no condition text, no trader-named price. Every
level/zone condition therefore receives an **identical** level series; machine-confirmed on
real data across all 8 specs (AR-086, sustained R-097 §1). *"Support at 100"* and
*"resistance at 140"* still bind identically. **The mechanism was live in the function and
constant in the wiring** — the WIRE-1 family, one layer down.

**Population derived, not framed** (`levelzone-object-reference-census.json`, generator
committed): **Population A = 7** rows whose referent is named IN-SPAN — `named_sr_level` 4,
`order_block_edge` 2, `swing` 1. Per-row match evidence recorded (AR-090). Enumerated
counts, not sampled rates — **no chance baseline is defined for them** (R-100 §2 satisfied
by stated reason, not silence).

**Population B (8 anaphora + 1 neither) is OUT — UNRESOLVABLE-AS-BUILT** with per-row
dispositions. Antecedent-resolution is UNPROVEN: its 88.9% presence result collapsed to
+6.2pp over a 82.7% chance baseline at n=9 (AR-089 / R-100 §1). **Forcing those rows into a
parser is prohibited in advance** — it would manufacture confident-but-hollow bindings.

## 2. Blast radius

**Changes:** the level series supplied to the 7 Population-A conditions, and only those.
**Invalidates / re-measure:** any rate computed over those 7 rows — **under dual
denominators (124 with-narration / 111 primary), no artifact silently replaced.**
**NOT touched:** the sealed 77 · `TF_WIRE1_HTF_COLUMNS` · frozen forensics pre-reg ·
promotion gates · sizing · fill/P&L · tier-a · the 26 session rows (own packet) · Population B ·
the other six concepts · the existing level/zone routing flag's OFF default.

## 3. The exact change, scope-locked

**IN:** a per-condition level resolver for the 3 Population-A kinds, each binding to a
detector the repo already owns; a new env flag, **default OFF**; the resolver replaces the
EMA proxy **only** for Population-A conditions.

**OUT, explicitly:** Population B (any bare anaphora) · antecedent resolution of any kind ·
the other six concepts · any `approximation=False` flip · any denominator move · the
narration rule · the session resolver · `SESSION_KEYWORDS` · engine fill/P&L/sizing.

## 4. Verification plan — RETURN CHECKLIST (blocking; R-094 §3)

Each item returns a receipt or an explicit *"could not, because…"*. A silent omission halts
the lane.

1. **★ Per-kind amended-Leg-1 audit (R-097 §2) — the item whose absence sank the last
   packet.** Liveness proven **at the production boundary**: vary the **CONDITION TEXT** the
   production path actually reads, and watch **the level series differ per condition**.
   Varying an interior `level` argument proves only that a function is a function.
2. **Per-condition discrimination demonstrated:** two Population-A conditions naming
   *different* levels must produce *different* level series — the exact property the prior
   sub-wire failed to deliver.
3. **Both-polarity per binding**, on the 13 evaluation-observable rows only; binding-
   engagement and evaluation-observability reported as **two separate numbers** (R-097 §4).
4. **Cadence isolated from signal** — reuse the Band-7 `cadence_isolation_harness.py` design;
   axes never combined.
5. **Any rate cited carries its null** (R-100 §2), or the stated reason none is defined.
6. **Flag-OFF byte-identity PROVEN** (not asserted) and `approximation` still True.
7. **Every guard has a mutation-tested anti-vacuity companion** (PASS known-good → FAIL
   known-bad, real exit codes), and no guard is over-strict (R-091 §3).

**★ Faced here rather than discovered at the grade: `swing` has n=1.** A per-kind premise
audit on a single member cannot distinguish a working detector from a lucky one. Options —
report `swing` as **UNVERIFIED-BY-SAMPLE** and de-approximate only `named_sr_level` (4) and
`order_block_edge` (2), or hold `swing` for the tier-a corpus where n grows. **The packet
does not decide this; the grade should not be surprised by it.**

## 5. Rollback

Env flag, **default OFF**; flipping off restores current behaviour exactly (proven by item
6, not asserted). Single-commit revert; no migration, no persisted state, no data mutation.
Two-commit law: resolver lands separately from any flag-default change.
