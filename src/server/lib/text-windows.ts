/**
 * TEXT WINDOWING (2026-06-24) — handle punctuation-less transcripts.
 *
 * YouTube auto-transcripts frequently have NO sentence punctuation → splitting on [.!?] returns one
 * giant blob. That blob then matches EVERY keyword at once: the session normalizer picked "London"
 * (listed as an alternative) over the educator's actual "US session", and the confirmation compiler
 * grabbed an intro sentence as its evidence quote. Windowing the text into small spans restores LOCAL
 * matching so the dominant/anchored signal wins. Pure, deterministic.
 */

/**
 * Split text into small candidate windows. Uses sentence punctuation where present; any span longer
 * than `maxChars` (a run-on from a punctuation-less transcript) is further chopped into ~`maxChars`
 * windows on word boundaries, with overlap so a phrase straddling a cut is still captured whole.
 */
export function toWindows(text: string, maxChars = 240, overlapChars = 60): string[] {
  if (typeof text !== "string" || text.trim().length === 0) return [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= maxChars) { out.push(s); continue; }
    // run-on span → window on word boundaries with overlap
    const words = s.split(/\s+/);
    let cur = "";
    const flush = () => { if (cur.trim()) out.push(cur.trim()); };
    for (const w of words) {
      if (cur.length + w.length + 1 > maxChars) {
        flush();
        // start next window with a small tail overlap
        const tail = cur.slice(Math.max(0, cur.length - overlapChars));
        cur = tail + " " + w;
      } else {
        cur += (cur ? " " : "") + w;
      }
    }
    flush();
  }
  return out;
}
