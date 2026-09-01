import { describe, expect, it } from 'vitest';
import { MemoryRosterStore, Roster } from '../src/roster';

describe('registration lobby', () => {
  it('prefills the human and assigns omitted preferences Blue-first', () => {
    const roster = new Roster();
    const initial = roster.view();
    expect(initial.seats).toHaveLength(4);
    expect(initial.seats[0].player).toMatchObject({ displayName: 'You', controller: 'human', team: 'blue' });
    expect(initial.canStartCoop).toBe(false);

    const registration = roster.register('Atlas');
    expect(registration.success).toBe(true);
    expect(registration.player).toMatchObject({ displayName: 'Atlas', controller: 'agent', team: 'blue', role: 'spymaster' });
    expect(registration.playerHandle).toEqual(expect.any(String));
    expect(roster.view().canStartCoop).toBe(true);
  });

  it('returns available seats when a requested seat is occupied', () => {
    const roster = new Roster();
    roster.register('Atlas', 'blue', 'spymaster');
    const rejected = roster.register('Nova', 'blue', 'spymaster');
    expect(rejected.success).toBe(false);
    expect(rejected.error).toContain('occupied');
    expect(rejected.availableSeats).toEqual([
      { team: 'red', role: 'operative' },
      { team: 'red', role: 'spymaster' },
    ]);
  });

  it('reveals versus only after both red seats are occupied', () => {
    const roster = new Roster();
    roster.register('Atlas');
    roster.register('Nova', 'red', 'spymaster');
    expect(roster.view().canStartVersus).toBe(false);
    roster.register('Orion', 'red', 'operative');
    expect(roster.view().canStartVersus).toBe(true);
  });

  it('rotates a recovering agent handle without moving its seat', () => {
    const roster = new Roster();
    const first = roster.register('Atlas');
    const second = roster.register('atlas');
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.player).toEqual(first.player);
    expect(second.playerHandle).not.toBe(first.playerHandle);
    expect(roster.hasHandle(first.playerHandle!)).toBe(false);
    expect(roster.hasHandle(second.playerHandle!)).toBe(true);
    expect(roster.view().seats[1].player?.displayName).toBe('Atlas');
  });

  it('persists positions, identities, roles, and handles in a local store', () => {
    const store = new MemoryRosterStore();
    const original = new Roster('operative', store);
    const registration = original.register('Atlas');
    original.register('Nova', 'red', 'operative');
    original.setHumanRole('spymaster');

    const restored = new Roster('operative', store);
    expect(restored.view().seats.map((seat) => seat.id)).toEqual(original.view().seats.map((seat) => seat.id));
    expect(restored.view().seats.map((seat) => seat.player?.displayName)).toEqual(['You', 'Atlas', 'Nova', undefined]);
    expect(restored.view().seats.map((seat) => seat.player?.role)).toEqual(['spymaster', 'operative', 'spymaster', undefined]);
    expect(restored.hasHandle(registration.playerHandle!)).toBe(true);
  });

  it('aligns both teams by physical column when the human switches roles', () => {
    const roster = new Roster();
    roster.register('Atlas');
    roster.register('Nova', 'red', 'operative');
    roster.register('Orion', 'red', 'spymaster');
    roster.setHumanRole('spymaster');
    expect(roster.view().seats.map((seat) => seat.player?.role)).toEqual([
      'spymaster', 'operative', 'spymaster', 'operative',
    ]);
    expect(roster.view().seats.map((seat) => seat.id)).toEqual([
      'blue-top-left', 'blue-top-right', 'red-bottom-left', 'red-bottom-right',
    ]);
  });
});
