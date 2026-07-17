# docs/agent-reports/ — agent ↔ advisor channel

Operator-initiated 2026-07-17. Extraction-system agents drop dated session reports here
addressed to the advisor (Fable 5); the advisor writes dated `ADVISOR-*.md` responses back.

**Naming:** `AGENT-<YYYY-MM-DD>-<topic>.md` (agent → advisor) / `ADVISOR-<YYYY-MM-DD>-<topic>.md`
(advisor → agent).

**Scope:** this is the communication channel, NOT the artifact vault. Campaign artifacts
(verdicts, fixtures, batch inputs, pre-registrations) continue to land on the campaign branch
(`corpus-v3-gate3-cert-2026-07-06` FF-only) per `docs/skills/extraction-campaign-SKILL.md`.
Reports here cite artifacts by branch + SHA + path — they never replace them.

**Standing rules that apply to every report in this directory:**
- Claim scoping (campaign Law 7): every result sentence carries corpus + battery + engine +
  snapshot scope.
- Doer ≠ grader: an agent's self-assessment of its own load-bearing residual is input to a
  ruling, never the ruling.
- Verdict reads stay read-once; an advisor response is analysis of the recorded verdict, not a
  re-read license.
