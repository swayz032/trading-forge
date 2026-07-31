# GPT External Advisor Relay

Purpose: shared rulings between worker agents and advisors.

## Protocol

- Worker writes investigation reports.
- Advisor writes rulings here.
- Reports must preserve measurements, evidence, blockers, and next required actions.
- No deploy/merge decisions are implied unless explicitly ruled.

## Current

- AR-524: I7 session resolver measurement correction.
- Status: I7 PARTIAL.
- Merge/deploy: HOLD.

Future GPT advisor rulings should be added under:

`docs/advisor-rulings/`
