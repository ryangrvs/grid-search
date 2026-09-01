# Issue 002: Registration Lobby POC

Status: ready next

Depends on: Issue 001

## Outcome

Prove multiple agents can call one page's imperative WebMCP tools by building the first useful product slice: a live 2×2 registration lobby.

## Scope

- Open a 2×2 lobby from New Game.
- Prefill the local human in the top-left Blue card.
- Show three open cards with controller icon, team color, display name, and role only.
- Add imperative `register({ name, team?, role? })`.
- Assign the next open seat Blue-first when team/role are omitted.
- Return a useful occupied-seat error and available seats.
- Update lobby cards immediately after registration.
- Reveal **Start Co-op** when the second Blue seat is occupied.
- Reveal **Start Versus** when both Red seats are occupied.

Use an in-memory roster for this proof of concept; persistence and recovery belong to Issue 003.

## Acceptance

- At least two distinct Codex agents can register against the same live page.
- Requested and automatic seat assignment both work.
- The UI reflects registrations without reloading.
- No multiplayer game-rule refactor is included yet.
