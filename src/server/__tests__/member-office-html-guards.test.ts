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

describe("F-4: the key input is cleared on EVERY path", () => {
  it("the clear runs in a finally block, not only after a successful fetch", () => {
    // Previously the clear sat after the fetch, so a network throw left the key in the DOM.
    const finallyBlock = html.match(/\}\s*finally\s*\{([\s\S]*?)\}/);
    expect(finallyBlock, "connect handler must have a finally block").not.toBeNull();
    expect(finallyBlock![1]).toMatch(/keyEl\.value\s*=\s*""/);
  });

  it("the key field is a password input and never autocompleted", () => {
    expect(html).toMatch(/id="key"[^>]*type="password"/);
    expect(html).toMatch(/id="key"[^>]*autocomplete="off"/);
  });

  it("the key is never written into the DOM anywhere", () => {
    // No path may echo the key back — not into status text, not into a data attribute.
    expect(liveMarkup).not.toMatch(/textContent\s*=\s*[^;]*keyEl\.value/);
    expect(liveMarkup).not.toMatch(/innerHTML\s*=\s*[^;]*keyEl\.value/);
  });
});

describe("the page performs no access decisions of its own", () => {
  it("has no client-side role check", () => {
    for (const pattern of [/isOperator/, /isAdmin/, /role\s*===?\s*["']operator["']/]) {
      expect(liveMarkup).not.toMatch(pattern);
    }
  });
});
