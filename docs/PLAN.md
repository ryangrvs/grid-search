# SemanticSpy Backlog

This file indexes the active multiplayer epic and holds ideas intentionally deferred from it.

## Active epic: multiplayer

Source: `docs/multiplayer-epic.md`

Work in dependency order unless an issue explicitly says it can overlap.

| Issue | Scope | Status | Depends on |
| --- | --- | --- | --- |
| [001](issues/issue-001-remove-wake.md) | Remove app-managed wake and connection UI | Complete | — |
| [002](issues/issue-002-registration-poc.md) | 2×2 lobby and multi-agent `register` POC | Complete | 001 |
| [003](issues/issue-003-persistent-roster.md) | Persistent players, handles, and role switching | Complete | 002 |
| [000](issues/issue-000-local-only-browser-runtime.md) | Remove the backend and move to a local-only browser runtime | Complete | 003 |
| [000A](issues/issue-000a-persist-browser-game-state.md) | Persist one coherent browser game snapshot | Complete | 000 |
| [004](issues/issue-004-multiplayer-domain.md) | One-engine Blue-only and Blue-vs-Red rules | Complete | 000A |
| [005](issues/issue-005-webmcp-tooling.md) | `get_context`, `get_state`, and player-scoped actions | Complete | 003, 004 |
| [006](issues/issue-006-four-player-ui.md) | Four-player board layout and turn presentation | Complete | 003, 004 |
| [007](issues/issue-007-education-outcomes.md) | How to Play, turn counter, and finish modal | Planned | 004, 006 |
| [008](issues/issue-008-live-verification.md) | Lightweight checks and complete multi-agent match | Planned | 005, 006, 007 |

Issues 000 and 000A were architectural corrections inserted after the registration and persistence spikes. The multiplayer domain, player-scoped tools, cross-tab synchronization, and board UI are now complete through Issue 006. Issue 007 is the next product pass, followed by the full live-match verification in Issue 008.

## If time

### Agent orchestrator / umpire

A separate agent could:

- interact with the human;
- call an orchestrator-only `new_game` tool;
- create the player sub-agents;
- prompt or coordinate turns;
- register as a visual umpire; and
- send public messages when a player needs attention.

Registration would be a visual pleasantry, not a requirement for starting a match.

### Four-agent self-play harness

- allow all four seats, including the current human seat, to be agent-controlled;
- run full Blue-versus-Red matches without human input;
- use self-play to exercise cross-tab synchronization, role filtering, turn order,
  terminal outcomes, and long-running match behavior; and
- keep this as a testing and demonstration mode rather than changing the default
  human-plus-agents setup.

### Public table chat

- separate `send_message` tool;
- public speech bubbles beside players;
- messages retained in game history; and
- no private team channel initially.

### Display-name management

- let the human rename registered agents;
- optionally let an orchestrator rename players; and
- communicate the current name in every later state/action result.

### Stronger player-handle behavior

- treat handles more like passwords;
- improve recovery and handle rotation;
- consider transport-bound authentication; and
- make clear that this remains game-level deterrence, not real security.

### Demo board

Show a polished read-only example game before New Game is pressed.

### Agent tool-call display and statistics

Show recent calls such as `called get_state` where player speech bubbles appear, with an optional tool-call history panel. Add end-game statistics such as clues, guesses, correct/wrong guesses, and tool calls.

Because SemanticSpy uses imperative tools, calls can be recorded in the shared execute wrapper today. Do not depend on `SubmitEvent.agentInvoked`: it is not present in the current WebMCP draft. The draft mentions a future `toolactivated` event, but it is still an unresolved specification item. [WebMCP draft](https://webmachinelearning.github.io/webmcp/)

### External turn prompting experiments

- Codex schedules or other external cadence mechanisms;
- long-running parent turns;
- parent/sub-agent handoff patterns; and
- manual recovery when an agent disappears.

These stay outside the web app until a reliable pattern is proven.

### Adversarial play experiments

- deliberately permissive or rule-bending prompts;
- observing whether agent teammates leak hidden information;
- optional cheat detection; and
- post-hackathon ethics/game-behavior experiments.

### Provider compatibility

After the Codex submission works, try the same imperative tools with other agents or browsers. Avoid provider-specific state in the core game, but do not block the submission on additional adapters.
