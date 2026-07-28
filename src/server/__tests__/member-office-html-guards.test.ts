// src/server/__tests__/member-office-html-guards.test.ts
//
// F-3 + F-4 closure (OR-053 §3). Both were previously verified by a one-time MANUAL check —
// which is exactly the gap: a property nobody re-checks is a property that quietly regresses.
// These are the permanent guards.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PAGE = path.resolve("public/slumhouse/member-office.html");
const html = fs.readFileSync(PAGE, "utf-8");

/** HTML comments describe the guarantees; only LIVE markup can violate them. */
const liveMarkup = html.replace(/<!--[\s\S]*?-->/g, "");

describe("F-3: Carter is absent by route, and stays absent", () => {
  it("no Carter reference survives in live markup or script", () => {
    expect(liveMarkup.toLowerCase()).not.toContain("carter");
  });

  it("no Carter element id or container exists", () => {
    // The operator's own office.html uses `carter-call` + a family of `cc-*` ids. None of that
    // may appear here: a member must not be able to unhide what is simply not present.
    expect(liveMarkup).not.toMatch(/id="carter/i);
    expect(liveMarkup).not.toMatch(/id="cc-/i);
  });

  it("the guarantee is still DOCUMENTED (so a future editor knows it is load-bearing)", () => {
    expect(html).toMatch(/CARTER IS ABSENT BY ROUTE/i);
  });
});

describe("member Office contains no operator-only reporting surfaces", () => {
  it.each(["reporting room", "system metrics", "learning loop"])("has no %s surface", (label) => {
    expect(liveMarkup.toLowerCase()).not.toContain(label);
  });
});

describe("member Office renders account-scoped bot truth", () => {
  it("loads the same authenticated crib data that powers homepage performance", () => {
    expect(liveMarkup).toMatch(/fetch\(['"]\/slumhouse\/api\/crib['"]/);
    expect(liveMarkup).toContain("data.accountUnmapped");
  });
});

describe("real broker enrollment protects browser secrets", () => {
  it("uses a password field, clears it in finally, and contains no mock validator", () => {
    expect(liveMarkup).toMatch(/id="broker-secret"[^>]*type="password"[^>]*autocomplete="off"/);
    expect(liveMarkup).toMatch(/finally\s*\{secret\.value=''/);
    expect(liveMarkup).not.toMatch(/TESTKEY|connect-test/i);
    expect(liveMarkup).toContain("/slumhouse/api/member/broker-health");
    expect(liveMarkup).toContain("/slumhouse/api/member/broker-enroll");
  });

  it("states that secrets stay server-side and execution stays locked", () => {
    expect(liveMarkup).toContain("Credentials go to encrypted server storage");
    expect(liveMarkup).toMatch(/Live execution stays locked/i);
  });
});

describe("the page performs no access decisions of its own", () => {
  it("has no client-side role check", () => {
    for (const pattern of [/isOperator/, /isAdmin/, /role\s*===?\s*["']operator["']/]) {
      expect(liveMarkup).not.toMatch(pattern);
    }
  });
});
