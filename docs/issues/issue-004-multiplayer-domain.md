# Issue 004: Multiplayer Game Domain

Status: complete

Depends on: Issue 000A

## Outcome

One authoritative game engine supports Blue-only Co-op and alternating Blue-vs-Red play.

## Scope

- Represent participating teams without splitting the engine into separate games.
- Replace human/agent turn identity with active Player/team/role state.
- Preserve the exact clue-count maximum and `end_turn`.
- Implement Blue Spymaster → Blue Operative → Red Spymaster → Red Operative rotation when Red participates.
- Keep Red as a non-playing hazard in Co-op.
- Credit opponent words correctly and resolve either team winning.
- Make the assassin defeat the guessing team.
- Keep role-scoped secret views.
- Add a game turn counter: one team's clue-and-guess sequence is one turn.

## Acceptance

- One focused Co-op transition test passes.
- One focused four-role Versus rotation test passes.
- Wrong player, role, and phase actions fail.
- Either team can win or lose to the assassin.
