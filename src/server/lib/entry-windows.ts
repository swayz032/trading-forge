/**
 * entry-windows.ts — W23H.3 allowed_entry_windows parser + checker
 *
 * Parses window specs of the form "HH:MM-HH:MM TZ" and checks whether a
 * bar timestamp falls inside any configured window.
 *
 * Boundary semantics: [start, end) — left-inclusive, right-exclusive.
 * So "09:45-12:00 ET" includes 09:45 but NOT 12:00. This avoids overlap
 * when windows abut ("09:45-12:00 ET" + "12:00-14:00 ET" have no gap).
 *
 * Timezone shorthands: "ET" → "America/New_York", "PT" → "America/Los_Angeles",
 * "CT" → "America/Chicago", "MT" → "America/Denver", "UTC" → "UTC".
 * Any other string is passed through as an IANA name.
 *
 * This module is used in three places:
 *   1. paper-signal-service.ts: signal-time enforcement
 *   2. framework-overlay.ts: config field definition (type-only)
 *   3. Tests
 *
 * Python mirror: src/engine/entry_windows.py
 */

// ─── Timezone shorthands → IANA names ───────────────────────────────────────

const TZ_SHORTHANDS: Record<string, string> = {
  ET: "America/New_York",
  EST: "America/New_York",
  EDT: "America/New_York",
  PT: "America/Los_Angeles",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  CT: "America/Chicago",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MT: "America/Denver",
  MST: "America/Denver",
  MDT: "America/Denver",
  UTC: "UTC",
};

function resolveTimezone(tz: string): string {
  return TZ_SHORTHANDS[tz.toUpperCase()] ?? tz;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EntryWindow {
  /** Minutes since 00:00 in window timezone. E.g. 9*60+45 = 585 for 09:45. */
  startMinutesOfDay: number;
  /** Minutes since 00:00 in window timezone. Right-exclusive. */
  endMinutesOfDay: number;
  /** IANA timezone name e.g. "America/New_York". */
  timezone: string;
  /** Original spec string, for diagnostics. */
  spec: string;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parse a window spec string: "HH:MM-HH:MM TZ"
 * Throws on malformed input — validation happens at config time, not signal time.
 *
 * Examples:
 *   parseEntryWindow("09:45-12:00 ET")   → {start:585, end:720, tz:"America/New_York"}
 *   parseEntryWindow("13:30-15:30 ET")   → {start:810, end:930, tz:"America/New_York"}
 *   parseEntryWindow("09:00-17:00 UTC")  → {start:540, end:1020, tz:"UTC"}
 */
export function parseEntryWindow(spec: string): EntryWindow {
  if (typeof spec !== "string" || spec.trim() === "") {
    throw new Error(`parseEntryWindow: empty or non-string spec: ${JSON.stringify(spec)}`);
  }

  // Split at first space — left side is time range, right side is TZ
  const trimmed = spec.trim();
  const spaceIdx = trimmed.lastIndexOf(" ");
  if (spaceIdx < 0) {
    throw new Error(`parseEntryWindow: missing timezone in spec "${spec}" — expected "HH:MM-HH:MM TZ"`);
  }

  const timeRange = trimmed.slice(0, spaceIdx).trim();
  const tzRaw = trimmed.slice(spaceIdx + 1).trim();

  if (!tzRaw) {
    throw new Error(`parseEntryWindow: missing timezone in spec "${spec}"`);
  }

  // Parse "HH:MM-HH:MM"
  const dashIdx = timeRange.indexOf("-");
  if (dashIdx < 0) {
    throw new Error(`parseEntryWindow: missing '-' separator in time range "${timeRange}" (spec: "${spec}")`);
  }

  const startStr = timeRange.slice(0, dashIdx);
  const endStr = timeRange.slice(dashIdx + 1);

  function parseTime(t: string, label: string): number {
    const parts = t.split(":");
    if (parts.length !== 2) {
      throw new Error(`parseEntryWindow: ${label} "${t}" must be HH:MM (spec: "${spec}")`);
    }
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) {
      throw new Error(`parseEntryWindow: ${label} "${t}" contains non-numeric value (spec: "${spec}")`);
    }
    if (h < 0 || h > 23) {
      throw new Error(`parseEntryWindow: ${label} hour ${h} out of range [0,23] (spec: "${spec}")`);
    }
    if (m < 0 || m > 59) {
      throw new Error(`parseEntryWindow: ${label} minute ${m} out of range [0,59] (spec: "${spec}")`);
    }
    return h * 60 + m;
  }

  const startMinutesOfDay = parseTime(startStr, "start");
  const endMinutesOfDay = parseTime(endStr, "end");

  if (endMinutesOfDay <= startMinutesOfDay) {
    throw new Error(
      `parseEntryWindow: end (${endStr}) must be after start (${startStr}) — overnight windows not supported (spec: "${spec}")`,
    );
  }

  const timezone = resolveTimezone(tzRaw);

  // Validate that the IANA timezone resolves without throwing at runtime.
  // Intl.DateTimeFormat constructor throws on bad timezone names.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`parseEntryWindow: unrecognized timezone "${tzRaw}" (resolved: "${timezone}") in spec "${spec}"`);
  }

  return { startMinutesOfDay, endMinutesOfDay, timezone, spec };
}

/**
 * Parse an array of window specs. Throws on the first malformed spec.
 * Returns [] when input is undefined or empty.
 */
export function parseEntryWindows(specs: string[] | undefined | null): EntryWindow[] {
  if (!specs || specs.length === 0) return [];
  return specs.map(parseEntryWindow);
}

// ─── Checker ─────────────────────────────────────────────────────────────────

/**
 * Return the "minutes of day" for a UTC timestamp converted to a given timezone.
 * Uses Intl.DateTimeFormat to handle DST correctly.
 */
function toMinutesOfDayInTz(barTsUtc: Date, timezone: string): number {
  // Intl gives us the wall-clock time in the target timezone.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(barTsUtc);

  let h = 0;
  let m = 0;
  for (const part of parts) {
    if (part.type === "hour") {
      h = parseInt(part.value, 10);
      // hour12:false returns "24" for midnight — normalize to 0
      if (h === 24) h = 0;
    } else if (part.type === "minute") {
      m = parseInt(part.value, 10);
    }
  }
  return h * 60 + m;
}

/**
 * Check if barTsUtc falls within a single entry window.
 * Boundary: [start, end) — start-inclusive, end-exclusive.
 */
export function isBarInWindow(barTsUtc: Date, window: EntryWindow): boolean {
  const minutesOfDay = toMinutesOfDayInTz(barTsUtc, window.timezone);
  return minutesOfDay >= window.startMinutesOfDay && minutesOfDay < window.endMinutesOfDay;
}

/**
 * Check if barTsUtc falls within ANY of the configured entry windows.
 * Returns false when windows array is empty (no restriction defined — callers
 * must handle the empty-array case as "no restriction" themselves, since this
 * function returns false for an empty array to distinguish from "in a window").
 *
 * Callers should check: windows.length === 0 || isBarInAnyWindow(ts, windows)
 */
export function isBarInAnyWindow(barTsUtc: Date, windows: EntryWindow[]): boolean {
  if (windows.length === 0) return false;
  return windows.some((w) => isBarInWindow(barTsUtc, w));
}
