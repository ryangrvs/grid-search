/// <reference types="vite/client" />

import botIcon from './assets/bot.svg?raw';
import userIcon from './assets/user.svg?raw';
import logoUrl from './assets/logo.svg';
import roleSwapUrl from './assets/arrow-left-right.svg';
import sendUrl from './assets/send-horizontal.svg';
import chevronUpUrl from './assets/chevron-up.svg';
import chevronDownUrl from './assets/chevron-down.svg';
import type { Action, Board, Lobby, LobbySeat, Role } from '../shared/types';
import { cardPresentation } from './board-view';
import { GameController, LocalStorageStateStore } from './game-controller';
import { registerWebMCP } from './webmcp';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');

function inlineIcon(raw: string, label: string): string {
  return raw.replace('<svg ', `<svg class="avatar-icon" role="img" aria-label="${label}" `);
}

const botIconMarkup = inlineIcon(botIcon, 'Agent');
const userIconMarkup = inlineIcon(userIcon, 'You');

class SemanticSpyApp {
  private readonly controller: GameController;
  private board: Board | null = null;
  private lobby: Lobby | null = null;
  private lobbyOpen = false;
  private lobbyRole: Role = 'operative';
  private lobbyMode: 'co-op' | 'versus' = 'co-op';
  private busy = false;
  private errorMessage = '';
  private mcpMessage = 'Checking WebMCP support…';
  private previousRevealed = new Set<string>();
  private allowRevealAnimation = false;
  private suppressNextRevealAnimation = false;
  private storageSyncBound = false;

  constructor(private readonly container: HTMLElement, controller = new GameController()) { this.controller = controller; }

  async start(): Promise<void> {
    try {
      this.mountShell();
      this.bindStorageSync();
      await this.refreshHumanBoard();
      await this.refreshLobby();
      const registration = await registerWebMCP({
        controller: this.controller,
        refreshHumanBoard: async () => { await this.refreshHumanBoard(); await this.refreshLobby(); },
      });
      this.mcpMessage = registration.supported
        ? 'WebMCP tools ready for the agent.'
        : registration.reason || 'WebMCP unavailable in this browser.';
      window.setInterval(() => { void this.pollBoard(); void this.pollLobby(); }, 2500);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not start the local game.';
      this.mountShell();
      this.render();
    }
  }

  private bindStorageSync(): void {
    if (this.storageSyncBound) return;
    this.storageSyncBound = true;
    window.addEventListener('storage', (event) => {
      if (event.key !== LocalStorageStateStore.key) return;
      this.controller.syncFromStore();
      void Promise.all([this.refreshHumanBoard(), this.refreshLobby()]).catch((error) => {
        this.errorMessage = error instanceof Error ? error.message : 'Shared game refresh failed';
        this.render();
      });
    });
  }

  private mountShell(): void {
    this.container.innerHTML = `
      <header class="topbar">
        <div class="brand"><img class="brand-logo" src="${logoUrl}" alt="" aria-hidden="true"><span class="brand-name">Grid Search</span></div>
      </header>
      <div class="game-shell">
        <section class="playing-region" aria-label="Grid Search playing area">
          <div class="table-scroll">
            <div class="game-table">
              <div class="participants-row participants-top" aria-label="Blue team players">
                <article class="player-slot player-left" data-seat-id="blue-top-left"></article>
                <article class="player-slot player-right" data-seat-id="blue-top-right"></article>
              </div>
              <div id="boardGrid" class="board-grid" aria-label="Grid Search word cards"></div>
              <div class="scorebar" aria-label="Team progress">
                <div id="blueSquares" class="score-squares score-squares-blue" aria-label="Blue team progress"></div>
                <div id="redSquares" class="score-squares score-squares-red" aria-label="Red team progress"></div>
              </div>
              <div class="participants-row participants-bottom" aria-label="Red team players">
                <article class="player-slot player-left" data-seat-id="red-bottom-left"></article>
                <article class="player-slot player-right" data-seat-id="red-bottom-right"></article>
              </div>
            </div>
          </div>
        </section>
        <section class="below-board" aria-label="Game controls">
          <div class="round-controls">
            <span id="gameStatus" class="game-status" hidden></span>
            <div class="round-buttons"><button id="nextRound" class="button secondary">Next Round</button><button id="newGame" class="button">New Game</button></div>
          </div>
          <section class="history-panel"><div class="section-head"><h2>Game History</h2></div><div id="log" class="log"></div></section>
          <p id="mcpMessage" class="sr-only"></p>
        </section>
      </div>
      <div id="lobbyModal" class="lobby-modal" role="dialog" aria-modal="true" aria-labelledby="lobbyTitle" hidden>
        <div class="lobby-dialog">
          <div class="section-head"><h2 id="lobbyTitle">New Game</h2><button id="closeLobby" class="icon-button" type="button" aria-label="Close lobby">×</button></div>
          <p class="hint">Agents can use <code>/register</code> to join and <code>/learn_rules</code> to understand the game.</p>
          <div class="lobby-stage">
            <div id="lobbyGrid" class="lobby-grid" aria-label="Player registration lobby"></div>
          </div>
          <div class="lobby-controls">
            <div class="lobby-setting"><span class="lobby-control-label">Players</span><div class="player-count-control" role="group" aria-label="Number of players"><button id="playerCount2" type="button" aria-label="Two-player Co-op">2</button><button id="playerCount4" type="button" aria-label="Four-player Versus">4</button></div></div>
            <div class="lobby-setting"><span class="lobby-control-label">Roles</span><button id="roleSwap" class="role-swap" type="button"><img src="${roleSwapUrl}" alt="" aria-hidden="true"></button></div>
            <p id="lobbyMessage" class="notice lobby-count" aria-live="polite"></p>
            <button id="startGame" class="button lobby-start" type="button" disabled>Start</button>
          </div>
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
    this.container.querySelector<HTMLButtonElement>('#playerCount2')?.addEventListener('click', () => { this.lobbyMode = 'co-op'; this.renderLobby(); });
    this.container.querySelector<HTMLButtonElement>('#playerCount4')?.addEventListener('click', () => { this.lobbyMode = 'versus'; this.renderLobby(); });
    this.container.querySelector<HTMLButtonElement>('#roleSwap')?.addEventListener('click', () => { this.toggleLobbyRole(); });
    this.container.querySelector<HTMLButtonElement>('#startGame')?.addEventListener('click', () => { void this.startLobby(); });
  }

  private async refreshHumanBoard(): Promise<void> {
    this.controller.syncFromStore();
    const next = this.controller.getBoard('human');
    const previous = this.board;
    const changed = !previous || previous.id !== next.id || previous.revision !== next.revision
      || previous.activePlayerId !== next.activePlayerId;
    if (!changed) return;
    const newGame = !previous || previous.id !== next.id;
    this.allowRevealAnimation = !newGame && !this.suppressNextRevealAnimation;
    this.suppressNextRevealAnimation = false;
    this.board = next;
    this.errorMessage = '';
    if (newGame) this.previousRevealed.clear();
    // Local refreshes should not wipe a clue/guess draft while the revision is unchanged.
    this.render();
  }

  private async pollBoard(): Promise<void> {
    if (this.busy) return;
    try { await this.refreshHumanBoard(); } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Board refresh failed';
      this.render();
    }
  }

  private async refreshLobby(): Promise<void> {
    const next = this.controller.lobby();
    const previousOccupied = this.lobby?.seats.filter((seat) => seat.player).length ?? 0;
    const nextOccupied = next.seats.filter((seat) => seat.player).length;
    const changed = JSON.stringify(next) !== JSON.stringify(this.lobby);
    this.lobby = next;
    if (this.lobbyOpen && previousOccupied < 3 && nextOccupied >= 3) this.lobbyMode = 'versus';
    if (changed) this.render();
  }

  private async pollLobby(): Promise<void> {
    if (this.busy) return;
    try { await this.refreshLobby(); } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Lobby refresh failed';
      this.render();
    }
  }

  private async humanAction(action: Action): Promise<void> {
    if (this.busy || !this.board || this.board.status !== 'playing') return;
    this.busy = true; this.errorMessage = ''; this.render();
    try {
      if (this.controller.syncFromStore()) {
        await this.refreshHumanBoard();
        return;
      }
      this.controller.act('human', action);
      await this.refreshHumanBoard();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Action failed';
      this.render();
    } finally { this.busy = false; this.render(); }
  }

  private async newGame(): Promise<void> {
    this.lobbyOpen = true;
    this.lobbyRole = this.board?.humanRole ?? 'operative';
    try {
      await this.refreshLobby();
      const occupied = this.lobby?.seats.filter((seat) => seat.player).length ?? 0;
      this.lobbyMode = occupied >= 3 ? 'versus' : 'co-op';
    } catch (error) { this.errorMessage = error instanceof Error ? error.message : 'Could not load the lobby.'; }
    this.render();
  }

  private async startLobby(): Promise<void> {
    const mode = this.lobbyMode;
    if (!this.lobby || (mode === 'co-op' && !this.lobby.canStartCoop) || (mode === 'versus' && !this.lobby.canStartVersus)) return;
    this.lobbyOpen = false;
    await this.resetGame(`Start ${mode}`, 'Deal a completely fresh field of 25 words? The current match will be replaced.', this.lobbyRole, mode);
  }

  private toggleLobbyRole(): void {
    if (!this.lobbyOpen) return;
    this.lobbyRole = this.lobbyRole === 'operative' ? 'spymaster' : 'operative';
    this.renderLobby();
  }

  private async nextRound(): Promise<void> {
    const role: Role = this.board?.humanRole === 'spymaster' ? 'operative' : 'spymaster';
    await this.resetGame('Next Round', 'Start a new key with the same 25 words and switch roles? The current round will end.', role);
  }

  private async resetGame(_label: string, confirmation: string, selectedRole?: string, mode?: 'co-op' | 'versus'): Promise<void> {
    if (this.busy) return;
    const role = selectedRole === 'spymaster' ? 'spymaster' : 'operative';
    if (!window.confirm(confirmation)) return;
    this.busy = true;
    try {
      this.suppressNextRevealAnimation = true;
      this.controller.syncFromStore();
      if (_label === 'Next Round') this.controller.nextRound(role);
      else this.controller.newGame(role, mode);
      await this.refreshHumanBoard();
    } catch (error) { this.suppressNextRevealAnimation = false; this.errorMessage = error instanceof Error ? error.message : 'Could not start a new match.'; }
    finally { this.busy = false; this.render(); }
  }

  private render(): void {
    if (!this.container.querySelector('#boardGrid')) return;
    const board = this.board;
    const status = this.container.querySelector('#gameStatus');
    if (status) {
      const winningTeam = board?.winner ? `${board.winner[0].toUpperCase()}${board.winner.slice(1)} wins` : '';
      const outcome = !board || board.status === 'playing' ? '' : winningTeam || 'Game over';
      status.textContent = outcome;
      status.toggleAttribute('hidden', !outcome);
      status.classList.toggle('team-blue', Boolean(outcome && board?.winner === 'blue'));
      status.classList.toggle('team-red', Boolean(outcome && board?.winner === 'red'));
    }
    this.renderScores();
    this.renderParticipants();
    this.renderGrid(); this.renderLog(); this.renderControls();
    this.renderLobby();
    const error = this.container.querySelector('#errorMessage'); if (error) error.textContent = this.errorMessage;
    const mcp = this.container.querySelector('#mcpMessage'); if (mcp) mcp.textContent = this.mcpMessage;
  }

  private renderScores(): void {
    const board = this.board;
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
    renderSquares(this.container.querySelector('#blueSquares'), board?.scores.blue ?? 0, board?.scores.blueTotal ?? 9, 'blue', 'Blue team progress');
    renderSquares(this.container.querySelector('#redSquares'), board?.scores.red ?? 0, board?.scores.redTotal ?? 8, 'red', 'Red team progress');
  }

  private renderParticipants(): void {
    const board = this.board;
    this.container.querySelector<HTMLElement>('.participants-bottom')
      ?.toggleAttribute('hidden', board?.mode === 'coop');
    for (const seat of this.lobby?.seats ?? []) this.renderPlayerSlot(seat, board);
  }

  private renderPlayerSlot(seat: LobbySeat, board: Board | null): void {
    const slot = this.container.querySelector<HTMLElement>(`[data-seat-id="${seat.id}"]`);
    if (!slot) return;
    const oldFeedback = slot.querySelector<HTMLElement>('.player-feedback');
    const calloutVersion = board ? `${board.id}:${board.revision}` : '';
    const preserveDraft = oldFeedback?.dataset.calloutVersion === calloutVersion;
    const clueDraft = preserveDraft ? oldFeedback?.querySelector<HTMLInputElement>('#clue')?.value ?? '' : '';
    const countDraft = preserveDraft ? oldFeedback?.querySelector<HTMLInputElement>('#count')?.value ?? '1' : '1';
    const player = seat.player;
    const active = Boolean(player && board?.status === 'playing' && board.activePlayerId === player.id);
    const inactiveTeam = board?.mode === 'coop' && seat.team === 'red';
    slot.className = `player-slot ${seat.id.endsWith('left') ? 'player-left' : 'player-right'} team-${seat.team}${active ? ' is-active' : ''}${inactiveTeam ? ' is-inactive-team' : ''}${player ? '' : ' is-open'}`;
    slot.toggleAttribute('aria-current', active);
    slot.setAttribute('aria-label', player ? `${player.displayName}, ${player.team} team, ${player.role}${active ? ', active player' : ''}` : `Open ${seat.team} ${seat.role} seat`);
    slot.replaceChildren();

    const copy = document.createElement('div'); copy.className = 'player-copy';
    const name = document.createElement('strong'); name.className = 'player-name'; name.textContent = player?.displayName ?? 'Open';
    const role = document.createElement('span'); role.className = 'player-role'; role.textContent = seat.role;
    copy.append(name, role);
    const interaction = document.createElement('div'); interaction.className = 'player-interaction';
    const avatar = document.createElement('div'); avatar.className = `avatar ${player?.controller === 'human' ? 'avatar-human' : 'avatar-agent'}`;
    avatar.innerHTML = player?.controller === 'human' ? userIconMarkup : botIconMarkup;
    const feedback = document.createElement('div'); feedback.className = `player-feedback clue-callout ${slot.classList.contains('player-left') ? 'clue-callout-left' : 'clue-callout-right'}`;
    feedback.dataset.calloutVersion = calloutVersion;
    const actionControl = document.createElement('div'); actionControl.className = 'player-action';
    if (slot.classList.contains('player-left')) interaction.append(avatar, feedback, actionControl);
    else interaction.append(actionControl, feedback, avatar);
    slot.append(copy, interaction);

    if (!player || !board) return;
    const guesses = board.turnGuesses.filter((guess) => guess.playerId === player.id);
    const isActiveHumanSpymaster = active && player.controller === 'human' && player.role === 'spymaster' && board.phase === 'clue';
    const ownsCurrentClue = board.phase === 'guess' && board.clue && player.team === board.activePlayer.team && player.role === 'spymaster';
    if (isActiveHumanSpymaster) {
      this.renderHumanClueForm(feedback, clueDraft, countDraft);
      const clueForm = feedback.querySelector<HTMLFormElement>('.clue-form');
      if (clueForm) {
        const send = this.createImageButton('clue-submit', sendUrl, 'Send clue');
        send.type = 'submit'; send.setAttribute('form', clueForm.id); send.disabled = this.busy;
        send.hidden = !clueDraft;
        feedback.querySelector<HTMLInputElement>('#clue')?.addEventListener('input', (event) => {
          send.hidden = !(event.currentTarget as HTMLInputElement).value;
        });
        actionControl.append(send);
      }
    } else if (ownsCurrentClue && board.clue) this.renderClueBubble(feedback, board.clue.word, board.clue.count, `${player.displayName}'s clue`);
    else if (guesses.length && board.clue) this.renderGuessBubble(feedback, guesses.at(-1)?.word ?? '', guesses.length, board.clue.count);
    if (!actionControl.childElementCount) actionControl.remove();
  }

  private createImageButton(className: string, src: string, label: string): HTMLButtonElement {
    const button = document.createElement('button'); button.className = className; button.setAttribute('aria-label', label);
    const image = document.createElement('img'); image.src = src; image.alt = ''; image.setAttribute('aria-hidden', 'true');
    button.append(image); return button;
  }

  private renderClueBubble(target: HTMLElement, word: string, count: number, label: string): void {
    this.sizeBubble(target, word);
    const bubble = document.createElement('div'); bubble.className = 'speech-bubble clue-bubble';
    const wordSegment = document.createElement('span'); wordSegment.className = 'bubble-segment bubble-word-segment';
    const kicker = document.createElement('span'); kicker.className = 'clue-kicker'; kicker.textContent = label;
    const wordNode = document.createElement('span'); wordNode.className = 'clue-word'; wordNode.textContent = word.toUpperCase();
    const countSegment = document.createElement('span'); countSegment.className = 'bubble-segment bubble-count-segment';
    const countNode = document.createElement('span'); countNode.className = 'clue-count'; countNode.textContent = String(count);
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-label', `${label}: ${word}, clue count ${count}`);
    countNode.setAttribute('aria-label', `Clue count ${count}`);
    wordSegment.append(kicker, wordNode); countSegment.append(countNode);
    bubble.append(wordSegment, countSegment);
    target.append(bubble);
  }

  private renderGuessBubble(target: HTMLElement, word: string, progress: number, total: number): void {
    this.sizeBubble(target, word);
    const bubble = document.createElement('div'); bubble.className = 'speech-bubble guess-bubble';
    const wordSegment = document.createElement('span'); wordSegment.className = 'bubble-segment bubble-word-segment';
    const wordNode = document.createElement('span'); wordNode.className = 'clue-word'; wordNode.textContent = word;
    const countSegment = document.createElement('span'); countSegment.className = 'bubble-segment bubble-count-segment';
    const progressNode = document.createElement('span'); progressNode.className = 'clue-count guess-progress'; progressNode.textContent = `${progress}/${total}`;
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-label', `${word}, guess ${progress} of ${total}`);
    wordSegment.append(wordNode); countSegment.append(progressNode);
    bubble.append(wordSegment, countSegment);
    target.append(bubble);
  }

  private renderHumanClueForm(target: HTMLElement, draft = '', countDraft = '1'): void {
    target.classList.add('is-form');
    this.sizeBubble(target, draft);
    const form = document.createElement('form'); form.id = 'clueForm'; form.className = 'clue-form speech-bubble clue-bubble';
    const wordBubble = document.createElement('span'); wordBubble.className = 'bubble-segment bubble-word-segment clue-word-bubble clue-word-entry';
    const clueLabelNode = document.createElement('label'); clueLabelNode.className = 'sr-only'; clueLabelNode.htmlFor = 'clue'; clueLabelNode.textContent = 'Clue word';
    const clue = document.createElement('input'); clue.id = 'clue'; clue.name = 'clue'; clue.maxLength = 40; clue.autocomplete = 'off'; clue.placeholder = 'Enter your clue...'; clue.value = draft.toUpperCase();
    clue.addEventListener('input', () => {
      const raw = clue.value;
      const cursor = clue.selectionStart ?? raw.length;
      const nextCursor = raw.slice(0, cursor).replace(/[^A-Za-z]/g, '').length;
      clue.value = raw.replace(/[^A-Za-z]/g, '').toUpperCase();
      clue.setSelectionRange(nextCursor, nextCursor);
      this.sizeBubble(target, clue.value);
    });
    wordBubble.append(clueLabelNode, clue);
    const countBubble = document.createElement('span'); countBubble.className = 'bubble-segment bubble-count-segment';
    const countLabel = document.createElement('label'); countLabel.className = 'clue-count clue-count-entry'; countLabel.htmlFor = 'count'; countLabel.setAttribute('aria-label', 'Clue count');
    const count = document.createElement('input'); count.id = 'count'; count.name = 'count'; count.type = 'number'; count.min = '1'; count.max = '9'; count.inputMode = 'numeric'; count.value = countDraft || '1'; count.setAttribute('aria-label', 'Clue count');
    countLabel.append(count);
    const steppers = document.createElement('span'); steppers.className = 'count-steppers';
    const increment = this.createImageButton('count-step', chevronUpUrl, 'Increase clue count'); increment.type = 'button';
    const decrement = this.createImageButton('count-step', chevronDownUrl, 'Decrease clue count'); decrement.type = 'button';
    increment.disabled = this.busy; decrement.disabled = this.busy;
    increment.addEventListener('click', () => { count.stepUp(); });
    decrement.addEventListener('click', () => { count.stepDown(); });
    steppers.append(increment, decrement);
    countBubble.append(steppers, countLabel);
    clue.disabled = this.busy; count.disabled = this.busy;
    form.setAttribute('role', 'group'); form.setAttribute('aria-label', 'Enter clue and count');
    form.append(wordBubble, countBubble);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = clue.value.trim(); const number = Number(count.value);
      if (value && Number.isInteger(number) && number > 0) void this.humanAction({ type: 'submit_clue', clue: value, count: number });
    });
    target.append(form);
  }

  private sizeBubble(target: HTMLElement, word: string): void {
    const slot = target.closest('.player-slot');
    if (slot?.querySelector('.avatar-human')) slot.classList.add('has-wide-feedback');
    const minimumWidth = target.classList.contains('is-form') ? 220 : 148;
    const width = word
      ? Math.min(400, Math.max(minimumWidth, 96 + word.length * 9))
      : 220;
    target.style.setProperty('--bubble-width', `${width}px`);
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
      if (card.word.length >= 9) button.classList.add('word-long');
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

  private renderLog(): void {
    const log = this.container.querySelector('#log'); if (!log) return;
    log.replaceChildren();
    if (!this.board?.log.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No moves yet.'; log.append(empty); return; }
    for (const item of [...this.board.log].reverse()) {
      const line = document.createElement('div'); line.className = `log-item team-${item.team}`;
      const time = document.createElement('time'); time.textContent = `#${item.id}`;
      line.append(time, document.createTextNode(item.text)); log.append(line);
    }
  }

  private renderControls(): void {
    const nextRound = this.container.querySelector<HTMLButtonElement>('#nextRound'); if (nextRound) nextRound.disabled = this.busy;
    const newGame = this.container.querySelector<HTMLButtonElement>('#newGame'); if (newGame) newGame.disabled = this.busy;
    const mcp = this.container.querySelector('#mcpMessage'); if (mcp) mcp.textContent = this.mcpMessage;
    const error = this.container.querySelector('#errorMessage'); if (error) error.textContent = this.errorMessage;
  }

  private renderLobby(): void {
    const modal = this.container.querySelector<HTMLElement>('#lobbyModal');
    const grid = this.container.querySelector<HTMLElement>('#lobbyGrid');
    if (!modal || !grid) return;
    modal.toggleAttribute('hidden', !this.lobbyOpen);
    grid.replaceChildren();
    for (const [index, seat] of (this.lobby?.seats ?? []).entries()) {
      const card = document.createElement('article');
      card.className = `lobby-card team-${seat.team}${seat.player ? '' : ' is-open'}`;
      const icon = document.createElement('div'); icon.className = 'lobby-avatar'; icon.innerHTML = seat.player?.controller === 'human' ? userIconMarkup : botIconMarkup;
      const name = document.createElement('strong'); name.textContent = seat.player?.displayName ?? 'Open';
      const previewRole: Role = index % 2 === 0
        ? this.lobbyRole
        : (this.lobbyRole === 'operative' ? 'spymaster' : 'operative');
      const role = document.createElement('span'); role.textContent = previewRole;
      const roleRow = document.createElement('div'); roleRow.className = 'lobby-role-row'; roleRow.append(role);
      const copy = document.createElement('div'); copy.className = 'lobby-card-copy'; copy.append(name, roleRow);
      card.append(icon, copy);
      grid.append(card);
    }
    const two = this.container.querySelector<HTMLButtonElement>('#playerCount2');
    const four = this.container.querySelector<HTMLButtonElement>('#playerCount4');
    const roleSwap = this.container.querySelector<HTMLButtonElement>('#roleSwap');
    const start = this.container.querySelector<HTMLButtonElement>('#startGame');
    const coopSelected = this.lobbyMode === 'co-op';
    if (two) { two.classList.toggle('is-selected', coopSelected); two.setAttribute('aria-pressed', String(coopSelected)); }
    if (four) { four.classList.toggle('is-selected', !coopSelected); four.setAttribute('aria-pressed', String(!coopSelected)); }
    if (roleSwap) roleSwap.setAttribute('aria-label', `Switch to ${this.lobbyRole === 'operative' ? 'spymaster' : 'operative'}`);
    const canStart = coopSelected ? this.lobby?.canStartCoop : this.lobby?.canStartVersus;
    if (start) {
      start.disabled = !canStart || this.busy;
      start.title = canStart ? '' : coopSelected ? 'Two Blue players are required' : 'All four players are required';
    }
    const message = this.container.querySelector('#lobbyMessage');
    if (message) message.textContent = this.lobby ? `${this.lobby.seats.filter((seat) => seat.player).length} of 4 seats occupied` : 'Loading lobby…';
  }
}

if (root) void new SemanticSpyApp(root).start();
