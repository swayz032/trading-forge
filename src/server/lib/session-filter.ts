/**
 * SESSION extraction + temporal normalization (2026-06-24 Layer 3A + 3A.5).
 *
 * The placeability audit found session_filter NEVER extracted (14/14 SESSION_MISSING) even though
 * the videos DO teach sessions (iU8 "NY 5:00 candle, UTC-4"; W7nln "overnight 16:00→09:30 ET").
 * Session is strategy IDENTITY, not metadata: an ORB without a session anchor is a different
 * strategy. So sessions must be stored STRUCTURED (engine-compatible), never as plain text.
 *
 * Layer 3A.5 — temporal normalization: videos use inconsistent time expressions ("NY open", "9:30",
 * "first candle", "kill zone", "8 AM EST", "13:30 UTC", "no lunch"). This module canonicalizes them
 * to a single ET-anchored structured window so graders + the engine stop disagreeing.
 *
 * Canon: all windows are expressed in EXCHANGE-LOCAL America/New_York wall-clock (DST-stable), matching
 * the existing DST-correct killzone.ts runtime model. UTC is derived at runtime (DST-aware), not stored.
 */

export type SessionRegion = "NY" | "LONDON" | "ASIA" | "UTC";
export type SessionSubtype = "ORB" | "KILLZONE" | "OPEN" | "CLOSE" | "RTH" | "OVERNIGHT" | "PREMARKET";

export interface SessionFilter {
  region?: SessionRegion;
  /** Exchange-local (America/New_York) start, "HH:mm", 24h. */
  start?: string;
  /** Exchange-local (America/New_York) end, "HH:mm", 24h. */
  end?: string;
  /** IANA tz the start/end are expressed in. Canon = America/New_York. */
  timezone?: string;
  subtype?: SessionSubtype;
  /** Extra hard constraints, e.g. "no_lunch" (avoid 11:30–13:30 ET dead zone). */
  constraints?: string[];
  /** The raw transcript phrase this was normalized from (provenance). */
  raw?: string;
  /**
   * Extraction confidence [0,1] (Layer 4 forward-hook): explicit clock ("9:30 EST") = high;
   * a vague named window ("kill zone") = medium; an inferred default = low.
   */
  confidence?: number;
}

const ET = "America/New_York";

/** Canonical ET-anchored windows, aligned with killzone.ts. */
const CANON = {
  NY_OPEN: { region: "NY" as const, start: "09:30", end: "16:00", subtype: "OPEN" as const },
  NY_ORB: { region: "NY" as const, start: "09:30", end: "10:00", subtype: "ORB" as const },
  NY_AM: { region: "NY" as const, start: "07:00", end: "10:00", subtype: "KILLZONE" as const },
  NY_PM: { region: "NY" as const, start: "13:30", end: "16:00", subtype: "CLOSE" as const },
  LONDON: { region: "LONDON" as const, start: "02:00", end: "05:00", subtype: "KILLZONE" as const },
  ASIA: { region: "ASIA" as const, start: "18:00", end: "03:00", subtype: "OVERNIGHT" as const },
  OVERNIGHT: { region: "NY" as const, start: "16:00", end: "09:30", subtype: "OVERNIGHT" as const },
  PREMARKET: { region: "NY" as const, start: "04:00", end: "09:30", subtype: "PREMARKET" as const },
  RTH: { region: "NY" as const, start: "09:30", end: "16:00", subtype: "RTH" as const },
};

function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** UTC clock → ET wall-clock (approx; uses standard EST offset −5 for canonicalization only). */
function utcToEtApprox(h: number, m: number): { h: number; m: number } {
  let et = h - 5; // EST; the engine applies DST-correct conversion at runtime
  if (et < 0) et += 24;
  return { h: et % 24, m };
}

const RE = {
  // explicit clock: "9:30", "8 am", "13:30", "8:00 EST", "14:00 UTC"
  clock: /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(est|edt|et|utc|gmt)?\b/gi,
  ny: /\b(new york|ny|nyse|us session|new york session)\b/i,
  nyOpen: /\b(ny open|new york open|market open|the open|nyse open|9:?30)\b/i,
  london: /\b(london|lo session|london open|london killzone|london session)\b/i,
  asia: /\b(asia|asian|tokyo|sydney|asian session|asian range)\b/i,
  orb: /\b(opening range|orb|first (?:5|15|30)\s*(?:-|\s)?min|first candle|first (?:5|15|30) minutes|range breakout)\b/i,
  killzone: /\b(kill ?zone|killzone|kz)\b/i,
  silverBullet: /\b(silver bullet)\b/i,
  overnight: /\b(overnight|over night|on session)\b/i,
  premarket: /\b(pre[\s-]?market|premarket|pre market)\b/i,
  lunch: /\b(lunch|midday|noon)\b/i,
  noLunch: /\b(?:no|never|avoid|skip|don'?t|do not|not|stay out of|outside|steer clear of)\b[^.!?]*\b(?:lunch|midday)\b/i,
  rth: /\b(rth|regular trading hours|cash session|day session)\b/i,
};

/**
 * Normalize ONE raw session/time phrase to a structured ET-anchored SessionFilter, or null if no
 * session signal is present. Pure, deterministic. (Layer 3A.5 temporal normalization.)
 */
export function normalizeSessionPhrase(raw: string | null | undefined): SessionFilter | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const s = raw.toLowerCase();
  const constraints: string[] = [];
  if (RE.noLunch.test(s)) constraints.push("no_lunch");

  // Region + named-window resolution (most-specific first).
  let base: { region: SessionRegion; start: string; end: string; subtype: SessionSubtype } | null = null;
  let confidence = 0.5;

  if (RE.silverBullet.test(s)) { base = { region: "NY", start: "10:00", end: "11:00", subtype: "KILLZONE" }; confidence = 0.7; }
  else if (RE.premarket.test(s)) { base = { ...CANON.PREMARKET }; confidence = 0.6; }
  else if (RE.overnight.test(s)) { base = { ...CANON.OVERNIGHT }; confidence = 0.6; }
  else if (RE.london.test(s)) { base = { ...CANON.LONDON }; confidence = RE.killzone.test(s) ? 0.7 : 0.6; }
  else if (RE.asia.test(s)) { base = { ...CANON.ASIA }; confidence = 0.6; }
  else if (RE.orb.test(s)) { base = { ...CANON.NY_ORB }; confidence = 0.65; }
  else if (RE.nyOpen.test(s)) { base = { ...CANON.NY_OPEN }; confidence = 0.7; }
  else if (RE.ny.test(s)) { base = RE.killzone.test(s) ? { ...CANON.NY_AM } : { ...CANON.NY_OPEN }; confidence = 0.6; }
  else if (RE.rth.test(s)) { base = { ...CANON.RTH }; confidence = 0.6; }
  else if (RE.killzone.test(s)) { base = { ...CANON.NY_AM }; confidence = 0.5; }

  // Explicit clock overrides the default start (and bumps confidence). Take the FIRST clock token.
  // 2026-06-24 GENERALIZATION FIX: strip TIMEFRAME tokens first ("15-minute"/"5 min"/"3m"), then
  // require a real clock QUALIFIER — :MM, am/pm, or a tz. A bare 1-2 digit number ("15", "5") is NOT
  // a clock; the unseen-video test exposed bare timeframes ("15-minute ORB") misfiring as 15:00.
  const sClock = s.replace(
    /\b\d+\s*-?\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|sec|second|seconds)\b/gi,
    " ",
  );
  RE.clock.lastIndex = 0;
  let explicitStart: string | null = null;
  let matchedTz: string | undefined;
  let cm: RegExpExecArray | null;
  while ((cm = RE.clock.exec(sClock)) !== null) {
    const hasQualifier = Boolean(cm[2] || cm[3] || cm[4]); // :MM, am/pm, or tz — required
    if (!hasQualifier) continue;
    let h = parseInt(cm[1], 10);
    const min = cm[2] ? parseInt(cm[2], 10) : 0;
    const ampm = cm[3]?.replace(/\./g, "").toLowerCase();
    const tz = cm[4]?.toLowerCase();
    if (h <= 23 && min <= 59) {
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
      if (tz === "utc" || tz === "gmt") { const et = utcToEtApprox(h, min); h = et.h; }
      explicitStart = hhmm(h, min);
      matchedTz = tz;
      break;
    }
  }

  if (!base && !explicitStart && constraints.length === 0) return null;

  const region: SessionRegion = base?.region ?? (matchedTz === "utc" ? "UTC" : "NY");
  const start = explicitStart ?? base?.start;
  const end = base?.end;
  const subtype = base?.subtype;
  if (explicitStart) confidence = Math.max(confidence, 0.85);

  const out: SessionFilter = { timezone: ET, raw: raw.trim(), confidence };
  if (region) out.region = region;
  if (start) out.start = start;
  if (end) out.end = end;
  if (subtype) out.subtype = subtype;
  if (constraints.length) out.constraints = constraints;
  // A bare no_lunch constraint with no window is still a valid (weak) session signal.
  return out;
}

/**
 * Scan a full transcript for the dominant session the speaker teaches and return it structured.
 * Picks the highest-confidence normalized phrase across windowed candidate sentences. Pure.
 */
export function extractSessionFromTranscript(transcript: string | null | undefined): SessionFilter | null {
  if (typeof transcript !== "string" || transcript.trim().length === 0) return null;
  // Candidate sentences: those mentioning any session/time cue (keeps the normalizer focused).
  const cueRe = /(new york|\bny\b|london|asia|asian|tokyo|kill ?zone|opening range|\borb\b|overnight|pre[\s-]?market|lunch|\brth\b|session|\d{1,2}:\d{2}|\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?))/i;
  const sentences = transcript.split(/(?<=[.!?])\s+|\n+/).filter((x) => cueRe.test(x));
  let best: SessionFilter | null = null;
  const mergedConstraints = new Set<string>();
  for (const sent of sentences) {
    const sf = normalizeSessionPhrase(sent);
    if (!sf) continue;
    (sf.constraints ?? []).forEach((c) => mergedConstraints.add(c));
    if (!best || (sf.confidence ?? 0) > (best.confidence ?? 0)) {
      if (sf.region || sf.start) best = sf; // prefer a real window over a bare constraint
    }
  }
  if (!best && mergedConstraints.size === 0) return null;
  if (!best) best = { timezone: ET, confidence: 0.4 };
  if (mergedConstraints.size) best.constraints = [...new Set([...(best.constraints ?? []), ...mergedConstraints])];
  return best;
}

/**
 * Canonical short string label for backward-compat with existing string `session_filter` consumers
 * (gemma-prose-to-v11, Pine export, scout runner). Structured field is authoritative; this is a view.
 */
export function sessionFilterLabel(sf: SessionFilter | null | undefined): string | null {
  if (!sf) return null;
  const parts: string[] = [];
  if (sf.region) parts.push(sf.region);
  if (sf.subtype && sf.subtype !== "OPEN") parts.push(sf.subtype);
  let label = parts.join("_");
  if (!label && sf.constraints?.includes("no_lunch")) label = "NO_LUNCH";
  return label || null;
}
