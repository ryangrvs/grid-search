# Issue 000: Local-Only Browser Runtime

Status: complete

Depends on: Issue 003

Blocks: Issues 004–008

## Outcome

SemanticSpy is a static, local-only WebMCP application. The human UI and imperative WebMCP tools share one browser-owned game controller, and durable state lives in browser `localStorage`. Running or deploying the game requires no backend, serverless function, database, or cloud account.

## Decisions

- WebMCP is the only agent integration; remove the HTTP MCP server.
- Protect hidden information through tool and UI responses, not as a security boundary against the local human. A human who inspects browser state may cheat. (Remember this is a small/light weight game played by a single human - if an agent or human wants to try hard enough to cheat then so be it). 
- Cross-device and remote human multiplayer are not product requirements.
- Player handles are lightweight game identifiers, not secrets requiring server-side storage.

## Scope

- Move the reusable Game and Roster domain modules into browser-compatible code.
- Replace Node-only UUID usage with browser `crypto.randomUUID()` or an injected equivalent.
- Replace separate roster persistence with the controller-owned versioned `LocalStorageStateStore` snapshot.
- Introduce one browser `GameController` shared by the UI and WebMCP tool handlers.
- Replace `/api/*` fetches with direct controller calls while keeping async tool interfaces where useful.
- Preserve role-filtered board responses so WebMCP agents receive only the state appropriate to their role.
- Remove bootstrap capabilities, bearer tokens, HTTP routes, the HTTP MCP endpoint, server startup, Vite API proxying, and backend-only dependencies.
- Replace server integration tests with focused controller and WebMCP integration tests.
- Preserve the completed registration, handle recovery, role alignment, New Game, and New Round behavior.

## Non-goals

- Preventing the local human from finding the secret board through developer tools.
- HTTP MCP compatibility.
- Cross-browser, cross-device, or remote multiplayer synchronization.
- Implementing the multiplayer turn engine from Issue 004.

## Acceptance

- The production output can be hosted as static files and played without a running application server.
- Runtime code makes no `/api/*` or `/mcp` requests.
- UI actions and WebMCP tools operate on the same browser-owned game and roster.
- Refresh restores the controller snapshot from `localStorage`; clearing `semanticspy.state.v1` starts a fresh registration lobby and game.
- Existing Game, Roster, UI, and WebMCP behavior remains covered by focused tests.
- The static production build succeeds.
