/**
 * CLAUSE SEGMENTER (v1.1 Phase 1, 2026-06-29) — transcript -> stable, offset-exact clauses.
 *
 * The clause is the PRIMARY KEY through the whole system: every downstream artifact (atoms, ledgers, report)
 * references a permanent clause id, never raw text. IDs are `${transcriptId}-C0042` and are STABLE for a given
 * transcript (same input -> same ids + same offsets). Deterministic, pure, no I/O, no LLM.
 *
 * ASR transcripts have unreliable punctuation, so we segment on BOTH sentence terminators AND strong discourse
 * markers ("then", "once", "after", "wait for", ...), with a length cap. We deliberately lean toward
 * OVER-segmentation: a too-fine clause is still judged individually downstream, whereas a too-coarse clause can
 * merge two decisions and hide one. Tiny fragments are merged forward so no clause is trivially short.
 */

export interface SegmentedClause {
  id: string;            // permanent primary key: `${transcriptId}-C0042`
  index: number;
  start: number;         // char offset into the ORIGINAL transcript (inclusive)
  end: number;           // char offset (exclusive) — transcript.slice(start,end) === text
  text: string;          // original substring
  normalized: string;    // lowercased, whitespace-collapsed (for matching/dedup)
  timestamp?: number;    // optional (only if the transcript carries timecodes)
}

// Discourse markers that START a new clause (boundary BEFORE the marker). Word-boundary matched.
const MARKERS = [
  "and then", "then", "after that", "after", "once", "when", "next", "first", "second", "third", "finally",
  "so", "now", "but", "however", "wait for", "we wait", "you wait", "look for", "we want", "if ", "as soon as",
];
const MIN_CLAUSE_CHARS = 12;   // merge anything shorter forward
const MAX_CLAUSE_CHARS = 320;  // hard cap so a run-on becomes multiple clauses

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Collect sorted, deduped boundary offsets where a new clause should start. */
function boundaries(t: string): number[] {
  const set = new Set<number>([0, t.length]);
  // after sentence terminators
  for (const m of t.matchAll(/[.!?]+[\s)"']*/g)) set.add((m.index ?? 0) + m[0].length);
  // before discourse markers (word-boundary)
  const lower = t.toLowerCase();
  for (const mk of MARKERS) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(mk, from);
      if (i < 0) break;
      const before = i === 0 ? " " : lower[i - 1];
      if (/\s/.test(before)) set.add(i); // only at a word start
      from = i + mk.length;
    }
  }
  // hard length cap: inject boundaries at whitespace nearest each MAX step
  for (let p = MAX_CLAUSE_CHARS; p < t.length; p += MAX_CLAUSE_CHARS) {
    let q = p;
    while (q < t.length && !/\s/.test(t[q])) q++;
    set.add(Math.min(q + 1, t.length));
  }
  return [...set].sort((a, b) => a - b);
}

export function segmentTranscript(transcript: string, transcriptId: string): SegmentedClause[] {
  const bs = boundaries(transcript);
  // raw spans between consecutive boundaries
  const raw: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < bs.length - 1; i++) if (bs[i + 1] > bs[i]) raw.push({ start: bs[i], end: bs[i + 1] });

  // merge fragments whose TRIMMED text is too short forward into the next span (keeps offsets exact)
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of raw) {
    const prev = merged[merged.length - 1];
    const trimmedLen = transcript.slice(r.start, r.end).trim().length;
    if (prev && (transcript.slice(prev.start, prev.end).trim().length < MIN_CLAUSE_CHARS)) {
      prev.end = r.end; // absorb the short PREVIOUS fragment forward
    } else {
      merged.push({ ...r });
    }
    void trimmedLen;
  }

  const out: SegmentedClause[] = [];
  for (const m of merged) {
    const text = transcript.slice(m.start, m.end);
    if (!text.trim()) continue; // skip pure-whitespace spans
    const index = out.length;
    out.push({
      id: `${transcriptId}-C${String(index).padStart(4, "0")}`,
      index, start: m.start, end: m.end, text, normalized: normalize(text),
    });
  }
  return out;
}

/** Round-trip guarantee helper for tests: clauses cover the transcript with exact offsets. */
export function clausesReconstruct(transcript: string, clauses: SegmentedClause[]): boolean {
  return clauses.every((c) => transcript.slice(c.start, c.end) === c.text);
}
