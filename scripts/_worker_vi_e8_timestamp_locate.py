"""Diagnostic probe (AR-1391): locate exact timestamp windows for the three VI-E8 questions by
matching their anchor transcript quotes against the timed caption snippets. Disposable."""

import json
import re


def normalize(s):
    return re.sub(r"\s+", " ", s.lower()).strip()


with open("scripts/_worker_vi_e8_timedtext_raw.json", encoding="utf-8") as f:
    snippets = json.load(f)

# Build a rolling concatenated text with an index mapping char offset -> snippet index
joined_parts = []
offsets = []
pos = 0
for i, s in enumerate(snippets):
    t = normalize(s["text"])
    offsets.append((pos, pos + len(t), i))
    joined_parts.append(t)
    pos += len(t) + 1  # + space
full_text = " ".join(joined_parts)


def find_window(anchor_start, anchor_end):
    a_start = normalize(anchor_start)
    a_end = normalize(anchor_end)
    idx_start = full_text.find(a_start[:60])
    idx_end = full_text.find(a_end[-60:])
    if idx_start == -1 or idx_end == -1:
        return None
    # map char offsets to snippet indices
    snip_start = None
    snip_end = None
    for lo, hi, i in offsets:
        if snip_start is None and lo <= idx_start < hi:
            snip_start = i
        if lo <= idx_end < hi:
            snip_end = i
    if snip_start is None:
        # fallback: first snippet containing any overlap
        for lo, hi, i in offsets:
            if hi > idx_start:
                snip_start = i
                break
    if snip_end is None:
        for lo, hi, i in reversed(offsets):
            if lo < idx_end + len(a_end):
                snip_end = i
                break
    return snip_start, snip_end


def fmt_ts(seconds):
    m = int(seconds // 60)
    s = seconds - m * 60
    return f"{m}:{s:05.2f}"


QUESTIONS = {
    "VI-E8-1": (
        "So I like to gauge retracements by using the Fibonacci retracement tool",
        "And then I drag the takerit to the low of the Fibonacci range right here",
    ),
    "VI-E8-2": (
        "Now using the magnet tool again, I can click the stop loss",
        "Click this little button at the top, drag it to the high of the Fibonacci range, and drop it",
    ),
    "VI-E8-3-EX1": (
        "So, my indicator automatically checks premium and discount",
        "look for potential selling opportunities",
    ),
    "VI-E8-3-EX2": (
        "my indicator is showing me that the 4hour time frame is currently at a discount",
        "which is actually what I would be interested in on this 15-minute time frame",
    ),
}

for qid, (a_start, a_end) in QUESTIONS.items():
    win = find_window(a_start, a_end)
    if win is None:
        print(qid, "NOT FOUND")
        continue
    i0, i1 = win
    t0 = snippets[i0]["start"]
    t1 = snippets[i1]["start"] + snippets[i1]["duration"]
    print(qid, "snippet_idx", i0, i1, "time", fmt_ts(t0), "-", fmt_ts(t1), f"({t0:.2f}s-{t1:.2f}s)")
