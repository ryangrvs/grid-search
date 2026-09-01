# SemanticSpy implementation contract

SemanticSpy is a static, local-only WebMCP game. The browser owns one `GameController`, which contains the in-memory `Game` and `Roster` plus one versioned `LocalStorageStateStore` snapshot. The human UI and imperative WebMCP handlers call that same controller directly. There is no backend, HTTP API, MCP server, proxy, token, database, wake service, or runtime network request.

## Runtime modules

- `src/game.ts` is the browser-compatible authoritative turn engine. It uses browser crypto IDs (with an injected ID factory for tests), keeps secret alignments internally, and returns role-filtered boards. Agent reads are fresh-read capabilities: every agent mutation requires a new `getBoard('agent')` at the current revision.
- `src/roster.ts` owns the fixed four-seat lobby and exposes validated snapshots; it never reads or writes storage. Handles remain internal and are rotated on same-name agent recovery.
- `src/game.ts` exposes a validated snapshot containing the hidden key and all authoritative round state. Fresh agent-read authorization is intentionally not included in that snapshot.
- `src/state-store.ts` provides `LocalStorageStateStore` under `semanticspy.state.v1` and `MemoryStateStore` for tests. A successful unified-state write removes the obsolete `semanticspy.roster.v1` key from earlier builds.
- `src/game-controller.ts` is the single browser state boundary and persistence seam. It loads one `{ version: 1, game, roster }` snapshot, saves after every successful mutation, and exposes board reads, human/agent actions, registration/recovery, role alignment, New Game, and Next Round.
- `src/webmcp.ts` feature-detects `document.modelContext` (with the navigator compatibility path) and registers `get_board`, `submit_clue`, `make_guess`, `end_turn`, and `register` with strict schemas. Tool execution is async, but has no fetch or server dependency. Agent board results use `semanticspy://game/board`; the secret board is never rendered into the human DOM.
- `src/main.ts` renders the human view and calls the controller for all refreshes and actions. Polling only re-reads local state to update UI; it is not synchronization with a service.

## Game rules and views

There are 25 cards: 9 blue, 8 red, 7 innocent, and 1 assassin. Blue wins after all nine blue cards; the assassin loses. A wrong guess ends the turn. A clue count is the exact maximum number of guesses with no bonus or carryover. The terminal board reveals the key while `revealed` continues to mean actually guessed.

The human operative view hides unrevealed alignments. A spymaster view receives the key. An agent receives the board for its assigned role. UI and tools preserve registration, handle recovery, role alignment, New Game (fresh words), and Next Round (same words, fresh key) behavior. Issue 004's multiplayer turn engine is intentionally out of scope here.

## Development and verification

`npm run dev` starts Vite only. `npm test` runs focused Game, roster, controller, UI presentation, and WebMCP integration tests. `npm run build` typechecks the browser modules and emits a static `dist/` directory. The production directory can be hosted by any static file server; no application server is required.

Runtime source contains no `/api` or `/mcp` requests. No server startup, HTTP routes, bearer capabilities, filesystem roster, MCP SDK, Node-only runtime API, or Vite API proxy is part of the application.
