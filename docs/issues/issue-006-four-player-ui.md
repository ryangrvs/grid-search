# Issue 006: Four-Player Board UI

Status: planned

Depends on: Issues 003 and 004

## Outcome

The registered 2×2 roster follows the players into a readable four-position game layout.

## Scope

- Keep the human top-left and the other Blue player top-right.
- Place Red players bottom-left and bottom-right.
- Preserve physical player positions across rounds while role labels may change.
- Align roles vertically: the Red player matching the human's role is bottom-left and the opposite role is bottom-right.
- Polish the lobby and player cards beyond the functional Issue 002 layout.
- Show controller icon, team color, display name, and current role.
- Add a clear active-player treatment using team color.
- Adapt the four positions for narrow screens without shrinking the word board excessively.
- Keep clue and guess feedback working with four players.

## Acceptance

- All four players remain visually associated with the board.
- Role changes update labels without moving people.
- Exactly one active player is visually clear.
- Existing board interaction remains usable on desktop and a narrow viewport.
