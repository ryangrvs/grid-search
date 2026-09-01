# Issue 001: Remove App-Managed Wake

Status: delegated to **Multi-agent frontend**

Depends on: nothing

## Outcome

SemanticSpy no longer configures, stores, or starts Codex threads. The game and WebMCP tools remain functional.

## Scope

- Remove the **Connection & Agent wake** UI.
- Remove connection settings, wake state, wake retry logic, and wake-related local storage from the frontend.
- Remove the app-managed Codex transport path and tests that exist only for wake-up.
- Simplify bootstrap/server configuration that only supplies thread IDs or wake WebSocket details.
- Keep WebMCP tool registration and normal board polling/actions working.
- Update affected code tests.

## Constraints

- Do not implement the multiplayer lobby or player registration.
- Do not redesign unrelated game UI.
- Do not edit `README.md` or planning documents; the orchestrator will reconcile documentation because the integration worktree has an existing README edit.
- Preserve user changes and avoid broad cleanup.

## Acceptance

- No wake/connection controls appear in the app.
- No frontend path can start or resume a Codex thread.
- Existing game and WebMCP behavior still builds and passes relevant tests.
- The diff is limited to wake removal and necessary fallout.
