# Short Evidence Receipt Template

Use this instead of a long storytelling report when a bounded worker packet is complete.

```text
JOB: AR-____
WORKER: worker-1 | worker-2
LANE: __________
STARTING_SHA: <40-char>
ENDING_SHA: <40-char>

RED:
command: <exact>
result: <exact failure / witness>

CHANGED_FILES:
- path
- path

GREEN:
command: <exact>
result: <exact pass counts / exit code>

NEGATIVE_OR_MUTATION_CONTROL:
control: <what was changed/removed/wrong>
result: <must fail/change outcome>

FULL_REGRESSION:
command: <exact or N/A with bounded reason>
result: <exact>

COMMIT: <40-char SHA>
PUSHED_BRANCH: <branch>

KNOWN_LIMIT:
- <one bounded limitation or NONE>

CROSS_LANE_FILES_TOUCHED: NONE | <paths + handoff receipt>
BROKER_EGRESS: ZERO
STOPPED_FOR_GPT: YES
```

Rules:
- No words like 'all good' without exact evidence.
- Do not paste secrets/tokens.
- Report actual commands, not commands you intended to run.
- If RED was not reproducible, say so and STOP instead of inventing a fix.
- If a required control did not bite, packet is not complete.
- One receipt = one bounded worker order.