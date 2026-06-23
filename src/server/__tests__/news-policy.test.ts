import { describe, it, expect, afterEach } from "vitest";
import {
  resolveNewsAction,
  eventAffectsSymbol,
  getNewsReduceSizeFactor,
  normalizeFirmKey,
  isEiaWindow,
} from "../lib/news-policy.js";

describe("news-policy — firm-aware Tier-1 behavior (Phase 2)", () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("resolveNewsAction — firm branching", () => {
    it("Topstep in a T1 window → reduce_size (caution, never block)", () => {
      const r = resolveNewsAction("topstep", true);
      expect(r.action).toBe("reduce_size");
      expect(r.sizeFactor).toBe(0.5);
    });

    it("Topstep_50k normalizes to topstep → reduce_size", () => {
      expect(resolveNewsAction("topstep_50k", true).action).toBe("reduce_size");
    });

    it("MFFU (Rapid restricted) in a T1 window → block", () => {
      expect(resolveNewsAction("mffu", true).action).toBe("block");
      expect(resolveNewsAction("mffu_50k", true).action).toBe("block");
    });

    it("unknown / missing firm → fail-safe block (never assume permissive)", () => {
      expect(resolveNewsAction(null, true).action).toBe("block");
      expect(resolveNewsAction("", true).action).toBe("block");
      expect(resolveNewsAction("someprop", true).action).toBe("block");
    });

    it("outside a T1 window → allow for every firm", () => {
      expect(resolveNewsAction("topstep", false).action).toBe("allow");
      expect(resolveNewsAction("mffu", false).action).toBe("allow");
      expect(resolveNewsAction(null, false).action).toBe("allow");
    });

    it("bypass_news_blackout (B11 opt-in) → allow even in window, even for MFFU", () => {
      expect(resolveNewsAction("mffu", true, true).action).toBe("allow");
      expect(resolveNewsAction("topstep", true, true).action).toBe("allow");
    });
  });

  describe("getNewsReduceSizeFactor — env-tunable, clamped", () => {
    it("defaults to 0.5", () => {
      delete process.env.NEWS_REDUCE_SIZE_FACTOR;
      expect(getNewsReduceSizeFactor()).toBe(0.5);
    });
    it("honors a valid override in (0,1]", () => {
      process.env.NEWS_REDUCE_SIZE_FACTOR = "0.25";
      expect(getNewsReduceSizeFactor()).toBe(0.25);
    });
    it("rejects out-of-range / non-finite → falls back to 0.5", () => {
      for (const bad of ["0", "-1", "1.5", "abc", "Infinity"]) {
        process.env.NEWS_REDUCE_SIZE_FACTOR = bad;
        expect(getNewsReduceSizeFactor()).toBe(0.5);
      }
    });
  });

  describe("eventAffectsSymbol — product scope", () => {
    it("FOMC / FOMC_MINUTES affect ALL products", () => {
      for (const s of ["MES", "MNQ", "MCL", "CL"]) {
        expect(eventAffectsSymbol("FOMC", s)).toBe(true);
        expect(eventAffectsSymbol("FOMC_MINUTES", s)).toBe(true);
      }
    });
    it("CPI / NFP affect equity index, NOT crude", () => {
      expect(eventAffectsSymbol("CPI", "MES")).toBe(true);
      expect(eventAffectsSymbol("NFP", "MNQ")).toBe(true);
      expect(eventAffectsSymbol("CPI", "MCL")).toBe(false);
      expect(eventAffectsSymbol("NFP", "CL")).toBe(false);
    });
    it("EIA affects crude ONLY", () => {
      expect(eventAffectsSymbol("EIA", "MCL")).toBe(true);
      expect(eventAffectsSymbol("EIA", "CL")).toBe(true);
      expect(eventAffectsSymbol("EIA", "MES")).toBe(false);
      expect(eventAffectsSymbol("EIA", "MNQ")).toBe(false);
    });
  });

  describe("isEiaWindow — crude-only, T−5/+2 window (Phase 2B)", () => {
    // EIA 2026-01-07 at 10:30 ET (EST=UTC-5) → 15:30 UTC. Window [T−5, T+2] = 15:25–15:32 UTC.
    it("MCL exactly at EIA release (10:30 ET) → in window", () => {
      expect(isEiaWindow("MCL", "2026-01-07T15:30:00.000Z")).toBe(true);
    });
    it("MCL at T−2 (10:28 ET) → in window", () => {
      expect(isEiaWindow("MCL", "2026-01-07T15:28:00.000Z")).toBe(true);
    });
    it("MCL at T−6 (10:24 ET) → NOT in window (before T−5)", () => {
      expect(isEiaWindow("MCL", "2026-01-07T15:24:00.000Z")).toBe(false);
    });
    it("MCL at T+3 (10:33 ET) → NOT in window (after T+2)", () => {
      expect(isEiaWindow("MCL", "2026-01-07T15:33:00.000Z")).toBe(false);
    });
    it("CL (mini crude) is also covered", () => {
      expect(isEiaWindow("CL", "2026-01-07T15:30:00.000Z")).toBe(true);
    });
    it("MES / MNQ are NEVER in an EIA window (product scope)", () => {
      expect(isEiaWindow("MES", "2026-01-07T15:30:00.000Z")).toBe(false);
      expect(isEiaWindow("MNQ", "2026-01-07T15:30:00.000Z")).toBe(false);
    });
    it("holiday-shifted EIA (2026-01-22 Thu 11:00 ET = 16:00 UTC) → in window for MCL", () => {
      expect(isEiaWindow("MCL", "2026-01-22T16:00:00.000Z")).toBe(true);
      // and the normal Wednesday that week is NOT an EIA day (shifted)
      expect(isEiaWindow("MCL", "2026-01-21T15:30:00.000Z")).toBe(false);
    });
    it("a non-EIA day → not in window", () => {
      expect(isEiaWindow("MCL", "2026-01-08T15:30:00.000Z")).toBe(false);
    });
  });

  describe("normalizeFirmKey", () => {
    it("strips size suffix + lowercases", () => {
      expect(normalizeFirmKey("Topstep_50k")).toBe("topstep");
      expect(normalizeFirmKey("MFFU_100K")).toBe("mffu");
      expect(normalizeFirmKey(null)).toBe("");
    });
  });
});
