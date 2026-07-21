// src/server/__tests__/office-payout-panel-guards.test.ts
//
// Charter item 12 (2026-07-21) — permanent guards for the Office "Payout Reality"
// panel (`public/slumhouse/office-payout.js`).
//
// These exist because the panel's correctness is almost entirely about what it
// does NOT do: it must not define a payout rule, must not silently drift from
// the server's request schema, and must not drop the projection's own honest
// limits. None of that is visible to a rendering smoke test.
//
// COMMENT-VS-CODE: every "is it there" assertion runs against LIVE code with
// comments stripped. A promise made only in a comment is not a property — that
// exact confusion has been caught four times in this campaign.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PANEL = path.resolve("public/slumhouse/office-payout.js");
const OFFICE = path.resolve("public/slumhouse/office.html");
const ROUTE = path.resolve("src/server/routes/prop-firm.ts");

const panelSrc = fs.readFileSync(PANEL, "utf-8");
const officeHtml = fs.readFileSync(OFFICE, "utf-8");
const routeSrc = fs.readFileSync(ROUTE, "utf-8");

/** Live code only: block comments and whole-line `//` comments removed. */
const livePanel = panelSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** The zod payoutSchema block, read from the route at test time. */
const payoutSchemaBlock = (() => {
  const m = routeSrc.match(/const payoutSchema = z\.object\(\{([\s\S]*?)\n\}\);/);
  if (!m) throw new Error("payoutSchema not found in prop-firm.ts — this guard is stale");
  return m[1];
})();

describe("request-shape parity: the form cannot drift from the server schema", () => {
  it("every field the server accepts has an input in the panel", () => {
    // Keys declared in the zod object, ignoring commented-out lines.
    const keys = payoutSchemaBlock
      .split("\n")
      .filter(l => !l.trim().startsWith("//"))
      .map(l => l.match(/^\s*(\w+):\s*z\./)?.[1])
      .filter((k): k is string => Boolean(k));

    expect(keys.length, "expected the 7-field payout schema").toBeGreaterThanOrEqual(7);
    for (const k of keys) {
      expect(livePanel, `panel is missing an input for schema field "${k}"`).toContain(k);
    }
  });

  it("numeric bounds mirror the schema exactly (drift would 400 at the tower)", () => {
    const accounts = payoutSchemaBlock.match(/numAccounts:\s*z\.number\(\)\.int\(\)\.min\((\d+)\)\.max\((\d+)\)/);
    const months = payoutSchemaBlock.match(/months:\s*z\.number\(\)\.int\(\)\.min\((\d+)\)\.max\((\d+)\)/);
    expect(accounts, "numAccounts bounds unreadable — guard is stale").not.toBeNull();
    expect(months, "months bounds unreadable — guard is stale").not.toBeNull();

    const panelAccounts = livePanel.match(/NUM_ACCOUNTS_MIN\s*=\s*(\d+),\s*NUM_ACCOUNTS_MAX\s*=\s*(\d+)/);
    const panelMonths = livePanel.match(/MONTHS_MIN\s*=\s*(\d+),\s*MONTHS_MAX\s*=\s*(\d+)/);
    expect(panelAccounts).not.toBeNull();
    expect(panelMonths).not.toBeNull();

    expect(panelAccounts![1]).toBe(accounts![1]);
    expect(panelAccounts![2]).toBe(accounts![2]);
    expect(panelMonths![1]).toBe(months![1]);
    expect(panelMonths![2]).toBe(months![2]);
  });

  it("posts to the payout endpoint and lets the server stay authoritative on rejection", () => {
    expect(livePanel).toContain("'/api/prop-firm/payout'");
    // The server's own rejection must reach the operator. Both halves are read:
    // `error` is the headline, `details` is where zod puts the useful part.
    // (Asserted as reads, not as a code shape — the previous regex pinned the
    // exact expression and went stale the moment the handler was improved.)
    expect(livePanel).toContain("j.error");
    expect(livePanel).toContain("j.details");
  });
});

describe("the panel defines NO payout rule of its own", () => {
  it("does not hardcode the payout split", () => {
    // The split is `payoutSplit` off the response. A literal 0.8 / 0.80 / "80/20"
    // here would be this file asserting a firm rule it has no authority over.
    expect(livePanel).not.toMatch(/0\.80?\b/);
    expect(livePanel).not.toMatch(/80\s*\/\s*20/);
    expect(livePanel).toContain("d.payoutSplit");
  });

  it("does not hardcode a firm roster — firms come from the server list", () => {
    expect(livePanel).toContain("'/api/prop-firm/firms'");
    expect(livePanel.toLowerCase()).not.toMatch(/['"]topstep['"]/);
    expect(livePanel.toLowerCase()).not.toMatch(/['"]mffu['"]/);
  });

  it("does not hardcode a cadence or cap number", () => {
    // requests_per_month / cap_per_request are read from payout_cap_applied.
    expect(livePanel).toContain("cap.requests_per_month");
    expect(livePanel).toContain("cap.cap_per_request");
    expect(livePanel).not.toMatch(/requests_per_month\s*=\s*\d/);
  });
});

describe("OR-149: the projection's honest limits are rendered, not dropped", () => {
  it("reads and renders `simplifications` in LIVE code", () => {
    expect(livePanel).toContain("cap.simplifications");
    // ...and actually emits them into the output, not just reads them.
    expect(livePanel).toMatch(/simps\.map\(/);
  });

  it("the simplifications block is part of the rendered output", () => {
    expect(livePanel).toMatch(/outEl\.innerHTML\s*=[^;]*simpBlock/);
  });

  it("declares the scope limits the response cannot know about", () => {
    // 50K-only (ACCOUNT_TYPE is pinned server-side) and the CL-012 boundary.
    expect(livePanel).toMatch(/50K accounts only/i);
    expect(livePanel).toMatch(/CL-012/);
    expect(livePanel).toMatch(/scenario/i);
  });

  it("the 50K claim still matches the server's pinned ACCOUNT_TYPE", () => {
    // If a second account size ever ships, this panel's caption becomes a lie.
    expect(routeSrc).toMatch(/const ACCOUNT_TYPE = "50k"/);
  });
});

describe("XSS: escaping is a choke point, not a call-site convention", () => {
  it("item() escapes its value and sub, so a forgetful call site cannot inject", () => {
    const itemFn = livePanel.match(/function item\(k, v, sub, cls\) \{([\s\S]*?)\n  \}/);
    expect(itemFn, "item() not found — guard is stale").not.toBeNull();
    expect(itemFn![1]).toContain("esc(v)");
    expect(itemFn![1]).toContain("esc(sub)");
    expect(itemFn![1]).toContain("esc(k)");
  });

  it("server-derived table cells are escaped", () => {
    expect(livePanel).toContain("esc(m.phase)");
  });

  it("the firm dropdown escapes both fields it renders", () => {
    expect(livePanel).toContain("esc(f.name)");
    expect(livePanel).toContain("esc(f.displayName || f.name)");
  });
});

describe("office.html wiring", () => {
  it("mounts the panel and loads the script", () => {
    expect(officeHtml).toMatch(/<section id="of-payout"/);
    expect(officeHtml).toMatch(/src="\/slumhouse\/office-payout\.js"/);
  });

  it("the panel sleeps when the Office locks (no polling behind a locked door)", () => {
    expect(livePanel).toContain("office:unlocked");
    expect(livePanel).toContain("office:locked");
    expect(livePanel).toMatch(/function stop\(\)\s*\{[^}]*of-hide/);
  });
});
