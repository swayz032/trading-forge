---
name: user-profile
description: Principal engineer profile — Trading Forge owner in Production Hardening phase
metadata:
  type: user
---

## User Profile

Trading Forge owner and principal engineer. Building a prop-firm trading system with:
- Production hardening as current phase (not a prototype)
- Paper trading as the promotion-gate/certification layer before live
- Heavy emphasis on journal/audit-log completeness and tamper-evidence
- Zero tolerance for silent failures, distorted parity, or reduced observability

**Technical profile:**
- Works in TypeScript (strict mode), Node.js, PostgreSQL/Drizzle ORM
- Familiar with prop-firm compliance rules (Topstep, MFFU, OFP)
- Values additive changes over refactors — "no schema changes" is a hard constraint
- Tests are expected to be green before claiming work done

**Collaboration style:**
- Execute autonomously, don't stop for approval mid-task
- Conservative choices that preserve integrity over clever solutions
- Document parity assumptions explicitly
- Do NOT commit — parent claude commits per §11a after architect review
