# Issue 000A: Persist Browser Game State

Status: complete

Depends on: Issue 000

Blocks: Issues 004–008

## Outcome

Refreshing the page restores one coherent local game session: roster, handles, board, hidden key, clues, guesses, scores, turn, phase, status, and history.

## Design

- Store one versioned JSON snapshot under `semanticspy.state.v1`.
- Make `GameController` the persistence seam and the only module responsible for loading and saving the complete snapshot.
- Use `LocalStorageStateStore` in the browser and `MemoryStateStore` in tests.
- Keep Game and Roster focused on domain behavior; they expose validated snapshot/restore behavior without writing storage independently.
- Save after every successful controller mutation.
- Treat an absent, invalid, or unsupported snapshot as a fresh game and roster.

## Persisted state

- Fixed roster seats, players, roles, and opaque handles.
- Game ID and revision.
- Words, alignments, and revealed state.
- Human role, turn, phase, and game status.
- Current clue, turn guesses, and remaining guesses.
- Scores, action history, and last action.

Do not persist transient UI state such as open modals, form drafts, animations, busy/error state, or polling state. Do not restore the agent's fresh-read authorization: after refresh, an agent must read state again before mutating it.

## Acceptance

- Refresh restores the same roster, words, key, reveals, clue, remaining guesses, turn, scores, status, and history.
- UI and WebMCP continue to share the restored `GameController` instance.
- Every successful registration, role change, clue, guess, end turn, New Round, and New Game updates the snapshot.
- Clearing `semanticspy.state.v1` starts a completely fresh game and registration lobby.
- Corrupt or unknown-version state safely falls back to a fresh session.
- Tests cover round-trip restoration and the fresh-read requirement after restoration.
- The static production build succeeds.
