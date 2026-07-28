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

  it("restores honest 3D standby waves until account observations exist", () => {
    expect(crib).toContain("function standbyWave(tone)");
    expect(crib).toContain("AWAITING REAL DATA");
    expect(crib).toContain("Decorative standby visual. Awaiting real account data.");
    expect(crib).toMatch(/if \(opts\.spark && opts\.spark\.length >= 2\)[\s\S]*sparkline\(opts\.spark/);
    expect(crib).not.toMatch(/sparkline\(baselineSpark/);
  });

  it("formats old Discord intake ages and lets live items fill their panels", () => {
    expect(crib).toContain("function formatAgeMinutes(rawMinutes)");
    expect(crib).toContain("formatAgeMinutes(f.ageMin)");
    expect(crib).not.toContain("${f.ageMin}m ago");
    expect(shared).toBeTruthy();
  });
});

describe("operator broker health is real, compact, and secret-safe", () => {
  it("is a carousel card that opens a compact dialog", () => {
    expect(office).toContain("id: 'broker_health'");
    expect(office).toMatch(/<dialog id="of-broker-card"/);
    expect(office).toContain("openBrokerHealth()");
  });

  it("reads real health and clears the submitted credential on every path", () => {
    expect(office).toContain("/slumhouse/api/member/broker-health");
    expect(office).toContain("/slumhouse/api/member/broker-enroll");
    expect(office).toContain("Credentials go only to encrypted server storage");
    expect(office).toContain(".finally(function ()");
    expect(office).toContain("brokerKey.value = ''");
    expect(office).not.toMatch(/TESTKEY|connect-test/i);
  });
});
