/**
 * Wave 26 Pass I (2026-05-26) — Gemma prose → v11 structured fields synthesizer.
 *
 * Gemma4:e2b (operator's mandated model) cannot emit v11 nested JSON shape without
 * GBNF grammar enforcement, and GBNF crashes the Ollama runner on RTX 5060 8GB VRAM.
 * BUT Gemma DOES capture the semantic content in v10 `entry_rules` prose + flat
 * `stop_loss_atr_multiple` + `confluence_factors` + `confirming_indicators` etc.
 *
 * This module parses Gemma's v10 output and synthesizes the 6 v11 structured fields
 * the graduator stamps (Pass I track 2):
 *   - entry_sequence[]    from entry_rules prose
 *   - stop_loss object    from stop_loss_atr_multiple + prose anchor mentions
 *   - targets[]           from entry_rules prose + take_profit_atr_multiple
 *   - filters[]           from entry_rules + risk_rules prose
 *   - timeframes object   from timeframe + bias_timeframe + execution_timeframe
 *   - indicators_used[]   from entry_indicator + confirming_indicators
 *
 * Only synthesizes fields when not already present (additive — operator can still
 * upgrade to a model that emits v11 directly without losing this fallback path).
 */

type GemmaIdea = Record<string, unknown> & {
  entry_rules?: string;
  risk_rules?: string;
  exit_rules?: string;
  entry_condition?: string;
  entry_indicator?: string;
  timeframe?: string;
  bias_timeframe?: string;
  execution_timeframe?: string;
  stop_loss_atr_multiple?: number;
  take_profit_atr_multiple?: number;
  confluence_factors?: unknown[];
  confirming_indicators?: unknown[];
  direction?: string;
  // v11 fields if model emits directly
  entry_sequence?: unknown[];
  stop_loss?: unknown;
  targets?: unknown[];
  filters?: unknown[];
  timeframes?: unknown;
  indicators_used?: unknown[];
};

const ICT_ARCHETYPE_RX = /^archetype:(ict_|fvg_|order_block|market_structure|break_of_structure|liquidity|displacement|wyckoff_)/i;

function isFilledArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function detectArchetypeFamily(entryIndicator: string | undefined): "ict_layered" | "ma_based" | "breakout" | "structural" | "other" {
  const ei = String(entryIndicator ?? "").toLowerCase();
  if (ei.includes("ict_bias_aligned") || ei.includes("ict_silver_bullet") || ei.includes("ict_power_of_3")) return "ict_layered";
  if (ei.includes("bounce_off_level") || ei.includes("ma_") || ei.includes("ema") || ei.includes("sma")) return "ma_based";
  if (ei.includes("breakout") || ei.includes("orb") || ei.includes("opening_range") || ei.includes("session_open")) return "breakout";
  if (ICT_ARCHETYPE_RX.test(ei)) return "structural";
  return "other";
}

/**
 * Synthesize entry_sequence[] from prose. Detects sequenced rule patterns
 * (HTF bias → structure step → entry trigger) and emits step objects.
 */
function synthesizeEntrySequence(idea: GemmaIdea): unknown[] | undefined {
  if (isFilledArray(idea.entry_sequence)) return undefined; // already emitted by model
  const prose = `${idea.entry_rules ?? ""} ${idea.entry_condition ?? ""}`.trim();
  if (prose.length < 30) return undefined;
  const family = detectArchetypeFamily(idea.entry_indicator);
  const steps: Array<Record<string, unknown>> = [];

  // Step 1 — HTF bias (look for weekly/daily/4H mentions or "bias" keyword)
  if (/\b(htf|w\/d\/4h|weekly|daily|4\s?h(?:our)?|higher.?time.?frame|bias|hh\/hl|lh\/ll|higher\s+highs|lower\s+lows|trending|trend.+direction)\b/i.test(prose)) {
    steps.push({
      step: 1,
      name: "htf_bias_confirmed",
      rule: "Higher-timeframe trend established (W/D/4H aligned). Long bias requires higher highs + higher lows; short bias requires lower highs + lower lows.",
      indicators_needed: ["market_structure", "trend_continuity"],
      source: "synthesized_from_prose",
    });
  }

  // Step 2 — Structure/liquidity trigger (SFP, MSS, BOS, liquidity raid)
  const hasSFP = /\b(swing failure|sfp|liquidity raid|raid (?:on |the |old )(?:low|high)|wick (?:takes|grabs)|stop.?(?:run|hunt))\b/i.test(prose);
  const hasMSS = /\b(market.?structure.?shift|mss|change.?of.?character|choch|break.?of.?structure|bos|closure (?:above|below))\b/i.test(prose);
  if (hasSFP) {
    steps.push({
      step: steps.length + 1,
      name: "liquidity_raid_sfp",
      rule: "Price raids prior swing high (short bias) or swing low (long bias) AND closes back through that level — the wick takes retail out, then closure signals the trap.",
      indicators_needed: ["swing_highs_lows", "candle_closure"],
      source: "synthesized_from_prose",
    });
  } else if (hasMSS) {
    steps.push({
      step: steps.length + 1,
      name: "market_structure_shift",
      rule: "Confirmed BOS/CHoCH/MSS aligned with HTF bias (closure + follow-through of an old level).",
      indicators_needed: ["market_structure", "candle_closure"],
      source: "synthesized_from_prose",
    });
  }

  // Step 3 — Entry trigger (FVG, displacement, retest)
  const hasFVG = /\b(fair.?value.?gap|fvg|imbalance|inefficiency)\b/i.test(prose);
  const hasDisplacement = /\b(displacement|large.?body|strong.?candle|momentum.?candle|range.?expansion)\b/i.test(prose);
  const hasBounce = /\b(bounce|rejection|retest|pullback|reject(?:ion|ed)\s+(?:off|from))\b/i.test(prose);
  if (hasFVG && hasDisplacement) {
    steps.push({
      step: steps.length + 1,
      name: "displacement_with_fvg_entry",
      rule: "Large-body candle creates a fair value gap AND breaks market structure. Enter inside the FVG on retest, or after rejection from the FVG edge.",
      indicators_needed: ["fair_value_gap", "displacement_candle", "market_structure_break"],
      source: "synthesized_from_prose",
    });
  } else if (hasFVG) {
    steps.push({
      step: steps.length + 1,
      name: "fvg_retrace_entry",
      rule: "Enter on retrace into the fair value gap, or after rejection from the FVG edge.",
      indicators_needed: ["fair_value_gap"],
      source: "synthesized_from_prose",
    });
  } else if (hasBounce && family === "ma_based") {
    steps.push({
      step: steps.length + 1,
      name: "ma_rejection_entry",
      rule: "Enter on wick rejection / engulfing pattern off the moving average level.",
      indicators_needed: ["moving_average", "rejection_pattern"],
      source: "synthesized_from_prose",
    });
  }

  // For ICT-style strategies, ensure at least 3 steps. For others, at least 2.
  const minSteps = family === "ict_layered" || family === "structural" ? 3 : 2;
  if (steps.length < minSteps) {
    // Generic entry-trigger step from indicator name
    steps.push({
      step: steps.length + 1,
      name: "generic_entry_trigger",
      rule: `Entry per indicator: ${idea.entry_indicator ?? "primary signal"}`,
      indicators_needed: [String(idea.entry_indicator ?? "primary_signal").replace(/^archetype:/, "")],
      source: "synthesized_fallback",
    });
  }
  return steps;
}

/**
 * Synthesize stop_loss object from flat ATR multiple + prose anchor mentions.
 */
function synthesizeStopLoss(idea: GemmaIdea): Record<string, unknown> | undefined {
  if (idea.stop_loss !== undefined && typeof idea.stop_loss === "object" && idea.stop_loss !== null) return undefined;
  const prose = `${idea.entry_rules ?? ""} ${idea.risk_rules ?? ""} ${idea.entry_condition ?? ""}`;
  let anchor = "atr_multiple"; // default
  if (/\b(below the swing|swing low|below.*swing|invalidat\w+ below)\b/i.test(prose)) anchor = "swing_low_below_entry";
  else if (/\b(above the swing|swing high|above.*swing|invalidat\w+ above)\b/i.test(prose)) anchor = "swing_high_above_entry";
  else if (/\b(below.*fvg|fvg low|low end of (?:the )?fvg)\b/i.test(prose)) anchor = "fvg_low";
  else if (/\b(above.*fvg|fvg high|high end of (?:the )?fvg)\b/i.test(prose)) anchor = "fvg_high";
  else if (/\b(after the sfp|after.*swing failure|swing.+sfp)\b/i.test(prose)) anchor = "swing_after_sfp";

  return {
    anchor,
    buffer_atr: typeof idea.stop_loss_atr_multiple === "number" ? idea.stop_loss_atr_multiple : 1.5,
    rationale: anchor === "atr_multiple"
      ? `ATR-multiple stop (${idea.stop_loss_atr_multiple ?? 1.5}× ATR). Framework-overlay will apply structural ceilings per CLAUDE.md §4.`
      : `Stop placed at ${anchor.replace(/_/g, " ")} per speaker rule (synthesized from prose).`,
    source: "synthesized_from_prose",
  };
}

/**
 * Synthesize targets[] from prose mentions of common DOL types.
 */
function synthesizeTargets(idea: GemmaIdea): Array<Record<string, unknown>> | undefined {
  if (isFilledArray(idea.targets)) return undefined;
  const prose = `${idea.entry_rules ?? ""} ${idea.exit_rules ?? ""} ${idea.entry_condition ?? ""}`;
  const targets: Array<Record<string, unknown>> = [];
  let priority = 1;

  if (/\b(equal highs|equal lows|equal high\/low|eqh|eql|double tops?|double bottoms?)\b/i.test(prose)) {
    targets.push({ priority: priority++, type: "equal_highs_lows", rationale: "Speaker explicitly targets equal-highs/equal-lows liquidity (synthesized from prose)." });
  }
  if (/\b(previous daily (?:high|low)|prior daily|pdh|pdl)\b/i.test(prose)) {
    targets.push({ priority: priority++, type: "previous_daily_high_low", rationale: "Previous daily high/low (synthesized from prose)." });
  }
  if (/\b(previous weekly (?:high|low)|prior weekly|pwh|pwl)\b/i.test(prose)) {
    targets.push({ priority: priority++, type: "previous_weekly_high_low", rationale: "Previous weekly high/low (synthesized from prose)." });
  }
  if (/\b(previous monthly|prior monthly|pmh|pml)\b/i.test(prose)) {
    targets.push({ priority: priority++, type: "previous_monthly_high_low", rationale: "Previous monthly high/low (synthesized from prose)." });
  }
  if (/\b(range (?:high|low)|asian (?:high|low)|london (?:high|low)|session (?:high|low)|hod|lod)\b/i.test(prose)) {
    targets.push({ priority: priority++, type: "session_range_extremes", rationale: "Session range high/low (synthesized from prose)." });
  }
  if (/\b(naked poc|untouched poc|virgin poc|vpoc)\b/i.test(prose)) {
    targets.push({ priority: priority++, type: "naked_poc", rationale: "Naked point-of-control (synthesized from prose)." });
  }
  // Always include the ATR-multiple TP as the lowest-priority fallback
  if (typeof idea.take_profit_atr_multiple === "number" && idea.take_profit_atr_multiple > 0) {
    targets.push({
      priority: priority++,
      type: "atr_multiple",
      r_multiple: idea.take_profit_atr_multiple,
      rationale: `R-multiple fallback (${idea.take_profit_atr_multiple}R). Framework-overlay applies adaptive engine when liquidity_target_clear satisfied.`,
    });
  }
  return targets.length > 0 ? targets : undefined;
}

/**
 * Synthesize filters[] from prose mentions of avoid conditions + risk filters.
 */
function synthesizeFilters(idea: GemmaIdea): Array<Record<string, unknown>> | undefined {
  if (isFilledArray(idea.filters)) return undefined;
  const prose = `${idea.entry_rules ?? ""} ${idea.risk_rules ?? ""} ${idea.entry_condition ?? ""}`;
  const filters: Array<Record<string, unknown>> = [];

  if (/\b(avoid.*(?:neutral|ranging|chop)|(?:neutral|ranging|chop).*market|no clear direction|sideways|consolidation)\b/i.test(prose)) {
    filters.push({ type: "avoid_when", condition: "neutral_or_ranging_market", rationale: "Speaker explicitly avoids neutral/ranging markets (synthesized from prose)." });
  }
  if (/\b(equal liquidity (?:on |both )?sides|liquidity (?:on |both )?sides|both sides.+liquidity)\b/i.test(prose)) {
    filters.push({ type: "avoid_when", condition: "equal_liquidity_both_sides", rationale: "Speaker avoids markets with equal liquidity on both sides (synthesized from prose)." });
  }
  if (/\b(conflicting (?:htf|fvg|structure|setup)|opposing (?:htf|fvg|structure))\b/i.test(prose)) {
    filters.push({ type: "avoid_when", condition: "conflicting_htf_structure_or_fvgs", rationale: "Speaker avoids conflicting HTF structure / FVGs (synthesized from prose)." });
  }
  const rrMatch = prose.match(/\b(?:minimum |min )?(?:risk.?reward|r:?r|rr)\s*(?:of |>=?|at least |must be )?(\d+(?:\.\d+)?)\s*(?:r|to 1|:1)?/i);
  if (rrMatch) {
    const val = parseFloat(rrMatch[1]);
    if (val >= 1 && val <= 10) {
      filters.push({ type: "min_rr", value: val, rationale: `Speaker requires minimum ${val}R risk/reward (synthesized from prose).` });
    }
  }
  // News blackout filter from macro_alignment confluence factor
  if (Array.isArray(idea.confluence_factors) && idea.confluence_factors.includes("macro_alignment")) {
    filters.push({ type: "avoid_when", condition: "macro_news_blackout", rationale: "macro_alignment confluence factor implies FOMC/CPI/NFP blackout (hard-block per CLAUDE.md §12)." });
  }
  // Always include a session-only filter if RTH-only is stated
  const sessionFilter = typeof (idea as { session_filter?: unknown }).session_filter === "string" ? (idea as { session_filter?: string }).session_filter : null;
  if (sessionFilter && sessionFilter !== "ALL") {
    filters.push({ type: "session_only", value: sessionFilter, rationale: `Trade only during ${sessionFilter} (synthesized from session_filter field).` });
  }
  return filters.length > 0 ? filters : undefined;
}

/**
 * Synthesize timeframes object from flat timeframe fields + prose mentions.
 */
function synthesizeTimeframes(idea: GemmaIdea): Record<string, unknown> | undefined {
  if (idea.timeframes !== undefined && typeof idea.timeframes === "object" && idea.timeframes !== null) return undefined;
  const VALID_TFS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
  const biasTfs: string[] = [];
  const entryTfs: string[] = [];
  const triggerTfs: string[] = [];

  // Pull from prose
  const prose = `${idea.entry_rules ?? ""} ${idea.entry_condition ?? ""}`;
  if (/\bweekly\b/i.test(prose)) biasTfs.push("1w");
  if (/\bdaily\b|\bD1\b/i.test(prose)) biasTfs.push("1d");
  if (/\b4\s?h(?:our)?\b|\bH4\b/i.test(prose)) biasTfs.push("4h");
  if (/\b1\s?h(?:our)?\b|\bH1\b/i.test(prose)) biasTfs.push("1h");

  // Pull from flat fields
  if (idea.bias_timeframe && VALID_TFS.has(idea.bias_timeframe) && !biasTfs.includes(idea.bias_timeframe)) biasTfs.push(idea.bias_timeframe);
  if (idea.execution_timeframe && VALID_TFS.has(idea.execution_timeframe)) entryTfs.push(idea.execution_timeframe);
  if (idea.timeframe && VALID_TFS.has(idea.timeframe) && !entryTfs.includes(idea.timeframe)) entryTfs.push(idea.timeframe);

  // Trigger TF: typically the lowest TF below entry
  if (entryTfs[0]) {
    const order = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];
    const idx = order.indexOf(entryTfs[0]);
    if (idx > 0) triggerTfs.push(order[idx - 1]);
  }

  if (biasTfs.length === 0 && entryTfs.length === 0) return undefined;
  return {
    bias: biasTfs.length > 0 ? biasTfs : (entryTfs[0] === "5m" || entryTfs[0] === "15m" ? ["1d", "4h"] : ["1d"]),
    entry: entryTfs.length > 0 ? entryTfs : ["15m"],
    trigger: triggerTfs,
    source: "synthesized_from_prose",
  };
}

/**
 * Synthesize indicators_used[] from entry_indicator + confirming_indicators.
 */
function synthesizeIndicatorsUsed(idea: GemmaIdea): Array<Record<string, unknown>> | undefined {
  if (isFilledArray(idea.indicators_used)) return undefined;
  const out: Array<Record<string, unknown>> = [];
  if (idea.entry_indicator) {
    const name = String(idea.entry_indicator).replace(/^archetype:/, "");
    out.push({ name, purpose: "primary entry trigger (synthesized from entry_indicator field)." });
  }
  if (Array.isArray(idea.confirming_indicators)) {
    for (const ci of idea.confirming_indicators) {
      if (typeof ci === "object" && ci !== null && "indicator" in ci && typeof (ci as { indicator?: unknown }).indicator === "string") {
        out.push({ name: (ci as { indicator: string }).indicator, purpose: "confirming indicator (synthesized from confirming_indicators field)." });
      }
    }
  }
  return out.length > 0 ? out : undefined;
}

// ─── v12 speaker-concept-driven synthesis ────────────────────────────────
// When Gemma emits speaker_concepts (the speaker's exact vocabulary), use THOSE
// to build v11 fields instead of the generic regex catalog above. This is what
// makes the system extract ANY video — the speaker tells us their terms;
// we just translate role → v11 field slot, keeping their verbatim words.

type SpeakerConcept = {
  term?: string;
  role?: string;
  verbatim_description?: string;
  transcript_quote?: string;
};

function buildEntrySequenceFromSpeakerConcepts(concepts: SpeakerConcept[]): unknown[] | undefined {
  // Entry-step concepts in their original order from the speaker
  const steps = concepts.filter(c => c.role === "entry_step" || c.role === "phase");
  if (steps.length === 0) return undefined;
  return steps.map((c, idx) => ({
    step: idx + 1,
    name: String(c.term ?? "unnamed_step").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60),
    rule: c.verbatim_description ?? c.transcript_quote ?? c.term ?? "",
    speaker_term: c.term,
    indicators_needed: [],
    source: "speaker_concept",
  }));
}

function buildStopLossFromSpeakerConcepts(concepts: SpeakerConcept[], fallbackAtr: number): Record<string, unknown> | undefined {
  const stop = concepts.find(c => c.role === "stop_anchor");
  if (!stop) return undefined;
  return {
    anchor: String(stop.term ?? "speaker_defined").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60),
    speaker_term: stop.term,
    buffer_atr: fallbackAtr,
    rationale: stop.verbatim_description ?? stop.transcript_quote ?? stop.term ?? "speaker-defined stop",
    source: "speaker_concept",
  };
}

function buildTargetsFromSpeakerConcepts(concepts: SpeakerConcept[]): Array<Record<string, unknown>> | undefined {
  const tgs = concepts.filter(c => c.role === "target");
  if (tgs.length === 0) return undefined;
  return tgs.map((c, idx) => ({
    priority: idx + 1,
    type: String(c.term ?? "target").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60),
    speaker_term: c.term,
    rationale: c.verbatim_description ?? c.transcript_quote ?? c.term ?? "",
    source: "speaker_concept",
  }));
}

function buildFiltersFromSpeakerConcepts(concepts: SpeakerConcept[]): Array<Record<string, unknown>> | undefined {
  const fls = concepts.filter(c => c.role === "filter");
  if (fls.length === 0) return undefined;
  return fls.map(c => ({
    type: "speaker_filter",
    condition: String(c.term ?? "filter").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60),
    speaker_term: c.term,
    rationale: c.verbatim_description ?? c.transcript_quote ?? c.term ?? "",
    source: "speaker_concept",
  }));
}

function buildIndicatorsUsedFromSpeakerConcepts(concepts: SpeakerConcept[]): Array<Record<string, unknown>> | undefined {
  // indicator + zone + model = things to track on the chart
  const inds = concepts.filter(c => c.role === "indicator" || c.role === "zone" || c.role === "model");
  if (inds.length === 0) return undefined;
  return inds.map(c => ({
    name: String(c.term ?? "indicator").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 60),
    speaker_term: c.term,
    role: c.role,
    purpose: c.verbatim_description ?? c.transcript_quote ?? c.term ?? "",
    source: "speaker_concept",
  }));
}

/**
 * Main entry — given a Gemma idea, return the v11 fields to merge in.
 * Priority order per field:
 *   1. Gemma's direct v11 emission (model emitted entry_sequence/stop_loss/etc directly)
 *   2. Speaker-concept-driven build (v12 — uses the speaker's exact vocabulary)
 *   3. Prose synthesizer (regex catalog fallback — generic ICT/SMC terms only)
 */
export function synthesizeV11FromGemmaProse(idea: GemmaIdea): Partial<{
  entry_sequence: unknown[];
  stop_loss: Record<string, unknown>;
  targets: Array<Record<string, unknown>>;
  filters: Array<Record<string, unknown>>;
  timeframes: Record<string, unknown>;
  indicators_used: Array<Record<string, unknown>>;
  _v11_synthesis_source: string;
}> {
  const out: Partial<{
    entry_sequence: unknown[];
    stop_loss: Record<string, unknown>;
    targets: Array<Record<string, unknown>>;
    filters: Array<Record<string, unknown>>;
    timeframes: Record<string, unknown>;
    indicators_used: Array<Record<string, unknown>>;
    _v11_synthesis_source: string;
  }> = {};

  // ── v12 PRIORITY: speaker_concepts drives v11 field synthesis ──
  const sc = (idea as { speaker_concepts?: unknown }).speaker_concepts;
  const speakerConcepts: SpeakerConcept[] = Array.isArray(sc)
    ? (sc as unknown[]).filter((it): it is SpeakerConcept => typeof it === "object" && it !== null)
    : [];

  if (speakerConcepts.length > 0) {
    const fallbackAtr = typeof idea.stop_loss_atr_multiple === "number" ? idea.stop_loss_atr_multiple : 1.5;
    const esSpeaker = buildEntrySequenceFromSpeakerConcepts(speakerConcepts);
    const slSpeaker = buildStopLossFromSpeakerConcepts(speakerConcepts, fallbackAtr);
    const tgSpeaker = buildTargetsFromSpeakerConcepts(speakerConcepts);
    const flSpeaker = buildFiltersFromSpeakerConcepts(speakerConcepts);
    const iuSpeaker = buildIndicatorsUsedFromSpeakerConcepts(speakerConcepts);
    if (esSpeaker && !isFilledArray(idea.entry_sequence)) out.entry_sequence = esSpeaker;
    if (slSpeaker && !(idea.stop_loss && typeof idea.stop_loss === "object")) out.stop_loss = slSpeaker;
    if (tgSpeaker && !isFilledArray(idea.targets)) out.targets = tgSpeaker;
    if (flSpeaker && !isFilledArray(idea.filters)) out.filters = flSpeaker;
    if (iuSpeaker && !isFilledArray(idea.indicators_used)) out.indicators_used = iuSpeaker;
    if (Object.keys(out).length > 0) out._v11_synthesis_source = "speaker_concepts_v12";
  }

  // ── Fallback: regex catalog synthesis for fields speaker_concepts didn't fill ──
  if (!out.entry_sequence) { const es = synthesizeEntrySequence(idea); if (es) out.entry_sequence = es; }
  if (!out.stop_loss)      { const sl = synthesizeStopLoss(idea);      if (sl) out.stop_loss = sl; }
  if (!out.targets)        { const tg = synthesizeTargets(idea);       if (tg) out.targets = tg; }
  if (!out.filters)        { const fl = synthesizeFilters(idea);       if (fl) out.filters = fl; }
  if (!out.timeframes)     { const tf = synthesizeTimeframes(idea);    if (tf) out.timeframes = tf; }
  if (!out.indicators_used){ const iu = synthesizeIndicatorsUsed(idea); if (iu) out.indicators_used = iu; }
  if (Object.keys(out).length > 0 && !out._v11_synthesis_source) {
    out._v11_synthesis_source = "gemma_prose_to_v11_synthesizer";
  }
  return out;
}
