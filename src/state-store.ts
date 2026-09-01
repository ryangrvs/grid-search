import type { PersistedGame } from './game';
import type { PersistedRoster } from './roster';

export interface PersistedState {
  version: 1;
  game: PersistedGame;
  roster: PersistedRoster;
}

/** Synchronous storage boundary used by the browser controller. */
export interface StateStore {
  load(): unknown;
  save(snapshot: PersistedState): void;
}

/** In-memory adapter for tests and embedders. */
export class MemoryStateStore implements StateStore {
  private snapshot: unknown;

  constructor(initial: unknown = null) { this.snapshot = clone(initial); }
  load(): unknown { return clone(this.snapshot); }
  save(snapshot: PersistedState): void { this.snapshot = clone(snapshot); }
}

/** Versioned browser adapter. Storage failures leave the current session in memory. */
export class LocalStorageStateStore implements StateStore {
  static readonly key = 'semanticspy.state.v1';
  static readonly legacyRosterKey = 'semanticspy.roster.v1';

  constructor(private readonly storage: Storage | undefined = browserStorage(), private readonly key = LocalStorageStateStore.key) {}

  load(): unknown {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.key);
      return raw ? JSON.parse(raw) as unknown : null;
    } catch {
      return null;
    }
  }

  save(snapshot: PersistedState): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(snapshot));
      if (this.key === LocalStorageStateStore.key) this.storage?.removeItem(LocalStorageStateStore.legacyRosterKey);
    } catch { /* Private browsing or quota limits leave the session-only state active. */ }
  }
}

function browserStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function clone(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as unknown;
}
