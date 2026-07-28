import { describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({ db: {} }));

describe("YouTube evidence archive identifiers", () => {
  it("normalizes every supported YouTube URL shape to the same video ID", async () => {
    const { youtubeVideoId } = await import("../services/youtube-evidence-archive.js");
    for (const value of [
      "dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]) expect(youtubeVideoId(value)).toBe("dQw4w9WgXcQ");
  });

  it("rejects malformed and non-YouTube evidence IDs", async () => {
    const { youtubeVideoId } = await import("../services/youtube-evidence-archive.js");
    expect(youtubeVideoId("too-short")).toBeNull();
    expect(youtubeVideoId("https://example.com/not-a-video")).toBeNull();
  });
});
