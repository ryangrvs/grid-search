# SemanticSpy implementation contract

SemanticSpy is a static, local-only WebMCP game. Each browser tab owns one `GameController`, which contains the in-memory `Game` and `Roster`; tabs coordinate through one versioned `LocalStorageStateStore` snapshot for the app origin. The human UI and imperative WebMCP handlers within a tab call that tab's controller directly. There is no backend, HTTP API, MCP server, proxy, token, database, wake service, or runtime network request.

## Runtime modules

- `src/game.ts` is the browser-compatible authoritative turn engine for both Co-op and Versus. It uses roster Player IDs for turn ownership, keeps secret alignments internally, and returns role-filtered boards. Agent reads are player-scoped fresh-read capabilities: a Player reads before its first action, and each successful action result establishes that Player's read at the new revision when another action remains legal.
- `src/roster.ts` owns the fixed four-seat lobby and exposes validated snapshots; it never reads or writes storage. Handles remain internal and are rotated on same-name agent recovery.
- `src/game.ts` exposes a validated snapshot containing the hidden key, participating Players, match mode, active Player, winner, and turn counters. Fresh agent-read authorization is intentionally not included in that snapshot.
- `src/state-store.ts` provides `LocalStorageStateStore` under `semanticspy.state.v1` and `MemoryStateStore` for tests. A successful unified-state write removes the obsolete `semanticspy.roster.v1` key from earlier builds.
- `src/game-controller.ts` is the browser state boundary and persistence seam. It loads and change-detects one coherent `{ version: 1, game, roster }` snapshot, can atomically rehydrate both domains without writing it back, saves after every successful mutation, starts Co-op or Versus from the authoritative roster, resolves player handles, and returns one caller-authorized state shape with legal actions.
- `src/webmcp.ts` feature-detects `document.modelContext` (with the navigator compatibility path) and imperatively registers `get_context`, `get_state`, `submit_clue`, `make_guess`, `end_turn`, and `register` with strict schemas. State and action results use `semanticspy://game/state`; every dynamic tool is player-handle scoped, synchronizes from persisted state before reading or mutating, and no tool uses `expectedRevision`.
- `src/main.ts` renders the human view as a fixed four-seat table around the board and calls the controller for all refreshes and actions. Player positions remain stable when Next Round switches roles. The New Game lobby is the only role picker. Same-origin tabs react to `storage` events immediately, with polling as a fallback for delayed or suppressed cross-tab events; neither mechanism synchronizes with a server.

## Game rules and views

There are 25 cards: 9 blue, 8 red, 7 innocent, and 1 assassin. Co-op has Blue-only turns while Red remains a hazard. Versus rotates Blue Spymaster, Blue Operative, Red Spymaster, and Red Operative. Revealing a team word credits that team, either participating team can win, and the assassin defeats the guessing team. A wrong guess ends the guessing team's turn. A clue count is the exact maximum number of guesses with no bonus or carryover. The terminal board reveals the key while `revealed` continues to mean actually guessed.

An Operative view hides unrevealed alignments; a Spymaster view receives the key. Each successful clue, guess, or end-turn action adds exactly one team-attributed Game History entry. The active Player is authoritative, while controller identity remains a temporary UI adapter detail. `get_state` and successful WebMCP actions return the caller's current identity, authorized board, active Player, legal actions, remaining guesses, winner/status, and turn number. The total turn number and per-team counts increment when a Spymaster submits a clue. UI and tools preserve registration, same-name handle recovery, role alignment, New Game (fresh words), and Next Round (same words, fresh key with automatically switched roles) behavior.

## Development and verification

`npm run dev` starts Vite only. `npm test` runs focused Game, roster, controller, UI presentation, and WebMCP integration tests. `npm run build` typechecks the browser modules and emits a static `dist/` directory. The production directory can be hosted by any static file server; no application server is required.

Runtime source contains no `/api` or `/mcp` requests. No server startup, HTTP routes, bearer capabilities, filesystem roster, MCP SDK, Node-only runtime API, or Vite API proxy is part of the application.
