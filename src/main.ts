/// <reference types="vite/client" />

import botIcon from './assets/bot.svg?raw';
import userIcon from './assets/user.svg?raw';
import type { Action, Board, Lobby, Role } from '../shared/types';
import { actionTitle, cardPresentation } from './board-view';
import { registerWebMCP } from './webmcp';
import './style.css';

interface Bootstrap {
  humanToken: string;
  agentToken: string;
}

const root = document.querySelector<HTMLElement>('#app');

function inlineIcon(raw: string, label: string): string {
  return raw.replace('<svg ', `<svg class="avatar-icon" role="img" aria-label="${label}" `);
}

const botIconMarkup = inlineIcon(botIcon, 'Agent');
const userIconMarkup = inlineIcon(userIcon, 'You');

async function jsonRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error(`Server returned ${response.status} with invalid JSON`); }
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
      ? data.error : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data as T;
}

async function bootstrap(): Promise<Bootstrap> {
  const response = await fetch('/api/bootstrap');
  if (!response.ok) throw new Error(`Bootstrap failed (${response.status})`);
  return response.json() as Promise<Bootstrap>;
}

class SemanticSpyApp {
  private board: Board | null = null;
  private lobby: Lobby | null = null;
  private bootstrapData: Bootstrap | null = null;
  private lobbyOpen = false;
  private busy = false;
  private errorMessage = '';
  private mcpMessage = 'Checking WebMCP support…';
  private previousRevealed = new Set<string>();
  private allowRevealAnimation = false;
  private suppressNextRevealAnimation = false;

  constructor(private readonly container: HTMLElement) {}

  async start(): Promise<void> {
    try {
      this.bootstrapData = await bootstrap();
      this.mountShell();
      await this.refreshHumanBoard();
      await this.refreshLobby();
      const registration = await registerWebMCP({
        agentToken: this.bootstrapData.agentToken,
        refreshHumanBoard: async () => { await this.refreshHumanBoard(); await this.refreshLobby(); },
      });
      this.mcpMessage = registration.supported
        ? 'WebMCP tools ready for the agent.'
        : registration.reason || 'WebMCP unavailable in this browser.';
      window.setInterval(() => { void this.pollBoard(); void this.pollLobby(); }, 2500);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not connect to the local game.';
      this.mountShell();
      this.render();
    }
  }

  private mountShell(): void {
    this.container.innerHTML = `
      <header class="topbar">
        <div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="brand-name">SemanticSpy</span></div>
      </header>
      <div class="game-shell">
        <section class="playing-region" aria-label="SemanticSpy playing area">
          <div class="participants-row">
            <div class="participant participant-agent" data-actor="agent">
              <div class="participant-main"><div class="avatar avatar-agent">${botIconMarkup}</div><div class="participant-copy"><span class="participant-name">Agent</span><span class="participant-role" id="agentRole">Spymaster</span></div></div>
              <div class="clue-callout clue-callout-left" id="agentClue" aria-live="polite"></div>
            </div>
            <div class="participant participant-human" data-actor="human">
              <div class="participant-main"><div class="participant-copy participant-copy-right"><span class="participant-name">You</span><span class="participant-role" id="humanRole">Operative</span></div><div class="avatar avatar-human">${userIconMarkup}</div></div>
              <div class="clue-callout clue-callout-right" id="humanClue" aria-live="polite"></div>
            </div>
          </div>
          <div id="boardGrid" class="board-grid" aria-label="SemanticSpy word cards"></div>
          <div class="scorebar" aria-label="Team score">
            <div class="score-team score-team-blue"><div id="blueSquares" class="score-squares" aria-label="Blue words remaining"></div><span class="score-copy"><strong id="blueScore">—</strong><small>Blue words</small></span></div>
            <div class="score-team score-team-red"><span class="score-copy score-copy-right"><strong id="redScore">—</strong><small>Red words</small></span><div id="redSquares" class="score-squares" aria-label="Red words remaining"></div></div>
          </div>
          <div class="board-meta-row"><span id="boardMeta" class="small">Waiting for board…</span><span id="gameStatus" class="game-status" hidden></span></div>
        </section>
        <section class="below-board" aria-label="Game controls">
          <section class="panel action-panel"><div class="section-head"><h2 id="actionTitle">Your turn</h2><span id="phaseLabel" class="small">—</span></div><div id="actionBody" class="action-body"></div></section>
          <div class="utility-grid">
            <section class="panel utility-panel"><div class="utility-status"><span id="rolePill" class="role-pill">Role —</span></div><div class="section-head"><h2>New round</h2></div><p class="hint">Keep the words or deal a fresh field.</p><div class="field"><label for="roleSelect">Your role</label><select id="roleSelect"><option value="operative">Operative</option><option value="spymaster">Spymaster</option></select></div><div class="reset-actions"><button id="nextRound" class="button secondary">Next Round</button><button id="newGame" class="button">New Game</button></div><p class="reset-help"><strong>Next Round</strong> keeps these words. <strong>New Game</strong> deals fresh words.</p><p id="mcpMessage" class="notice"></p></section>
            <section class="panel history-panel"><div class="section-head"><h2>Move history</h2></div><div id="log" class="log"></div></section>
          </div>
        </section>
      </div>
      <div id="lobbyModal" class="lobby-modal" role="dialog" aria-modal="true" aria-labelledby="lobbyTitle" hidden>
        <div class="lobby-dialog">
          <div class="section-head"><h2 id="lobbyTitle">New Game</h2><button id="closeLobby" class="icon-button" type="button" aria-label="Close lobby">×</button></div>
          <p class="hint">Register agents into the four seats before starting a match.</p>
          <div id="lobbyGrid" class="lobby-grid" aria-label="Player registration lobby"></div>
          <div class="field"><label for="lobbyRoleSelect">Your Blue role</label><select id="lobbyRoleSelect"><option value="operative">Operative</option><option value="spymaster">Spymaster</option></select></div>
          <div class="lobby-actions"><button id="startCoop" class="button" type="button" disabled>Start Co-op</button><button id="startVersus" class="button secondary" type="button" disabled>Start Versus</button></div>
          <p id="lobbyMessage" class="notice" aria-live="polite"></p>
        </div>
      </div>
      <p id="errorMessage" class="notice error" role="alert" aria-live="assertive"></p>`;
    this.bindShellEvents();
    this.render();
  }

  private bindShellEvents(): void {
    this.container.querySelector<HTMLButtonElement>('#newGame')?.addEventListener('click', () => { void this.newGame(); });
    this.container.querySelector<HTMLButtonElement>('#nextRound')?.addEventListener('click', () => { void this.nextRound(); });
    this.container.querySelector<HTMLButtonElement>('#closeLobby')?.addEventListener('click', () => { this.lobbyOpen = false; this.render(); });
    this.container.querySelector<HTMLButtonElement>('#startCoop')?.addEventListener('click', () => { void this.startLobby('co-op'); });
    this.container.querySelector<HTMLButtonElement>('#startVersus')?.addEventListener('click', () => { void this.startLobby('versus'); });
  }

  private async refreshHumanBoard(): Promise<void> {
    if (!this.bootstrapData) return;
    const next = await jsonRequest<Board>('/api/board', this.bootstrapData.humanToken);
    const previous = this.board;
    const changed = !previous || previous.id !== next.id || previous.revision !== next.revision;
    if (!changed) return;
    const newGame = !previous || previous.id !== next.id;
    this.allowRevealAnimation = !newGame && !this.suppressNextRevealAnimation;
    this.suppressNextRevealAnimation = false;
    this.board = next;
    this.errorMessage = '';
    if (newGame) this.previousRevealed.clear();
    // Polling should not wipe a clue/guess draft while the server revision is unchanged.
    this.render();
  }

  private async pollBoard(): Promise<void> {
    if (this.busy || !this.bootstrapData) return;
    try { await this.refreshHumanBoard(); } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Board refresh failed';
      this.render();
    }
  }

  private async refreshLobby(): Promise<void> {
    if (!this.bootstrapData) return;
    this.lobby = await jsonRequest<Lobby>('/api/lobby', this.bootstrapData.humanToken);
    this.renderLobby();
  }

  private async pollLobby(): Promise<void> {
    if (this.busy || !this.bootstrapData) return;
    try { await this.refreshLobby(); } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Lobby refresh failed';
      this.render();
    }
  }

  private async humanAction(action: Action): Promise<void> {
    if (!this.bootstrapData || this.busy || !this.board || this.board.status !== 'playing') return;
    this.busy = true; this.errorMessage = ''; this.render();
    try {
      await jsonRequest<Board>('/api/action', this.bootstrapData.humanToken, { method: 'POST', body: JSON.stringify(action) });
      await this.refreshHumanBoard();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Action failed';
      this.render();
    } finally { this.busy = false; this.render(); }
  }

  private async newGame(): Promise<void> {
    this.lobbyOpen = true;
    try {
      await this.refreshLobby();
      const roleSelect = this.container.querySelector<HTMLSelectElement>('#lobbyRoleSelect');
      if (roleSelect && this.board) roleSelect.value = this.board.humanRole;
    } catch (error) { this.errorMessage = error instanceof Error ? error.message : 'Could not load the lobby.'; }
    this.render();
  }

  private async startLobby(mode: 'co-op' | 'versus'): Promise<void> {
    if (!this.lobby || (mode === 'co-op' && !this.lobby.canStartCoop) || (mode === 'versus' && !this.lobby.canStartVersus)) return;
    this.lobbyOpen = false;
    const roleSelect = this.container.querySelector<HTMLSelectElement>('#lobbyRoleSelect');
    await this.resetGame('/api/new', `Start ${mode}`, 'Deal a completely fresh field of 25 words? The current match will be replaced.', roleSelect?.value);
  }

  private async nextRound(): Promise<void> {
    await this.resetGame('/api/next-round', 'Next Round', 'Start a new key with the same 25 words? The current round will end.');
  }

  private async resetGame(path: string, _label: string, confirmation: string, selectedRole?: string): Promise<void> {
    if (!this.bootstrapData || this.busy) return;
    const role = (selectedRole ?? this.container.querySelector<HTMLSelectElement>('#roleSelect')?.value) === 'spymaster' ? 'spymaster' : 'operative';
    if (!window.confirm(confirmation)) return;
    this.busy = true;
    try {
      this.suppressNextRevealAnimation = true;
      await jsonRequest<Board>(path, this.bootstrapData.humanToken, { method: 'POST', body: JSON.stringify({ humanRole: role }) });
      await this.refreshHumanBoard();
    } catch (error) { this.suppressNextRevealAnimation = false; this.errorMessage = error instanceof Error ? error.message : 'Could not start a new match.'; }
    finally { this.busy = false; this.render(); }
  }

  private render(): void {
    if (!this.container.querySelector('#boardGrid')) return;
    const board = this.board;
    const role = this.container.querySelector('#rolePill');
    const status = this.container.querySelector('#gameStatus');
    if (role) role.textContent = board ? `You: ${board.humanRole}` : 'Role —';
    if (status) {
      const outcome = board?.status === 'won' ? 'Blue wins' : board?.status === 'lost' ? 'Game over' : '';
      status.textContent = outcome;
      status.toggleAttribute('hidden', !outcome);
    }
    const actionHeading = this.container.querySelector('#actionTitle'); if (actionHeading) actionHeading.textContent = board ? actionTitle(board) : 'Your turn';
    const phase = this.container.querySelector('#phaseLabel'); if (phase) phase.textContent = board ? board.phase : '—';
    const meta = this.container.querySelector('#boardMeta'); if (meta) meta.textContent = !board ? 'Waiting for board…' : board.status !== 'playing' ? 'Round complete' : board.phase === 'clue' ? 'Awaiting clue' : `${board.guessesRemaining} guess${board.guessesRemaining === 1 ? '' : 'es'} left`;
    this.renderScores();
    this.renderParticipants();
    this.renderGrid(); this.renderLog(); this.renderAction(); this.renderControls();
    this.renderLobby();
    const error = this.container.querySelector('#errorMessage'); if (error) error.textContent = this.errorMessage;
    const mcp = this.container.querySelector('#mcpMessage'); if (mcp) mcp.textContent = this.mcpMessage;
  }

  private renderScores(): void {
    const board = this.board;
    const blue = this.container.querySelector('#blueScore');
    const red = this.container.querySelector('#redScore');
    if (blue) blue.textContent = board ? `${board.scores.blue} / ${board.scores.blueTotal}` : '—';
    if (red) red.textContent = board ? `${board.scores.red} / ${board.scores.redTotal}` : '—';
    const renderSquares = (target: Element | null, found: number, total: number, color: string, label: string): void => {
      if (!target) return;
      target.replaceChildren();
      target.setAttribute('aria-label', board ? `${label}: ${found} of ${total} found` : label);
      for (let index = 0; index < total; index += 1) {
        const square = document.createElement('span');
        square.className = `score-square ${color}${index < found ? ' is-found' : ''}`;
        square.setAttribute('aria-hidden', 'true');
        target.append(square);
      }
    };
    renderSquares(this.container.querySelector('#blueSquares'), board?.scores.blue ?? 0, board?.scores.blueTotal ?? 9, 'blue', 'Blue words');
    renderSquares(this.container.querySelector('#redSquares'), board?.scores.red ?? 0, board?.scores.redTotal ?? 8, 'red', 'Red words');
  }

  private renderParticipants(): void {
    const board = this.board;
    const agentRole = this.container.querySelector('#agentRole');
    const humanRole = this.container.querySelector('#humanRole');
    if (agentRole) agentRole.textContent = board?.agentRole === 'spymaster' ? 'Spymaster' : 'Operative';
    if (humanRole) humanRole.textContent = board?.humanRole === 'spymaster' ? 'Spymaster' : 'Operative';

    const activeTurn = (actor: 'agent' | 'human'): boolean => Boolean(board?.status === 'playing' && board.turn === actor);
    this.container.querySelector('.avatar-agent')?.classList.toggle('is-active', activeTurn('agent'));
    this.container.querySelector('.avatar-human')?.classList.toggle('is-active', activeTurn('human'));

    const agentClue = this.container.querySelector<HTMLElement>('#agentClue');
    const humanClue = this.container.querySelector<HTMLElement>('#humanClue');
    const activeGuess = board?.status === 'playing' && board.phase === 'guess' && board.clue
      ? board.turnGuesses.filter((guess) => guess.actor === board.turn)
      : [];
    if (agentClue) {
      agentClue.classList.remove('is-form');
      agentClue.replaceChildren();
      if (board?.agentRole === 'spymaster' && board.clue) {
        this.renderClueBubble(agentClue, board.clue.word, board.clue.count, board.status === 'playing' && board.phase === 'guess' ? 'Agent clue' : 'Previous clue');
      } else if (board?.agentRole === 'operative' && board.turn === 'agent' && activeGuess.length && board.clue) {
        this.renderGuessBubble(agentClue, activeGuess.at(-1)?.word ?? '', activeGuess.length, board.clue.count);
      }
    }
    if (humanClue) {
      const calloutVersion = board ? `${board.id}:${board.revision}` : '';
      const preserveDraft = humanClue.dataset.calloutVersion === calloutVersion;
      const previousClue = preserveDraft ? humanClue.querySelector<HTMLInputElement>('#clue')?.value ?? '' : '';
      const previousCount = preserveDraft ? humanClue.querySelector<HTMLInputElement>('#count')?.value ?? '1' : '1';
      humanClue.dataset.calloutVersion = calloutVersion;
      humanClue.classList.remove('is-form');
      humanClue.replaceChildren();
      if (board?.humanRole === 'spymaster' && board.clue && !(board.turn === 'human' && board.phase === 'clue')) {
        this.renderClueBubble(humanClue, board.clue.word, board.clue.count, board.status === 'playing' && board.phase === 'guess' ? 'Your clue' : 'Previous clue');
      } else if (board?.humanRole === 'spymaster' && board.status === 'playing' && board.turn === 'human' && board.phase === 'clue') {
        this.renderHumanClueForm(humanClue, previousClue, previousCount);
      } else if (board?.humanRole === 'operative' && board.turn === 'human' && activeGuess.length && board.clue) {
        this.renderGuessBubble(humanClue, activeGuess.at(-1)?.word ?? '', activeGuess.length, board.clue.count);
      }
    }
  }

  private renderClueBubble(target: HTMLElement, word: string, count: number, label: string): void {
    const bubble = document.createElement('div'); bubble.className = 'speech-bubble clue-bubble';
    const kicker = document.createElement('span'); kicker.className = 'clue-kicker'; kicker.textContent = label;
    const wordNode = document.createElement('span'); wordNode.className = 'clue-word'; wordNode.textContent = word;
    const divider = document.createElement('span'); divider.className = 'bubble-divider'; divider.setAttribute('aria-hidden', 'true'); divider.textContent = '—';
    const countNode = document.createElement('span'); countNode.className = 'clue-count'; countNode.textContent = String(count);
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-label', `${label}: ${word}, clue count ${count}`);
    countNode.setAttribute('aria-label', `Clue count ${count}`);
    bubble.append(kicker, wordNode, divider, countNode);
    target.append(bubble);
  }

  private renderGuessBubble(target: HTMLElement, word: string, progress: number, total: number): void {
    const bubble = document.createElement('div'); bubble.className = 'speech-bubble guess-bubble';
    const wordNode = document.createElement('span'); wordNode.className = 'clue-word'; wordNode.textContent = word;
    const divider = document.createElement('span'); divider.className = 'bubble-divider'; divider.setAttribute('aria-hidden', 'true'); divider.textContent = '—';
    const progressNode = document.createElement('span'); progressNode.className = 'clue-count guess-progress'; progressNode.textContent = `${progress}/${total}`;
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-label', `${word}, guess ${progress} of ${total}`);
    bubble.append(wordNode, divider, progressNode);
    target.append(bubble);
  }

  private renderHumanClueForm(target: HTMLElement, draft = '', countDraft = '1'): void {
    target.classList.add('is-form');
    const form = document.createElement('form'); form.id = 'clueForm'; form.className = 'clue-form speech-bubble clue-bubble';
    const wordBubble = document.createElement('span'); wordBubble.className = 'clue-word-bubble clue-word-entry';
    const clueLabelNode = document.createElement('label'); clueLabelNode.className = 'sr-only'; clueLabelNode.htmlFor = 'clue'; clueLabelNode.textContent = 'Clue word';
    const clue = document.createElement('input'); clue.id = 'clue'; clue.name = 'clue'; clue.maxLength = 40; clue.autocomplete = 'off'; clue.placeholder = 'One word'; clue.value = draft;
    wordBubble.append(clueLabelNode, clue);
    const countBubble = document.createElement('label'); countBubble.className = 'clue-count clue-count-entry'; countBubble.htmlFor = 'count'; countBubble.setAttribute('aria-label', 'Clue count');
    const count = document.createElement('input'); count.id = 'count'; count.name = 'count'; count.type = 'number'; count.min = '1'; count.max = '9'; count.inputMode = 'numeric'; count.value = countDraft || '1'; count.setAttribute('aria-label', 'Clue count');
    countBubble.append(count);
    const divider = document.createElement('span'); divider.className = 'bubble-divider'; divider.setAttribute('aria-hidden', 'true'); divider.textContent = '—';
    const submit = document.createElement('button'); submit.className = 'clue-submit'; submit.type = 'submit'; submit.textContent = 'Send';
    clue.disabled = this.busy; count.disabled = this.busy; submit.disabled = this.busy;
    form.setAttribute('role', 'group'); form.setAttribute('aria-label', 'Enter clue and count');
    form.append(wordBubble, divider, countBubble, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = clue.value.trim(); const number = Number(count.value);
      if (value && Number.isInteger(number) && number > 0) void this.humanAction({ type: 'submit_clue', clue: value, count: number });
    });
    target.append(form);
  }

  private renderGrid(): void {
    const grid = this.container.querySelector('#boardGrid'); if (!grid) return;
    const boardVersion = this.board ? `${this.board.id}:${this.board.revision}` : '';
    if (grid.getAttribute('data-board-version') === boardVersion) {
      // Busy state changes without a board revision. Keep the card DOM (and its
      // reveal animation) but update whether operative guesses can be clicked.
      if (this.board) {
        const canGuess = this.board.status === 'playing' && this.board.turn === 'human' && this.board.humanRole === 'operative' && this.board.phase === 'guess';
        grid.querySelectorAll<HTMLButtonElement>('.card').forEach((button, index) => {
          const card = this.board?.cards[index];
          button.disabled = !canGuess || this.busy || Boolean(card?.revealed);
          if (canGuess && !button.dataset.guessBound && card && !card.revealed) {
            button.dataset.guessBound = 'true';
            button.addEventListener('click', () => { void this.humanAction({ type: 'make_guess', word: card.word }); });
          }
        });
      }
      return;
    }
    grid.setAttribute('data-board-version', boardVersion);
    grid.replaceChildren();
    if (!this.board) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'The board is not available.'; grid.append(empty); return; }
    for (const card of this.board.cards) {
      const presentation = cardPresentation(this.board, card, this.previousRevealed, this.allowRevealAnimation);
      const button = document.createElement('button'); button.className = `card ${presentation.tone}`; button.type = 'button';
      button.append(document.createTextNode(card.word));
      button.setAttribute('aria-label', presentation.badge ? `${card.word} — ${presentation.badge}` : card.word);
      if (presentation.badge) button.title = presentation.badge;
      if (presentation.alignment) button.classList.add(presentation.alignment);
      if (presentation.animate) button.classList.add('newly-revealed');
      const canGuess = this.board.status === 'playing' && this.board.turn === 'human' && this.board.humanRole === 'operative' && this.board.phase === 'guess' && !card.revealed;
      button.disabled = !canGuess || this.busy;
      if (canGuess) {
        button.dataset.guessBound = 'true';
        button.addEventListener('click', () => { void this.humanAction({ type: 'make_guess', word: card.word }); });
      }
      grid.append(button);
    }
    this.previousRevealed = new Set(this.board.cards.filter((card) => card.revealed).map((card) => card.word));
    this.allowRevealAnimation = false;
  }

  private renderAction(): void {
    const body = this.container.querySelector<HTMLElement>('#actionBody'); if (!body) return;
    const board = this.board;
    if (!board) { body.innerHTML = '<p class="hint">Connect to the local server to begin.</p>'; return; }
    const actionVersion = `${board.id}:${board.revision}:${board.turn}:${board.phase}:${board.humanRole}`;
    const preserveGuess = body.dataset.actionVersion === actionVersion;
    const previousGuess = body.querySelector<HTMLInputElement>('#guess')?.value ?? '';
    body.dataset.actionVersion = actionVersion;
    if (board.status !== 'playing') { body.innerHTML = `<p class="hint">Match ${board.status}. Choose Next Round or New Game to play again.</p>`; return; }
    if (board.turn === 'agent') { body.innerHTML = '<p class="hint">Waiting for the agent to make its legal move. Updates will appear in the history.</p>'; return; }
    if (board.humanRole === 'spymaster' && board.phase === 'clue') {
      body.innerHTML = '<p class="hint">Enter a one-word clue and count in the callout beside your avatar.</p>';
      return;
    }
    if (board.humanRole === 'operative' && board.phase === 'guess') {
      body.innerHTML = '<p id="clueDisplay" class="hint"></p><p class="hint">Select a card above, or type its exact word.</p><form id="guessForm" class="guess-form"><div class="field"><label for="guess">Exact word</label><input id="guess" name="guess" autocomplete="off" /></div><button id="submitGuess" class="button" type="submit">Guess</button></form><div class="action-row"><button id="endTurn" class="button secondary" type="button">End turn</button></div>';
      const clueDisplay = body.querySelector('#clueDisplay'); if (clueDisplay) clueDisplay.textContent = board.clue ? `Clue: ${board.clue.word} · ${board.clue.count}` : 'No clue is active.';
      const guessInput = body.querySelector<HTMLInputElement>('#guess'); if (guessInput && preserveGuess) guessInput.value = previousGuess;
      body.querySelector('#guessForm')?.addEventListener('submit', (event) => { event.preventDefault(); const word = body.querySelector<HTMLInputElement>('#guess')?.value.trim() ?? ''; if (word) void this.humanAction({ type: 'make_guess', word }); });
      body.querySelector('#endTurn')?.addEventListener('click', () => { void this.humanAction({ type: 'end_turn' }); });
      body.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((element) => { element.disabled = this.busy; });
      return;
    }
    body.innerHTML = '<p class="hint">No action is available in this phase.</p>';
  }

  private renderLog(): void {
    const log = this.container.querySelector('#log'); if (!log) return;
    log.replaceChildren();
    if (!this.board?.log.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No moves yet.'; log.append(empty); return; }
    for (const item of [...this.board.log].reverse()) { const line = document.createElement('div'); line.className = 'log-item'; const time = document.createElement('time'); time.textContent = `#${item.id}`; line.append(time, document.createTextNode(item.text)); log.append(line); }
  }

  private renderControls(): void {
    const nextRound = this.container.querySelector<HTMLButtonElement>('#nextRound'); if (nextRound) nextRound.disabled = this.busy;
    const newGame = this.container.querySelector<HTMLButtonElement>('#newGame'); if (newGame) newGame.disabled = this.busy;
    const roleSelect = this.container.querySelector<HTMLSelectElement>('#roleSelect'); if (roleSelect) roleSelect.disabled = this.busy;
    const mcp = this.container.querySelector('#mcpMessage'); if (mcp) mcp.textContent = this.mcpMessage;
    const error = this.container.querySelector('#errorMessage'); if (error) error.textContent = this.errorMessage;
  }

  private renderLobby(): void {
    const modal = this.container.querySelector<HTMLElement>('#lobbyModal');
    const grid = this.container.querySelector<HTMLElement>('#lobbyGrid');
    if (!modal || !grid) return;
    modal.toggleAttribute('hidden', !this.lobbyOpen);
    grid.replaceChildren();
    for (const seat of this.lobby?.seats ?? []) {
      const card = document.createElement('article');
      card.className = `lobby-card lobby-${seat.team}`;
      const icon = document.createElement('div'); icon.className = 'lobby-avatar'; icon.innerHTML = seat.player?.controller === 'human' ? userIconMarkup : botIconMarkup;
      const name = document.createElement('strong'); name.textContent = seat.player?.displayName ?? 'Open seat';
      const role = document.createElement('span'); role.textContent = seat.player ? (seat.player.role === 'spymaster' ? 'Spymaster' : 'Operative') : (seat.role === 'spymaster' ? 'Spymaster' : 'Operative');
      card.append(icon, name, role);
      grid.append(card);
    }
    const startCoop = this.container.querySelector<HTMLButtonElement>('#startCoop');
    const startVersus = this.container.querySelector<HTMLButtonElement>('#startVersus');
    if (startCoop) { startCoop.hidden = !this.lobby?.canStartCoop; startCoop.disabled = !this.lobby?.canStartCoop || this.busy; }
    if (startVersus) { startVersus.hidden = !this.lobby?.canStartVersus; startVersus.disabled = !this.lobby?.canStartVersus || this.busy; }
    const message = this.container.querySelector('#lobbyMessage');
    if (message) message.textContent = this.lobby ? `${this.lobby.seats.filter((seat) => seat.player).length} of 4 seats occupied` : 'Loading lobby…';
  }
}

if (root) void new SemanticSpyApp(root).start();
