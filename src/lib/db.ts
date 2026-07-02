import Dexie, { type Table } from 'dexie';
import type { DailyDebrief, Strategy, Trade } from '../domain/types';

/**
 * All data lives locally in the browser (IndexedDB) — nothing leaves
 * the trader's machine. Backup/restore is available in Settings.
 */
class EdgeDB extends Dexie {
  trades!: Table<Trade, number>;
  debriefs!: Table<DailyDebrief, number>;
  strategies!: Table<Strategy, number>;

  constructor() {
    super('edge-intelligence');
    this.version(1).stores({
      trades: '++id, date, instrument, domain, strategyId, entryTime, importKey',
      debriefs: '++id, &date',
      strategies: '++id, name, status',
    });
  }
}

export const db = new EdgeDB();

export async function exportBackup(): Promise<string> {
  const [trades, debriefs, strategies] = await Promise.all([
    db.trades.toArray(),
    db.debriefs.toArray(),
    db.strategies.toArray(),
  ]);
  return JSON.stringify(
    { app: 'edge-intelligence', version: 1, exportedAt: new Date().toISOString(), trades, debriefs, strategies },
    null,
    2,
  );
}

export async function importBackup(json: string): Promise<{ trades: number; debriefs: number; strategies: number }> {
  const data = JSON.parse(json);
  if (data?.app !== 'edge-intelligence') throw new Error('Not an Edge Intelligence backup file');
  await db.transaction('rw', db.trades, db.debriefs, db.strategies, async () => {
    await Promise.all([db.trades.clear(), db.debriefs.clear(), db.strategies.clear()]);
    if (data.trades?.length) await db.trades.bulkAdd(data.trades);
    if (data.debriefs?.length) await db.debriefs.bulkAdd(data.debriefs);
    if (data.strategies?.length) await db.strategies.bulkAdd(data.strategies);
  });
  return {
    trades: data.trades?.length ?? 0,
    debriefs: data.debriefs?.length ?? 0,
    strategies: data.strategies?.length ?? 0,
  };
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.trades, db.debriefs, db.strategies, async () => {
    await Promise.all([db.trades.clear(), db.debriefs.clear(), db.strategies.clear()]);
  });
}
