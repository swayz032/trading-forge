/**
 * massive-websocket-protocol.test.ts — M1a: Massive WebSocket protocol
 * correctness (2026-07-17).
 *
 * Drives the REAL `createWebSocket()` against a controllable fake `ws`
 * module, replaying the recorded fixtures in
 * src/data/fetchers/__fixtures__/massive/ (see that directory's README for
 * full source citations) to prove the adapter's rewritten auth/subscribe/
 * message-handling matches the REAL, independently-verified Massive
 * protocol — not the prior code's wrong Bearer-header + bare-object guess.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(resolve(__dirname, "__fixtures__/massive", name), "utf8"),
  );
}

// ─── Controllable fake `ws` — the test drives "open"/"message"/"close" and
// inspects every `.send()` call, so no real network connection ever occurs.
// Declared via vi.hoisted() because vi.mock()'s factory is itself hoisted
// above normal top-level declarations. Implements its own minimal on/emit
// (rather than extending node:events' EventEmitter) to avoid an import-
// ordering conflict between the hoisted mock factory and a hoisted import. ──
const { FakeWebSocket } = vi.hoisted(() => {
  class FakeWebSocket {
    static OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = FakeWebSocket.OPEN;
    sent: string[] = [];
    url: string;
    opts: unknown;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(url: string, opts?: unknown) {
      this.url = url;
      this.opts = opts;
      FakeWebSocket.instances.push(this);
    }

    on(event: string, fn: (...args: unknown[]) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event)!.push(fn);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
    }

    send(data: string) {
      this.sent.push(data);
    }

    ping() {}

    close() {
      this.emit("close");
    }
  }
  return { FakeWebSocket };
});

vi.mock("ws", () => ({ default: FakeWebSocket }));

// Import AFTER the mock is registered.
import { createMassiveFetcher } from "./massive.js";

type FakeWebSocketInstance = InstanceType<typeof FakeWebSocket>;

function lastSocket(): FakeWebSocketInstance {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
}

function sentActions(ws: FakeWebSocketInstance): Array<Record<string, unknown>> {
  return ws.sent.map((s: string) => JSON.parse(s));
}

describe("M1a — Massive WebSocket protocol (auth flow)", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  it("sends NO Authorization header at construction (the prior code's wrong guess)", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25"], () => {});
    ws.connect();
    const sock = lastSocket();
    expect(sock.opts).toBeUndefined();
  });

  it("sends {action:'auth', params:apiKey} as a MESSAGE immediately after open — not a header", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25"], () => {});
    ws.connect();
    const sock = lastSocket();
    sock.emit("open");

    const actions = sentActions(sock);
    expect(actions).toContainEqual({ action: "auth", params: "test-key-123" });
  });

  it("does NOT subscribe before auth_success arrives", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25"], () => {});
    ws.connect();
    const sock = lastSocket();
    sock.emit("open");

    const actions = sentActions(sock);
    expect(actions.some((a) => a.action === "subscribe")).toBe(false);
  });

  it("sends {action:'subscribe', params:'AM.<ticker>'} only after auth_success — real channel-prefixed comma-joined format, not the prior {symbols:[...]} shape", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25", "MNQH25"], () => {});
    ws.connect();
    const sock = lastSocket();
    sock.emit("open");
    sock.emit("message", JSON.stringify(loadFixture("auth-success.json")));

    const actions = sentActions(sock);
    expect(actions).toContainEqual({ action: "subscribe", params: "AM.MESH25,AM.MNQH25" });
  });

  it("emits 'connected' only after the subscribe confirmation status frame (not on raw WS open)", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25"], () => {});
    const connectedSpy = vi.fn();
    ws.on("connected", connectedSpy);
    ws.connect();
    const sock = lastSocket();
    sock.emit("open");
    expect(connectedSpy).not.toHaveBeenCalled();

    sock.emit("message", JSON.stringify(loadFixture("auth-success.json")));
    expect(connectedSpy).not.toHaveBeenCalled(); // auth success alone isn't "connected" yet

    sock.emit("message", JSON.stringify(loadFixture("subscribe-success.json")));
    expect(connectedSpy).toHaveBeenCalledTimes(1);
  });

  it("emits 'error' on auth_failed and does NOT attempt to subscribe", () => {
    const fetcher = createMassiveFetcher({ apiKey: "bad-key" });
    const ws = fetcher.createWebSocket(["MESH25"], () => {});
    const errorSpy = vi.fn();
    ws.on("error", errorSpy);
    ws.connect();
    const sock = lastSocket();
    sock.emit("open");
    sock.emit("message", JSON.stringify(loadFixture("auth-failed.json")));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect((errorSpy.mock.calls[0][0] as Error).message).toMatch(/auth failed/i);
    const actions = sentActions(sock);
    expect(actions.some((a) => a.action === "subscribe")).toBe(false);
  });

  it("isConnected() is true only once BOTH the socket is open AND authenticated", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25"], () => {});
    ws.connect();
    const sock = lastSocket();
    expect(ws.isConnected()).toBe(false);
    sock.emit("open");
    expect(ws.isConnected()).toBe(false); // open, not yet authenticated
    sock.emit("message", JSON.stringify(loadFixture("auth-success.json")));
    expect(ws.isConnected()).toBe(true);
  });
});

describe("M1a — Massive WebSocket protocol (AM bar delivery)", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  function connectAndAuth(symbols: string[], onBar: (bar: unknown) => void) {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(symbols, onBar as never);
    ws.connect();
    const sock = lastSocket();
    sock.emit("open");
    sock.emit("message", JSON.stringify(loadFixture("auth-success.json")));
    return { ws, sock };
  }

  it("parses a single AM bar (array-wrapped) into the internal Bar shape with short-key fields mapped correctly", () => {
    const onBar = vi.fn();
    const { sock } = connectAndAuth(["6CH5"], onBar);

    sock.emit("message", JSON.stringify(loadFixture("am-single.json")));

    expect(onBar).toHaveBeenCalledTimes(1);
    const bar = onBar.mock.calls[0][0];
    expect(bar).toMatchObject({
      symbol: "6CH5",
      open: 6994.5,
      high: 6995,
      low: 6994.5,
      close: 6995,
      volume: 91,
    });
    // s: 1751933700000 (Unix ms) trusted end-to-end, not wall-clock.
    expect(bar.timestamp).toBe(new Date(1751933700000).toISOString());
  });

  it("parses a bundled multi-bar frame (one WS message, multiple AM events) into ordered onBar calls, filtered to subscribed symbols", () => {
    const onBar = vi.fn();
    // am-bundle.json contains MESH25 (x2) and MNQH25 (x1) — subscribe to both.
    const { sock } = connectAndAuth(["MESH25", "MNQH25"], onBar);

    sock.emit("message", JSON.stringify(loadFixture("am-bundle.json")));

    expect(onBar).toHaveBeenCalledTimes(3);
    expect(onBar.mock.calls[0][0]).toMatchObject({ symbol: "MESH25", close: 5921.0 });
    expect(onBar.mock.calls[1][0]).toMatchObject({ symbol: "MNQH25", close: 21008.75 });
    expect(onBar.mock.calls[2][0]).toMatchObject({ symbol: "MESH25", close: 5922.75 });
  });

  it("filters out bars for symbols the caller did NOT subscribe to", () => {
    const onBar = vi.fn();
    // Only subscribe to MESH25 — MNQH25 bars in the bundle must be dropped.
    const { sock } = connectAndAuth(["MESH25"], onBar);

    sock.emit("message", JSON.stringify(loadFixture("am-bundle.json")));

    expect(onBar).toHaveBeenCalledTimes(2);
    expect(onBar.mock.calls.every((c) => (c[0] as { symbol: string }).symbol === "MESH25")).toBe(true);
  });
});

describe("M1a — Massive WebSocket protocol (malformed-bar rejection — never silent drop)", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  function connectAndAuth(symbols: string[], onBar: (bar: unknown) => void, onIncident: (i: unknown) => void) {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(symbols, onBar as never);
    ws.on("incident", onIncident);
    ws.connect();
    const sock = lastSocket();
    sock.emit("open");
    sock.emit("message", JSON.stringify(loadFixture("auth-success.json")));
    return { ws, sock };
  }

  it("rejects a bar with a non-numeric close price — emits 'incident', never calls onBar", () => {
    const onBar = vi.fn();
    const onIncident = vi.fn();
    const { sock } = connectAndAuth(["MESH25"], onBar, onIncident);

    sock.emit("message", JSON.stringify(loadFixture("malformed-non-numeric-close.json")));

    expect(onBar).not.toHaveBeenCalled();
    expect(onIncident).toHaveBeenCalledTimes(1);
    expect((onIncident.mock.calls[0][0] as { reason: string }).reason).toBe("non_numeric_price");
  });

  it("rejects a bar with a genuinely non-coercible string price (Number.isNaN path, distinct from the null-field path above) — emits 'incident', never calls onBar", () => {
    const onBar = vi.fn();
    const onIncident = vi.fn();
    const { sock } = connectAndAuth(["MESH25"], onBar, onIncident);

    sock.emit("message", JSON.stringify(loadFixture("malformed-string-price.json")));

    expect(onBar).not.toHaveBeenCalled();
    expect(onIncident).toHaveBeenCalledTimes(1);
    expect((onIncident.mock.calls[0][0] as { reason: string }).reason).toBe("non_numeric_price");
  });

  it("rejects a bar with negative volume — emits 'incident', never calls onBar", () => {
    const onBar = vi.fn();
    const onIncident = vi.fn();
    const { sock } = connectAndAuth(["MESH25"], onBar, onIncident);

    sock.emit("message", JSON.stringify(loadFixture("malformed-negative-volume.json")));

    expect(onBar).not.toHaveBeenCalled();
    expect(onIncident).toHaveBeenCalledTimes(1);
    expect((onIncident.mock.calls[0][0] as { reason: string }).reason).toBe("negative_volume");
  });

  it("rejects a bar with invalid OHLC (high < low) — emits 'incident', never calls onBar", () => {
    const onBar = vi.fn();
    const onIncident = vi.fn();
    const { sock } = connectAndAuth(["MESH25"], onBar, onIncident);

    sock.emit("message", JSON.stringify(loadFixture("malformed-invalid-ohlc.json")));

    expect(onBar).not.toHaveBeenCalled();
    expect(onIncident).toHaveBeenCalledTimes(1);
    expect((onIncident.mock.calls[0][0] as { reason: string }).reason).toBe("invalid_ohlc");
  });

  it("a malformed bar does not stop siblings in the same bundle from being processed", () => {
    const onBar = vi.fn();
    const onIncident = vi.fn();
    const { sock } = connectAndAuth(["MESH25"], onBar, onIncident);

    const goodBar = (loadFixture("am-single.json") as unknown[])[0] as Record<string, unknown>;
    const badBar = (loadFixture("malformed-negative-volume.json") as unknown[])[0] as Record<string, unknown>;
    sock.emit(
      "message",
      JSON.stringify([{ ...goodBar, sym: "MESH25" }, badBar]),
    );

    expect(onBar).toHaveBeenCalledTimes(1);
    expect(onIncident).toHaveBeenCalledTimes(1);
  });
});

describe("M1a — Massive WebSocket protocol (reconnect → reauth → resubscribe)", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("on disconnect, schedules a reconnect and the NEW connection re-sends auth from scratch (no stale auth state carried over)", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25"], () => {});
    const reconnectingSpy = vi.fn();
    const disconnectedSpy = vi.fn();
    ws.on("reconnecting", reconnectingSpy);
    ws.on("disconnected", disconnectedSpy);

    ws.connect();
    const firstSocket = lastSocket();
    firstSocket.emit("open");
    firstSocket.emit("message", JSON.stringify(loadFixture("auth-success.json")));
    expect(ws.isConnected()).toBe(true);

    // Simulate the connection dropping.
    firstSocket.emit("close");
    expect(disconnectedSpy).toHaveBeenCalledTimes(1);
    expect(reconnectingSpy).toHaveBeenCalledTimes(1);
    expect(ws.isConnected()).toBe(false);

    // Advance past the backoff delay — a NEW socket must be created and
    // must independently re-send the auth message (it doesn't inherit the
    // old connection's authenticated state).
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances.length).toBe(2);
    const secondSocket = lastSocket();
    expect(secondSocket).not.toBe(firstSocket);

    secondSocket.emit("open");
    const actions = sentActions(secondSocket);
    expect(actions).toContainEqual({ action: "auth", params: "test-key-123" });

    secondSocket.emit("message", JSON.stringify(loadFixture("auth-success.json")));
    const subscribeActions = sentActions(secondSocket);
    expect(subscribeActions).toContainEqual({ action: "subscribe", params: "AM.MESH25" });
    expect(ws.isConnected()).toBe(true);
  });

  it("disconnect() (intentional) does NOT schedule a reconnect", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25"], () => {});
    const reconnectingSpy = vi.fn();
    ws.on("reconnecting", reconnectingSpy);

    ws.connect();
    const sock = lastSocket();
    sock.emit("open");
    ws.disconnect();

    vi.advanceTimersByTime(60_000);
    expect(reconnectingSpy).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances.length).toBe(1); // no new socket created
  });
});

describe("M1a — Massive WebSocket protocol (regression: unchanged external contract)", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  it("subscribedSymbols() still returns the exact symbols passed in (unchanged from prior behavior)", () => {
    const fetcher = createMassiveFetcher({ apiKey: "test-key-123" });
    const ws = fetcher.createWebSocket(["MESH25", "MNQH25", "MCLQ25"], () => {});
    expect(ws.subscribedSymbols()).toEqual(["MESH25", "MNQH25", "MCLQ25"]);
  });
});
