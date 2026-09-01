import type { Action, Actor, Board, Lobby, RegistrationResult, Role, Team } from '../shared/types';
import { Game } from './game';
import { Roster } from './roster';
import { LocalStorageStateStore, type PersistedState, MemoryStateStore, type StateStore } from './state-store';

export { LocalStorageStateStore, MemoryStateStore } from './state-store';
export type { PersistedState, StateStore } from './state-store';

export interface GameControllerOptions {
  humanRole?: Role;
  stateStore?: StateStore;
}

/**
 * The only state owner in the browser. UI and WebMCP both call this controller;
 * neither path serializes state or talks to a server.
 */
export class GameController {
  readonly game: Game;
  readonly roster: Roster;
  private readonly stateStore: StateStore;

  constructor(options: GameControllerOptions = {}) {
    this.stateStore = options.stateStore ?? new LocalStorageStateStore();
    const fallbackRole = options.humanRole ?? 'operative';
    let restoredGame: Game | undefined;
    let restoredRoster: Roster | undefined;
    try {
      const saved = this.stateStore.load();
      if (isPersistedState(saved)) {
        // Hydrate isolated candidates. A malformed or incoherent pair must not
        // partially mutate either domain object before falling back.
        const candidateRoster = new Roster(fallbackRole);
        const candidateGame = new Game(fallbackRole);
        candidateRoster.restore(saved.roster);
        candidateGame.restore(saved.game);
        if (candidateGame.human !== candidateRoster.humanRole) throw new Error('Game and roster roles do not match');
        restoredGame = candidateGame;
        restoredRoster = candidateRoster;
      }
    } catch {
      // Any malformed, unsupported, or incoherent snapshot starts a new session.
    }
    this.roster = restoredRoster ?? new Roster(fallbackRole);
    this.game = restoredGame ?? new Game(fallbackRole);
    this.persist();
  }

  getBoard(actor: Actor = 'human'): Board { return this.game.getBoard(actor); }
  view(actor: Actor = 'human'): Board { return this.game.view(actor); }
  lobby(): Lobby { return this.roster.view(); }

  act(actor: Actor, action: Action): Board {
    const board = this.game.act(actor, action);
    this.persist();
    return board;
  }

  register(name: string, team?: Team, role?: Role): RegistrationResult {
    const result = this.roster.register(name, team, role);
    if (result.success) this.persist();
    return result;
  }

  setHumanRole(role: Role): Lobby {
    if (this.game.view('human').status === 'playing' && role !== this.roster.humanRole) {
      throw new Error('Human role cannot change during an active clue/guess turn');
    }
    this.game.setHumanRole(role);
    this.roster.setHumanRole(role);
    this.persist();
    return this.roster.view();
  }

  newGame(role: Role = this.roster.humanRole): Board {
    const board = this.game.reset(role);
    this.roster.setHumanRole(role);
    this.persist();
    return board;
  }

  nextRound(role: Role = this.roster.humanRole): Board {
    if (this.game.view('human').status === 'playing' && role !== this.roster.humanRole) {
      throw new Error('Human role cannot change during an active clue/guess turn');
    }
    const board = this.game.nextRound(role);
    this.roster.setHumanRole(role);
    this.persist();
    return board;
  }

  /** Return the single versioned snapshot owned by this controller. */
  snapshot(): PersistedState { return { version: 1, game: this.game.snapshot(), roster: this.roster.snapshot() }; }

  private persist(): void { this.stateStore.save(this.snapshot()); }
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && candidate.game !== null && typeof candidate.game === 'object'
    && candidate.roster !== null && typeof candidate.roster === 'object';
}
