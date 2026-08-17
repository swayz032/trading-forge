# CONTROL-PLANE BOOTSTRAP — ONE-SHOT AUTHORIZATION CLAIMS

**This directory exists so that it does not have to be created during a one-shot critical section.**

AR-1278A F-10: the bootstrap's claim step previously ran
`mkdirSync(dir, {recursive:true})` and then the atomic `wx` write. A failure between those two
operations left external state changed while the authorization was still reusable — small, but this
whole package exists to make that boundary exact.

With the parent committed here, execution performs **exactly one** filesystem act in the critical
section: a `wx` write of `<authorization_id>.json`. It either makes the authorization non-reusable,
or it changes nothing at all.

> `THE FIRST EXTERNAL MUTATION MUST ITSELF BE THE THING THAT SPENDS THE AUTHORIZATION.`

---

Each file here is one spent bootstrap authorization:

```
<authorization_id>.json   authorization_id · ruling_id · target_packet · branch · worktree
                          source_worker_head · bootstrap_bundle_sha256 · claimed_at
```

A claim is **never** deleted to regain a green run. If an execution failed after the claim landed,
the authorization is spent and a new GPT ruling is required — that is the intended cost, not a bug
to route around.

This namespace is deliberately **disjoint** from the frozen G2 receipt namespace
(`docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1`), and
`assertClaimNamespaceDisjoint()` fails the plan build if that ever stops being true.
