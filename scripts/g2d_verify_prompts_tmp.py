import json, hashlib

with open("docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json", "r", encoding="utf-8") as f:
    queue = json.load(f)

with open("docs/replay-results/svkm-extraction-certified/grade/opus-v2/native_call_manifest_t1.json", "r", encoding="utf-8") as f:
    manifest = json.load(f)

with open("src/engine/extraction/fixtures/source-evidence/sVkmZklJDHI.transcript.txt", "r", encoding="utf-8") as f:
    transcript = f.read()

SYSTEM_PROMPT = (
    "You are an anchor locator for trading-education transcripts. You are given "
    "ONE extracted strategy condition and the FULL transcript it was extracted "
    "from. Find the literal span of transcript text that GROUNDS the condition -- "
    "the trader's own words that this condition is describing.\n\n"
    "Rules:\n"
    "1. Your `quote` MUST be copied VERBATIM from the transcript -- exact "
    "wording, exact punctuation. Do not paraphrase, summarize, or correct "
    "the trader's grammar.\n"
    "2. Prefer the SHORTEST contiguous span that still grounds the condition.\n"
    "3. If you cannot find transcript text that grounds this condition, return "
    "`quote: null`. Declining is CORRECT when no grounding exists -- do not "
    "invent or approximate a quote.\n\n"
    "Return JSON matching the schema."
)

def build_user_message(transcript, condition_text):
    return (
        f"CONDITION:\n{condition_text}\n\n"
        f"TRANSCRIPT:\n{transcript}\n\n"
        "Return the literal grounding quote, or null."
    )

q_by_ref = {row["condition_ref"]: row for row in queue["queue"]}

results = []
for call in manifest["calls"]:
    ref = call["condition_ref"]
    qrow = q_by_ref[ref]
    condition_text = qrow["condition_text"]
    user_msg = build_user_message(transcript, condition_text)
    full_prompt = SYSTEM_PROMPT + "\n\n" + user_msg
    prompt_sha = hashlib.sha256(full_prompt.encode("utf-8")).hexdigest()
    prompt_len = len(full_prompt)

    native_call_obj = {"model": call["model"], "subagent_type": call["subagent_type"], "prompt": full_prompt}
    native_call_json = json.dumps(native_call_obj, separators=(",", ":"))
    native_call_sha = hashlib.sha256(native_call_json.encode("utf-8")).hexdigest()

    ok_prompt = (prompt_sha == call["native_prompt_sha256"])
    ok_len = (prompt_len == call["native_prompt_char_count"])
    ok_call = (native_call_sha == call["native_call_sha256"])

    results.append({
        "condition_ref": ref,
        "prompt_sha_match": ok_prompt,
        "len_match": ok_len,
        "call_sha_match": ok_call,
        "computed_prompt_sha": prompt_sha,
        "expected_prompt_sha": call["native_prompt_sha256"],
        "computed_len": prompt_len,
        "expected_len": call["native_prompt_char_count"],
    })

all_ok = all(r["prompt_sha_match"] and r["len_match"] and r["call_sha_match"] for r in results)
print(json.dumps({"all_ok": all_ok, "results": results}, indent=2))

import os
outdir = "scripts/g2d_prompts_tmp"
os.makedirs(outdir, exist_ok=True)
for i, call in enumerate(manifest["calls"]):
    ref = call["condition_ref"]
    qrow = q_by_ref[ref]
    condition_text = qrow["condition_text"]
    user_msg = build_user_message(transcript, condition_text)
    full_prompt = SYSTEM_PROMPT + "\n\n" + user_msg
    safe = ref.replace("[", "_").replace("]", "_").replace(".", "_")
    with open(f"{outdir}/row{i}_{safe}.txt", "w", encoding="utf-8", newline="") as f:
        f.write(full_prompt)
print("wrote", len(manifest["calls"]), "prompt files to", outdir)
