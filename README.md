# SemanticSpy

SemanticSpy is a local-first word-association game displayed as **Grid Search** in the UI. A human and one to three AI agents play Co-op or Blue-versus-Red matches across a 5×5 board.

It is a small demonstration of **WebMCP** capabilities: the web app exposes typed tools that let agents register, read their role-filtered state, give clues, make guesses, and end turns. The UI and tools share browser-owned state persisted in `localStorage`; same-origin tabs synchronize through storage events with polling as a fallback.

```sh
npm install
npm run dev
```

The production build is static (`npm run build`); no backend or application server is needed. The remaining education/outcome UI and full live-match verification work are tracked as Issues 007 and 008 in `docs/PLAN.md`.
