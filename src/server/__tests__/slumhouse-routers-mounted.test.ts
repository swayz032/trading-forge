// src/server/__tests__/slumhouse-routers-mounted.test.ts
//
// CLASS guard for a wiring gap found 2026-07-21 (OA-140): `memberOfficeRouter` shipped with
// Tier-2 item 6, defined four routes, and was never mounted in `slumhouse/index.ts`. Every route
// was unreachable in production. `member-office.html` fetches `/slumhouse/api/member/scope`;
// unmounted, that fell through to express.static, 404'd, and the page's `if (r.ok)` guard turned
// the 404 into an empty scope — so a member saw a permanently "Locked" room and nothing logged an
// error. A silent failure, on a surface that had already been built, tested and graded.
//
// ★ WHY THE EXISTING TESTS COULD NOT CATCH IT — this is the reusable lesson.
// `member-office-crown-e2e.test.ts` builds its OWN express app and calls
// `app.use(memberOfficeRouter)` before exercising the routes. That proves the routes work WHEN
// MOUNTED. It says nothing about whether production mounts them. A test that supplies the very
// wiring it is meant to verify cannot fail the way production failed.
//
// So this guard deliberately does NOT import the routers or start a server. It reads the
// production barrel as TEXT and asserts the mount is written there — because the property under
// test is "the barrel mounts this", and any test that constructs its own app re-introduces the
// exact blind spot.
//
// Instance fixed; this is the class (CLAUDE.md: fix the pattern, not the instance).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const API_DIR = path.resolve("src/server/routes/slumhouse/api");
const BARREL = path.resolve("src/server/routes/slumhouse/index.ts");
const barrelSrc = fs.readFileSync(BARREL, "utf-8");

/** Live code only — a mount written inside a comment is not a mount. */
const liveBarrel = barrelSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/**
 * Routers that are deliberately NOT mounted on `slumhouseRouter`.
 *
 * Empty on purpose. Adding an entry requires a written reason here — that way an intentional
 * omission is a documented decision, and an accidental one (which is what OA-140 was) still
 * fails this test. "It's fine, it's mounted elsewhere" belongs in this comment, not in silence.
 */
const DELIBERATELY_UNMOUNTED: Record<string, string> = {};

/** Every `export const xxxRouter` declared under routes/slumhouse/api. */
function declaredRouters(): { file: string; name: string }[] {
  return fs
    .readdirSync(API_DIR)
    .filter(f => f.endsWith(".ts"))
    .flatMap(file => {
      const src = fs.readFileSync(path.join(API_DIR, file), "utf-8");
      return [...src.matchAll(/export const (\w*Router)\b/g)].map(m => ({ file, name: m[1] }));
    });
}

describe("every Slumhouse API router is actually mounted in the production barrel", () => {
  const routers = declaredRouters();

  it("finds the routers to check (guard is not vacuously passing)", () => {
    // Without this, a rename of the api directory would make every assertion below iterate an
    // empty list and report success — the classic way a guard stops guarding.
    expect(routers.length).toBeGreaterThanOrEqual(9);
    expect(routers.map(r => r.name)).toContain("memberOfficeRouter");
  });

  for (const { file, name } of routers) {
    it(`${name} (${file}) is imported and mounted`, () => {
      const why = DELIBERATELY_UNMOUNTED[name];
      if (why) {
        expect(liveBarrel).not.toContain(`slumhouseRouter.use(${name})`);
        return;
      }
      expect(liveBarrel, `${name} is never imported by the barrel`).toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`),
      );
      expect(liveBarrel, `${name} is imported but never mounted — its routes are unreachable`)
        .toContain(`slumhouseRouter.use(${name})`);
    });
  }
});

describe("the member-Office routes the live page depends on are reachable", () => {
  // Pinned by path, not just by router name: the page hardcodes these URLs, so a route rename
  // that leaves the router mounted would still break the page silently.
  const PAGE = path.resolve("public/slumhouse/member-office.html");
  const pageSrc = fs.readFileSync(PAGE, "utf-8");
  const routeSrc = fs.readFileSync(path.join(API_DIR, "member-office.ts"), "utf-8");

  const called = [...pageSrc.matchAll(/"(\/slumhouse\/api\/member\/[a-z/-]*)"/g)].map(m => m[1]);

  it("the page calls at least the scope endpoint", () => {
    expect(called).toContain("/slumhouse/api/member/scope");
  });

  for (const url of [...new Set(called)]) {
    it(`${url} is declared by the member-office router`, () => {
      expect(routeSrc).toContain(`"${url}"`);
    });
  }
});
