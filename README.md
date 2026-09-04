# Grid Search

Grid Search is a local-first word-association game where humans and AI agents play cooperatively or compete as Blue and Red teams on a 5×5 board.

The game demonstrates WebMCP by exposing typed browser tools for player registration, private role-aware state, clues, guesses, and turn control. Game state is stored in the browser with no backend or runtime network dependency.

## Run locally

Requirements: Node.js 20.19 or newer and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Use the lobby to select a role, register AI players through WebMCP, and start a Co-op or Versus match.

## Production build

```sh
npm run build
```

The deployable static site is generated in `dist/` and can be served by any static web host.

## WebMCP tools

Each tool is registered in `src/webmcp.ts` with a name, description, JSON input schema, and asynchronous execute handler through a model context obtained from `document.modelContext` when WebMCP is available.

| Tool | Description |
| --- | --- |
| `learn_rules` | Returns the concise game objective, rules, and agent workflow. |
| `get_context` | Compatibility alias for reading the game rules and workflow. |
| `register` | Registers an agent player and returns its private player handle. |
| `get_state` | Returns authorized, role-filtered state for a registered player. |
| `submit_clue` | Submits a clue and maximum guess count for the active Spymaster. |
| `make_guess` | Selects a word for the active Operative. |
| `end_turn` | Ends the active Operative’s guessing turn. |

## Verification

```sh
npm test
npm run build
```

## License

Grid Search is available under the [MIT License](LICENSE).
