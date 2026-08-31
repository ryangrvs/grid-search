# Waking a Codex agent from the web app

Date: 2026-08-31. Status: parked; no wakeup integration implemented during this investigation.

## Intended flow

The agent registers its Codex `threadId` with SemanticSpy. When the human clicks **End Turn**, the app prompts that task to read the board and play using WebMCP.

## What we learned

- **An external turn can appear in the existing desktop task.** After fixing executable selection, the user successfully ran `initialize`, `initialized`, `thread/resume`, and a hello-world `turn/start` from a terminal. They reported that both the prompt and response appeared immediately in the intended desktop task. This establishes conversation continuity and desktop visibility in this setup, not attachment to the same live agent process. It improves on the older visibility limitation reported in [issue #33650](https://github.com/openai/codex/issues/33650). [App Server docs](https://learn.chatgpt.com/docs/app-server).
- **Direct browser WebSocket access failed our tests.** Handshakes containing browser-style `Origin` headers returned `403`; a native client without that header connected successfully. Browser JavaScript cannot simply omit that header. Starting App Server with `--listen ws://127.0.0.1:4500` does not remove this restriction. [App Server transport documentation](https://learn.chatgpt.com/docs/app-server).
- **The native WebSocket hello-world rerun was blocked before prompting.** Using desktop-bundled Codex 0.151.0-alpha.7.2, the WebSocket handshake, `initialize`, and `thread/read` succeeded. `thread/resume` returned an active-writer conflict; an existing terminal stdio server was still running, although its ownership was not independently established. No `turn/start` was sent, so desktop visibility of a WebSocket-started turn remains untested. The temporary WebSocket server was stopped.
- **Ownership appears exclusive, but can return to the desktop.** Initial resume attempts hit another process's writer lock. In the user's successful test, the desktop displayed a warning approximately saying the task was open in another app and must be closed to continue. Stopping the terminal App Server restored normal desktop interaction. This is consistent with temporary ownership by the external process; reliable automatic coordination remains untested. [Related ownership report #37450](https://github.com/openai/codex/issues/37450).
- **Browser/WebMCP access failed in the follow-up test.** Asked to inspect another site's tools, the externally started agent reported that browser support was installed but its connector returned “No browser is available.” This is the agent's explanation supplied by the user, not an independently inspected connector trace. It indicates that tool availability alone did not provide an attached browser session in this run. Reusing the task ID and desktop-bundled executable was insufficient; it does not prove that every possible attachment method is unsupported. The report also listed other connected tools, so this was not evidence that all MCP access failed. [Browser docs](https://learn.chatgpt.com/docs/browser?surface=app).

## The practical alternative

`Browser → authenticated local helper → App Server over stdio`

The helper would run on each player's computer, requiring a startup command or companion app, rather than a cloud server per player. It would need explicit pairing, authentication, allowed website origins, and narrowly scoped actions. This addresses prompt delivery, not browser-session attachment. Game tools would need a working browser connection or another interface, such as a conventional MCP server; the latter would change the original WebMCP-only design.

The inspected [codex-mobile implementation](https://github.com/friuns2/codex-mobile/tree/fac2291b0e606c869d4760f56c0f49172214cb79) follows this pattern: browser requests reach its Node backend, which launches App Server and exchanges JSON over stdin/stdout. Its browser WebSocket connects to that backend, not directly to Codex.

[0xcaff/codex-web](https://github.com/0xcaff/codex-web) is another relevant implementation. Its [architecture](https://github.com/0xcaff/codex-web/blob/main/ARCHITECTURE.md) adapts the desktop Electron app using patches and shims, with browser messages carried over WebSocket to a Node-hosted IPC bridge. The backend runs on a machine the user controls; it can also proxy to a separately running App Server through a Unix socket. Its README specifies loopback binding by default and requires authentication/access controls to be supplied externally before broader access. Browser panel support is still listed as unfinished, so this is not evidence that it solves our WebMCP attachment problem. Documentation reviewed only; not installed or tested. [Usage, security, and roadmap](https://github.com/0xcaff/codex-web#usage).

## Decision and security takeaway

Leave this integration parked. Allowing arbitrary websites to prompt a local agent could expose its files, tools, and credentials, so unrestricted browser access would be dangerous. This does **not** establish that browser integration will never be allowed: an explicitly authorized, carefully scoped integration is a different design. External prompting and desktop visibility worked, but browser access failed in the follow-up test. Reliable ownership coordination and access to the game tools remain unresolved.
