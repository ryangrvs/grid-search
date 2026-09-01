# SemanticSpy

SemanticSpy is a local, cooperative word-association game where a human and an AI agent work together across a 5×5 board.

It is a small demonstration of **WebMCP** capabilities: the web app exposes typed tools that let the agent read the live board, give clues, and make guesses.

```sh
npm install
npm run dev
```

Idle/wake functionality is on the roadmap, but is currently blocked by the lack of a reliable supported way to wake an existing Codex desktop thread while preserving access to the same browser WebMCP session.
