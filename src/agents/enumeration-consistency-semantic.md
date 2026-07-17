<!-- PROMPT_VERSION: enumeration-consistency-semantic-v1 (2026-07-15, path-1 ruling; MINTED-LAW: prose-format=semantic) -->
# Enumeration-Consistency Check (SEMANTIC, cross-vendor)

You judge ONE extracted trading strategy against its video's ENUMERATION-EXCLUDED MENTIONS. The certified
enumeration read the whole transcript and ruled certain taught scenarios UNPROMOTED MENTIONS — content it
deliberately EXCLUDED (no runnable entry, retrospective "you would have", deferred to another video,
dispreferred alternative, a cited mistake/counterfactual, a risk-contrast aside). Answer ONE question:

**Does any of this strategy's VARIANTS re-promote a setup the enumeration EXCLUDED as a mention?**

You are given: the strategy object (with variants[]), the video's excluded mentions (each a DESCRIPTION +
why it was ruled a mention), and the transcript for context. Judge by MEANING, not word-matching — a variant
re-promotes an excluded mention if it turns that excluded scenario into a runnable, direction-tagged setup,
however it is phrased.

## The test
For each variant: is it, in substance, the SAME setup as one of the excluded mentions — now dressed as a
runnable variant? Consider especially:
- An OPPOSITE-DIRECTION variant that matches an excluded opposite-direction mention (e.g. a short "breakdown"
  variant inside a long support-bounce strategy, where the breakdown was ruled a retrospective mention).
- A "standalone model" variant matching a mention the enumeration ruled a passing "could be used by itself" aside.
- Any variant whose mechanic IS an excluded scenario given runnable entry mechanics it lacked in the transcript.
A variant that is a LEGITIMATE configuration of the strategy's OWN skeleton (timeframe / confirmation / support-level)
and does NOT correspond to any excluded mention → fine. Judge substance against the excluded DESCRIPTIONS.

## Output — return ONLY this JSON
```json
{
  "strategy_name": "<name>",
  "enumeration_consistent": true,
  "offending_variants": [ {"variant": "<name>", "re_promotes_mention": "<the excluded mention it matches>"} ],
  "reasoning": "<one paragraph: which variant (if any) re-promotes which excluded mention, by meaning>"
}
```
`enumeration_consistent` = false IFF at least one variant re-promotes an excluded mention. Empty excluded-mention
list, or no variants, or all variants legitimate → true. Judge meaning against descriptions; never require literal
key strings (the mechanical version's fatal flaw). When uncertain whether a variant IS an excluded mention,
read the transcript span for whether that scenario was taught runnable or only mentioned.
