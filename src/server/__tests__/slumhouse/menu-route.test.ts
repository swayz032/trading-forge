import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assembleNowServing: vi.fn().mockResolvedValue([]),
  assembleDeployReady: vi.fn().mockResolvedValue([]),
  assembleKitchenMenu: vi.fn().mockResolvedValue([]),
  assembleGraveyardMenu: vi.fn().mockResolvedValue([]),
  requireSlumhouseUser: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock("../../lib/slumhouse/menu-data.js", () => ({
  assembleNowServing: mocks.assembleNowServing,
  assembleDeployReady: mocks.assembleDeployReady,
  assembleKitchenMenu: mocks.assembleKitchenMenu,
  assembleGraveyardMenu: mocks.assembleGraveyardMenu,
}));

vi.mock("../../lib/slumhouse/require-session.js", () => ({
  requireSlumhouseUser: mocks.requireSlumhouseUser,
}));

vi.mock("../../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }), execute: vi.fn().mockResolvedValue([]) },
}));

/** Collect { path, guardWired } for each route layer on an Express router. */
function routeMap(router: any): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const guardWired = layer.route.stack.some((s: any) => s.handle === mocks.requireSlumhouseUser);
    map.set(layer.route.path, guardWired);
  }
  return map;
}

describe("menu api router", () => {
  it("registers the four menu category paths behind requireSlumhouseUser", async () => {
    const { menuApiRouter } = await import("../../routes/slumhouse/api/menu.js");
    const routes = routeMap(menuApiRouter);

    for (const path of [
      "/slumhouse/api/menu/now-serving",
      "/slumhouse/api/menu/deploy-ready",
      "/slumhouse/api/menu/kitchen",
      "/slumhouse/api/menu/graveyard",
    ]) {
      expect(routes.has(path), `route ${path} registered`).toBe(true);
      expect(routes.get(path), `route ${path} behind requireSlumhouseUser`).toBe(true);
    }
  });

  it("now-serving handler returns { dishes: [...] }", async () => {
    const { menuApiRouter } = await import("../../routes/slumhouse/api/menu.js");
    const layer = menuApiRouter.stack.find(
      (l: any) => l.route?.path === "/slumhouse/api/menu/now-serving",
    );
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res: any = { body: null, json(b: any) { this.body = b; return this; } };
    await handler({ query: {} } as any, res);
    expect(res.body).toEqual({ dishes: [] });
    expect(mocks.assembleNowServing).toHaveBeenCalledOnce();
  });

  it("kitchen handler defaults symbol to MES and returns { families: [...] }", async () => {
    const { menuApiRouter } = await import("../../routes/slumhouse/api/menu.js");
    const layer = menuApiRouter.stack.find(
      (l: any) => l.route?.path === "/slumhouse/api/menu/kitchen",
    );
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const res: any = { body: null, json(b: any) { this.body = b; return this; } };
    await handler({ query: {} } as any, res);
    expect(res.body).toEqual({ families: [] });
    expect(mocks.assembleKitchenMenu).toHaveBeenCalledWith("MES");
  });
});
