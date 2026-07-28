import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema.js";

const holder = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock("../db/index.js", () => ({
  db: new Proxy({}, {
    get(_target, property: string | symbol) {
      const real = holder.db as unknown as Record<string | symbol, unknown>;
      const value = real[property];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    },
  }),
}));

let pg: PGlite;
let archiveYoutubeEvidence: typeof import("../services/youtube-evidence-archive.js").archiveYoutubeEvidence;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync(resolve("src/server/db/migrations/0207_youtube_evidence_archive.sql"), "utf8"));
  holder.db = drizzle(pg, { schema });
  ({ archiveYoutubeEvidence } = await import("../services/youtube-evidence-archive.js"));
});

afterAll(async () => {
  await pg.close();
});

describe("archiveYoutubeEvidence", () => {
  it("persists sealed historical transcripts and never lets a later miss erase them", async () => {
    const discoveredAt = new Date("2026-07-01T15:00:00.000Z");
    const transcript = "A complete historical trading transcript with deterministic mechanics. ".repeat(8).trim();
    await archiveYoutubeEvidence({
      youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      title: "Historical strategy",
      channel: "Source channel",
      transcript,
      sourceProvider: "historical_extraction_cache",
      discoveredAt,
    });
    await archiveYoutubeEvidence({
      youtubeUrl: "https://youtu.be/abcdefghijk",
      title: null,
      transcript: null,
      sourceProvider: "later_retry",
      status: "unavailable",
    });

    const result = await pg.query<{
      transcript_text: string;
      transcript_chars: number;
      transcript_status: string;
      discovered_at: string;
    }>("SELECT transcript_text, transcript_chars, transcript_status, discovered_at FROM youtube_evidence_archive");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.transcript_text).toBe(transcript);
    expect(result.rows[0]?.transcript_chars).toBe(transcript.length);
    expect(result.rows[0]?.transcript_status).toBe("available");
    expect(new Date(result.rows[0]!.discovered_at).toISOString()).toBe(discoveredAt.toISOString());
  });
});
