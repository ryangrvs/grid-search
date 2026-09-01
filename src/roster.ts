import type { Lobby, LobbySeat, Player, Role, Team, RegistrationResult } from '../shared/types';

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

type Seat = LobbySeat & { handle: string | null };

const seatPlan: Array<{ id: string; team: Team; role: Role }> = [
  { id: 'blue-top-left', team: 'blue', role: 'operative' },
  { id: 'blue-top-right', team: 'blue', role: 'spymaster' },
  { id: 'red-bottom-left', team: 'red', role: 'operative' },
  { id: 'red-bottom-right', team: 'red', role: 'spymaster' },
];

export interface PersistedRoster {
  seats: Array<{ id: string; team: Team; role: Role; player: Player | null; handle: string | null }>;
}

function isRole(value: unknown): value is Role { return value === 'operative' || value === 'spymaster'; }
function isTeam(value: unknown): value is Team { return value === 'blue' || value === 'red'; }
function isPlayer(value: unknown): value is Player | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const player = value as Record<string, unknown>;
  return typeof player.id === 'string' && typeof player.displayName === 'string'
    && (player.controller === 'human' || player.controller === 'agent') && isTeam(player.team) && isRole(player.role);
}
function isPersistedRoster(value: unknown): value is PersistedRoster {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.seats) || candidate.seats.length !== seatPlan.length) return false;
  const seats = candidate.seats;
  const ids = new Set<string>();
  const playerIds = new Set<string>();
  const displayNames = new Set<string>();
  let humanCount = 0;
  if (!seats.every((seat): boolean => {
    if (!seat || typeof seat !== 'object') return false;
    const item = seat as Record<string, unknown>;
    if (typeof item.id !== 'string' || ids.has(item.id) || !isTeam(item.team) || !isRole(item.role)
      || !isPlayer(item.player) || (item.handle !== null && typeof item.handle !== 'string')) return false;
    ids.add(item.id);
    const player = item.player as Player | null;
    if (!player) return item.handle === null;
    if (!player.id || playerIds.has(player.id) || !player.displayName.trim()
      || displayNames.has(player.displayName.toLocaleLowerCase())) return false;
    playerIds.add(player.id);
    displayNames.add(player.displayName.toLocaleLowerCase());
    if (player.controller === 'human') humanCount += 1;
    return player.controller === 'human' ? item.handle === null : typeof item.handle === 'string' && item.handle.length > 0;
  })) return false;
  if (seatPlan.some((seat) => !ids.has(seat.id))) return false;
  const ordered = seatPlan.map((seat) => seats.find((candidate) => (candidate as Record<string, unknown>).id === seat.id) as Record<string, unknown>);
  if (!isRole(ordered[0].role)) return false;
  const humanRole = ordered[0].role;
  return humanCount === 1 && ordered.every((seat, index) => {
    const expectedRole = index % 2 === 0 ? humanRole : opposite(humanRole);
    const player = seat.player as Player | null;
    return seat.team === seatPlan[index].team && seat.role === expectedRole
      && (!player || (index === 0 ? player.controller === 'human' : player.controller === 'agent'))
      && (!player || (player.team === seat.team && player.role === seat.role));
  });
}
function opposite(role: Role): Role { return role === 'operative' ? 'spymaster' : 'operative'; }

/** Four-seat roster. Handles remain internal and are never part of Lobby/Player views. */
export class Roster {
  private seats: Seat[];

  constructor(humanRole: Role = 'operative') {
    if (!isRole(humanRole)) throw new Error('Invalid human role');
    this.seats = this.fresh(humanRole);
  }

  get humanRole(): Role { return this.seats[0].role; }

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

  /** Change role labels by column, preserving every player's physical seat. */
  setHumanRole(role: Role): void {
    if (!isRole(role)) throw new Error('Invalid human role');
    this.seats.forEach((seat, index) => {
      const seatRole = index % 2 === 0 ? role : opposite(role);
      seat.role = seatRole;
      if (seat.player) seat.player.role = seatRole;
    });
  }

  register(name: string, team?: Team, role?: Role): RegistrationResult {
    const available = (): Array<{ team: Team; role: Role }> => this.seats
      .filter((seat) => !seat.player)
      .map((seat) => ({ team: seat.team, role: seat.role }));
    const cleanName = name.trim();
    const existing = this.seats.find((seat) => seat.player?.displayName.toLocaleLowerCase() === cleanName.toLocaleLowerCase());
    if (existing?.player?.controller === 'human') {
      return { success: false, error: `The display name “${cleanName}” is already registered`, availableSeats: available(), lobby: this.view() };
    }
    if (existing?.player) {
      // Recovery keeps the player and physical position stable while issuing a
      // new handle. The old handle is overwritten and therefore invalid.
      existing.handle = randomId();
      return { success: true, player: { ...existing.player }, playerHandle: existing.handle, availableSeats: available(), lobby: this.view() };
    }
    const seat = this.seats.find((candidate) => !candidate.player
      && (team === undefined || candidate.team === team)
      && (role === undefined || candidate.role === role));
    if (!seat) {
      const requested = [team, role].filter(Boolean).join(' ');
      const detail = requested ? `The requested ${requested} seat is occupied` : 'The lobby is full';
      return { success: false, error: `${detail}. Choose an available seat.`, availableSeats: available(), lobby: this.view() };
    }
    const player: Player = { id: randomId(), displayName: cleanName, controller: 'agent', team: seat.team, role: seat.role };
    const handle = randomId();
    seat.player = player;
    seat.handle = handle;
    return { success: true, player: { ...player }, playerHandle: handle, availableSeats: available(), lobby: this.view() };
  }

  hasHandle(handle: string): boolean { return this.seats.some((seat) => seat.handle === handle); }

  /** Return the complete roster state for the owning GameController to persist. */
  snapshot(): PersistedRoster {
    return {
      seats: this.seats.map((seat) => ({ id: seat.id, team: seat.team, role: seat.role,
        player: seat.player ? { ...seat.player } : null, handle: seat.handle })),
    };
  }

  /** Restore only validated state; storage remains the controller's responsibility. */
  restore(snapshot: unknown): void {
    if (!isPersistedRoster(snapshot)) throw new Error('Invalid roster snapshot');
    this.seats = this.hydrate(snapshot);
  }

  private fresh(humanRole: Role): Seat[] {
    const seats = seatPlan.map((seat, index) => ({
      ...seat,
      player: index === 0 ? {
        id: randomId(), displayName: 'You', controller: 'human' as const, team: 'blue' as const, role: humanRole,
      } : null,
      handle: null,
    }));
    seats.forEach((seat, index) => { seat.role = index % 2 === 0 ? humanRole : opposite(humanRole); });
    return seats;
  }

  private hydrate(saved: PersistedRoster): Seat[] {
    const byId = new Map(saved.seats.map((seat) => [seat.id, seat]));
    if (seatPlan.some((seat) => !byId.has(seat.id))) return this.fresh('operative');
    const seats = seatPlan.map((plan) => {
      const savedSeat = byId.get(plan.id)!;
      return { ...plan, player: savedSeat.player ? { ...savedSeat.player } : null, handle: savedSeat.handle };
    });
    const humanRole = seats[0].player?.role ?? seats[0].role;
    seats.forEach((seat, index) => {
      seat.role = index % 2 === 0 ? humanRole : opposite(humanRole);
      if (seat.player) seat.player.role = seat.role;
    });
    return seats;
  }

}

export { seatPlan };
