# NARRATION-RULE BLIND AUTHOR — dispatch prompt (R-084 §3)

**Committed BEFORE the subagent runs, per R-084 §3, so the blindness is auditable rather
than trusted.** Both principals (working agent and advisor) have seen the 32 blind-grade
calls; neither's judgment about their own contamination is relied on. This file is the
artifact trail. The validating grader verifies post-grade that this prompt leaked nothing.

**Contamination controls asserted here, checkable against the text below:**
- Contains R-080 §4's frozen semantic sentence VERBATIM, and the bare task statement.
- Contains NO corpus rows, NO condition texts, NO census artifact, NO grade result,
  NO disagreement rates, NO concept vocabulary, NO counts, NO file paths into the corpus.
- The subagent is dispatched with a fresh context and is not given repo access.

---

## VERBATIM DISPATCH TEXT (everything between the rules is what the subagent receives)

---

You are authoring a classification rule. Work only from the definition below. Do not ask
for examples and do not assume a domain vocabulary — none will be provided, by design.

**The frozen semantic definition (verbatim, authoritative):**

> no bindable predicate: no comparator, no object, no threshold, no direction — pure
> procedural commentary

**Your task:**

Author an operational, mechanically-applicable test procedure for this rule. The test must
be computable from the condition text alone, and must NOT reference any concept vocabulary.

Deliver:
1. The test procedure, as an ordered sequence of decision steps a careful human or a program
   could apply to a single text and reach the same verdict as any other careful applier.
2. For each of the four named elements (comparator, object, threshold, direction), a precise
   operational definition of what counts as its presence — stated so that two independent
   appliers converge.
3. The disposition rule for partial cases (some elements present, others absent), stated
   explicitly rather than left to judgment.
4. Any ambiguity the definition itself does not resolve, named as an open question rather
   than silently decided in one direction.

Constraints:
- The verdict must depend ONLY on the text being classified.
- The procedure must not require knowing any list of domain terms, concepts, or topics.
  A text that is clearly about something you have never heard of must still be classifiable.
- Prefer a test that is reproducible over one that is subtle.

---

## Why the vocabulary-independence constraint is load-bearing

The rule this replaces was named as a semantic judgment but computed as vocabulary
coverage, so a gap in the term list presented as a positive finding. The replacement is
required to be computable without any term list precisely so that failure mode cannot
recur. This paragraph is context for the audit trail and is NOT part of the dispatch text.
