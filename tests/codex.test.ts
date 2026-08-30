import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexClient, type CodexConfig, type CodexClientOptions } from "../src/codex";

type Handler<T> = ((event: T) => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  sent: unknown[] = [];
  pendingIds: (string | number)[] = [];
  onopen: Handler<unknown> = null;
  onmessage: Handler<{ data: unknown }> = null;
  onerror: Handler<unknown> = null;
  onclose: Handler<unknown> = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  send(message: string): void {
    const frame = JSON.parse(message) as { id?: string | number; method?: string };
    this.sent.push(frame);
    if (frame.method && frame.id !== undefined) this.pendingIds.push(frame.id);
  }
}

const config: CodexConfig = {
  wsUrl: "ws://127.0.0.1:4500",
  threadId: "thread-1",
  protocol: "current",
};

const options: CodexClientOptions = {
  webSocket: MockWebSocket as unknown as CodexClientOptions["webSocket"],
  requestTimeoutMs: 100,
};

function latestSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) throw new Error("No mock socket");
  return socket;
}

function respond(socket: MockWebSocket, result: unknown): void {
  const id = socket.pendingIds.shift();
  if (id === undefined) throw new Error("No pending request");
  socket.receive({ id, result });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  MockWebSocket.instances = [];
  vi.useRealTimers();
});

describe("CodexClient", () => {
  it("performs current handshake, reads the selected thread, and starts a turn", async () => {
    const statuses: string[] = [];
    const client = new CodexClient((status) => statuses.push(status), options);
    const wake = client.wake(config, "Play the next legal move.");
    const socket = latestSocket();
    socket.open();
    await flush();

    expect(socket.sent[0]).toMatchObject({ method: "initialize" });
    respond(socket, {});
    await flush();
    expect(socket.sent[1]).toEqual({ method: "initialized" });
    expect(socket.sent[2]).toMatchObject({ method: "thread/read", params: { threadId: "thread-1", includeTurns: false } });
    respond(socket, { thread: { id: "thread-1", status: { type: "idle" } } });
    await flush();
    expect(socket.sent[3]).toEqual({
      method: "turn/start",
      id: expect.any(Number),
      params: { threadId: "thread-1", input: [{ type: "text", text: "Play the next legal move.", text_elements: [] }] },
    });
    respond(socket, {});
    await expect(wake).resolves.toBeUndefined();
    expect(statuses).toContain("Sending turn");
    expect(statuses).toContain("Turn acknowledged");
  });

  it("resumes a not-loaded thread and never creates or forks one", async () => {
    const client = new CodexClient(undefined, options);
    const wake = client.wake(config, "Continue.");
    const socket = latestSocket();
    socket.open();
    await flush();
    respond(socket, {});
    await flush();
    respond(socket, { thread: { id: "thread-1", status: { type: "notLoaded" } } });
    await flush();
    expect(socket.sent.map((frame: any) => frame.method)).toEqual(["initialize", "initialized", "thread/read", "thread/resume"]);
    respond(socket, { thread: { id: "thread-1", status: { type: "idle" } } });
    await flush();
    respond(socket, {});
    await expect(wake).resolves.toBeUndefined();
    expect(socket.sent.map((frame: any) => frame.method)).not.toContain("thread/start");
    expect(socket.sent.map((frame: any) => frame.method)).not.toContain("thread/fork");
  });

  it("refuses an active thread before sending turn/start", async () => {
    const client = new CodexClient(undefined, options);
    const wake = client.wake(config, "Do not run.");
    const socket = latestSocket();
    socket.open();
    await flush();
    respond(socket, {});
    await flush();
    respond(socket, { thread: { id: "thread-1", status: { type: "active", activeFlags: [] } } });
    await expect(wake).rejects.toThrow(/already active/);
    expect(socket.sent.map((frame: any) => frame.method)).not.toContain("turn/start");
  });

  it.each([
    ["a different thread", { id: "thread-other", status: { type: "idle" } }, /different thread/],
    ["an unknown status", { id: "thread-1" }, /without a runtime status/],
  ])("fails closed when thread/read returns %s", async (_label, thread, expected) => {
    const client = new CodexClient(undefined, options);
    const wake = client.wake(config, "Do not run.");
    const socket = latestSocket();
    socket.open();
    await flush();
    respond(socket, {});
    await flush();
    respond(socket, { thread });
    await expect(wake).rejects.toThrow(expected);
    expect(socket.sent.map((frame: any) => frame.method)).not.toContain("turn/start");
  });

  it("uses the explicitly selected legacy frame without silently falling back", async () => {
    const legacy = { ...config, protocol: "legacy" as const };
    const client = new CodexClient(undefined, options);
    const wake = client.wake(legacy, "Legacy instruction");
    const socket = latestSocket();
    socket.open();
    await flush();
    expect(socket.sent[0]).toMatchObject({
      method: "session/createTurn",
      params: { sessionId: "thread-1", instructions: "Legacy instruction" },
    });
    respond(socket, {});
    await expect(wake).resolves.toBeUndefined();
    expect(socket.sent.some((frame: any) => frame.method === "initialize")).toBe(false);
  });

  it("rejects non-loopback URLs and concurrent wakes", async () => {
    const client = new CodexClient(undefined, options);
    await expect(client.wake({ ...config, wsUrl: "wss://example.com/socket" }, "x")).rejects.toThrow(/loopback/);

    const first = client.wake(config, "x");
    const second = client.wake(config, "y");
    await expect(second).rejects.toThrow(/already in progress/);
    latestSocket().open();
    await flush();
    respond(latestSocket(), {});
    await flush();
    respond(latestSocket(), { thread: { id: "thread-1", status: { type: "idle" } } });
    await flush();
    respond(latestSocket(), {});
    await expect(first).resolves.toBeUndefined();
  });

  it("rejects an unanswered connection instead of hanging", async () => {
    vi.useFakeTimers();
    const client = new CodexClient(undefined, { ...options, requestTimeoutMs: 20 });
    const wake = client.wake(config, "x");
    const rejection = expect(wake).rejects.toThrow(/connection timed out/);
    await vi.advanceTimersByTimeAsync(21);
    await rejection;
  });

  it("rejects approval/server requests and keeps listening for notifications", async () => {
    const statuses: string[] = [];
    const client = new CodexClient((status) => statuses.push(status), options);
    const wake = client.wake(config, "x");
    const socket = latestSocket();
    socket.open();
    await flush();
    socket.receive({ id: "approval-1", method: "item/commandExecution/requestApproval", params: {} });
    expect(socket.sent.at(-1)).toEqual({
      id: "approval-1",
      error: { code: -32601, message: "Server requests are not supported by the browser client" },
    });
    expect(statuses.some((status) => status.includes("Rejected unsupported"))).toBe(true);
    respond(socket, {});
    await flush();
    respond(socket, { thread: { id: "thread-1", status: { type: "idle" } } });
    await flush();
    respond(socket, {});
    await expect(wake).resolves.toBeUndefined();
  });
});
