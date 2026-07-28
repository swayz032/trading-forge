import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = resolve(
  process.cwd(),
  "src/server/db/migrations/0207_youtube_evidence_archive.sql",
);
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("Migration 0207: youtube_evidence_archive", () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite();
  });

  afterAll(async () => {
    await pg.close();
  });

  it("is present, additive, and safe to apply repeatedly", async () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migrationSql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+youtube_evidence_archive/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
    await expect(pg.exec(migrationSql)).resolves.not.toThrow();
    await expect(pg.exec(migrationSql)).resolves.not.toThrow();
  });

  it("rejects available evidence without its transcript and integrity seal", async () => {
    await expect(
      pg.exec(`
        INSERT INTO youtube_evidence_archive
          (video_id, youtube_url, title, source_provider, transcript_status)
        VALUES
          ('abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk', 'Missing evidence', 'test', 'available');
      `),
    ).rejects.toThrow();
  });

  it("accepts sealed evidence and prevents duplicate video identities", async () => {
    await pg.exec(`
      INSERT INTO youtube_evidence_archive
        (video_id, youtube_url, title, transcript_text, transcript_sha256,
         transcript_chars, source_provider, transcript_status)
      VALUES
        ('12345678901', 'https://youtu.be/12345678901', 'Sealed evidence',
         'full transcript', '${"a".repeat(64)}', 15, 'test', 'available');
    `);

    await expect(
      pg.exec(`
        INSERT INTO youtube_evidence_archive
          (video_id, youtube_url, title, source_provider, transcript_status)
        VALUES
          ('12345678901', 'https://youtu.be/12345678901', 'Duplicate', 'test', 'pending');
      `),
    ).rejects.toThrow();
  });

  it("rejects unknown transcript states and negative character counts", async () => {
    await expect(
      pg.exec(`
        INSERT INTO youtube_evidence_archive
          (video_id, youtube_url, title, source_provider, transcript_status)
        VALUES
          ('zzzzzzzzzzz', 'https://youtu.be/zzzzzzzzzzz', 'Bad status', 'test', 'invented');
      `),
    ).rejects.toThrow();

    await expect(
      pg.exec(`
        INSERT INTO youtube_evidence_archive
          (video_id, youtube_url, title, transcript_chars, source_provider, transcript_status)
        VALUES
          ('yyyyyyyyyyy', 'https://youtu.be/yyyyyyyyyyy', 'Bad length', -1, 'test', 'unavailable');
      `),
    ).rejects.toThrow();
  });
});
