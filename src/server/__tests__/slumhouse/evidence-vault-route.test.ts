import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assemble: vi.fn(),
  adminSession: vi.fn(),
}));

vi.mock("../../lib/slumhouse/evidence-vault-data.js", () => ({ assembleEvidenceVault: mocks.assemble }));
vi.mock("../../lib/logger.js", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../../lib/slumhouse/admin-session.js", () => ({ adminSessionFromCookie: mocks.adminSession }));
vi.mock("../../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
}));

import { getEvidenceVault } from "../../routes/slumhouse/api/evidence-vault.js";

function response() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

describe("Slumhouse evidence vault route", () => {
  beforeEach(() => {
    mocks.assemble.mockReset();
    mocks.adminSession.mockReset();
    mocks.adminSession.mockReturnValue(false);
  });

  it("passes exact video and bounded search inputs into the real assembler", async () => {
    const payload = { stats: { today: 1, available: 1, total: 1 }, videos: [], selected: null };
    mocks.assemble.mockResolvedValue(payload);
    const res = response();
    await getEvidenceVault({ query: { video: "dQw4w9WgXcQ", q: "opening range" }, headers: {} } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(payload);
    expect(mocks.assemble).toHaveBeenCalledWith({ videoId: "dQw4w9WgXcQ", search: "opening range", includeOperator: false });
  });

  it("exposes the library and worker roster only to an Office admin session", async () => {
    mocks.adminSession.mockReturnValue(true);
    mocks.assemble.mockResolvedValue({ capabilities: { operatorViews: true }, strategies: [], workers: [] });
    const res = response();
    await getEvidenceVault({ query: {}, headers: { cookie: "slumhouse_admin_sid=signed" } } as any, res as any);
    expect(mocks.assemble).toHaveBeenCalledWith({ videoId: undefined, search: undefined, includeOperator: true });
  });

  it("returns an explicit unavailable state instead of a false quiet archive", async () => {
    mocks.assemble.mockRejectedValueOnce(new Error("database offline"));
    const res = response();
    await getEvidenceVault({ query: {}, headers: {} } as any, res as any);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: "evidence_vault_unavailable", videos: [], selected: null });
  });
});
