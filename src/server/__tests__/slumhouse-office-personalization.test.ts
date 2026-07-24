import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const office = fs.readFileSync(path.resolve("public/slumhouse/office.html"), "utf8");
const crib = fs.readFileSync(path.resolve("public/slumhouse/crib.html"), "utf8");
const shared = fs.readFileSync(path.resolve("public/slumhouse/slumhouse.js"), "utf8");

describe("Slumhouse personalized office navigation", () => {
  it("rewrites shared Office links from server-authoritative identity scope", () => {
    expect(shared).toContain('fetch("/slumhouse/api/member/scope"');
    expect(shared).toContain('link.setAttribute("href", viewer.officePath)');
  });

  it("personalizes existing homepage performance without replacing its stats", () => {
    expect(crib).toContain("data.viewer");
    expect(crib).toContain('label: botLabel + " · Today\'s Bag"');
    expect(crib).toContain('label: botLabel + " · Trades Today"');
    expect(crib).toContain('label: botLabel + " · Open Right Now"');
  });
});

describe("operator broker card remains test-only and secret-safe", () => {
  it("is hidden until the Office is unlocked", () => {
    expect(office).toMatch(/id="of-broker-card"[^>]*of-hide/);
    expect(office).toContain("brokerCard.classList.remove('of-hide')");
    expect(office).toContain("brokerCard.classList.add('of-hide')");
  });

  it("states the non-live boundary and never retains the submitted key", () => {
    expect(office).toContain("Test mode · no live orders");
    expect(office).toContain("without touching live execution or saving real credentials");
    expect(office).toContain(".finally(function () { brokerKey.value = ''; })");
  });
});
