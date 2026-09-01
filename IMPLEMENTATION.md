# SemanticSpy implementation contract

SemanticSpy is a static, local-only WebMCP game. The browser owns one `GameController`, which contains the in-memory `Game` and `Roster` plus one versioned `LocalStorageStateStore` snapshot. The human UI and imperative WebMCP handlers call that same controller directly. There is no backend, HTTP API, MCP server, proxy, token, database, wake service, or runtime network request.

## Runtime modules

- `src/game.ts` is the browser-compatible authoritative turn engine for both Co-op and Versus. It uses roster Player IDs for turn ownership, keeps secret alignments internally, and returns role-filtered boards. Agent reads are player-scoped fresh-read capabilities: every agent mutation requires a new read by that Player at the current revision.
- `src/roster.ts` owns the fixed four-seat lobby and exposes validated snapshots; it never reads or writes storage. Handles remain internal and are rotated on same-name agent recovery.
- `src/game.ts` exposes a validated snapshot containing the hidden key, participating Players, match mode, active Player, winner, and turn counters. Fresh agent-read authorization is intentionally not included in that snapshot.
- `src/state-store.ts` provides `LocalStorageStateStore` under `semanticspy.state.v1` and `MemoryStateStore` for tests. A successful unified-state write removes the obsolete `semanticspy.roster.v1` key from earlier builds.
- `src/game-controller.ts` is the single browser state boundary and persistence seam. It loads one coherent `{ version: 1, game, roster }` snapshot, saves after every successful mutation, and starts Co-op or Versus from the authoritative roster. Legacy human/agent adapters remain until Issue 005 moves WebMCP to player handles.
- `src/webmcp.ts` feature-detects `document.modelContext` (with the navigator compatibility path) and registers `get_board`, `submit_clue`, `make_guess`, `end_turn`, and `register` with strict schemas. Tool execution is async, but has no fetch or server dependency. Agent board results use `semanticspy://game/board`; the secret board is never rendered into the human DOM.
- `src/main.ts` renders the human view and calls the controller for all refreshes and actions. Polling only re-reads local state to update UI; it is not synchronization with a service.

## Game rules and views

There are 25 cards: 9 blue, 8 red, 7 innocent, and 1 assassin. Co-op has Blue-only turns while Red remains a hazard. Versus rotates Blue Spymaster, Blue Operative, Red Spymaster, and Red Operative. Revealing a team word credits that team, either participating team can win, and the assassin defeats the guessing team. A wrong guess ends the guessing team's turn. A clue count is the exact maximum number of guesses with no bonus or carryover. The terminal board reveals the key while `revealed` continues to mean actually guessed.

An Operative view hides unrevealed alignments; a Spymaster view receives the key. The active Player is authoritative, while controller identity remains a temporary adapter detail for the current UI and WebMCP tools. The total turn number and per-team counts increment when a Spymaster submits a clue. UI and tools preserve registration, handle recovery, role alignment, New Game (fresh words), and Next Round (same words, fresh key) behavior.

## Development and verification

`npm run dev` starts Vite only. `npm test` runs focused Game, roster, controller, UI presentation, and WebMCP integration tests. `npm run build` typechecks the browser modules and emits a static `dist/` directory. The production directory can be hosted by any static file server; no application server is required.

Runtime source contains no `/api` or `/mcp` requests. No server startup, HTTP routes, bearer capabilities, filesystem roster, MCP SDK, Node-only runtime API, or Vite API proxy is part of the application.
