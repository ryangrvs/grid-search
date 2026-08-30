# SemanticSpy

A local-first, single-human word-association game: you and your Codex agent cooperate to uncover nine Blue cards. Red cards are hazards, **not a second team or automated opponent**. Minimal 5×5 interface, authoritative local game engine, browser WebMCP tools, and a direct browser-to-Codex WebSocket client.

## Quick start

Requires Node.js 24+, npm, and (for automatic agent turns) a compatible Codex App Server.

```sh
cd semanticspy
npm install
npm run dev
```

Open the local Vite URL printed in the terminal, `http://127.0.0.1:5174`, in the Codex in-app browser. The game server runs on `http://127.0.0.1:4310`. Keep both processes running. No OpenAI API key is required by SemanticSpy: Codex uses its own existing authentication.

```sh
npm test
npm run build
npm start
```

Production mode serves the built browser files and game API together on port 4310. The game is held **in memory**: browser refresh keeps the match, but restarting the server creates a new one and rotates capabilities. Reload the page after a backend restart to obtain fresh capabilities. Nothing is deployed or sent to a third-party game service. Codex inference itself is not offline.

## Play

1. By default, you are the Operative and the agent is the Spymaster. You can choose the opposite pairing when starting a new match. Roles stay fixed for the entire match so an Operative never inherits a secret map it previously saw as Spymaster.
2. The Spymaster submits one word and a count. The Operative can guess up to count + 1 cards, or end the turn early.
3. Blue cards advance your shared goal. Red or Innocent ends the guessing phase. The Assassin immediately loses the match. Reveal every Blue card to win.
4. Only the actor whose turn it is can act. A Spymaster clue hands control to the Operative; ending guessing returns control to the Spymaster.

Red's displayed score counts revealed hazards; it does not represent another player. Clue legality checks are mechanical, not a semantic cheating detector.

## File tree

```text
semanticspy/
├── README.md                  # Setup, gameplay, protocol and security notes
├── IMPLEMENTATION.md          # Design and integration contract
├── package.json
├── package-lock.json
├── index.html
├── vite.config.ts             # Port 5174; /api and /mcp proxy to 4310
├── tsconfig.json
├── tsconfig.server.json
├── .gitignore
├── scripts/
│   └── dev.mjs                # Starts/stops both local development processes
├── shared/
│   ├── types.ts               # Board, Card, Role, Actor, Action DTOs
│   └── schemas.ts             # Canonical strict tool input schemas
├── server/
│   ├── index.ts               # Loopback server entry point
│   ├── app.ts                 # Authenticated HTTP routes and static frontend
│   ├── game.ts                # Authoritative game and role/freshness checks
│   ├── contracts.ts           # Runtime action validation
│   └── mcp.ts                 # SDK-backed MCP resources and tools
├── src/
│   ├── main.ts                # UI, human actions and opt-in wake orchestration
│   ├── style.css
│   ├── webmcp.ts              # Browser tool registration
│   └── codex.ts               # Direct browser WebSocket client
└── tests/
    ├── game.test.ts
    ├── server.test.ts         # Includes real MCP SDK client integration
    ├── webmcp.test.ts
    └── codex.test.ts          # Mock socket; never starts a real Codex turn
```

`node_modules/` and `dist/` are generated and ignored by Git. Dependencies are locked in `package-lock.json`; use `npm ci` for repeatable installation.

## Connect this thread

Expand the connection settings. The app takes an initial thread ID from the server's `CODEX_THREAD_ID` environment variable when available; you can also paste an ID or supply `?threadId=...` / `?sessionId=...` in the page URL. Confirm the ID before enabling automatic turns. It is not inferred by scraping other conversations.

The default socket endpoint is `ws://127.0.0.1:4500`. A compatible listener can be launched using:

```sh
codex app-server --listen ws://127.0.0.1:4500
```

**Important:** that command starts a listener; it does not attach that listener to the currently running desktop server. The selected server must be able to read/resume the exact thread, and its running agent must have access to the same browser's WebMCP tools. A separate CLI server may have stored thread history but no access to the desktop browser. Do not run the same thread concurrently through two independent servers. If the desktop does not expose a compatible listener, automatic wake-up of its active thread is unavailable through this interface. Do not treat an acknowledged turn as proof that browser tools are connected.

The app never creates a replacement thread, forks the conversation, changes your model, auto-approves requests, or silently guesses on the agent's behalf. Automatic waking is opt-in; leave it off while developing or while this thread is busy. You can still ask the agent in the current browser-enabled thread to take its turn using the page's tools.

### Protocol correction

The supported current API is `turn/start`, **not** `session/createTurn`. A successful current-mode wake performs:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"semanticspy","version":"0.1.0"},"capabilities":null}}
{"method":"initialized"}
{"id":2,"method":"thread/read","params":{"threadId":"YOUR_THREAD_ID","includeTurns":false}}
{"id":3,"method":"turn/start","params":{"threadId":"YOUR_THREAD_ID","input":[{"type":"text","text":"SemanticSpy: human ended guessing. Read get_board before making a move, then use the game tools.","text_elements":[]}]}}
```

Request IDs above are illustrative. If the known thread is not loaded, the client resumes it first. Active/error states are rejected. Protocol-compatible JSON-RPC frames omit the optional `jsonrpc` marker as Codex's examples do.

An explicit **legacy/unverified** compatibility setting preserves the originally requested payload for a custom server that actually implements it:

```json
{"id":4,"method":"session/createTurn","params":{"sessionId":"YOUR_SESSION_ID","instructions":"Read the current SemanticSpy board using WebMCP before acting."}}
```

There is no automatic downgrade. A timeout after sending a turn is an **unknown outcome**, not proof of failure. Check the target thread before manually retrying. Wake attempts are guarded against accidental duplicate submission; local browser deduplication is not an exactly-once distributed delivery guarantee.

## WebMCP versus MCP

They are related but different interfaces:

- **WebMCP:** tools registered in the top-level page with `document.modelContext.registerTool` (with a compatibility fallback). The browser-enabled agent calls `get_board`, then `submit_clue`, `make_guess`, or `end_turn`. WebMCP does not provide a standard MCP resource registry, so `get_board` returns the board with its canonical resource URI.
- **MCP:** a separate authenticated Streamable HTTP endpoint at `/mcp` exposes `semanticspy://game/board` as a real MCP resource and the same game actions as MCP tools. It uses the same engine; it never creates a second match. This is an optional non-browser integration, not a claim that CLI MCP calls are WebMCP calls.

The local API publishes strict tool input schemas at `/api/schemas`. Unknown keys, malformed arguments, out-of-turn moves, illegal clues, duplicate guesses, and moves after game-over are rejected. The backend requires an agent board read at the current revision before **every** agent mutation. This prevents blind/stale moves through the supported interfaces; it cannot prove what a model considered internally.

An external MCP client connects to `http://127.0.0.1:4310/mcp` with `Authorization: Bearer <agentToken>`. Obtain the current process's `agentToken` from the same local `/api/bootstrap` response used by the frontend; never commit or share it. The endpoint uses stateless Streamable HTTP: initialize, then POST MCP requests normally. No persistent MCP session ID or standalone GET event stream is needed. The bare board resource returns public information; `semanticspy://game/board?role=spymaster` returns the secret key **only** with the agent bearer capability and only when that agent is the match's Spymaster. The browser's `get_board` tool automatically selects the authenticated agent's permitted view.

The board resource's secret view is determined by the authenticated actor's match role, not an untrusted `role=spymaster` string. Public/Operative responses omit every hidden alignment. Spymaster views include them. The browser refreshes only the **human** view after an agent tool call, keeping an agent-only key out of the board DOM and history.

### Model and browser support

Current official documentation says WebMCP site tools require **Sol or Terra**; Luna currently has site tools disabled. Luna High can write this application's code, but should not be selected as its WebMCP playing agent. Availability also depends on the desktop version, account rollout, permissions, and whether the page stays open. The app displays an unsupported state when the API is absent; it does not fabricate tool availability.

## Security boundary

This is a trusted, single-user, loopback application—not an anti-cheat service against the machine owner. Random actor capabilities, Origin/Host checks, and server-side role authorization prevent ordinary cross-site calls and accidental role escalation. Keep it bound to loopback. Do not publish the server or forward its ports. The same local browser process holds both actor capabilities so WebMCP can act on behalf of the agent; browser developer tools and local filesystem access are outside the game's secrecy boundary.

Capabilities are not saved to browser storage, source control, logs, or wake prompts. Query-string capability variants should not be shared or logged; prefer bearer authentication. Connection preferences contain thread IDs, so do not share your browser profile casually. A raw local Codex socket is a privileged connection: expose it only to trusted local clients and never change it to a public bind just to work around browser connection errors.

## Sources and compatibility baseline

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): supported lifecycle and WebSocket transport.
- [Codex site tools / WebMCP](https://learn.chatgpt.com/docs/webmcp): browser API, model availability, and limitations.
- Protocol fields were also checked against locally generated TypeScript bindings from Codex CLI 0.147.0. The experimental App Server/WebMCP surfaces may evolve.

See `IMPLEMENTATION.md` for component ownership and the HTTP/DTO contracts. Complete source is included in this repository; no generated game logic or hosted runtime is required.

## Verification baseline

The initial implementation passes TypeScript checking, a Vite production build, and 26 automated tests covering the engine, HTTP authorization, real MCP client interoperability, WebMCP registration, and mock Codex socket lifecycle. The development page returned HTTP 200. A real automatic wake of the desktop's active thread has **not** been verified; no Codex turn is sent by the test suite. Browser visual/interaction QA has not been performed.
