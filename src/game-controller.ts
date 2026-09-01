import type { Action, Actor, Board, Lobby, RegistrationResult, Role, Team } from '../shared/types';
import { Game } from './game';
import { LocalStorageRosterStore, Roster, type RosterStore } from './roster';

export interface GameControllerOptions {
  humanRole?: Role;
  rosterStore?: RosterStore;
  game?: Game;
}

/**
 * The only state owner in the browser. UI and WebMCP both call this controller;
 * neither path serializes state or talks to a server.
 */
export class GameController {
  readonly game: Game;
  readonly roster: Roster;

  constructor(options: GameControllerOptions = {}) {
    this.roster = new Roster(options.humanRole ?? options.game?.human ?? 'operative', options.rosterStore ?? new LocalStorageRosterStore());
    this.game = options.game ?? new Game(this.roster.humanRole);
    if (this.game.human !== this.roster.humanRole) this.game.reset(this.roster.humanRole);
  }

  getBoard(actor: Actor = 'human'): Board { return this.game.getBoard(actor); }
  view(actor: Actor = 'human'): Board { return this.game.view(actor); }
  lobby(): Lobby { return this.roster.view(); }

  act(actor: Actor, action: Action): Board { return this.game.act(actor, action); }

  register(name: string, team?: Team, role?: Role): RegistrationResult {
    return this.roster.register(name, team, role);
  }

  setHumanRole(role: Role): Lobby {
    if (this.game.view('human').status === 'playing' && role !== this.roster.humanRole) {
      throw new Error('Human role cannot change during an active clue/guess turn');
    }
    this.roster.setHumanRole(role);
    return this.roster.view();
  }

  newGame(role: Role = this.roster.humanRole): Board {
    this.roster.setHumanRole(role);
    return this.game.reset(role);
  }

  nextRound(role: Role = this.roster.humanRole): Board {
    if (this.game.view('human').status === 'playing' && role !== this.roster.humanRole) {
      throw new Error('Human role cannot change during an active clue/guess turn');
    }
    this.roster.setHumanRole(role);
    return this.game.nextRound(role);
  }
}

