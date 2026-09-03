# Multiplayer and Multi-Agent Epic

Status: active. The foundational work through Issue 006 is complete; Issue 007 is next. This is an epic because it changes player registration, game rules, WebMCP tools, and the board UI.

## Goal

Extend SemanticSpy from one human-agent Blue partnership into a game that can also support:

- Human + Agent on Blue; and
- Human + Agent on Blue versus two players on Red.

The game logic should not care whether a non-human seat is occupied by an agent or another human. The initial UI still assumes one local human, prefilled on Blue, with agents filling the other seats.

> Decision: Keep one game engine and one lobby. Do not present separate game-mode selection or use a "Classic" label.

The lobby exposes start buttons progressively:

- after the second Blue player registers: **Start Co-op**;
- after both Red players also register: **Start Versus**.

These are provisional button labels; they describe how many teams are participating without splitting the product into separate games.

## Scope

### In this epic

- 2×2 player registration lobby;
- imperative WebMCP `register` proof of concept;
- persistent player roster and loose player handles;
- one-team and two-team turn rules in the same game engine;
- revised WebMCP context, state, clue, guess, and end-turn tools;
- four player positions around the board;
- human role switching between rounds;
- a How to Play modal;
- a game-turn counter; and
- a game-finished modal with win/loss and turn count.

### Deferred

Deferred ideas are kept in `docs/PLAN.md` rather than expanding this epic.

## Local-only browser architecture

> Decision: SemanticSpy is a static, local-only WebMCP application. It does not require a backend, serverless function, database, or cloud account.

The human UI and imperative WebMCP tools share one browser-owned game controller. The roster, player handles, and restorable game state live in versioned browser `localStorage`.

> Decision: Persist one coherent, versioned application snapshot rather than separate roster and game keys. `GameController` owns this persistence seam so role changes and game state cannot be restored out of sync.

> Decision: WebMCP is the only agent integration. Remove the HTTP MCP server. Cross-device human multiplayer is not a requirement.

Role-filtered tool responses remain part of the game rules, but hidden state is not a security boundary against the local human. A player who inspects browser memory may cheat; this is acceptable for a local agent-play experiment.

## No in-app wake-up or coordinator

> Decision: Remove the current **Connection & Agent wake** UI and app-managed Codex wake behavior from the product direction.

SemanticSpy will expose state and legal actions. Prompting, schedules, long-running sessions, or parent/sub-agent coordination happen outside the web app.

There is no Match Director in this epic. A separate LLM orchestrator or umpire is an optional later experiment. The web app does not store thread IDs, provider credentials, or runtime configuration.

## Player and seat model

```ts
type Team = 'blue' | 'red';
type Role = 'spymaster' | 'operative';
type Controller = 'human' | 'agent';

interface Player {
  id: string;
  displayName: string;
  controller: Controller;
  team: Team;
  role: Role;
}
```

> Decision: `team` and `role` are separate Player fields. A seat is the available combination of team and role, not the player's identity.

The loose `playerHandle` used by tools is stored separately from the public Player. Physical UI position is also presentation state, not part of the game domain.

### Stable player positions

- Human: top-left, always Blue.
- Other Blue player: top-right.
- Red players: bottom-left and bottom-right.

The human's physical position never changes. If the human switches roles, the two Blue role labels switch while the people remain in place. Players should generally remain in their physical positions between rounds; the active-turn treatment makes the current turn clear.

> Decision: Roles align vertically. The bottom-left Red player has the same role as the human above them, and the bottom-right Red player has the opposite role. When the human switches roles between rounds, role labels switch within both teams while all four people remain in their physical positions.

### Human role changes

> Decision: The human may change Blue role after the Blue agent registers, either in the lobby or between rounds. The other Blue player takes the opposite role. Do not switch roles during an active clue/guess turn.

Every `get_state` and successful action result includes the caller's current `displayName`, `team`, and `role`, so an agent learns about role changes without relying on remembered context.

## Player registration and identification

Registration is intentionally lightweight. It is meant to demonstrate WebMCP coordination, not provide strong authentication.

```ts
register({
  name,
  team?,
  role?
}) -> {
  success,
  player?,
  playerHandle?,
  error?,
  availableSeats?
}
```

Rules:

- `name` is required and shown in the lobby and around the board.
- `team` and `role` are optional.
- With no preference, assign the next open seat, Blue first.
- A requested occupied seat returns a useful failure and the remaining seats.
- Only registered handles can call player-scoped tools.
- The browser game controller rejects a legal tool called by the wrong role or outside that player's turn.
- Registering again with the same display name reissues a new handle for that existing player and invalidates the previous handle.

> Decision: Do not use invitation codes.

> Decision: Use an opaque `playerHandle` as loose authentication, while keeping the human-readable display name as the visible identity. This is an honor-based game, not a security boundary.

> Comment: If an agent loses its context or is replaced, calling `register` again with the same display name is the recovery mechanism. Display names are therefore unique within a roster.

### Persistence

> Decision: Preserve registered players, positions, names, and handles through New Round, New Game, and page refresh as part of the one controller-owned versioned browser snapshot. Clearing `semanticspy.state.v1` starts a fresh registration lobby and game.

New Round may switch roles but retains players. New Game changes the board but also retains players.

Changing another player's display name through the UI or an orchestrator tool is deferred. When added, state/action results will communicate the new name to that agent.

## Game rules

The same engine supports one or two participating teams:

- **Start Co-op:** Blue takes turns; Red remains a board hazard and does not act.
- **Start Versus:** Blue and Red alternate Spymaster/Operative turns.

> Decision: Preserve the current clue-count rule: the number is the maximum number of guesses, with no bonus guess or carryover.

> Decision: Keep `end_turn`. An Operative may stop before using every allowed guess when the remaining guesses are risky.

For Versus:

1. Blue Spymaster submits a clue.
2. Blue Operative guesses or ends the turn.
3. Red Spymaster submits a clue.
4. Red Operative guesses or ends the turn.
5. Repeat until a team wins or reveals the assassin.

Guessing an opponent word credits that team and ends the guessing turn. Revealing the assassin makes the guessing team lose.

## WebMCP tools

### Imperative registration

SemanticSpy currently registers tools imperatively with `document.modelContext.registerTool()` in `src/webmcp.ts`.

> Decision: Continue using imperative tools. They fit custom game actions, validation, structured results, and shared application logic. Declarative WebMCP is primarily useful for form-driven interactions and is not a better fit for game state mutations.

The WebMCP specification remains a draft. The current draft's imperative callback receives the input object and execution options; it does not provide a stable Codex thread identity. That is why `register` and `playerHandle` remain necessary. [WebMCP draft](https://webmachinelearning.github.io/webmcp/)

### `get_context`

```ts
get_context({}) -> { context: string }
```

> Decision: `get_context` is static and unscoped. It contains a short rules-and-workflow prompt, similar in spirit to a small game-specific `AGENTS.md`.

It should explain:

- the objective and clue rules;
- the registration workflow;
- which state tool to call;
- how turns work;
- the no-cheating/table-talk rule; and
- how to recover after losing context.

If this becomes large, split it into narrower context tools later. Do not put current board or player state in it.

### `get_state`

```ts
get_state({ playerHandle }) -> {
  player,
  board,
  activePlayer,
  clue,
  remainingGuesses,
  legalActions,
  status,
  winner,
  turnNumber
}
```

This is the only dynamic read tool. It replaces the role-assuming `get_board` name.

### Gameplay tools

```ts
submit_clue({ playerHandle, clue, count })
make_guess({ playerHandle, word })
end_turn({ playerHandle })
```

Each successful mutation returns the caller-authorized current state, including:

- the caller's current name/team/role;
- whether it is still their turn;
- remaining guesses;
- the next active player;
- game status and winner; and
- current turn number.

> Decision: Do not require a second `get_state` immediately after a successful mutation; its result is already authoritative.

> Decision: Do not expose `expectedRevision` in MVP tool inputs. It was proposed as protection against stale concurrent actions, but it adds agent ceremony that this local hackathon game does not currently need. The server still validates role, phase, turn, and card legality.

## First proof of concept: registration lobby

> Decision: The easiest useful multi-agent WebMCP test is the real registration slice, not a disposable probe.

Build:

1. A New Game lobby modal with a 2×2 player grid.
2. Human prefilled in the top-left Blue position.
3. Three open player cards showing only controller icon, team color, display name, and role.
4. Imperative `register({ name, team?, role? })` tool.
5. Live lobby updates when an agent registers.
6. **Start Co-op** once the second Blue seat is occupied.
7. **Start Versus** once both Red seats are also occupied.
8. A minimal manual test using two or three distinct Codex agents against the same page.

This POC answers the important unknowns directly:

- Can several agents discover and call the page's imperative tools?
- Do calls arrive correctly after different agent turns or invocations?
- Does the roster survive page refresh?
- Can the app distinguish players using the returned handles?

## Lobby and board UI

The lobby uses cards visually related to the 5×5 word grid:

- controller icon communicates Human or Agent;
- card color communicates Blue or Red;
- text shows display name and current role; and
- an empty card communicates an available seat.

Do not show invitation codes, runtime type, thread ID, model configuration, or connection status.

The same players retain the same physical positions around the game board. The initial active-turn cue can fill or strongly tint the active player's card with their team color; visual refinement can follow after the four-position layout works.

## Education and outcome UI

### How to Play

Add a How to Play button and modal covering:

- normal game rules;
- how to register agents;
- how to prompt the active agent manually;
- the current caveat that the app does not wake agents;
- optional use of an external schedule when available; and
- the token-heavy alternative of keeping a long-running agent turn active until the match ends.

### Turn counter

> Decision: A game turn is one team's clue-and-guess sequence. Increment the total when a Spymaster submits a clue. In Co-op, this is effectively the number of clues used; in Versus, also retain per-team counts for future statistics.

Display the current turn count during play.

### Game-finished modal

When the game ends, show:

- You won / You lost;
- winning team and reason;
- total game turns; and
- New Round / New Game actions.

Detailed player and tool statistics are deferred.

## Lightweight verification

Every test should answer "is this needed for the hackathon demo?"

Minimum useful coverage:

- registration assignment, occupied-seat failure, and same-name recovery;
- wrong-role and wrong-turn tool rejection;
- one happy-path Co-op game transition;
- one happy-path Versus rotation through all four roles;
- action results contain enough state to continue without an immediate read; and
- roster restoration after refresh.

The manual acceptance test is a complete Human + Agent versus Agent + Agent game using the lobby and WebMCP tools.

## Suggested implementation order

1. Remove the current wake/connection UI and app-managed wake path.
2. Build the 2×2 lobby plus `register` POC.
3. Confirm multiple Codex agents can register against the same live page.
4. Add persistent roster, handles, and human role switching.
5. Generalize the game domain for one or two participating teams.
6. Add `get_context`, `get_state`, and revised mutation results.
7. Extend the player layout around the board.
8. Add turn counting, How to Play, and the game-finished modal.
9. Run the lightweight automated checks and one complete live multi-agent match.

## Resolved decisions

- No in-app coordinator or wake system.
- No separate mode-selection screen.
- One engine supports one or two participating teams.
- Human is always top-left and Blue; role is selectable between rounds.
- Player has separate `team` and `role` fields.
- Agents register by display name, with optional requested team/role.
- Registration returns a loose opaque handle; no invitation codes.
- Roster persists through rounds, games, and refresh.
- Exact-count maximum remains.
- `end_turn` remains.
- `get_context` is static; `get_state` is dynamic and scoped.
- Successful actions return current state; no mandatory post-action read.
- No public `expectedRevision` argument for MVP.
- Imperative WebMCP tools remain the correct approach.
- Chat, demo board, orchestrator, and cheating experiments are backlog items.
