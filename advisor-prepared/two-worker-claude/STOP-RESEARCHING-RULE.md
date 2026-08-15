# Stop-Researching Rule

Purpose: stop Claude from burning context after enough evidence exists to make the bounded repair safely.

## Default worker loop

```text
identity + lane
-> system inventory / prior art
-> locate canonical owner
-> reproduce RED on real path
-> STOP broad research
-> make smallest repair
-> GREEN + negative/mutation control
-> commit/push/receipt
```

## Stop broad searching when ALL are true
1. The canonical production owner/path has been identified.
2. Existing prior art has been checked enough to avoid duplicate architecture.
3. The real defect/contract gap is reproduced by a focused RED or direct measured witness.
4. The packet states the safety invariant and expected touched-file boundary.

Once those are true, do not keep browsing unrelated files for 'anything else.' Fix the bounded RED.

## Research may reopen only if
- the RED disproves the assumed owner/path;
- the minimal repair requires an unresolved dependency;
- a safety invariant conflicts with the proposed repair;
- the focused GREEN exposes a new causal failure in the same path;
- a shared-file collision requires ownership resolution.

## Attempt budget
Before expanding scope, make at most TWO bounded repair attempts against the same causal hypothesis.

If both fail for different underlying reasons, STOP and report the measured blocker instead of wandering through the repo.

## Forbidden time sinks
- 'while I am here' refactors;
- reading the whole advisor history after START-HERE/queue already resolved the job;
- creating a new subsystem before checking existing authority;
- fixing unrelated failing tests during a bounded packet;
- retry hunting for a convenient passing fixture;
- replacing a clear refusal with guessing/defaults to make progress look faster;
- broad file scans after a production RED and owner are already known.

## Speed law
More research is useful only while it changes the next safe edit.

When it no longer changes the next safe edit, CODE + TEST.