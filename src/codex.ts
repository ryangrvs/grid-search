/**
 * Small browser transport for the Codex app-server JSON-RPC WebSocket.
 *
 * This client deliberately only knows how to continue an already selected
 * thread.  It never creates or forks threads, and it does not retry a
 * request after a connection failure (the result of a request may be
 * unknowable at that point).
 */

export interface CodexConfig {
  wsUrl: string;
  threadId: string;
  protocol: "current" | "legacy";
}

export type CodexStatusHandler = (status: string) => void;

export interface CodexClientOptions {
  /** Request timeout, primarily useful to keep tests short. */
  requestTimeoutMs?: number;
  /** WebSocket constructor override for tests. */
  webSocket?: WebSocketConstructor;
}

export const CODEX_REQUEST_TIMEOUT_MS = 15_000;

interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface WebSocketConstructor {
  new (url: string): WebSocketLike;
}

interface PendingRequest {
  method: string;
  threadId?: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

const OPEN = 1;
const CONNECTING = 0;

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    const candidate = value as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string" && candidate.message.length > 0) {
      return candidate.message;
    }
    if (typeof candidate.error === "string" && candidate.error.length > 0) {
      return candidate.error;
    }
  }
  return fallback;
}

function isLoopbackWsUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "ws:" && url.protocol !== "wss:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function statusType(thread: unknown): string | undefined {
  if (!thread || typeof thread !== "object") return undefined;
  const status = (thread as { status?: unknown }).status;
  if (typeof status === "string") return status;
  if (status && typeof status === "object") {
    const type = (status as { type?: unknown }).type;
    if (typeof type === "string") return type;
  }
  return undefined;
}

function resultThread(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  return (result as { thread?: unknown }).thread;
}

/** Browser-only Codex app-server client. */
export class CodexClient {
  private readonly onStatus: CodexStatusHandler;
  private readonly requestTimeoutMs: number;
  private readonly webSocket: WebSocketConstructor;
  private socket: WebSocketLike | null = null;
  private socketUrl: string | null = null;
  private socketProtocol: CodexConfig["protocol"] | null = null;
  private activeThreadId: string | null = null;
  private connectionPromise: Promise<void> | null = null;
  private initialized = false;
  private nextRequestId = 1;
  private pending = new Map<string | number, PendingRequest>();
  private wakeInProgress = false;

  constructor(onStatus: CodexStatusHandler = () => {}, options: CodexClientOptions = {}) {
    this.onStatus = onStatus;
    this.requestTimeoutMs = options.requestTimeoutMs ?? CODEX_REQUEST_TIMEOUT_MS;
    const nativeWebSocket = options.webSocket ?? (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
    if (!nativeWebSocket) {
      throw new Error("WebSocket is unavailable; CodexClient must run in a browser");
    }
    this.webSocket = nativeWebSocket;
  }

  /**
   * Wake the configured thread. Promise resolution means the `turn/start` or
   * legacy `session/createTurn` request was acknowledged by app-server; the
   * connection remains open to receive subsequent notifications.
   */
  async wake(config: CodexConfig, instructions: string): Promise<void> {
    if (this.wakeInProgress) {
      throw new Error("A Codex wake is already in progress");
    }
    this.validateConfig(config);
    if (typeof instructions !== "string" || instructions.length === 0) {
      throw new Error("Wake instructions must be a non-empty string");
    }

    this.wakeInProgress = true;
    try {
      await this.ensureConnection(config);
      this.activeThreadId = config.threadId;
      if (config.protocol === "legacy") {
        this.report("Legacy protocol is explicitly selected and unverified");
        this.report("Sending turn (legacy session/createTurn)");
        await this.request("session/createTurn", {
          sessionId: config.threadId,
          instructions,
        }, config.threadId);
        this.report("Turn acknowledged");
        return;
      }

      await this.ensureInitialized();
      const read = await this.request("thread/read", {
        threadId: config.threadId,
        includeTurns: false,
      }, config.threadId);
      let thread = resultThread(read);
      this.assertThread(thread, config.threadId);
      const type = statusType(thread);
      if (type === "active") {
        throw new Error("Codex thread is already active; refusing to start another turn");
      }
      if (type === "notLoaded") {
        const resumed = await this.request("thread/resume", {
          threadId: config.threadId,
        }, config.threadId);
        thread = resultThread(resumed);
        this.assertThread(thread, config.threadId);
        const resumedType = statusType(thread);
        if (resumedType === "active") {
          throw new Error("Codex thread became active while resuming; refusing to start another turn");
        }
        if (resumedType !== "idle") {
          throw new Error(`Codex thread cannot be woken after resume from status: ${resumedType ?? "unknown"}`);
        }
      } else if (type !== "idle") {
        throw new Error(`Codex thread cannot be woken from status: ${type ?? "unknown"}`);
      }

      this.report("Sending turn");
      await this.request("turn/start", {
        threadId: config.threadId,
        input: [{ type: "text", text: instructions, text_elements: [] }],
      }, config.threadId);
      this.report("Turn acknowledged");
    } finally {
      this.wakeInProgress = false;
    }
  }

  /** Close the transport and reject requests whose outcome is now unknown. */
  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.socketUrl = null;
    this.socketProtocol = null;
    this.initialized = false;
    this.activeThreadId = null;
    this.connectionPromise = null;
    this.rejectPending(new Error("Codex connection disconnected; request outcome is unknown"));
    if (socket && (socket.readyState === OPEN || socket.readyState === CONNECTING)) {
      try {
        socket.close(1000, "client disconnected");
      } catch {
        // A browser may throw if a mock or an already closed socket rejects close.
      }
    }
    this.report("Disconnected");
  }

  private validateConfig(config: CodexConfig): void {
    if (!config || (config.protocol !== "current" && config.protocol !== "legacy")) {
      throw new Error("Codex protocol must be current or legacy");
    }
    if (!isLoopbackWsUrl(config.wsUrl)) {
      throw new Error("Codex WebSocket URL must be a loopback ws(s)://localhost, 127.0.0.1, or [::1] URL");
    }
    if (typeof config.threadId !== "string" || config.threadId.length === 0) {
      throw new Error("Codex threadId must be a non-empty string");
    }
  }

  private assertThread(thread: unknown, expectedId: string): void {
    if (!thread || typeof thread !== "object") {
      throw new Error("Codex did not return the selected thread");
    }
    const returnedId = (thread as { id?: unknown }).id;
    if (returnedId !== expectedId) {
      throw new Error("Codex returned a different thread; refusing to wake it");
    }
    if (!statusType(thread)) {
      throw new Error("Codex returned the selected thread without a runtime status");
    }
  }

  private async ensureConnection(config: CodexConfig): Promise<void> {
    const reusable = this.socket && this.socketUrl === config.wsUrl && this.socketProtocol === config.protocol;
    if (reusable && this.socket?.readyState === OPEN) return;
    if (reusable && this.connectionPromise) return this.connectionPromise;
    if (this.socket) this.disconnect();

    this.report("Connecting");
    const socket = new this.webSocket(config.wsUrl);
    this.socket = socket;
    this.socketUrl = config.wsUrl;
    this.socketProtocol = config.protocol;
    this.initialized = false;
    const connection = new Promise<void>((resolve, reject) => {
      let settled = false;
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        if (connectTimer !== undefined) clearTimeout(connectTimer);
        fn();
      };
      socket.onopen = () => finish(() => {
        this.report("Connected");
        resolve();
      });
      socket.onerror = () => {
        const error = new Error("Codex WebSocket connection failed");
        finish(() => reject(error));
        // Errors can happen after `open`; in that case the connection promise
        // is already settled but outstanding request outcomes are not known.
        this.handleSocketEnd(socket, error);
      };
      socket.onclose = () => {
        const error = new Error("Codex WebSocket closed; request outcome is unknown");
        finish(() => reject(error));
        this.handleSocketEnd(socket, error);
      };
      socket.onmessage = (event) => {
        // A delayed event from a socket that was disconnected must not be
        // allowed to satisfy a request on a newer connection.
        if (this.socket === socket) void this.handleMessage(event.data, socket);
      };
      connectTimer = setTimeout(() => {
        const error = new Error("Codex WebSocket connection timed out; outcome is unknown");
        finish(() => reject(error));
        this.handleSocketEnd(socket, error);
        try {
          socket.close(1000, "connection timeout");
        } catch {
          // Ignore close failures; the timeout is already terminal.
        }
      }, this.requestTimeoutMs);
    }).catch((error: Error) => {
      // If the socket closed before opening, surface the reason once through
      // the regular status path, then preserve the rejection for wake().
      this.report(error.message);
      throw error;
    });
    this.connectionPromise = connection;
    return connection;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.request("initialize", {
      clientInfo: { name: "semanticspy", title: "SemanticSpy", version: "0.1.0" },
      capabilities: null,
    });
    this.sendNotification("initialized");
    this.initialized = true;
    this.report("Initialized");
  }

  private request(method: string, params: unknown, threadId?: string): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) {
      return Promise.reject(new Error("Codex WebSocket is not open"));
    }
    const id = this.nextRequestId++;
    const frame = JSON.stringify({ method, id, params });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`Codex request timed out: ${method}; outcome is unknown`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, threadId, resolve, reject, timer });
      try {
        socket.send(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Codex WebSocket send failed"));
      }
    });
  }

  private sendNotification(method: string): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) {
      throw new Error("Codex WebSocket is not open");
    }
    socket.send(JSON.stringify({ method }));
  }

  private async handleMessage(data: unknown, socket: WebSocketLike): Promise<void> {
    if (this.socket !== socket) return;
    let text: string;
    try {
      if (typeof data === "string") {
        text = data;
      } else if (data instanceof ArrayBuffer) {
        text = new TextDecoder().decode(data);
      } else if (typeof Blob !== "undefined" && data instanceof Blob) {
        text = await data.text();
      } else {
        this.report("Codex sent an unsupported WebSocket message");
        return;
      }
      if (this.socket !== socket) return;
      const message = JSON.parse(text) as JsonRpcMessage;
      this.handleJsonMessage(message);
    } catch (error) {
      this.report(`Invalid Codex message: ${errorMessage(error, "invalid JSON")}`);
    }
  }

  private handleJsonMessage(message: JsonRpcMessage): void {
    if (!message || typeof message !== "object") {
      this.report("Invalid Codex message: expected an object");
      return;
    }

    // Requests from app-server (including approval requests) are explicitly
    // rejected. This client must never auto-approve an operation.
    if (typeof message.method === "string") {
      if (message.id !== undefined) {
        this.report(`Rejected unsupported Codex server request: ${message.method}`);
        this.sendServerRequestError(message.id);
      } else {
        this.handleNotification(message.method, message.params);
      }
      return;
    }

    if (message.id === undefined) {
      this.report("Invalid Codex response: missing request id");
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.report(`Unknown Codex response id: ${String(message.id)}`);
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      const error = new Error(errorMessage(message.error, `Codex request failed: ${pending.method}`));
      pending.reject(error);
    } else if (message.result !== undefined) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(`Malformed Codex response: ${pending.method}`));
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "error") {
      const details = params && typeof params === "object" ? params as { error?: unknown; threadId?: string } : {};
      if (details.threadId && this.activeThreadId && details.threadId !== this.activeThreadId) return;
      const error = new Error(errorMessage(details.error, "Codex server reported an error"));
      for (const [id, pending] of this.pending) {
        if (pending.method === "turn/start" && (!details.threadId || pending.threadId === details.threadId)) {
          this.pending.delete(id);
          clearTimeout(pending.timer);
          pending.reject(error);
          break;
        }
      }
      this.report(`Codex error: ${error.message}`);
      return;
    }
    if (method === "turn/completed") {
      const notification = params && typeof params === "object" ? params as { threadId?: string; turn?: { status?: unknown; error?: unknown } } : {};
      if (notification.threadId && this.activeThreadId && notification.threadId !== this.activeThreadId) return;
      const turn = notification.turn;
      if (turn?.status === "failed") {
        this.report(`Codex turn failed: ${errorMessage(turn.error, "turn failed")}`);
      } else {
        this.report("Turn completed");
      }
      return;
    }
    if (method === "thread/status/changed") {
      const notification = params && typeof params === "object" ? params as { threadId?: string; status?: unknown } : {};
      if (notification.threadId && this.activeThreadId && notification.threadId !== this.activeThreadId) return;
      const status = notification.status;
      const type = statusType({ status });
      if (type) this.report(`Thread status: ${type}`);
      return;
    }
    this.report(`Codex notification: ${method}`);
  }

  private sendServerRequestError(id: string | number): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify({
        id,
        error: { code: -32601, message: "Server requests are not supported by the browser client" },
      }));
    } catch {
      this.report("Could not reject Codex server request");
    }
  }

  private handleSocketEnd(socket: WebSocketLike, error: Error): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.socketUrl = null;
    this.socketProtocol = null;
    this.initialized = false;
    this.activeThreadId = null;
    this.connectionPromise = null;
    this.rejectPending(error);
    this.report(error.message);
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private report(status: string): void {
    try {
      this.onStatus(status);
    } catch {
      // Status reporting must not break the transport state machine.
    }
  }
}
