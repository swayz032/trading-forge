/**
 * wave25-pre-market-briefing.test.ts — W25.5d Pre-Market Briefing Service
 *
 * Coverage:
 *   1. Full briefing assembles all 3 symbols correctly from mocked rows
 *   2. Idempotency: second call same UTC day returns already_sent_today
 *   3. Audit event fires on send AND on skip
 *   4. Discord posting helper called once per briefing
 *   5. Degraded briefing when pre_market_sessions rows missing (data pending markers)
 *   6. Force flag bypasses idempotency check
 *   7. Markdown structure — required sections present per symbol
 *   8. MCL omits internals section (stock breadth not applicable)
 *   9. VIX bucket → sizing recommendation labels verified
 *  10. Fail-soft: Discord post error → sent=false but audit still fires
 *  11. Cron exemption: pre-market-briefing-discord in _PIPELINE_GATE_EXEMPT
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendPreMarketBriefing,
  composeBriefingMarkdown,
  __resetLiveDalForTests,
  type PreMarketSessionRow,
  type BriefingDataAccessLayer,
} from "../services/pre-market-briefing-service.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SESSION_DATE = "2026-05-24";

function makeRow(symbol: string, overrides: Partial<PreMarketSessionRow> = {}): PreMarketSessionRow {
  return {
    sessionDate: SESSION_DATE,
    symbol,
    writtenBias: symbol === "MES" ? "bullish_above_5300" : symbol === "MNQ" ? "bearish_below_18500" : "neutral",
    pdh: "5312.25",
    pdl: "5289.50",
    pwh: "5350.00",
    pwl: "5260.00",
    pwhIso: "5345.00",
    pwlIso: "5255.00",
    overnightRangePoints: "18.75",
    openingGapPct: "0.125",
    vixBucket: "normal",
    vixProxyAtrPercentile: "38.5",
    economicCalendarClear: true,
    blackoutWindows: null,
    bondAuctionToday: false,
    extendedCalendarEvents: null,
    nearbyNakedPocs: [
      { price: 5295.0, session_date: "2026-05-22", symbol },
      { price: 5320.0, session_date: "2026-05-21", symbol },
    ],
    dxyDirection: "flat",
    us10yDirection: "down",
    crossAssetAligned: true,
    tickOpen: "245",
    addOpen: "320",
    ...overrides,
  };
}

// ─── Mock DAL factory ─────────────────────────────────────────────────────────

interface MockState {
  rows: PreMarketSessionRow[];
  alreadySent: boolean;
  auditRows: Array<{ action: string; status: string; result: Record<string, unknown> }>;
  discordCalls: Array<{ title: string; body: string }>;
  discordThrows: boolean;
}

function buildMockDal(state: MockState): BriefingDataAccessLayer {
  return {
    async getPreMarketRows(_sessionDate: string): Promise<PreMarketSessionRow[]> {
      return state.rows;
    },

    async checkBriefingAlreadySent(_sessionDate: string): Promise<boolean> {
      return state.alreadySent;
    },

    async insertAuditRow(values): Promise<void> {
      state.auditRows.push({
        action: values.action,
        status: values.status,
        result: values.result,
      });
    },

    postToDiscord(title: string, body: string, metadata?: Record<string, unknown>): void {
      if (state.discordThrows) {
        throw new Error("Discord unreachable (simulated)");
      }
      state.discordCalls.push({ title, body });
      void metadata; // consumed
    },
  };
}

// ─── Reset DAL cache before each test ────────────────────────────────────────

beforeEach(() => {
  __resetLiveDalForTests();
});

// ─── 1. Full briefing assembles all 3 symbols ─────────────────────────────────

describe("sendPreMarketBriefing — full 3-symbol briefing", () => {
  it("assembles briefing for all 3 symbols and posts once", async () => {
    const state: MockState = {
      rows: [makeRow("MES"), makeRow("MNQ"), makeRow("MCL")],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    const result = await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    expect(result.sent).toBe(true);
    expect(result.sessionDate).toBe(SESSION_DATE);
    expect(result.symbolsFound).toBe(3);
    expect(state.discordCalls).toHaveLength(1);

    const { body } = state.discordCalls[0]!;
    // All 3 symbols present
    expect(body).toContain("## MES");
    expect(body).toContain("## MNQ");
    expect(body).toContain("## MCL");
  });

  it("title includes session date", async () => {
    const state: MockState = {
      rows: [makeRow("MES"), makeRow("MNQ"), makeRow("MCL")],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    const { title } = state.discordCalls[0]!;
    expect(title).toContain(SESSION_DATE);
    expect(title).toContain("Pre-Market Briefing");
  });

  it("briefing contains written bias for MES", async () => {
    const state: MockState = {
      rows: [makeRow("MES")],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    const { body } = state.discordCalls[0]!;
    expect(body).toContain("bullish_above_5300");
  });
});

// ─── 2. Idempotency ───────────────────────────────────────────────────────────

describe("sendPreMarketBriefing — idempotency", () => {
  it("second call same day returns already_sent_today without posting", async () => {
    const state: MockState = {
      rows: [makeRow("MES")],
      alreadySent: true, // simulate prior send
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    const result = await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("already_sent_today");
    expect(state.discordCalls).toHaveLength(0);
  });

  it("force=true bypasses idempotency and posts again", async () => {
    const state: MockState = {
      rows: [makeRow("MES"), makeRow("MNQ"), makeRow("MCL")],
      alreadySent: true, // would normally skip
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    const result = await sendPreMarketBriefing({ date: SESSION_DATE, force: true, dalOverride: dal });

    expect(result.sent).toBe(true);
    expect(state.discordCalls).toHaveLength(1);
  });
});

// ─── 3. Audit events ─────────────────────────────────────────────────────────

describe("sendPreMarketBriefing — audit events", () => {
  it("fires pre_market.briefing_sent audit on successful send", async () => {
    const state: MockState = {
      rows: [makeRow("MES"), makeRow("MNQ"), makeRow("MCL")],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    const sentRow = state.auditRows.find((r) => r.action === "pre_market.briefing_sent");
    expect(sentRow).toBeDefined();
    expect(sentRow?.status).toBe("success");
    expect(sentRow?.result.session_date).toBe(SESSION_DATE);
    expect(sentRow?.result.briefing_markdown).toBeTruthy();
  });

  it("fires pre_market.briefing_skipped_already_ran_today audit on idempotency skip", async () => {
    const state: MockState = {
      rows: [],
      alreadySent: true,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    const skipRow = state.auditRows.find((r) => r.action === "pre_market.briefing_skipped_already_ran_today");
    expect(skipRow).toBeDefined();
    expect(skipRow?.result.reason).toBe("already_sent_today");
  });

  it("audit row contains full briefing_markdown payload (90-day reconstruction)", async () => {
    const state: MockState = {
      rows: [makeRow("MES"), makeRow("MNQ"), makeRow("MCL")],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    const sentRow = state.auditRows.find((r) => r.action === "pre_market.briefing_sent");
    const markdown = sentRow?.result.briefing_markdown as string | undefined;
    expect(typeof markdown).toBe("string");
    expect(markdown!.length).toBeGreaterThan(100);
    expect(markdown).toContain("## MES");
    expect(markdown).toContain("## MNQ");
    expect(markdown).toContain("## MCL");
  });
});

// ─── 4. Discord posting called once ──────────────────────────────────────────

describe("sendPreMarketBriefing — Discord posting", () => {
  it("Discord post called exactly once per briefing", async () => {
    const state: MockState = {
      rows: [makeRow("MES"), makeRow("MNQ"), makeRow("MCL")],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    expect(state.discordCalls).toHaveLength(1);
  });

  it("Discord post NOT called when idempotency skips", async () => {
    const state: MockState = {
      rows: [],
      alreadySent: true,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    expect(state.discordCalls).toHaveLength(0);
  });
});

// ─── 5. Degraded briefing ─────────────────────────────────────────────────────

describe("sendPreMarketBriefing — degraded briefing (no rows)", () => {
  it("still posts when 0 rows found — all fields show (data pending)", async () => {
    const state: MockState = {
      rows: [],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    const result = await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    // Still posts (doesn't throw or skip)
    expect(result.sent).toBe(true);
    expect(result.symbolsFound).toBe(0);
    expect(state.discordCalls).toHaveLength(1);

    const { body } = state.discordCalls[0]!;
    // All symbols listed with pending markers
    expect(body).toContain("## MES");
    expect(body).toContain("## MNQ");
    expect(body).toContain("## MCL");
    expect(body).toContain("data not yet available");
  });

  it("partial rows: 1 of 3 symbols present — others degrade gracefully", async () => {
    const state: MockState = {
      rows: [makeRow("MES")], // only MES has data
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    const result = await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    expect(result.sent).toBe(true);
    expect(result.symbolsFound).toBe(1);

    const { body } = state.discordCalls[0]!;
    // MES should have real data
    expect(body).toContain("bullish_above_5300");
    // MNQ should have pending markers
    const mnqSectionIdx = body.indexOf("## MNQ");
    const mnqSection = body.slice(mnqSectionIdx, body.indexOf("## MCL", mnqSectionIdx));
    expect(mnqSection).toContain("data not yet available");
  });
});

// ─── 6. Force flag ────────────────────────────────────────────────────────────

describe("sendPreMarketBriefing — force flag", () => {
  it("force=false is the default and respects idempotency", async () => {
    const state: MockState = {
      rows: [makeRow("MES")],
      alreadySent: true,
      auditRows: [],
      discordCalls: [],
      discordThrows: false,
    };
    const dal = buildMockDal(state);

    // Default (no force)
    const result = await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });
    expect(result.sent).toBe(false);
    expect(state.discordCalls).toHaveLength(0);
  });
});

// ─── 7. Markdown structure ────────────────────────────────────────────────────

describe("composeBriefingMarkdown — structure validation", () => {
  it("contains header with session date", () => {
    const rows = [makeRow("MES"), makeRow("MNQ"), makeRow("MCL")];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES", "MNQ", "MCL"]);
    expect(md).toContain(`## Pre-Market Briefing — ${SESSION_DATE}`);
  });

  it("each symbol has required sections: Bias, Key Levels, Overnight, Volatility, Calendar, Cross-Asset", () => {
    const rows = [makeRow("MES")];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("**Bias:**");
    expect(md).toContain("**Key Levels:**");
    expect(md).toContain("**Overnight:**");
    expect(md).toContain("**Volatility:**");
    expect(md).toContain("**Calendar:**");
    expect(md).toContain("**Cross-Asset:**");
  });

  it("contains footer with mandate reminder", () => {
    const rows = [makeRow("MES")];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("1 A+ trade per day");
  });

  it("PWH/PWL ISO shown when pwhIso/pwlIso populated", () => {
    const rows = [makeRow("MES", { pwhIso: "5345.00", pwlIso: "5255.00" })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("5345.00");
    expect(md).toContain("5255.00");
  });

  it("bond auction today shows YES when bondAuctionToday=true", () => {
    const rows = [makeRow("MES", { bondAuctionToday: true })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("YES — 1pm ET Treasury auction");
  });

  it("extended calendar events listed when present", () => {
    const rows = [makeRow("MES", {
      extendedCalendarEvents: [{ name: "PPI" }, { name: "ISM Manufacturing" }],
    })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("PPI");
    expect(md).toContain("ISM Manufacturing");
  });

  it("nearby naked POCs listed when present", () => {
    const rows = [makeRow("MES")]; // makeRow includes 2 naked POCs
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("5295.00");
    expect(md).toContain("5320.00");
  });

  it("cross-asset section shows DXY and 10Y", () => {
    const rows = [makeRow("MES", { dxyDirection: "up", us10yDirection: "up" })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("DXY: up");
    expect(md).toContain("10Y: up");
  });
});

// ─── 8. MCL omits internals ───────────────────────────────────────────────────

describe("composeBriefingMarkdown — MCL omits internals section", () => {
  it("MCL section has no Internals heading", () => {
    const rows = [makeRow("MCL", { tickOpen: "300", addOpen: "400" })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MCL"]);
    // The internals section should NOT appear for MCL
    expect(md).not.toContain("**Internals");
  });

  it("MES section includes Internals heading", () => {
    const rows = [makeRow("MES")];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("**Internals");
  });

  it("MNQ section includes Internals heading", () => {
    const rows = [makeRow("MNQ")];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MNQ"]);
    expect(md).toContain("**Internals");
  });
});

// ─── 9. VIX bucket → sizing recommendation ───────────────────────────────────

describe("composeBriefingMarkdown — VIX sizing labels", () => {
  it("normal bucket → FULL SIZE", () => {
    const rows = [makeRow("MES", { vixBucket: "normal" })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("FULL SIZE");
  });

  it("elevated bucket → REDUCED SIZE (75%)", () => {
    const rows = [makeRow("MES", { vixBucket: "elevated" })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("REDUCED SIZE (75%)");
  });

  it("extreme bucket → MINIMAL SIZE (50%)", () => {
    const rows = [makeRow("MES", { vixBucket: "extreme" })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("MINIMAL SIZE (50%)");
  });

  it("null bucket → UNKNOWN label", () => {
    const rows = [makeRow("MES", { vixBucket: null })];
    const md = composeBriefingMarkdown(SESSION_DATE, rows, ["MES"]);
    expect(md).toContain("UNKNOWN");
  });
});

// ─── 10. Fail-soft: Discord error → sent=false, audit still fires ─────────────

describe("sendPreMarketBriefing — fail-soft Discord error", () => {
  it("Discord post error → returns sent=false, audit still fires with pre_market.briefing_failed", async () => {
    const state: MockState = {
      rows: [makeRow("MES"), makeRow("MNQ"), makeRow("MCL")],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: true, // simulate Discord unreachable
    };
    const dal = buildMockDal(state);

    const result = await sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal });

    // Discord post failed → sent=false
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("discord_post_error");

    // Audit MUST still have fired
    const failRow = state.auditRows.find((r) => r.action === "pre_market.briefing_failed");
    expect(failRow).toBeDefined();
    expect(failRow?.status).toBe("warning");
    // Full briefing markdown still in payload for reconstruction
    expect(failRow?.result.briefing_markdown).toBeTruthy();
  });

  it("does not throw when Discord is unreachable", async () => {
    const state: MockState = {
      rows: [],
      alreadySent: false,
      auditRows: [],
      discordCalls: [],
      discordThrows: true,
    };
    const dal = buildMockDal(state);

    // Must not throw — fail-soft contract
    await expect(
      sendPreMarketBriefing({ date: SESSION_DATE, dalOverride: dal }),
    ).resolves.not.toThrow();
  });
});

// ─── 11. Scheduler source — pipeline-gate exemption and cron name ────────────

describe("Scheduler source: pre-market-briefing-discord job wiring", () => {
  it("scheduler.ts source registers pre-market-briefing-discord in _PIPELINE_GATE_EXEMPT", async () => {
    // Read the scheduler source directly — verify both the registerJob call and
    // the _PIPELINE_GATE_EXEMPT.add call are present. This avoids importing the
    // full scheduler graph (which requires DATABASE_URL) while still verifying
    // the job is wired correctly at the source level.
    const fs = await import("fs");
    const path = await import("path");
    const schedulerPath = path.resolve("src/server/scheduler.ts");
    const src = fs.readFileSync(schedulerPath, "utf-8");

    // Job must be registered
    expect(src).toContain('registerJob("pre-market-briefing-discord"');

    // Job must be in the pipeline-gate-exempt set
    expect(src).toContain('"pre-market-briefing-discord"');
    expect(src).toContain("_PIPELINE_GATE_EXEMPT.add(\"pre-market-briefing-discord\")");

    // Cron driver must be wired (_scheduledJobs.add confirms cron.schedule was called)
    expect(src).toContain('_scheduledJobs.add("pre-market-briefing-discord")');
  });

  it("scheduler.ts source: briefing fires at UTC 14 (09:00 ET DST / 10:00 ET EST)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const schedulerPath = path.resolve("src/server/scheduler.ts");
    const src = fs.readFileSync(schedulerPath, "utf-8");

    // The hour-gate must check UTC 14 specifically
    expect(src).toContain("hourUtc !== 14");
  });

  it("scheduler.ts source: sendPreMarketBriefing dynamically imported in job fn", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const schedulerPath = path.resolve("src/server/scheduler.ts");
    const src = fs.readFileSync(schedulerPath, "utf-8");

    expect(src).toContain("pre-market-briefing-service.js");
    expect(src).toContain("sendPreMarketBriefing");
  });
});
