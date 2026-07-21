// src/server/__tests__/member-office-pin-ui-guards.test.ts
//
// PIN-entry UI (OR-167) — the actual cure for the permanently-"Locked" member room.
//
// The properties that matter here are all NEGATIVE — the code must not reach the DOM, the page
// must not decide access, an error must not open the office — and negatives are exactly what a
// happy-path render test cannot see. So these are guards, and every one of them was
// mutation-proved at birth (break the property, watch this file go red).
//
// Comments are stripped before assertion: a promise made only in a comment is not a property.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PAGE = path.resolve("public/slumhouse/member-office.html");
const ROUTE = path.resolve("src/server/routes/slumhouse/api/member-office.ts");
const html = fs.readFileSync(PAGE, "utf-8");
const routeSrc = fs.readFileSync(ROUTE, "utf-8");

/** Only LIVE markup/script can satisfy a guarantee. */
const live = html.replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Live code with quoted STRING LITERALS emptied — so the identifier `code` can be distinguished
 * from the word "code" in UI copy ("Enter your code"). Without this the choice is a guard that
 * false-positives on its own prose or one that misses the real leak; the first two attempts at
 * this file were one of each. Backticks are deliberately LEFT INTACT so `${code}` stays visible.
 */
const liveNoStrings = live
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''");

describe("the code never reaches the DOM", () => {
  it("both PIN fields are password inputs and are never autocompleted", () => {
    expect(live).toMatch(/id="pin"[^>]*type="password"/);
    expect(live).toMatch(/id="pin"[^>]*autocomplete="off"/);
    expect(live).toMatch(/id="pin-confirm"[^>]*type="password"/);
    expect(live).toMatch(/id="pin-confirm"[^>]*autocomplete="off"/);
  });

  it("★ BOTH fields are cleared inside a `finally`, not after a successful fetch", () => {
    // The connect-card had this exact bug (F-4): the clear sat after the fetch, so a network
    // throw stranded the key in the DOM. A `finally` is the only placement that survives an
    // early return AND a throw.
    const blocks = [...live.matchAll(/\}\s*finally\s*\{([\s\S]*?)\n\s{4}\}/g)].map(m => m[1]);
    const clearing = blocks.find(b => /pinEl\.value\s*=\s*""/.test(b));
    expect(clearing, "no finally block clears the PIN field").toBeDefined();
    expect(clearing!).toMatch(/confirmEl\.value\s*=\s*""/);
  });

  it("★ the code never flows into a DOM sink — DIRECTLY or through a helper", () => {
    // ★ Mutation-proved at birth, and the first version of this guard HAD A HOLE:
    // `pinSay("That code did not work: " + code)` stayed GREEN, because the guard watched the
    // sink (`textContent = …`) while the leak entered through the helper's ARGUMENT and never
    // touched the pattern. Same species as guarding a wall the attack walks around.
    // Asserting on liveNoStrings is what makes these precise instead of prose-tripped.
    expect(liveNoStrings).not.toMatch(/pinSay\([^)]*\bcode\b/);
    expect(liveNoStrings).not.toMatch(/pinSay\([^)]*(pinEl|confirmEl)\.value/);
    expect(liveNoStrings).not.toMatch(/(textContent|innerHTML)\s*=[^;\n]*\bcode\b/);
    expect(liveNoStrings).not.toMatch(/(textContent|innerHTML)\s*=[^;\n]*(pinEl|confirmEl)\.value/);
    expect(liveNoStrings).not.toMatch(/setAttribute\([^)]*\bcode\b/);
    // Never concatenated or interpolated into ANY string, anywhere.
    expect(liveNoStrings).not.toMatch(/\+\s*code\b/);
    expect(liveNoStrings).not.toMatch(/\bcode\s*\+/);
    expect(live).not.toMatch(/\$\{code\}/);
    expect(live).not.toMatch(/localStorage|sessionStorage/);    // never persisted client-side
  });

  it("the code variable is used ONLY where it must be", () => {
    // Belt to the above's braces: with prose stripped, `code` should appear exactly at its
    // declaration, the empty check, the confirm comparison, and the request body. A fifth use is
    // not automatically a leak — but it is automatically worth a human look.
    const uses = [...liveNoStrings.matchAll(/\bcode\b/g)].length;
    expect(uses, "an unexpected use of the PIN variable appeared — review it").toBe(4);
  });

  it("the status line writes textContent, never innerHTML", () => {
    // Server strings land here (e.g. the policy `reason`); textContent makes them inert.
    expect(live).toMatch(/pin-status"\)\.textContent\s*=/);
    expect(live).not.toMatch(/pin-status"\)\.innerHTML/);
  });
});

describe("the page makes NO access decision of its own", () => {
  it("★ first-run vs return is set ONLY from a server response", () => {
    // Inferring "this member has no PIN" client-side would be an access decision this page is
    // not allowed to make. The only setPinMode calls are the two 409 branches (plus the initial
    // literal), so the server owns the flow.
    expect(live).toMatch(/j\.error\s*===\s*"no_pin_set"[\s\S]{0,80}setPinMode\("establish"\)/);
    expect(live).toMatch(/j\.error\s*===\s*"pin_already_set"[\s\S]{0,80}setPinMode\("verify"\)/);
    // Count CALLS only — `setPinMode("…")` — not the `function setPinMode(mode)` definition,
    // which the first version of this guard miscounted as a third call.
    const calls = [...live.matchAll(/setPinMode\("/g)].length;
    expect(calls, "an extra setPinMode call may be a client-side inference").toBe(2);
  });

  it("a successful unlock re-asks the server what may be seen", () => {
    // It must NOT render surfaces from local assumption after a 200.
    expect(live).toMatch(/if\s*\(r\.ok\)[\s\S]{0,120}await boot\(\)/);
  });

  it("surfaces still come only from the server's scope response", () => {
    expect(live).toMatch(/scope\.surfaces/);
    expect(live).not.toMatch(/surfaces\s*=\s*\[\s*"/); // no hardcoded surface list
  });
});

describe("fail-CLOSED", () => {
  it("an empty scope shows the lock and the PIN form, and hides the connect card", () => {
    const branch = live.match(/if \(shown\.length === 0\) \{([\s\S]*?)return;/);
    expect(branch, "the empty-scope branch is gone").not.toBeNull();
    expect(branch![1]).toMatch(/pin-card"\)\.style\.display = ""/);
    expect(branch![1]).toMatch(/connect-card"\)\.style\.display = "none"/);
  });

  it("an unknown or server error leaves the office shut", () => {
    // No branch may open anything on a non-ok response; the catch-all only writes a message.
    expect(live).toMatch(/Cannot check your code right now/);
    expect(live).toMatch(/catch\s*\{[\s\S]{0,120}Cannot reach the server/);
  });

  it("the PIN card starts hidden and is only revealed by the locked branch", () => {
    expect(live).toMatch(/id="pin-card"[^>]*style="display:none"/);
  });
});

describe("the lockout message is legible but not informative", () => {
  it("says when to retry, never how many tries remain or how close the code was", () => {
    expect(live).toMatch(/Too many tries/);
    expect(live).toMatch(/retryAfterMs/);
    expect(live).not.toMatch(/attemptsAllowed/);      // the route returns it; the page must not show it
    expect(live).not.toMatch(/tries remaining|attempts left|attempts remaining/i);
  });

  it("a wrong code says only that it did not work", () => {
    expect(live).toMatch(/That code did not work/);
    expect(live).not.toMatch(/close|almost|nearly/i);
  });
});

describe("the form is wired to routes that actually exist", () => {
  // A rename on either side would silently strand the form — the same class as the unmounted
  // router (OA-140), one layer up.
  for (const url of ["/slumhouse/api/member/pin/establish", "/slumhouse/api/member/pin"]) {
    it(`${url} is declared by the member-office router`, () => {
      expect(live).toContain(url);
      expect(routeSrc).toContain(`"${url}"`);
    });
  }

  it("the page's stated code length matches the server's PIN_POLICY", () => {
    // A form promising 6-12 while the server enforces something else is a caption defect.
    const policy = fs.readFileSync(path.resolve("src/server/lib/member-pin.ts"), "utf-8");
    const min = policy.match(/minLength:\s*(\d+)/)?.[1];
    const max = policy.match(/maxLength:\s*(\d+)/)?.[1];
    expect(min, "PIN_POLICY.minLength unreadable — guard is stale").toBeDefined();
    expect(live).toContain(`between ${min} and ${max} characters`);
    expect(live).toMatch(new RegExp(`id="pin"[^>]*maxlength="${max}"`));
  });
});

describe("member-office invariants still hold with the form added", () => {
  it("Carter is still absent from live markup", () => {
    expect(live.toLowerCase()).not.toContain("carter");
  });
});
