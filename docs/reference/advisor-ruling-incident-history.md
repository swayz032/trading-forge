# Advisor-Ruling Skill — Incident History & Long-Form Rationale

> Moved out of `.claude/skills/advisor-ruling/SKILL.md` during the 2026-08-18 token-optimization
> pass. The skill keeps the operative rule + a one-line pointer to the matching entry below; this
> file carries the full "why" — the specific incident, date, and measured numbers that produced
> each rule. Read this when you want the case, not just the constraint.

---

## Re-invoke every ruling, not once per session

"It is already loaded in my context" is the rationalisation that killed it on 2026-07-28. The desk
invoked this skill once (before R-360), declared it loaded, and ruled twenty-plus times from
memory. **MEASURED:** §7 field compliance fell from **4.0/10 (R-355–R-360) to 0.1/10 (R-374–R-382)**
— the mandated structure collapsed to zero, and the operator noticed before the desk did.

The decisive reason is not discipline, it is staleness: the file mutates. That same day the desk
edited the skill four times (§0.0 authority, §8 start-receipt, §8 decline-receipt/read-the-tail, §9
research-first) — and then kept ruling from the version it had read *before* those edits. It broke
§8's "name the first observable + ETA" forty minutes after writing that rule into the file, because
it never re-read the file it had written it into.

> A remembered skill is a stale skill. You are not re-reading it for discipline; you are re-reading
> it because you may have changed it, and a document you edited from memory is a document you no
> longer know.

---

## The prior-art convicting case (AR-896, 2026-08-09)

`AR-896 §5` put the opening-range duration question to the desk as an open architecture choice
(`A` vs `B`); the desk agreed it was open and told the operator a decision was pending. It had been
**RULED at `R-736`** — *"THE TEACHER GAVE THREE VERSIONS, SO THE FACTORY MAKES THREE BOTS"* —
reaffirmed at `R-743`, and enforced in committed code (`expand_execution_candidates` has no
`default_variant`; `selected_duration_minutes` RAISES). The operator caught it from memory — one
`grep` found it in seconds. Full record: `R-774 §3`.

Both roles failed in one exchange: the ruling that asked the question, and the desk that answered
"open" instead of grepping first.

---

## R-370 §6 — a handoff declaration is not a transfer of authorization

Observed 2026-07-28: the worker had already implemented the "blocked" task three minutes after
declaring itself too deep in context to do it. The ruling gave it permission to stop; only its own
initiative kept the campaign moving.

Related case, R-353 §6: forbade code fixes "before the deploy path is defined" and assigned the
deploy-path definition to no one. The worker reported "no new work" and stopped. Entirely the
desk's defect — the deploy path was never missing (branch → PR → CI → operator merge → operator
updates the worktree), it was merely unrecognised.

---

## R-380 — the decline-receipt case

2026-07-28, item 2: sat declined-but-labelled-ACTIVE for an hour. The operator escalated a fourth
time, and the desk answered "it is working" from a state line it had WRITTEN, not measured. A
decline is a state change the relay must carry — "not starting, because X" gets a receipt exactly
like a start, and the ruling on that report must re-label the task in the same motion.

**READ THE TAIL:** a report's headline sections are news; its RECOMMENDING/HOLDS tail is where
task-state changes live. The decline clause fired inside the very report its author was ruling on,
and nothing updated — a clause you write is a sensor you must also read.

---

## The four verification-gate incidents (R-392, R-400, R-413/R-415, R-416, R-412), 2026-07-28

**R-392 — mechanism claims got it wrong four times in one session.** "By construction", "cannot
happen", "is excluded", "guaranteed" are claims about HOW something works, written in a verdict's
voice without opening the file. A wrong number is caught by the next measurement; a wrong mechanism
is obeyed. Enforced by `ruling-mechanism-guard.ps1`.

**R-400 — six errors, one shape: a join without checking the key.** file↔line (verified the file,
not the line) · number↔population ("the pinned eleven" counted a different set) · metric-name↔
instrument (ordered a measurement of `EXACT-NOW`, which exists in no code) · table↔table (a
concordance across two different populations, which would have manufactured a false finding) ·
ruling↔behaviour (a flattering causal story). The desk's work IS joins — synthesis across
artifacts — so its errors are join errors, structurally.

**R-413/R-415 — an evidence grade certifies you ran something, not where.** The desk wrote
`[MEASURED HERE]` about the campaign worktree and ruled about production — then used it to overrule
a correct worker. `spec_family_bindings.py` was 160,049 B in the campaign checkout and 35,046 B in
`runtime-production`: two different files, one name, disagreeing on real bindings.

**R-416 — a ruling rejected two claims on a premise a worker's AR had killed twenty minutes
earlier**, and the ledger carried that confident rejection until the worker caught it. Enforced by
`ruling-stale-premise-guard.ps1`, which requires naming the newest AR, not agreeing with it.

**R-412 — a layer-scoped proof got published as a property of the behaviour.** The desk proved the
FVG primitive detects a subset of taught zones and published "conservative" as a property of the
BEHAVIOUR. Sixty lines downstream the fill rule inverted it: a wider taught band is easier to
overlap, so the taught zone dies sooner and the narrower implemented zone stays active longer —
producing signals the teacher never sanctioned.

**Four instrument-audit incidents, same day:** `| head` masked an exit code · a shell collapsed a
character into a backspace · an ANSI-corrupted script exited 1 on every case including its own
fail-open control · a test helper hardcoded the path it claimed to vary. A surprising result is an
accusation against your tooling first.

**2026-07-29 — independence is structural, not diligence.** The desk verified a change's mechanism,
the worker proved its refusal set, and both missed four tests that would go red — a disinterested
reader found them in one pass. Two agents can each verify their own claim correctly and still miss
the same thing, because they scoped the question the same way.

---

## Grader dispatch history

**v1 → v2 (rebuilt 2026-07-30, operator-ordered):** opus pin, July verification laws inlined,
HUNT/GRADE modes, mandatory closing coverage section (paths used, positive-control witnesses, join
keys, what it did NOT verify). **F-2 (2026-07-30):** 0-byte transcripts under a "4/4" claim forced a
full re-run — a verdict living only in the dispatcher's chat is single-source; the grader now writes
its verdict to a committed durable-receipt file.
