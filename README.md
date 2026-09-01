# SemanticSpy

SemanticSpy is a local, cooperative word-association game where a human and an AI agent work together across a 5×5 board.

It is a small demonstration of **WebMCP** capabilities: the web app exposes typed tools that let the agent read the live board, give clues, and make guesses. The UI and tools share one browser-owned controller, and the roster is persisted locally in `localStorage`.

```sh
npm install
npm run dev
```

The production build is static (`npm run build`); no backend or application server is needed.
