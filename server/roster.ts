import { randomUUID } from 'node:crypto';
import type { Lobby, LobbySeat, Player, Role, Team, RegistrationResult } from '../shared/types';

type Seat = LobbySeat & { handle: string | null };

const seatPlan: Array<{ id: string; team: Team; role: Role }> = [
  { id: 'blue-top-left', team: 'blue', role: 'operative' },
  { id: 'blue-top-right', team: 'blue', role: 'spymaster' },
  { id: 'red-bottom-left', team: 'red', role: 'spymaster' },
  { id: 'red-bottom-right', team: 'red', role: 'operative' },
];

/** A deliberately process-local roster for the registration proof of concept. */
export class Roster {
  private readonly seats: Seat[];

  constructor(humanRole: Role = 'operative') {
    this.seats = seatPlan.map((seat, index) => ({
      ...seat,
      player: index === 0 ? {
        id: randomUUID(), displayName: 'You', controller: 'human', team: 'blue', role: humanRole,
      } : null,
      handle: null,
    }));
    // Keep the local human in the physical top-left seat while reflecting the
    // role selected for the current game.
    this.seats[1].role = humanRole === 'operative' ? 'spymaster' : 'operative';
  }

  view(): Lobby {
    const seats = this.seats.map(({ handle: _handle, ...seat }) => ({
      ...seat,
      player: seat.player ? { ...seat.player } : null,
    }));
    return {
      seats,
      canStartCoop: seats.filter((seat) => seat.team === 'blue' && seat.player).length === 2,
      canStartVersus: seats.every((seat) => seat.player !== null),
    };
  }

  setHumanRole(role: Role): void {
    const human = this.seats[0].player;
    if (!human) return;
    human.role = role;
    this.seats[0].role = role;
    this.seats[1].role = role === 'operative' ? 'spymaster' : 'operative';
    if (this.seats[1].player) this.seats[1].player.role = this.seats[1].role;
  }

  register(name: string, team?: Team, role?: Role): RegistrationResult {
    const available = (): Array<{ team: Team; role: Role }> => this.seats
      .filter((seat) => !seat.player)
      .map((seat) => ({ team: seat.team, role: seat.role }));
    const cleanName = name.trim();
    if (this.seats.some((seat) => seat.player?.displayName.toLocaleLowerCase() === cleanName.toLocaleLowerCase())) {
      return { success: false, error: `The display name “${cleanName}” is already registered`, availableSeats: available(), lobby: this.view() };
    }
    const seat = this.seats.find((candidate) => !candidate.player
      && (team === undefined || candidate.team === team)
      && (role === undefined || candidate.role === role));
    if (!seat) {
      const requested = [team, role].filter(Boolean).join(' ');
      const detail = requested ? `The requested ${requested} seat is occupied` : 'The lobby is full';
      return { success: false, error: `${detail}. Choose an available seat.`, availableSeats: available(), lobby: this.view() };
    }
    const player: Player = { id: randomUUID(), displayName: cleanName, controller: 'agent', team: seat.team, role: seat.role };
    const handle = randomUUID();
    seat.player = player;
    seat.handle = handle;
    return { success: true, player: { ...player }, playerHandle: handle, availableSeats: available(), lobby: this.view() };
  }

  /** Handles are intentionally not used by gameplay until the multiplayer domain issue. */
  hasHandle(handle: string): boolean {
    return this.seats.some((seat) => seat.handle === handle);
  }
}
