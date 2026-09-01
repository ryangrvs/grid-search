import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Lobby, LobbySeat, Player, Role, Team, RegistrationResult } from '../shared/types';

type Seat = LobbySeat & { handle: string | null };

const seatPlan: Array<{ id: string; team: Team; role: Role }> = [
  { id: 'blue-top-left', team: 'blue', role: 'operative' },
  { id: 'blue-top-right', team: 'blue', role: 'spymaster' },
  { id: 'red-bottom-left', team: 'red', role: 'operative' },
  { id: 'red-bottom-right', team: 'red', role: 'spymaster' },
];

export interface PersistedRoster {
  version: 1;
  seats: Array<{ id: string; team: Team; role: Role; player: Player | null; handle: string | null }>;
}

/** Synchronous on-purpose: roster mutations are tiny and happen on one local server. */
export interface RosterStore {
  load(): PersistedRoster | null;
  save(snapshot: PersistedRoster): void;
}

/** Default store for tests and embedders; the owning app keeps it for its lifetime. */
export class MemoryRosterStore implements RosterStore {
  private snapshot: PersistedRoster | null = null;
  load(): PersistedRoster | null { return this.snapshot ? cloneSnapshot(this.snapshot) : null; }
  save(snapshot: PersistedRoster): void { this.snapshot = cloneSnapshot(snapshot); }
}

/** Local-disk store used by the standalone server. It never sends roster data remotely. */
export class FileRosterStore implements RosterStore {
  constructor(private readonly filePath: string) {}
  load(): PersistedRoster | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return isPersistedRoster(parsed) ? parsed : null;
    } catch { return null; }
  }
  save(snapshot: PersistedRoster): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

function cloneSnapshot(snapshot: PersistedRoster): PersistedRoster { return JSON.parse(JSON.stringify(snapshot)) as PersistedRoster; }
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
  if (candidate.version !== 1 || !Array.isArray(candidate.seats) || candidate.seats.length !== seatPlan.length) return false;
  return candidate.seats.every((seat): boolean => {
    if (!seat || typeof seat !== 'object') return false;
    const item = seat as Record<string, unknown>;
    return typeof item.id === 'string' && isTeam(item.team) && isRole(item.role) && isPlayer(item.player)
      && (item.handle === null || typeof item.handle === 'string');
  });
}
function opposite(role: Role): Role { return role === 'operative' ? 'spymaster' : 'operative'; }

/** Persistent four-seat roster. Handles remain internal and are never part of Lobby/Player views. */
export class Roster {
  private readonly seats: Seat[];
  private readonly store: RosterStore;

  constructor(humanRole: Role = 'operative', store: RosterStore = new MemoryRosterStore()) {
    this.store = store;
    const saved = store.load();
    this.seats = saved ? this.hydrate(saved) : this.fresh(humanRole);
    if (!saved) this.persist();
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
    this.persist();
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
      existing.handle = randomUUID();
      this.persist();
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
    const player: Player = { id: randomUUID(), displayName: cleanName, controller: 'agent', team: seat.team, role: seat.role };
    const handle = randomUUID();
    seat.player = player;
    seat.handle = handle;
    this.persist();
    return { success: true, player: { ...player }, playerHandle: handle, availableSeats: available(), lobby: this.view() };
  }

  hasHandle(handle: string): boolean { return this.seats.some((seat) => seat.handle === handle); }

  private fresh(humanRole: Role): Seat[] {
    const seats = seatPlan.map((seat, index) => ({
      ...seat,
      player: index === 0 ? {
        id: randomUUID(), displayName: 'You', controller: 'human' as const, team: 'blue' as const, role: humanRole,
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

  private persist(): void {
    this.store.save({
      version: 1,
      seats: this.seats.map((seat) => ({ id: seat.id, team: seat.team, role: seat.role,
        player: seat.player ? { ...seat.player } : null, handle: seat.handle })),
    });
  }
}

export { seatPlan };
