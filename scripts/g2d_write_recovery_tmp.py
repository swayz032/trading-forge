import json, hashlib, os

OUTDIR = "docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-recovery-t1"
os.makedirs(OUTDIR, exist_ok=True)

rows = [
    {
        "condition_ref": "entry_sequence[0].rationale",
        "stem": "entry_sequence_0_.rationale.74936600cfe8",
        "agent_id": "a16430abed638fa5a",
        "duration_ms": 25061,
        "subagent_tokens": 125090,
        "recovered_raw_text": (
            '```json\n'
            '{\n'
            '  "quote": "And what that now gives me is a range on the five minute. Right? So that\'s how high the price went within the first 5 minutes and that\'s how low it went.",\n'
            '  "found": true\n'
            '}\n'
            '```\n\n'
            "Grounding notes:\n"
            '- The condition ("establishes the initial volatility range for the trading session") describes the trader marking the high and low of the first 9:30 ET 5-minute candle. The span above is the shortest contiguous verbatim text where he states that this act produces the range and defines its bounds (highest/lowest price of the first 5 minutes).\n'
            '- A secondary, non-contiguous passage supports the "volatility / trading session" framing if the anchor is later re-scoped to the rationale rather than the range definition: `"Because the 9:30 candle is when New York opens. And the New York session is the most volatile session, especially 9:30. That\'s pretty much the moment where we\'re going to get a big move in the market."` It is verbatim but sits ~2 paragraphs later, so it could not be merged into one contiguous span.'
        ),
    },
    {
        "condition_ref": "entry_sequence[1].action",
        "stem": "entry_sequence_1_.action.772948a5e9bd",
        "agent_id": "af026925433dc73d7",
        "duration_ms": 7649,
        "subagent_tokens": 125101,
        "recovered_raw_text": (
            '```json\n'
            '{\n'
            '  "quote": "the candles need to close outside of this 5m minute range"\n'
            '}\n'
            '```\n\n'
            'Grounding found at the step where the trader defines the breakout trigger. Full surrounding context in the transcript: "We are essentially waiting for the one minute time frame candles to print into one of these sides of the range. Now, what does that mean? What has to happen is the candles need to close outside of this 5m minute range." The quoted span is the shortest contiguous text that grounds the close-outside-the-range condition; the 1-minute timeframe attribution comes from the immediately preceding sentence.'
        ),
    },
    {
        "condition_ref": "entry_sequence[1].rationale",
        "stem": "entry_sequence_1_.rationale.fdda699d03f8",
        "agent_id": "a76ef7696fa2e863b",
        "duration_ms": 16150,
        "subagent_tokens": 125094,
        "recovered_raw_text": (
            '```json\n'
            '{\n'
            '  "quote": "the candles have printed outside of the range on the lower side of this 5m minute time frame. Right now, this is pretty much what we\'re looking for because what it\'s telling us is that price may be looking for a move to the downside"\n'
            '}\n'
            '```\n\n'
            'Grounding note: this span is the transcript\'s own statement that the break of the 9:30 5-minute range in a given direction is what tells the trader which way the market is going for that trade. Adjacent supporting text (not needed, and longer) includes "That gives us an idea of the direction in which the market wants to go for the day." and "if we have traded into the downside of this range, it means that the price is going down. So, we want to be taking a short" (down case) and "So we have our break to the upside." -> "we can go ahead and get this one ready for a buy" (up case). The returned quote is the shortest contiguous span that states the break-direction -> market-direction inference directly.'
        ),
    },
    {
        "condition_ref": "entry_sequence[2].action",
        "stem": "entry_sequence_2_.action.c93f25926694",
        "agent_id": "a0d21183e70186611",
        "duration_ms": 10162,
        "subagent_tokens": 125105,
        "recovered_raw_text": (
            '```json\n'
            '{\n'
            '  "quote": "What we are looking for is a fair value gap sequence that is printing outside of the range."\n'
            '}\n'
            '```\n\n'
            '**Grounding:** The condition is directly and literally stated in the transcript at the point where the speaker transitions from identifying the 5-minute range break to defining the entry trigger. The quote is copied verbatim (exact wording and punctuation) from the passage that follows the discussion of price breaking out of the 5-minute range and precedes the definition of what a fair value gap sequence is ("A fair value gap is when you get a three candle pattern where the low of candle one does not overlap the high of candle three").\n\n'
            '**Note on the "5-minute" qualifier:** the quote says "the range" rather than "the 5-minute range" -- but the referent is unambiguous in context, since the range was established earlier in the same passage ("what that now gives me is a range on the five minute"). A near-alternative supporting span exists a few sentences later ("What\'s important for us to recognize is that the fair value gap has been printed outside of the range"), but the returned quote is the shorter, more direct statement of the *waiting-for* condition rather than the confirmation restatement.'
        ),
    },
    {
        "condition_ref": "entry_sequence[2].rationale",
        "stem": "entry_sequence_2_.rationale.b4a5470ddf98",
        "agent_id": "acc27212dab25d035",
        "duration_ms": 9507,
        "subagent_tokens": 125095,
        "recovered_raw_text": (
            '```json\n'
            '{\n'
            '  "quote": "As soon as we see this gap being printed outside of the range and confirming, then we can enter the trade."\n'
            '}\n'
            '```\n\n'
            '**Grounding notes:** The condition has two parts -- (a) the FVG is the entry, and (b) it comes after the directional break of the 9:30 5-minute range. The quoted span grounds both: "this gap" = the fair value gap, "printed outside of the range" = after the breakout, "then we can enter the trade" = entry point. Verified verbatim against the transcript (it appears immediately after "What\'s important for us to recognize is that the fair value gap has been printed outside of the range.").\n\n'
            'The "high-probability" framing is the extractor\'s editorializing -- the trader never claims a probability or win rate for the FVG entry (he explicitly says "this model is not perfect... You are going to lose on this model"). The quote grounds the mechanical entry rule, not the probability claim.'
        ),
    },
    {
        "condition_ref": "entry_sequence[3].rationale",
        "stem": "entry_sequence_3_.rationale.952f94d75996",
        "agent_id": "acf287199179e1f54",
        "duration_ms": 11289,
        "subagent_tokens": 125099,
        "recovered_raw_text": (
            '```json\n'
            '{\n'
            '  "quote": "my entry is going to be on the closure of that third candle",\n'
            '  "found": true,\n'
            '  "notes": "Grounds the \'entering on the closure\' clause verbatim. The adjacent lines -- \'in order for this fair value gap to be a valid fair value gap, the fair value gap has to actually be formed. And the way that happens is when the third candle of the sequence has been printed\' and \'As soon as we see this gap being printed outside of the range and confirming, then we can enter the trade\' -- ground the \'confirms the FVG structure\' rationale. The \'minimizes entry risk\' clause has NO grounding anywhere in the transcript; it is extractor-added rationale, not the trader\'s words."\n'
            '}\n'
            '```\n\n'
            "Anchor located. The condition is partially grounded: the mechanical part (enter at the third candle's close) and the confirmation rationale are both the trader's own words; the \"minimizes entry risk\" justification is not present in the transcript and appears to be interpolated by the extractor."
        ),
    },
    {
        "condition_ref": "confluences[0].description",
        "stem": "confluences_0_.description.0093d68738e7",
        "agent_id": "a2420621665543cd5",
        "duration_ms": 2616,
        "subagent_tokens": 125091,
        "recovered_raw_text": '{"quote": "this strategy needs to be traded at 9:30 a.m. Eastern time, New York time"}',
    },
    {
        "condition_ref": "confluences[1].description",
        "stem": "confluences_1_.description.40c64b18289a",
        "agent_id": "aa42cdd8132370188",
        "duration_ms": 7110,
        "subagent_tokens": 125092,
        "recovered_raw_text": (
            '```json\n'
            '{\n'
            '  "quote": "the candles need to close outside of this 5m minute range"\n'
            '}\n'
            '```\n\n'
            'Grounding located in the strategy-explanation section, immediately after the trader marks the 9:30 5-minute candle\'s high/low and switches to the 1-minute chart. Full surrounding context: "We are essentially waiting for the one minute time frame candles to print into one of these sides of the range. Now, what does that mean? What has to happen is **the candles need to close outside of this 5m minute range**."\n\n'
            'The chosen span is the shortest contiguous verbatim text that grounds both halves of the condition (1m candle + close outside the initial 5m range); the "one minute time frame candles" attribution comes from the sentence directly preceding it.'
        ),
    },
]

with open("docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json", "r", encoding="utf-8") as f:
    queue = json.load(f)
q_by_ref = {r["condition_ref"]: r for r in queue["queue"]}

manifest_out = []
for row in rows:
    task_input_sha256 = q_by_ref[row["condition_ref"]]["task_input_sha256"]
    recovered_bytes = row["recovered_raw_text"].encode("utf-8")
    recovered_sha256 = hashlib.sha256(recovered_bytes).hexdigest()

    out_obj = {
        "condition_ref": row["condition_ref"],
        "original_stem": row["stem"],
        "agent_id": row["agent_id"],
        "attempt_index": 1,
        "task_input_sha256": task_input_sha256,
        "recovery_source": (
            "task-notification event delivered synchronously by the harness to the "
            "dispatching worker session for this exact agent_id, received and read "
            "before the next row was dispatched. Independent re-verification via the "
            "recorded output_file path was attempted for all 8 agent_ids and found "
            "EMPTY (0 bytes) for every one -- see G2D-RECOVERY-AR1312.md. This "
            "recovery artifact therefore rests on a single retrieval path, not two "
            "independent ones; that limitation is disclosed, not hidden."
        ),
        "recovered_raw_text": row["recovered_raw_text"],
        "recovered_raw_sha256": recovered_sha256,
        "duration_ms": row["duration_ms"],
        "subagent_tokens": row["subagent_tokens"],
        "tool_uses": 0,
        "new_agent_task_or_model_calls_used_for_recovery": 0,
    }
    with open(f"{OUTDIR}/{row['stem']}.recovered.json", "w", encoding="utf-8") as f:
        json.dump(out_obj, f, indent=2, ensure_ascii=False)
    manifest_out.append({"condition_ref": row["condition_ref"], "agent_id": row["agent_id"], "recovered_raw_sha256": recovered_sha256})

print(json.dumps(manifest_out, indent=2))
