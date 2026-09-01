# Issue 003: Persistent Roster and Player Handles

Status: complete

Depends on: Issue 002

## Outcome

Registered players survive rounds, games, and refreshes and can reliably identify themselves to player-scoped tools.

## Scope

- Introduce Player with separate `displayName`, `controller`, `team`, and `role` fields.
- Keep opaque `playerHandle` outside the public Player shape.
- Persist roster, positions, names, roles, and handles locally.
- Preserve the roster through New Round, New Game, and refresh.
- Re-registering the same display name reissues its handle and invalidates the old handle.
- Allow the human to switch Blue role in the lobby or between rounds; the other Blue player takes the opposite role.
- Keep players in fixed physical positions while aligning roles by column: both left players match the human's role and both right players take the opposite role.
- Ensure player state returned to an agent always includes its current name, team, and role.

## Acceptance

- Refresh restores the same four roster positions.
- New Round and New Game do not clear registrations.
- Same-name recovery works.
- Human role changes update both teams' role labels, do not move player cards, and do not occur during an active turn.
