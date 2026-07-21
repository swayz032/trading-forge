/**
 * Anam spoken-name greeting — CLIENT-SIDE safety properties (crib.html).
 *
 * ★ DECLARED LIMIT, up front: these are SOURCE-LEVEL assertions on the served HTML, not
 * behavioural tests. The Anam client streams from a browser against a live avatar service, so
 * executing this path here is not possible. What a source check CAN prove is that the two
 * failure-handling properties are present and were not quietly dropped by a later edit; it
 * cannot prove the greeting is spoken. Stated so nobody reads a green here as "the avatar
 * greets by name" — that is verified by a human hearing it.
 *
 * The properties are worth guarding because both have bitten this repo before:
 *   • `fetch` does NOT throw on 4xx/5xx — an unchecked response body gets parsed as if it were
 *     a greeting (the false-success class, three prior sightings).
 *   • polish must never become a dependency — a greeting failure must not break the stream.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PUB_DIR = process.env["SLUMHOUSE_PUBLIC_DIR"] || path.resolve(process.cwd(), "public/slumhouse");
const crib = readFileSync(path.join(PUB_DIR, "crib.html"), "utf-8");

describe("anam spoken-name greeting (client)", () => {
  it("CONTROL — crib.html is readable and contains the Anam launch path", () => {
    // Without this, every assertion below could pass vacuously against an empty read.
    expect(crib.length).toBeGreaterThan(1000);
    expect(crib).toContain("streamToVideoElement");
  });

  it("speaks the greeting via talk() over the EXISTING session (persona lock preserved)", () => {
    expect(crib).toContain("anamClient.talk(");
    // The whole point of talk(): the client never CONSTRUCTS a persona. An inline definition
    // would duplicate the server-locked persona here. Assert on code, not prose — the words
    // avatarId/systemPrompt legitimately appear in this file's explanatory comment.
    expect(crib).not.toMatch(/personaConfig\s*:/);
    expect(crib).not.toMatch(/avatarId\s*:/);
    expect(crib).not.toMatch(/systemPrompt\s*:/);
  });

  it("★ checks res.ok before parsing — fetch does not throw on 4xx", () => {
    // ★ Anchor on the CALL, not the first textual match: the path also appears in a comment
    // above, and indexOf() would land there. Comment-vs-code, the defect this repo has hit
    // three times (the "322 call sites" that were 189; five "uncovered CRITICALs" that were
    // five comments) — and it bit this very test on first run.
    const idx = crib.indexOf('fetch("/slumhouse/api/anam-greeting"');
    expect(idx).toBeGreaterThan(-1);
    const window = crib.slice(idx, idx + 600);
    expect(window).toMatch(/\.ok/);
    // The status check must come BEFORE the body is read, or an error body reaches talk().
    expect(window.indexOf(".ok")).toBeLessThan(window.indexOf(".json()"));
  });

  it("★ is FAIL-SOFT — a greeting failure cannot break the avatar stream", () => {
    const idx = crib.indexOf('fetch("/slumhouse/api/anam-greeting"');
    const window = crib.slice(Math.max(0, idx - 400), idx + 900);
    expect(window).toMatch(/try\s*\{/);
    expect(window).toMatch(/catch\s*\(/);
  });

  it("the greeting is fetched with credentials (session-scoped, not anonymous)", () => {
    const idx = crib.indexOf('fetch("/slumhouse/api/anam-greeting"');
    const window = crib.slice(idx, idx + 300);
    expect(window).toContain("credentials");
  });
});
