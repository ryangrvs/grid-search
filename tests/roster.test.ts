import { describe, expect, it } from 'vitest';
import { Roster } from '../server/roster';

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
      { team: 'red', role: 'spymaster' },
      { team: 'red', role: 'operative' },
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
});
