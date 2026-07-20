# Narration Rule v2 — Blind-Authored Operational Test

**Status:** authored blind, from the frozen semantic definition only. No examples were consulted, no domain vocabulary was consulted or assumed.

**Frozen semantic definition (verbatim, authoritative):**

> no bindable predicate: no comparator, no object, no threshold, no direction — pure procedural commentary

**Scope of this document:** it converts the definition above into a mechanically-applicable test. It does not extend, narrow, or reinterpret the definition; where the definition is silent, this document makes an explicit, labelled decision and files the silence as an open question (§5) rather than burying it.

**Design constraint honoured throughout:** every step below is computable from the classified text's surface form. No step requires knowing what any content word means, what topic the text is about, or what vocabulary the surrounding system uses. A text about a subject the applier has never encountered is fully classifiable. The only word-lists used are *closed, generic, function-word-grade* inventories (relational operators, measure nouns, polarity morphemes, discourse connectives) that are properties of the language, not of any subject matter.

---

## 1. The test procedure

The procedure produces, for one text, a **record** of six fields:

| field | type | source |
|---|---|---|
| `comparator` | bool + span list | §2.1 |
| `object` | bool + span list | §2.2 |
| `threshold` | bool + span list | §2.3 |
| `direction` | bool + span list | §2.4 |
| `verdict` | `MATCH` / `NO-MATCH` | §3 |
| `binding` | bool (shadow field, always recorded) | §3.3 |

`MATCH` means *the text satisfies the frozen definition* (it is the thing the definition describes). `NO-MATCH` means it does not.

### Step 0 — Fix the unit

The unit of classification is **the entire text handed to the applier, as handed**, with no addition and no subtraction. Specifically:

- 0.1 Do not include any title, filename, label, ID, surrounding record, or metadata that was not inside the text body.
- 0.2 Do not include any material the text refers to but does not contain.
- 0.3 Do include every sentence, fragment, bullet, parenthetical, footnote, quotation, code span, formula, and table cell that is inside the text.
- 0.4 If the text is empty or contains no alphanumeric character, stop: `verdict = MATCH`, all four element flags `false`. (An empty text vacuously contains none of the four elements. Filed as OQ-9.)

### Step 1 — Normalize (reversibly)

Produce a normalization only for *matching*; keep the original for *span citation*.

- 1.1 Preserve character offsets into the original.
- 1.2 Unwrap markup that carries no lexical content: markdown emphasis, list bullets, heading hashes, table pipes, HTML tags. **Do not delete the text inside code spans/blocks** — code is text and is scanned (OQ-8).
- 1.3 Collapse runs of whitespace to a single space. Preserve sentence-ending punctuation.
- 1.4 Case-fold a matching copy. Do not stem, lemmatize, or spell-correct.
- 1.5 Do not resolve pronouns, do not expand abbreviations, do not infer omitted words.

### Step 2 — Scan for each of the four elements, independently

Run §2.1, §2.2, §2.3, §2.4 **in that order but without interaction**, except for the one declared dependency in §2.2 (object may be triggered by an attachment to another element's span). Each scan yields a boolean and a list of contiguous spans.

**Span-citation requirement (load-bearing for reproducibility):** an element may only be marked `true` if the applier can cite at least one **contiguous character span in the original text** that triggers it, together with the numbered clause of §2 that licenses it. An element asserted without a citable span and a clause number is recorded as `false`. This is the mechanism by which two appliers converge: disagreements reduce to "is this span real, and does that clause cover it", both of which are checkable by inspection.

### Step 3 — Apply disqualifiers

Each element's section carries a **disqualifier list**. A span that matches a disqualifier is struck from that element's span list. If an element's span list is emptied by disqualification, the element is `false`. Disqualifiers are applied per-span, never per-text: striking one span never strikes another.

### Step 4 — Compute the verdict

Apply §3 mechanically. No weighting, no impression, no "mostly", no appeal to what the text is *about*.

### Step 5 — Record

Emit all six fields plus the span lists. The record, not the verdict alone, is the deliverable — it is what lets a later reader re-derive the verdict under the alternative reading in OQ-1 without re-reading the text.

---

## 2. Operational definitions of the four elements

Each element is defined by **surface trigger classes** (what makes it present) and **disqualifiers** (what looks like a trigger but is struck). The trigger classes are closed. If a candidate does not match a listed trigger class, the element is absent — appliers must **not** extend the classes by analogy. Under-inclusion is deliberate: it is reproducible, whereas analogical extension is not.

### 2.1 COMPARATOR — present iff the text contains a relation token that takes two operand slots

A comparator is a **surface token or fixed phrase that expresses an ordering, equality, membership, or bounding relation between two slots**. Its presence is a property of the token, not of the operands: an unfilled operand slot does **not** remove the comparator (see OQ-5 for the threshold consequence).

**Trigger class C-1 — symbolic relational operators**, appearing anywhere including inside code or formulas:
`>` `<` `>=` `<=` `=>` `=<` `==` `===` `!=` `!==` `<>` `≥` `≤` `≠` `≈` `~=` `±`
A bare single `=` counts **only** when it stands between two operand-shaped tokens (assignment or equation); `=` inside a word or URL does not count.

**Trigger class C-2 — lexical ordering/bounding phrases** (fixed forms; match as whole words):
greater than · less than · more than · fewer than · larger than · smaller than · higher than · lower than · faster than · slower than · longer than · shorter than · at least · at most · no more than · no less than · no fewer than · not to exceed · exceeds · exceeding · surpasses · falls below · drops below · rises above · above · below · over · under · within · outside of · between … and … · from … to … · up to · as much as · as few as · at or above · at or below · minimum of · maximum of · capped at · floored at · bounded by · limited to

**Trigger class C-3 — equality / identity / membership relations** used predicatively:
equals · is equal to · is the same as · matches · is one of · is in · is not in · belongs to · differs from · other than *(when it separates two operand-shaped nominals; see disqualifier D-C3)*

**Trigger class C-4 — comparative morphology with an explicit second operand:** any `<adjective>-er than <X>` or `more/less <adjective> than <X>` construction where `<X>` is realized in the text. (The same span may also trigger DIRECTION per §2.4; see §2.5 on overlap.)

**Disqualifiers (struck spans):**
- **D-C1 — locative/document reference.** `above`, `below`, `over`, `under`, `within` when the adjacent nominal refers to a position in the document or discourse itself (e.g. "the list below", "within this section", "as noted above"). Test: the immediately governed nominal is a document/discourse noun (*section, document, list, table, note, paragraph, page, chapter, item, figure, appendix, thread, message*) or a deictic (*this, the following, the preceding*). Domain-free: the noun list is generic and closed.
- **D-C2 — comparative used as a bare intensifier with no second operand and no ordered axis**, e.g. "more work", "less effort". Struck from C-2/C-4 (may still trigger DIRECTION per §2.4; the two scans are independent).
- **D-C3 — `than` inside a non-relational fixed phrase:** `rather than`, `other than` used as "except", `no sooner than` used narratively, `less than ideal` as an idiom.
- **D-C4 — temporal narration of the author's own process.** `before`, `after`, `then`, `once` linking activities performed by the author/team (e.g. "after reviewing, we discussed"). These are sequencing connectives, not comparators. Note `before`/`after` were not in C-2 in the first place; D-C4 exists to forbid appliers from importing them by analogy.
- **D-C5 — `within`/`between` used partitively without a bound**, e.g. "differences within the group", "a conversation between the two of us".

### 2.2 OBJECT — present iff the text contains a nominal occupying a bindable argument slot

An object is a **nominal expression that a predicate could be evaluated *on***. Because "is this nominal referential in the intended sense" is not surface-computable in general, object presence is defined **structurally**: a nominal counts only when it stands in one of the enumerated argument positions below. Bare occurrence of a noun never suffices.

**Trigger class O-1 — comparator operand.** A nominal (noun, noun phrase, code identifier, quoted term, or symbol) immediately filling either operand slot of a span marked COMPARATOR in §2.1. Example shape: `<NOMINAL> exceeds …`, `… at least <NOMINAL>`, `<NOMINAL> == …`.

**Trigger class O-2 — threshold attachment.** A nominal adjacent to a span marked THRESHOLD in §2.3, in any of these patterns: `<NOMINAL> <THRESHOLD>`, `<THRESHOLD> <NOMINAL>`, `<NOMINAL>: <THRESHOLD>`, `<NOMINAL> of <THRESHOLD>`, `<THRESHOLD> of <NOMINAL>`, `<NOMINAL> = <THRESHOLD>`.

**Trigger class O-3 — direction argument.** A nominal that is the grammatical subject or direct object of a span marked DIRECTION in §2.4 (e.g. `<NOMINAL> increases`, `reduce the <NOMINAL>`).

**Trigger class O-4 — measure-noun construction (independent route).** A construction of the form `the <MEASURE-NOUN> of <NOMINAL>`, `<NOMINAL>'s <MEASURE-NOUN>`, or `<NOMINAL> <MEASURE-NOUN>`, where MEASURE-NOUN is drawn from this closed, domain-free inventory:
value · level · count · number · size · rate · ratio · amount · duration · length · width · depth · height · weight · score · share · proportion · percentage · fraction · magnitude · frequency · interval · span · total · sum · average · mean · median · maximum · minimum · limit · bound · cap · floor · threshold · target · quota · budget · capacity · margin · gap · delta · variance · range
O-4 is the **only** route by which OBJECT can be `true` while all three other elements are `false`.

**Disqualifiers (struck spans):**
- **D-O1 — generic-process nominal.** A candidate nominal whose head is drawn from the closed generic-process inventory is struck *when it is the only nominal in the slot*: approach · process · procedure · step · stage · phase · work · effort · task · activity · exercise · thing · way · manner · matter · point · issue · topic · aspect · area · side · part · note · comment · remark · discussion · conversation · review · analysis · consideration · attempt · idea · thought · plan · intent · goal · context · background · overview · summary · update · progress · status. Rationale: these are the nominals of commentary about doing, not of the thing acted upon. They are domain-free by construction.
- **D-O2 — first/second-person and discourse referents.** `I`, `we`, `you`, `they` (with no in-text antecedent), `the team`, `the author`, `the reader`, `this document`, `the following`, `the above`.
- **D-O3 — a nominal that is itself a MEASURE-NOUN with no complement**, e.g. "the total was discussed". (The measure noun needs an `of <NOMINAL>` or possessive complement to trigger O-4.)

**Design note (declared, not hidden):** under O-1/O-2/O-3, object presence is *parasitic* — it cannot fire unless another element fired. Only O-4 is independent. This is a consequence of refusing domain vocabulary: distinguishing a referential subject-matter nominal from a commentary nominal without knowing any subject matter is only reliably possible via structural attachment or an explicit measure-noun frame. See OQ-2.

### 2.3 THRESHOLD — present iff the text contains a resolvable magnitude in a value position

A threshold is a **literal magnitude that could serve as the right-hand side of a comparison**.

**Trigger class T-1 — numerals** in any notation: integers, decimals, fractions (`1/2`, `½`), scientific notation, signed numbers, thousands-separated numbers, hexadecimal.

**Trigger class T-2 — spelled-out cardinals and quantities**: `one` … `twelve`, `twenty`, `hundred`, `thousand`, `million`, `billion`, `dozen`, `half`, `quarter`, `third`.

**Trigger class T-3 — magnitudes with a unit or scale marker**: `%`, `percent`, `pct`, `bps`, `x` / `×` as a multiplier, currency symbols and codes, SI prefixes attached to a numeral, time-and-duration literals (`5 min`, `two weeks`, `24h`, `Q3` used as a span), and ratio notation (`3:1`, `2-to-1`).

**Trigger class T-4 — closed-form magnitude words in a value position**: `zero`, `none` (as a quantity), `all`, `any` (as a quantity bound), `every`, `each` (as a distributive bound), `no` + count noun, `maximum`, `minimum`, `unlimited`, `unbounded` — **only** when they fill the operand slot of a comparator span or are attached per O-2. Standalone `all`/`any` in ordinary prose does not fire.

**Disqualifiers (struck spans):**
- **D-T1 — enumeration and ordinal position.** List markers (`1.`, `2)`, `(iii)`), `first/second/third` as sequence words, `step 3`, `phase 2`, `item 4`, `round 2` — these index positions, not magnitudes.
- **D-T2 — identifiers.** Version strings, IDs, ticket/issue numbers, hashes, model/part numbers, phone numbers, ports, addresses, footnote markers, section/figure/page numbers, citation years.
- **D-T3 — calendar points used as dates,** i.e. a date naming a point in time rather than a quantity of time (`2026-07-20`, `on the 14th`, `in March`). A *duration* (`14 days`) is not struck.
- **D-T4 — numerals inside a struck O/C/D construction** are not automatically struck; the scans are independent. This clause exists only to forbid appliers from cascading disqualifications across elements.
- **D-T5 — a numeral used as a name** (`Team 3`, `Route 66`, `the Big 4`).

### 2.4 DIRECTION — present iff the text contains an ordered-axis polarity marker

A direction is a **surface marker of movement, change, sign, or preference along an ordered axis**.

**Trigger class D-1 — change-of-magnitude verbs and their nominalizations** (closed, generic): increase · decrease · rise · fall · grow · shrink · expand · contract · widen · narrow · tighten · loosen · raise · lower · lift · drop · climb · decline · gain · lose · add to · reduce · cut · boost · trim · scale up · scale down · ramp up · ramp down · accelerate · decelerate · speed up · slow down · strengthen · weaken · improve · degrade · worsen · maximize · minimize · optimize *(as maximize/minimize)* · double · halve · exceed · undershoot · overshoot.

**Trigger class D-2 — polarity and sign markers**: positive · negative · plus · minus · gain/loss pairing · surplus · deficit · above-zero/below-zero framing · `+`/`-` prefixed to a magnitude · upward · downward · up · down · higher · lower · more · less · fewer · greater · smaller · stronger · weaker · faster · slower · longer · shorter · earlier · later.

**Trigger class D-3 — comparative and superlative morphology**: any `-er`/`-est` comparative or superlative, and any `more <adj>` / `less <adj>` / `most <adj>` / `least <adj>` construction — **including** those with no second operand (this is where D-C2-struck spans land).

**Trigger class D-4 — monotone preference directives**: `prefer X over Y` · `favour/favor X over Y` · `as <adj> as possible` · `the <adj>er the better` · `err on the side of <adj>` · `bias toward <adj>` · `at all costs`.

**Disqualifiers (struck spans):**
- **D-D1 — discourse-connective idioms** containing a direction word but expressing narrative progression: `going forward` · `moving forward` · `moving on` · `moving ahead` · `up next` · `back to` · `on the up side` used as "additionally" · `down the line` · `further to` · `follow up` · `follow-on` · `next up` · `step back` · `zoom out` · `drill down` · `top-down` / `bottom-up` naming an approach.
- **D-D2 — locative up/down/above/below** referring to physical or document position (same nominal test as D-C1).
- **D-D3 — comparatives inside frozen idioms** carrying no axis: `sooner or later` · `more or less` (as "approximately") · `no less` (as emphasis) · `better part of` · `at best`/`at worst` used as hedges · `first and foremost`.
- **D-D4 — `optimize`, `improve`, `better` applied to the author's own process** ("we improved the write-up") — struck, because the axis is the commentary itself. Test: the grammatical object of the verb is a nominal struck by D-O1 or D-O2.

### 2.5 Overlap between elements

Elements are scanned **independently and may share spans**. A single token may set two or more flags (typically COMPARATOR + DIRECTION via a comparative, or THRESHOLD + OBJECT via an attachment). No token is "consumed" by the first element that claims it.

This is a decision, not a derivation from the definition; see OQ-3.

---

## 3. Verdict and the disposition of partial cases

### 3.1 The primary rule (zero-tolerance)

Let `P` be the set of elements flagged `true` after disqualification.

```
if |P| == 0   ->  verdict = MATCH
if |P| >= 1   ->  verdict = NO-MATCH
```

That is the whole rule. There is no weighting, no threshold count, no majority, no "predominantly", no tie-break, and no discretion.

### 3.2 Partial cases, stated explicitly

The definition enumerates four absences joined by repetition of "no". This procedure reads that enumeration as **jointly required absences**: the class is the intersection of four negatives, so the presence of **any one** element removes the text from the class.

Explicit dispositions, so nothing is left to judgment:

| elements present | verdict |
|---|---|
| none | MATCH |
| threshold only | NO-MATCH |
| direction only | NO-MATCH |
| comparator only (unfilled operands) | NO-MATCH |
| object only (via O-4) | NO-MATCH |
| any two | NO-MATCH |
| any three | NO-MATCH |
| all four | NO-MATCH |

Further explicit dispositions:

- **3.2.1 Negation does not remove presence.** A negated, forbidden, or rejected predicate still contains its elements. "must not exceed the cap" flags COMPARATOR, DIRECTION, OBJECT. Decision recorded; see OQ-4.
- **3.2.2 Modality does not remove presence.** Hypothetical, conditional, future, interrogative, and recommended predicates count the same as asserted ones.
- **3.2.3 Quoted and illustrative material counts.** A predicate inside a quotation, an example, a counter-example, or a code block is present. The rule is a surface rule; it does not model attribution.
- **3.2.4 Mixed texts.** A text that is overwhelmingly commentary but contains one qualifying span anywhere is `NO-MATCH`. Proportion is never consulted.
- **3.2.5 "pure procedural commentary" is treated as a non-operative gloss.** The clause after the em-dash restates the consequence of the four absences; it adds no fifth test. No applier may mark a text `NO-MATCH` on the ground that it "does not read like commentary" while `|P| == 0`, nor `MATCH` on the ground that it "reads like commentary" while `|P| >= 1`. See OQ-6.

### 3.3 The mandatory shadow field

Independently of the verdict, always record:

```
binding = object AND (comparator OR threshold OR direction)
```

`binding` is **not** used in the verdict under §3.1. It is recorded so that if OQ-1 is later resolved in favour of the conjunctive reading, every previously classified text can be re-derived from its record without re-reading it.

### 3.4 Adjudication between two appliers

1. Compare the four booleans. Identical booleans → identical verdict, done.
2. On any disagreement, the applier claiming `true` cites the span and the §2 clause number.
3. If the cited span exists in the text and the cited clause covers it on its face, `true` wins.
4. If the span exists but the cited clause does not cover it, and no other clause does, `false` wins. **Analogical extension of a clause is not a valid citation.**
5. If a disqualifier is invoked, the invoking applier cites the disqualifier number; disqualifiers are checked the same way.
6. If both appliers can cite validly for opposite readings of the *same* span, the case is escalated as an instance of one of the open questions in §5 and is **not** silently resolved.

---

## 4. Worked control checks (structural, vocabulary-free)

These are shape-checks on the procedure itself, not domain examples. They use nonsense content words deliberately, to demonstrate that the procedure never needs to know what a word means.

- `"We then revisited the approach and captured the discussion for later."` → C: none (D-C4 strikes `then`). O: `approach`, `discussion` struck by D-O1; no O-4 frame. T: none. D: `later` is D-2 — **flagged**. Verdict `NO-MATCH`. *This shows the rule is strict: an ordinary temporal comparative is a direction marker unless a disqualifier covers it. `later` is not in D-D1/D-D3, so it stands. Appliers must not "fix" this by intuition — it is registered as OQ-7.*
- `"Work continued on the process; a summary follows."` → C none, O all struck by D-O1/D-O2, T none, D none. Verdict `MATCH`.
- `"The blint of the frobbage must stay at or below 12."` → C-2 `at or below`; O-1 `frobbage` (and O-4 via `the blint of`); T-1 `12`; D-2 `below`. Verdict `NO-MATCH`, all four flags, `binding = true`. *No applier needed to know what a frobbage is.*
- `"Keep the wibble as tight as possible."` → D-4 `as <adj> as possible`; O-3 `wibble`. C false, T false. Verdict `NO-MATCH`, `binding = true`.
- `"Greater than X, per the spec."` → C-2 `greater than`; D-2/D-3 `greater`; T false (unbound placeholder, OQ-5); O false (`X` is a placeholder, not a nominal — though see OQ-5). Verdict `NO-MATCH`.

---

## 5. Open questions the definition does not resolve

These are named, not silently decided. Each records the decision this procedure makes *provisionally* so the procedure is runnable, and states what would change if the decision were reversed.

**OQ-1 — Is the colon enumerative or conjunctive?**
"no bindable predicate: no comparator, no object, no threshold, no direction" can be read (a) as four independently sufficient disqualifiers — any one present means the text is out; or (b) as an unpacking of what a *bindable predicate* is, implying a text is out only when enough elements co-occur to actually bind something (minimally an object plus one relation). *Provisional decision: reading (a), §3.1, because it is more reproducible and does not require judging "enough".* Reversal would move every `|P| >= 1, binding == false` text from `NO-MATCH` to `MATCH`. The `binding` shadow field (§3.3) exists precisely so this can be re-derived without re-reading. **This is the single highest-impact unresolved question.**

**OQ-2 — Can OBJECT be detected at all without domain vocabulary?**
The other three elements have closed, language-level surface inventories. "Object" does not: whether a nominal is a bindable referent or commentary filler is, in the general case, a semantic judgment about subject matter. §2.2 substitutes a structural proxy (attachment) plus one narrow independent frame (measure nouns). *Consequence: OBJECT under-fires relative to what the definition probably intends, and is nearly redundant under reading (a).* No resolution is available inside the stated constraints. If a domain-term list were ever permitted, this is the element that would consume it.

**OQ-3 — May one token satisfy two elements?**
Comparatives ("larger than N") plausibly carry both a comparator and a direction; a numeral attached to a nominal carries both a threshold and an object trigger. *Provisional decision: yes, independent scans, shared spans (§2.5).* The alternative — each token consumed once by the earliest-ordered element — would change `|P|` counts and therefore matters only under reading (b) of OQ-1, but it would change the *record* in every case.

**OQ-4 — Does polarity/modality affect presence?**
The definition speaks of what the text *has*, not what it *asserts*. A prohibition ("must never exceed the cap") contains all the machinery of a bindable predicate while asserting its negation. *Provisional decision: surface presence counts regardless of negation, modality, mood, or attribution (§3.2.1–3.2.3).* The opposite decision would require an asserted-content model, which is not surface-computable and would break applier convergence.

**OQ-5 — Do unbound placeholders count as thresholds?**
"at least N", "greater than X", "no more than TBD", "≤ the configured limit" have a threshold *slot* but no resolvable magnitude. *Provisional decision: comparator `true`, threshold `false`.* The reverse decision (slot-presence counts) would raise threshold-firing substantially on schematic or template-like texts. Related: whether a single-letter placeholder counts as an OBJECT nominal — provisionally `false`, same rationale.

**OQ-6 — Is "pure procedural commentary" a fifth test?**
Read as a restatement, it adds nothing. Read as an independent requirement, it would let an applier reject a text with `|P| == 0` that nonetheless is not commentary (e.g. a bare list of proper nouns, a greeting, a fragment). *Provisional decision: non-operative gloss (§3.2.5).* If made operative it would need its own surface test, which the definition does not supply.

**OQ-7 — Ordinary temporal and evaluative comparatives.**
`later`, `earlier`, `better`, `worse`, `more`, `less` are extremely frequent in ordinary prose that is otherwise pure commentary. §2.4 D-2/D-3 flags them, which makes DIRECTION the highest-firing element by a wide margin and may make `MATCH` rare. The definition gives no basis for exempting "merely rhetorical" comparatives. *No provisional exemption has been added beyond D-D1/D-D3/D-D4* — adding one would require a judgment call the definition does not license. **This is the most likely source of systematic over-firing and should be measured before the rule is trusted.**

**OQ-8 — Non-prose surfaces.**
Code blocks, formulas, tables, config snippets, and symbol soup are dense in `>`/`=`/numerals. *Provisional decision: they are text and are scanned (§1.2).* The alternative (strip non-prose before scanning) would change verdicts for any text carrying an illustrative snippet, and would itself need a reproducible prose/non-prose boundary, which is a further unresolved question.

**OQ-9 — Empty, degenerate, and non-linguistic texts.**
An empty string, a single punctuation mark, or a bare identifier contains none of the four elements and therefore returns `MATCH` under §3.1 — yet calling it "pure procedural commentary" is odd. *Provisional decision: `MATCH` (§0.4).* Under an operative reading of OQ-6 these would become `NO-MATCH`.

**OQ-10 — Language and tokenization.**
Every inventory in §2 is English surface form. A text in another language, or heavily transliterated, is not classifiable by this procedure without an equivalent inventory being authored for that language. The definition is silent on language scope. No provisional decision is available; such texts should be recorded as `UNCLASSIFIABLE` rather than forced to a verdict.

---

## 6. What this rule deliberately does not do

- It does not consult any list of domain terms, concepts, topics, or catalog entries, and cannot be made to depend on one without violating its stated constraint.
- It does not judge whether the text is *true*, *useful*, *well-written*, or *about* anything in particular.
- It does not weight, score, or rank. The output is a boolean verdict plus a fully auditable record.
- It does not resolve §5. Any implementation that silently resolves an open question in one direction has departed from this document and must say so.
