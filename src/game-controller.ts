import type { Action, Actor, Board, Lobby, MatchMode, Player, RegistrationResult, Role, Team } from '../shared/types';
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
        const gamePlayers = candidateGame.snapshot().players;
        const rosterPlayers = candidateRoster.players();
        if (gamePlayers.length !== rosterPlayers.length || gamePlayers.some((player) => {
          const rosterPlayer = rosterPlayers.find((candidate) => candidate.id === player.id);
          return !rosterPlayer || rosterPlayer.displayName !== player.displayName
            || rosterPlayer.controller !== player.controller || rosterPlayer.team !== player.team || rosterPlayer.role !== player.role;
        })) throw new Error('Game and roster players do not match');
        restoredGame = candidateGame;
        restoredRoster = candidateRoster;
      }
    } catch {
      // Any malformed, unsupported, or incoherent snapshot starts a new session.
    }
    this.roster = restoredRoster ?? new Roster(fallbackRole);
    this.game = restoredGame ?? new Game({ players: this.roster.players(), mode: 'coop', humanRole: this.roster.humanRole, allowSyntheticPlayers: false });
    this.persist();
  }

  getBoard(actor: Actor | string = 'human'): Board { return this.game.getBoard(actor); }
  view(actor: Actor | string = 'human'): Board { return this.game.view(actor); }
  lobby(): Lobby { return this.roster.view(); }

  act(actor: Actor | string, action: Action): Board {
    const board = this.game.act(actor, action);
    this.persist();
    return board;
  }

  /** Player-id APIs are the domain surface; actor overloads above remain for old adapters. */
  getBoardForPlayer(playerId: string): Board { this.requirePlayer(playerId); return this.game.getBoard(playerId); }
  viewForPlayer(playerId: string): Board { this.requirePlayer(playerId); return this.game.view(playerId); }
  actForPlayer(playerId: string, action: Action): Board { this.requirePlayer(playerId); const board = this.game.act(playerId, action); this.persist(); return board; }

  start(mode: MatchMode | 'co-op', role: Role = this.roster.humanRole): Board {
    const normalized: MatchMode = mode === 'co-op' ? 'coop' : mode;
    const lobby = this.roster.view();
    if (normalized === 'coop' && !lobby.canStartCoop) throw new Error('Two Blue players are required to start Co-op');
    if (normalized === 'versus' && !lobby.canStartVersus) throw new Error('All four players are required to start Versus');
    const board = this.game.startRound(normalized, this.roster.players(), role);
    this.roster.setHumanRole(role); this.persist(); return board;
  }
  startCoop(role: Role = this.roster.humanRole): Board { return this.start('coop', role); }
  startVersus(role: Role = this.roster.humanRole): Board { return this.start('versus', role); }

  register(name: string, team?: Team, role?: Role): RegistrationResult {
    const result = this.roster.register(name, team, role);
    if (result.success) { this.game.syncPlayers(this.roster.players(), false); this.persist(); }
    return result;
  }

  setHumanRole(role: Role): Lobby {
    if (this.game.view('human').status === 'playing' && role !== this.roster.humanRole) {
      throw new Error('Human role cannot change during an active clue/guess turn');
    }
    this.game.setHumanRole(role, this.roster.players(), false);
    this.roster.setHumanRole(role);
    this.persist();
    return this.roster.view();
  }

  newGame(role: Role = this.roster.humanRole, mode?: MatchMode | 'co-op'): Board {
    if (mode !== undefined) return this.start(mode, role);
    const board = this.game.startRound(this.game.snapshot().mode, this.roster.players(), role, false, false);
    this.roster.setHumanRole(role);
    this.persist();
    return board;
  }

  nextRound(role: Role = this.roster.humanRole): Board {
    if (this.game.view('human').status === 'playing' && role !== this.roster.humanRole) {
      throw new Error('Human role cannot change during an active clue/guess turn');
    }
    const board = this.game.startRound(this.game.snapshot().mode, this.roster.players(), role, true, false);
    this.roster.setHumanRole(role);
    this.persist();
    return board;
  }

  /** Return the single versioned snapshot owned by this controller. */
  snapshot(): PersistedState { return { version: 1, game: this.game.snapshot(), roster: this.roster.snapshot() }; }

  private persist(): void { this.stateStore.save(this.snapshot()); }
  private requirePlayer(id: string): Player {
    const player = this.roster.playerById(id);
    if (!player) throw new Error('Unknown player');
    return player;
  }
}

function isPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && candidate.game !== null && typeof candidate.game === 'object'
    && candidate.roster !== null && typeof candidate.roster === 'object';
}
