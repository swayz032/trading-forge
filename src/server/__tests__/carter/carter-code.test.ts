/**
 * carter-code.test.ts — guard-branch coverage for save_code_draft.
 *
 * Only the INVALID inputs are exercised — each returns an `{ error }` BEFORE any git
 * command runs, so no worktree/branch/push is ever triggered by this test. The happy
 * path (real git ops) is intentionally NOT exercised here.
 */
import { describe, it, expect } from "vitest";
import { CARTER_CODE_HANDLERS } from "../../lib/carter/carter-code.js";

const draft = CARTER_CODE_HANDLERS.save_code_draft;
const okFiles = [{ path: "docs/notes/x.md", content: "hello" }];

describe("save_code_draft — input guards (no git side-effects)", () => {
  it("requires a summary", async () => {
    expect(await draft({ files: okFiles })).toMatchObject({ error: expect.stringContaining("summary") });
  });

  it("requires a non-empty files array", async () => {
    expect(await draft({ summary: "x", files: [] })).toMatchObject({ error: expect.stringContaining("files") });
    expect(await draft({ summary: "x" })).toMatchObject({ error: expect.stringContaining("files") });
  });

  it("rejects too many files", async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ path: `docs/f${i}.md`, content: "x" }));
    expect(await draft({ summary: "x", files: many })).toMatchObject({ error: expect.stringContaining("too_many_files") });
  });

  it("refuses path traversal", async () => {
    expect(await draft({ summary: "x", files: [{ path: "../escape.md", content: "x" }] }))
      .toMatchObject({ error: expect.stringContaining("path_traversal") });
  });

  it("refuses forbidden paths (.env / .git / secrets / data / node_modules)", async () => {
    for (const path of [".env", "src/.env.local", ".git/config", "data/foo.parquet", "node_modules/x/i.js", "keys/server.pem", "config/db-credential.json"]) {
      expect(await draft({ summary: "x", files: [{ path, content: "x" }] }))
        .toMatchObject({ error: expect.stringContaining("forbidden_path") });
    }
  });

  it("rejects oversized drafts", async () => {
    const big = "a".repeat(300 * 1024);
    expect(await draft({ summary: "x", files: [{ path: "docs/big.md", content: big }] }))
      .toMatchObject({ error: expect.stringContaining("draft_too_large") });
  });

  it("rejects malformed file entries", async () => {
    expect(await draft({ summary: "x", files: [{ path: "docs/a.md" }] as never }))
      .toMatchObject({ error: expect.stringContaining("path, content") });
  });
});
