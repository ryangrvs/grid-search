# Issue 005: Multiplayer WebMCP Tooling

Status: complete

Depends on: Issues 003 and 004

## Outcome

Agents receive concise static guidance, authorized dynamic state, and self-contained action results without redundant reads.

## Scope

- Add unscoped `get_context({})` returning a short static rules/workflow string.
- Replace `get_board` with `get_state({ playerHandle })`.
- Add `playerHandle` to clue, guess, and end-turn inputs.
- Reject unknown handles, wrong roles, wrong phases, and out-of-turn calls.
- Return the authorized current state after every successful action, including player identity, active player, remaining guesses, winner/status, legal actions, and turn number.
- Remove the instruction to call a read immediately after a successful action.
- Do not expose `expectedRevision` in MVP tool inputs.
- Keep imperative `document.modelContext.registerTool()` registration.
- Rehydrate a tab-local controller from the shared origin snapshot before every
  dynamic WebMCP read or mutation so separately owned agent tabs stay current.

## Acceptance

- An action result contains enough state for the caller to decide whether to act again.
- An agent learns role/name changes from state or action results.
- Tool schemas and WebMCP tests cover only the essential happy and rejection paths.
- A tool registered in one tab observes a move persisted by another tab without
  requiring a page refresh.
