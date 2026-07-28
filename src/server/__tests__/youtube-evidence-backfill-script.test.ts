import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchYoutubeMetadata,
  loadCachedTranscripts,
  parseBackfillArgs,
  parseCachedTranscript,
} from "../../../scripts/backfill-youtube-evidence-archive.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tf-evidence-backfill-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("historical YouTube evidence backfill", () => {
  it("is dry-run by default and requires explicit source directories", () => {
    expect(parseBackfillArgs(["--source-dir", "."])).toEqual({ apply: false, sourceDirs: [path.resolve(".")] });
    expect(parseBackfillArgs(["--apply", "--source-dir", "."]).apply).toBe(true);
    expect(() => parseBackfillArgs([])).toThrow("At least one --source-dir");
    expect(() => parseBackfillArgs(["--unknown"])).toThrow("Unknown argument");
  });

  it("removes cache-only title headers without changing transcript text", () => {
    expect(parseCachedTranscript("TITLE: Premium Setup\r\n\r\nThe full transcript.\r\n")).toEqual({
      titleHint: "Premium Setup",
      transcript: "The full transcript.",
    });
  });

  it("requires every requested transcript and verifies adjacent extraction char counts", () => {
    const directory = tempDir();
    const transcript = "real mechanics ".repeat(20).trim();
    fs.writeFileSync(path.join(directory, "abcdefghijk.transcript.txt"), transcript);
    fs.writeFileSync(path.join(directory, "abcdefghijk.spec.json"), JSON.stringify({ transcript_chars: transcript.length }));
    const result = loadCachedTranscripts([directory], ["abcdefghijk"]);
    expect(result.get("abcdefghijk")?.transcript).toBe(transcript);
    expect(result.get("abcdefghijk")?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => loadCachedTranscripts([directory], ["missing0000"])).toThrow("Missing cached transcripts");
    fs.writeFileSync(path.join(directory, "abcdefghijk.spec.json"), JSON.stringify({ transcript_chars: 999 }));
    expect(() => loadCachedTranscripts([directory], ["abcdefghijk"])).toThrow("does not match extraction spec");
  });

  it("fails closed when two caches disagree for the same video", () => {
    const first = tempDir();
    const second = tempDir();
    fs.writeFileSync(path.join(first, "abcdefghijk.transcript.txt"), "first ".repeat(50));
    fs.writeFileSync(path.join(second, "abcdefghijk.transcript.txt"), "second ".repeat(50));
    expect(() => loadCachedTranscripts([first, second], ["abcdefghijk"])).toThrow("Conflicting cached transcripts");
  });

  it("requires real YouTube metadata before any apply phase can start", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "Real title", author_name: "Real channel" }),
    });
    await expect(fetchYoutubeMetadata("https://www.youtube.com/watch?v=abcdefghijk", fetchImpl as any)).resolves.toEqual({
      title: "Real title",
      channel: "Real channel",
    });
    fetchImpl.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(fetchYoutubeMetadata("https://www.youtube.com/watch?v=abcdefghijk", fetchImpl as any)).rejects.toThrow("oEmbed failed");
  });
});
