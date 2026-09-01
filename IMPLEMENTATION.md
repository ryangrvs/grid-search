# SemanticSpy integration contract

Local Node 24 + TypeScript + Vite vanilla TS. One cooperative Blue partnership: human and agent have opposite fixed roles per match; default human operative, agent spymaster. Optional human spymaster match. Red is a hazard, not another player. 9 blue, 8 red, 7 innocent, 1 assassin. Win all blue; assassin loses; red/innocent ends guessing; exactly clue.count maximum guesses, no bonus/carryover. End turn returns to spymaster. No role rotation leaking previously seen keys. Terminal views expose the key, while cards.revealed continues to mean actually guessed.

## Implementation responsibilities
- Luna High engine agent: shared/types.ts, server/game.ts, tests/game.test.ts.
- Luna High UI agent: index.html, src/main.ts, src/style.css, src/webmcp.ts, tests/webmcp.test.ts.
- Luna High transport agent: src/codex.ts, tests/codex.test.ts.
- Orchestrator: HTTP/MCP integration, schemas/validation, build tooling, documentation, review fixes, and integration checks. The requested Terra fallback could not start because the task's total agent limit had been reached.

## Shared HTTP contract
Server 127.0.0.1:4310; Vite 127.0.0.1:5174 proxies /api and /mcp. Production serves dist. Port 5173 was already occupied by an unrelated local server, which is left untouched.
GET /api/bootstrap -> {humanToken, agentToken, threadId: string|null, wsUrl: 'ws://127.0.0.1:4500'}; only same-origin browser requests/loopback hosts accepted. Tokens random per server start, never log them. Current thread from CODEX_THREAD_ID env, no hardcoded personal IDs.
GET /api/board: humanToken bearer -> human authorized view.
GET /api/agent/board: agentToken bearer -> agent authorized view and records read at current revision; require fresh agent read before EACH agent mutation (server enforcement).
POST /api/action: humanToken bearer, body {type:'submit_clue',clue,count} | {type:'make_guess',word} | {type:'end_turn'} -> Board.
POST /api/agent/action: agentToken bearer, same body -> Board.
POST /api/new: humanToken bearer, {humanRole:'operative'|'spymaster'} -> Board. Deals 25 words with no overlap against immediately prior board.
POST /api/next-round: humanToken bearer, same role body -> Board. Keeps current 25 words, shuffles positions/key, clears progress and stale agent read, assigns a new game ID.
GET /api/lobby and GET /api/agent/lobby: current four fixed seats with public Player identity fields (displayName, controller, team, role); handles stay internal.
POST /api/role: humanToken bearer, {humanRole} -> Lobby; role changes are rejected while a round is active.
Roster persistence: the standalone server stores fixed seats, player identities, roles, and opaque handles in local `.semanticspy-roster.json`; New Round/New Game retain it and same-name registration rotates the handle.
Every error non-2xx {error:string}. No public secret board leak. In-memory game lifetime documented, tokens never in persisted browser storage.

## Board DTO (shared/types.ts)
export type Role = 'spymaster'|'operative';
export type Actor = 'human'|'agent';
export type Alignment = 'blue'|'red'|'innocent'|'assassin';
export interface Board {id:string; revision:number; cards:Array<{word:string; revealed:boolean; alignment?:Alignment}>; humanRole:Role; agentRole:Role; turn:Actor; phase:'clue'|'guess'; status:'playing'|'won'|'lost'; clue:{word:string;count:number}|null; guessesRemaining:number; scores:{blue:number;red:number;blueTotal:number;redTotal:number}; log:Array<{id:number;text:string}>; lastAction:string;}
export type Action = {type:'submit_clue';clue:string;count:number}|{type:'make_guess';word:string}|{type:'end_turn'};
Server exports typed strict JSON schemas for tools via GET /api/schemas, shape {get_board,submit_clue,make_guess,end_turn} each is an input JSON Schema. get_board args {} only: role is server-authenticated, not selected by caller.

## WebMCP
Use document.modelContext (current Codex official example), optional navigator.modelContext compatibility. Register get_board, submit_clue, make_guess, end_turn with strict schemas. get_board calls agent board endpoint, exposing semanticspy://game/board in result wrapper {uri,board}. Other tools POST agent actions and refresh HUMAN view, never render agent secret view. All state-changing tools require prior fresh board read. Feature detection, unsupported status, no fabricated success. MCP endpoint exposes real resources/read and tools/call using same engine, resource role=spymaster only authorized if agent actually spymaster; secret capability query optional authenticated token validation, not role string alone.

## Codex transport module public API
export interface CodexConfig { wsUrl:string; threadId:string; protocol:'current'|'legacy'; }
export class CodexClient { constructor(onStatus?:(status:string)=>void); wake(config:CodexConfig, instructions:string):Promise<void>; disconnect():void; }
Default current initialize -> initialized -> thread/read to check existing thread idle (never create/fork); thread/resume only if not loaded -> turn/start {threadId,input:[{type:'text',text:instructions}]}.
Explicit legacy compatibility option session/createTurn {sessionId:threadId,instructions}, clearly unverified; no silent fallback. WebSocket browser direct to loopback only. Correlate requests, timeout, reject unknown outcome without automatic retry, refuse active thread. Keep connection listening for notifications. Never auto-approve server requests. Tests with mock websocket, never wake real thread during implementation.

## UI
Minimal 5x5, Blue progress, hazards, role selector new game (confirm reset), clue entry if human spymaster, human guessing if operative, End Turn, log, collapsed connection config. Save only connection config in localStorage. Capture sessionId/threadId from URL or bootstrap. Default autowake OFF until user enables (prevent recursive development turn). When enabled: once per {gameId,revision} where turn agent, wake after human action/end or initial start. Persist acknowledged wake ID to avoid reload duplicate; unknown outcome no automatic retry. Explicit wake/retry button with caution. Prompt tells agent to read get_board first and use only legal WebMCP moves, do not use filesystem/server internals/DOM to find secrets. Multiple guesses allowed until human turn; get_board before each move. No reset from WebMCP.

## Verification
Vitest unit/integration tests, tsc + Vite build. No remote deployment, GitHub writes or real agent turn submissions. Keep current Git identity.
