// Fix-wave telemetry-honesty-registry-dashboards (2026-07-17) — HIGH finding:
// system-topology.ts:2339's SSE-inventory drift arm was permanently dead because its
// source file (the old amber-vision-main frontend's typed sse-events.ts union) was
// deleted 2026-07-06; the read failure was caught and silently returned an empty set,
// which always reported zero drift regardless of real drift.
//
// This suite RED-proofs the repointed checker (now scanning broadcastSSE(...) call
// sites under src/server directly) against synthetic fixture trees, so it does not
// depend on — or get masked by — the real repo's current documentation state.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSseInventoryDriftItems, extractEmittedSseEventNames } from "../lib/system-topology.js";

async function makeFixture(serverFileContent: string): Promise<{ rootDir: string; cleanup: () => Promise<void> }> {
  const rootDir = await mkdtemp(path.join(tmpdir(), "tf-sse-drift-"));
  const serverLibDir = path.join(rootDir, "src", "server", "lib");
  await mkdir(serverLibDir, { recursive: true });
  await writeFile(path.join(serverLibDir, "fixture-emitter.ts"), serverFileContent, "utf-8");
  return {
    rootDir,
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
  };
}

describe("SSE inventory drift checker (repointed off the deleted frontend union)", () => {
  it("extracts a literal broadcastSSE(\"...\") event name", async () => {
    const { rootDir, cleanup } = await makeFixture(`
      import { broadcastSSE } from "../routes/sse.js";
      export function emit() {
        broadcastSSE("fixture:literal_event", { ok: true });
      }
    `);
    try {
      const events = await extractEmittedSseEventNames(rootDir);
      expect(events.has("fixture:literal_event")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("resolves a catalog-constant broadcastSSE(CATALOG.KEY, ...) event name", async () => {
    const { rootDir, cleanup } = await makeFixture(`
      import { broadcastSSE } from "../routes/sse.js";
      export const FIXTURE_EVENTS = {
        THING_HAPPENED: "fixture:thing_happened",
      } as const;
      export function emit() {
        broadcastSSE(FIXTURE_EVENTS.THING_HAPPENED, { ok: true });
      }
    `);
    try {
      const events = await extractEmittedSseEventNames(rootDir);
      expect(events.has("fixture:thing_happened")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("resolves a standalone-const broadcastSSE(CONST_NAME, ...) event name", async () => {
    const { rootDir, cleanup } = await makeFixture(`
      import { broadcastSSE } from "../routes/sse.js";
      export const FIXTURE_EVENT = "fixture:standalone_event";
      export function emit() {
        broadcastSSE(FIXTURE_EVENT, { ok: true });
      }
    `);
    try {
      const events = await extractEmittedSseEventNames(rootDir);
      expect(events.has("fixture:standalone_event")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("RED-PROOF: flags an SSE event emitted in code but undocumented in the System Map inventory", async () => {
    const { rootDir, cleanup } = await makeFixture(`
      import { broadcastSSE } from "../routes/sse.js";
      export function emit() {
        broadcastSSE("fixture:undocumented_injected_event", { ok: true });
      }
    `);
    try {
      const mapTextMissingTheEvent = [
        "## §SSE Events Canonical Inventory",
        "",
        "### fixture:some_other_documented_event",
        "- Purpose: unrelated documented event, present so the inventory section is non-empty.",
        "",
        "## §Next Section",
      ].join("\n");

      const driftItems = await buildSseInventoryDriftItems(rootDir, mapTextMissingTheEvent);
      const missingItem = driftItems.find((item) => item.includes("missing from System Map inventory"));
      expect(missingItem).toBeDefined();
      expect(missingItem).toContain("fixture:undocumented_injected_event");
    } finally {
      await cleanup();
    }
  });

  it("reports zero drift when the emitted event is documented in the inventory", async () => {
    const { rootDir, cleanup } = await makeFixture(`
      import { broadcastSSE } from "../routes/sse.js";
      export function emit() {
        broadcastSSE("fixture:documented_event", { ok: true });
      }
    `);
    try {
      const mapText = [
        "## §SSE Events Canonical Inventory",
        "",
        "### fixture:documented_event",
        "- Purpose: matches the emitted event exactly.",
        "",
        "## §Next Section",
      ].join("\n");

      const driftItems = await buildSseInventoryDriftItems(rootDir, mapText);
      expect(driftItems).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("flags an orphaned inventory entry that is no longer emitted anywhere", async () => {
    const { rootDir, cleanup } = await makeFixture(`
      import { broadcastSSE } from "../routes/sse.js";
      export function emit() {
        broadcastSSE("fixture:still_emitted", { ok: true });
      }
    `);
    try {
      const mapText = [
        "## §SSE Events Canonical Inventory",
        "",
        "### fixture:still_emitted",
        "- Purpose: matches.",
        "",
        "### fixture:dead_documented_event",
        "- Purpose: no longer emitted anywhere in code.",
        "",
        "## §Next Section",
      ].join("\n");

      const driftItems = await buildSseInventoryDriftItems(rootDir, mapText);
      const orphanItem = driftItems.find((item) => item.includes("never emitted"));
      expect(orphanItem).toBeDefined();
      expect(orphanItem).toContain("fixture:dead_documented_event");
    } finally {
      await cleanup();
    }
  });

  it("flags drift when the scan finds zero broadcastSSE call sites (scanner-broken guard, not the old silent-empty-set behavior)", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "tf-sse-drift-empty-"));
    try {
      // src/server exists but has no .ts files at all — this is the exact shape of
      // the ORIGINAL bug (source unreadable/absent). The old code caught that and
      // returned an empty Set silently, which made buildSseInventoryDriftItems()
      // short-circuit to "no drift" — the permanently-dead behavior this fix removes.
      await mkdir(path.join(rootDir, "src", "server"), { recursive: true });
      const driftItems = await buildSseInventoryDriftItems(rootDir, "## §SSE Events Canonical Inventory\n");
      expect(driftItems.some((item) => item.includes("scanner is broken"))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
