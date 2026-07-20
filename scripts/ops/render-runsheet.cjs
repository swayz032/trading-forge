// scripts/ops/render-runsheet.cjs — RENDER the cold-recovery runsheet from the typed source.
//
// The markdown is GENERATED. Nobody hand-edits the evidence table, so there is no free-form
// cell in which to assert a drill that did not happen — the dishonest-claim surface is
// removed as a CATEGORY rather than governed one cell at a time.
//
// A test asserts the checked-in file matches this render byte-for-byte, so a hand-edit goes
// red. `--check` does the same in CI; `--write` regenerates.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { EVIDENCE_STATES, LEGS, validate, evidenceLabel, drilledLegs } = require("./recovery-evidence.cjs");
const envManifest = require("./recovery-env-manifest.cjs");

const OUT = path.resolve(__dirname, "..", "..", "docs", "cold-recovery-runsheet.md");

function renderEnvSection(m = envManifest) {
  m.validate();
  const shown = m.runbookVars();
  const hidden = m.suppressedVars();
  const rowsOut = shown
    .map((v) => {
      // Render EVERY declared class's justification, not just the most severe one. Showing only
      // `degrades` hid the corrected `DATABASE_URL` text (the verifier reports UNKNOWN, not FAIL)
      // from the one reader who needs it. A var with several shapes has several things to say.
      const why = v.classes
        .map((c) => v[m.CLASSES[c].needs])
        .filter(Boolean)
        .join(" · ");
      const label = v.classes.map((c) => m.CLASSES[c].label).join(" + ");
      return `| \`${v.name}\` | ${v.leg} | **${label}** | ${why} |`;
    })
    .join("\n");

  return `## Secrets/env — what to set on a rebuilt box

**Set these ${shown.length}.** Generated from \`scripts/ops/recovery-env-manifest.cjs\`; every row's
class is cross-checked against the code by \`node scripts/ops/verify-env-manifest.cjs\`.

| variable | leg | class | if it is missing |
|---|---|---|---|
${rowsOut}

**★ Read the SILENTLY DEGRADES rows twice.** Those do not fail loudly — the box boots healthy and
is quietly less able. \`AWS_ACCESS_KEY_ID\`/\`AWS_SECRET_ACCESS_KEY\` default to \`""\` and get SET as
the DuckDB S3 credentials, so an unconfigured box reports itself fine and cannot read the lake.
That is the "boots healthy, S3-blind" shape this manifest exists to surface.

**${hidden.length} recovery-relevant vars are deliberately NOT listed** (${hidden.map((v) => `\`${v.name}\``).join(", ")}) —
each has a working default, so absence is *correct*. Listing them would train you to skim the list,
which is the failure mode this triage prevents. **A count of undeclared vars is not an inventory of
recovery risk:** the repo reads ~617 env vars and ~323 are absent from \`.env.example\`; almost all
of that gap is noise, and enumerating it would bury the ${shown.length} rows above.

**Declared limits of the cross-check** — it adjudicates ONE property soundly (the silent-degradation
signature, an empty-string default) in both directions. It does **not** derive REQUIRED vs
OPTIONAL — cross-line guards make that undecidable line-locally, so those are human-declared.
And it is **static-only**: \`RAILS_ENV_PATH\` is read via \`env[v]\` and scores zero static sites,
so dynamic entries are SKIPPED and the skip is reported, never silently passed.

---

`;
}

function render(legs = LEGS, states = EVIDENCE_STATES) {
  validate(legs, states);
  const rows = [...legs].sort((a, b) => a.order - b.order);
  const drilled = drilledLegs(legs, states);

  const table = rows
    .map((l) => `| **${l.order} · ${l.name}**${l.tier !== "—" ? ` (Tier ${l.tier})` : ""} | ${l.capability} | **${evidenceLabel(l, states)}**${l.receipt ? ` — ${l.receipt}` : ""} | ${l.keyFinding} |`)
    .join("\n");

  return `<!-- GENERATED FILE — DO NOT EDIT.
     Source of truth: scripts/ops/recovery-evidence.cjs
     Regenerate:      node scripts/ops/render-runsheet.cjs --write
     The evidence STATE of each leg is a closed typed value; this table is rendered from it,
     so a drill cannot be claimed by editing prose. KEY FINDINGs are free text and are
     explicitly NOT tool-governed — see the note under the table. -->

# Cold Recovery — Runsheet

> **EVIDENCE HEADER.** This runsheet is **NOT** drilled as a whole.
> ${drilled.length} of ${rows.length} legs carry a drill receipt: **${drilled.join(", ") || "none"}**.
> Every other leg states its own lesser evidence level. A blanket claim is never made anywhere
> in this document, and cannot be — the levels come from a closed enum, not from prose.

**Run the verifier, do not read the checklist:** \`node scripts/ops/verify-recovery.cjs\`
Exit \`0\` all PASS · \`2\` something inconclusive · \`3\` a capability is genuinely absent.

---

## Evidence map

| leg | capability | evidence level | KEY FINDING |
|---|---|---|---|
${table}

**How this table is governed.** The **evidence level** column is generated from a closed set
of states (\`${Object.keys(states).join("\`, \`")}\`), and a state that asserts a drill must
carry a receipt or the render refuses. **The KEY FINDING column is free text and is NOT
tool-governed** — a finding is human judgement about what a drill taught, not a completion
claim, and policing its prose would be the same open-set trap that made four rounds of
patching fail. Govern the state; declare the prose ungoverned.

**A second declared limit: RECEIPT CONTENT IS ASSERTED, NOT VERIFIED.** The schema enforces
that a drilled state *carries* a receipt and that a non-drilled state does not — it does not
open the receipt and check it says what it claims. Exploiting that needs a deliberate edit to
the typed source, which is a code-review threat, not a prose one: **no schema is closed
against its own author editing the source of truth.** Stated here rather than left implied,
because an undeclared limit is the same defect as an overclaiming guard.

**And a bounded scope on Tier B:** the expected task list is derived by globbing
\`scripts/rails\` and \`scripts/soak\`, so it cannot drift from the register scripts **in those
directories** — a register script added under a *third* directory would still be missed.

---

## The three tiers — ordered by PREREQUISITE, not preference

### Tier A — services (needs **ELEVATION**)
\`scripts/install-tower-launcher.ps1\` · \`scripts/ops/install-tower-relay-nssm.ps1\` — both say
"run once, as Administrator" in their own headers.
**Capability check:** the API answers \`/api/health\`. A non-200 still counts as UP — auth-gated
or slow is *serving*; only an unanswered request is a real failure.

### Tier B — node scheduled tasks (needs **node on PATH** + valid paths)
**Capability check:** every task the register scripts create is present **and not Disabled**,
matched by field. The expected list is DERIVED by globbing the register scripts, so a new one
is picked up without editing the check.
⚠ **Registration is necessary and NOT sufficient** — a Disabled task is registered and cannot
run, which is why Disabled is a FAIL here.

### Tier C — the WSL runner (needs **a configured WSL distro**)
\`register-runner-task.ps1\` registers a **WSL** action, not a node script.
**Capability check:** \`wsl -l -q\` lists at least one distro-shaped name.

---

## What the verifier proves, and what it does not

**Proves**, by exercising it: the DB answers · the API serves · the expected tasks are
registered and enabled · a WSL distro exists · **DuckDB can decode data from the lake**.

**Does not prove** that a *rebuilt* box reaches this state. Every check passing on a healthy
box is the expected result and says nothing about recovery. Only a real rebuild-the-box drill
tests that, and it is **operator-scheduled** because it touches irreversibles.

**UNKNOWN is not FAIL.** A checker that cannot run reports UNKNOWN; collapsing that into FAIL
would page an operator about a box that is fine.

---

## Recovery order (designed — not drilled)

1. Repo: \`git clone\`, then check out the branch the tower actually runs (CL-009 — the running
   checkout is manually updated and has drifted).
2. Secrets: place \`.env\`. Resolution honours \`RAILS_ENV_PATH\`/\`SOAK_ENV_PATH\` and finds a
   nested sibling checkout; \`.env.example\` is **not** a complete manifest.
3. \`npm ci\` — then verify \`node_modules/.bin\` is **populated**, not just that packages exist.
   A directory existing is a count; resolving its entry point is the inventory.
4. Database: \`docs/disaster-recovery-db.md\` (the drilled leg — pg17 client required).
5. **Tier A** (elevated) → **Tier B** → **Tier C** (install a WSL distro *first*, or the runner
   task is inert).
6. \`node scripts/ops/verify-recovery.cjs\` — every leg PASS or explained.

---

${renderEnvSection()}## Real incident — SEPARATE AND GUARDED

**Do not run anything in this section as part of a rehearsal.**
Restore-over-production lives in \`docs/disaster-recovery-db.md\` under its own heading and is
**operator-only**. A drill step must never be able to fire a real recovery.

---

## Open items (operator)

- **The deploy gap (CL-009).** The tower's checkout is updated **manually**; a push is inert on
  the box until a manual pull + API restart, and it pulls **both lanes**.
- **A real cold-recovery drill.** Touches irreversibles; operator-scheduled. Until it runs, the
  tiers stay at their stated evidence levels.
`;
}

function main(argv = process.argv.slice(2)) {
  const text = render();
  if (argv.includes("--write")) {
    fs.writeFileSync(OUT, text, "utf-8");
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
    return 0;
  }
  // Compare EOL-NORMALISED. .gitattributes fixes the checkout, but this makes the gate
  // correct wherever that rule does not reach (a zip download, another tool). It does not
  // weaken the honesty property: line endings carry no claim — the CONTENT is what is
  // governed, and a changed evidence cell still differs after normalisation.
  const norm = (x) => x.split("\r\n").join("\n");
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf-8") : "";
  if (norm(current) !== norm(text)) {
    console.error("cold-recovery-runsheet.md is STALE or HAND-EDITED — run: node scripts/ops/render-runsheet.cjs --write");
    return 1;
  }
  console.log("runsheet matches its typed source");
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { render, OUT, main };
