import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync(path.resolve("public/slumhouse/member-office.html"), "utf8");
const route = fs.readFileSync(path.resolve("src/server/routes/slumhouse/api/member-office.ts"), "utf8");
const live = html.replace(/<!--[\s\S]*?-->/g, "");

describe("member Office PIN security", () => {
  it("uses non-autocompleted password fields", () => {
    for (const id of ["pin", "pin-confirm"]) {
      expect(live).toMatch(new RegExp(`id="${id}"[^>]*type="password"[^>]*autocomplete="off"`));
    }
  });

  it("clears both fields on every submit path", () => {
    const body = live.match(/async function submitPin\(\)\{([\s\S]*?)\n\s*byId\('pin-submit'\)/)?.[1] ?? "";
    expect(body).toMatch(/finally\s*\{[^}]*p\.value='';c\.value=''/);
  });

  it("never persists or renders the submitted code", () => {
    expect(live).not.toMatch(/localStorage|sessionStorage/);
    expect(live).not.toMatch(/innerHTML/);
    expect(live).not.toMatch(/textContent\s*=\s*code/);
  });

  it("lets server responses alone select establish versus verify", () => {
    expect(live).toMatch(/j\.error==='no_pin_set'[^}]*setPinMode\('establish'\)/);
    expect(live).toMatch(/j\.error==='pin_already_set'[^}]*setPinMode\('verify'\)/);
    expect(live.match(/setPinMode\('/g)?.length).toBe(2);
  });

  it("fails closed and re-asks scope after success", () => {
    expect(live).toMatch(/if\(!scope\.surfaces\.length\)\{[^}]*lock[^}]*return/);
    expect(live).toMatch(/if\(r\.ok\)\{pinSay\(''\);await boot\(\)/);
    expect(live).toContain("Cannot reach the server");
  });

  it("renders only surfaces returned by scope", () => {
    expect(live).toContain("scope.surfaces");
    expect(live).not.toMatch(/role\s*===?\s*['"]operator/);
  });

  it("keeps lockout and wrong-code messages non-revealing", () => {
    expect(live).toContain("Too many tries. Try again later.");
    expect(live).toContain("That code did not work.");
    expect(live).not.toMatch(/tries remaining|attempts left|almost|nearly/i);
  });
});

describe("PIN UI and server stay wired together", () => {
  for (const url of ["/slumhouse/api/member/pin/establish", "/slumhouse/api/member/pin"]) {
    it(`${url} exists on both sides`, () => {
      expect(live).toContain(url);
      expect(route).toContain(`"${url}"`);
    });
  }

  it("matches the server PIN length policy", () => {
    const policy = fs.readFileSync(path.resolve("src/server/lib/member-pin.ts"), "utf8");
    const min = policy.match(/minLength:\s*(\d+)/)?.[1];
    const max = policy.match(/maxLength:\s*(\d+)/)?.[1];
    expect(live).toContain(`between ${min} and ${max} characters`);
    expect(live).toMatch(new RegExp(`id="pin"[^>]*minlength="${min}"[^>]*maxlength="${max}"`));
  });
});

describe("member-only markup", () => {
  it.each(["carter", "reporting room", "system metrics", "learning loop"])("contains no %s surface", (term) => {
    expect(live.toLowerCase()).not.toContain(term);
  });
});
