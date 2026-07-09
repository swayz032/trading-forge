/**
 * deep-scan #22 Track X1 — failure-injection for the STRICT / whole-tree family-grade check.
 *
 * Proves the AST check: catches a bare notifyCritical, accepts direct / import-aliased / indirect
 * wraps, and (integration) goes RED on an unwrapped fixture file while passing an alias-wrapped one.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  checkFileSource,
  resolveWrapperAliases,
  resolveWrapperBoundVars,
  checkTree,
} from "../../../scripts/check-family-grade-postscript.js";

describe("resolveWrapperAliases — import + destructure aliasing", () => {
  it("resolves a static import alias", () => {
    const src = `import { appendFamilyGradePostscript as fgp } from "../lib/notification-helpers.js";`;
    const sf = require("typescript").createSourceFile("f.ts", src, 99, true);
    expect([...resolveWrapperAliases(sf)]).toContain("fgp");
  });
});

describe("checkFileSource — call classification", () => {
  it("FLAGS a bare notifyCritical (no wrapper anywhere)", () => {
    const src = `import { notifyCritical } from "./notification-service.js";\nnotifyCritical("t", "plain body", {});`;
    const offenders = checkFileSource(src, "x.ts");
    expect(offenders.length).toBe(1);
    expect(offenders[0].callee).toBe("notifyCritical");
  });
  it("FLAGS a bare notifyWarning", () => {
    const src = `notifyWarning("t", "plain body");`;
    expect(checkFileSource(src, "x.ts").length).toBe(1);
  });
  it("PASSES a direct appendFamilyGradePostscript wrap", () => {
    const src = `notifyCritical("t", appendFamilyGradePostscript("body", "what", "do"), {});`;
    expect(checkFileSource(src, "x.ts")).toEqual([]);
  });
  it("PASSES an import-aliased wrap (as fgp)", () => {
    const src =
      `import { appendFamilyGradePostscript as fgp } from "../lib/notification-helpers.js";\n` +
      `notifyCritical("t", fgp("body", "what", "do"), {});`;
    expect(checkFileSource(src, "x.ts")).toEqual([]);
  });
  it("PASSES a dynamic-destructure aliased wrap (await import)", () => {
    const src =
      `async function f() {\n` +
      `  const { appendFamilyGradePostscript: appendFGP } = await import("../lib/notification-helpers.js");\n` +
      `  notifyCritical("t", appendFGP(["a","b"].join("\\n"), "what", "do"));\n` +
      `}`;
    expect(checkFileSource(src, "x.ts")).toEqual([]);
  });
  it("PASSES an indirect const-variable wrap", () => {
    const src =
      `const body = appendFamilyGradePostscript("b", "w", "d");\n` +
      `notifyWarning("t", body, { m: 1 });`;
    expect(checkFileSource(src, "x.ts")).toEqual([]);
  });
  it("PASSES an inline family sentinel body", () => {
    const src = `notifyCritical("t", "body\\n\\n--- For family members ---\\nWhat this means: x", {});`;
    expect(checkFileSource(src, "x.ts")).toEqual([]);
  });
  it("does NOT flag the notify function DEFINITION (declaration, not a call)", () => {
    const src = `export function notifyCritical(title: string, body: string): void { send(title, body); }`;
    expect(checkFileSource(src, "notification-service.ts")).toEqual([]);
  });
  it("REGRESSION: wrapper name only in a comment does NOT satisfy the call", () => {
    const src = `// body built with appendFamilyGradePostscript below\nnotifyCritical("t", "plain body", {});`;
    expect(checkFileSource(src, "x.ts").length).toBe(1);
  });
});

describe("resolveWrapperBoundVars", () => {
  it("collects a var assigned from a wrapper call", () => {
    const ts = require("typescript");
    const src = `const msg = appendFamilyGradePostscript("b","w","d");`;
    const sf = ts.createSourceFile("f.ts", src, 99, true);
    const names = resolveWrapperAliases(sf);
    expect([...resolveWrapperBoundVars(sf, names)]).toContain("msg");
  });
});

describe("checkTree — failure injection on a temp fixture tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ds22-x1-fgp-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("RED then GREEN: unwrapped notifyCritical flagged, wrapping clears it", () => {
    const svc = path.join(root, "src", "server", "services");
    mkdirSync(svc, { recursive: true });
    const bare = path.join(svc, "bare.ts");
    writeFileSync(bare, `import { notifyCritical } from "./notification-service.js";\nnotifyCritical("Broker down", "500 x3", {});`);
    // scanRoot must be the src/server dir (checkTree walks it, excludes __tests__)
    const scanRoot = path.join(root, "src", "server");
    let offenders = checkTree(scanRoot);
    expect(offenders.length).toBe(1);
    expect(offenders[0].file).toContain("bare.ts");

    // Now wrap it → GREEN
    writeFileSync(
      bare,
      `import { notifyCritical } from "./notification-service.js";\n` +
        `import { appendFamilyGradePostscript } from "../lib/notification-helpers.js";\n` +
        `notifyCritical("Broker down", appendFamilyGradePostscript("500 x3", "what", "do"), {});`,
    );
    offenders = checkTree(scanRoot);
    expect(offenders).toEqual([]);
  });
});
