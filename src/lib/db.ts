import Dexie, { type Table } from 'dexie';
import type { DailyDebrief, DayPrep, Photo, Strategy, Trade } from '../domain/types';

/**
 * All data lives locally in the browser (IndexedDB) — nothing leaves
 * the trader's machine. Backup/restore is available in Settings.
 */
class EdgeDB extends Dexie {
  trades!: Table<Trade, number>;
  debriefs!: Table<DailyDebrief, number>;
  strategies!: Table<Strategy, number>;
  preps!: Table<DayPrep, number>;
  photos!: Table<Photo, number>;

  constructor() {
    super('edge-intelligence');
    this.version(1).stores({
      trades: '++id, date, instrument, domain, strategyId, entryTime, importKey',
      debriefs: '++id, &date',
      strategies: '++id, name, status',
    });
    this.version(2).stores({
      trades: '++id, date, instrument, domain, strategyId, entryTime, importKey',
      debriefs: '++id, &date',
      strategies: '++id, name, status',
      preps: '++id, &date',
      photos: '++id, [parentType+parentId]',
    });
  }
}

export const db = new EdgeDB();

export function emptyPrep(date: string): DayPrep {
  return {
    date,
    overnight: { dollarFx: '', gold: '', oil: '', euStocks: '', bunds: '' },
    overnightMoved: '',
    overnightImplication: '',
    newsPricedIn: '',
    newsDeveloping: '',
    events: [],
    dailyChart: '',
    profile: '',
    sixtyMin: '',
    fiveMin: '',
    hypotheses: [
      { title: 'H1 Red', inPlay: '', lineInSand: '', expectation: '' },
      { title: 'H2 Blue', inPlay: '', lineInSand: '', expectation: '' },
      { title: 'H3 Green', inPlay: '', lineInSand: '', expectation: '' },
    ],
    videoUrl: '',
    links: [],
  };
}

export async function exportBackup(): Promise<string> {
  const [trades, debriefs, strategies, preps, photos] = await Promise.all([
    db.trades.toArray(),
    db.debriefs.toArray(),
    db.strategies.toArray(),
    db.preps.toArray(),
    db.photos.toArray(),
  ]);
  return JSON.stringify(
    {
      app: 'edge-intelligence',
      version: 2,
      exportedAt: new Date().toISOString(),
      trades,
      debriefs,
      strategies,
      preps,
      photos,
    },
    null,
    2,
  );
}

export async function importBackup(json: string): Promise<{ trades: number; debriefs: number; strategies: number; preps: number; photos: number }> {
  const data = JSON.parse(json);
  if (data?.app !== 'edge-intelligence') throw new Error('Not an Edge Intelligence backup file');
  await db.transaction('rw', db.trades, db.debriefs, db.strategies, db.preps, db.photos, async () => {
    await Promise.all([db.trades.clear(), db.debriefs.clear(), db.strategies.clear(), db.preps.clear(), db.photos.clear()]);
    if (data.trades?.length) await db.trades.bulkAdd(data.trades);
    if (data.debriefs?.length) await db.debriefs.bulkAdd(data.debriefs);
    if (data.strategies?.length) await db.strategies.bulkAdd(data.strategies);
    if (data.preps?.length) await db.preps.bulkAdd(data.preps);
    if (data.photos?.length) await db.photos.bulkAdd(data.photos);
  });
  return {
    trades: data.trades?.length ?? 0,
    debriefs: data.debriefs?.length ?? 0,
    strategies: data.strategies?.length ?? 0,
    preps: data.preps?.length ?? 0,
    photos: data.photos?.length ?? 0,
  };
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.trades, db.debriefs, db.strategies, db.preps, db.photos, async () => {
    await Promise.all([db.trades.clear(), db.debriefs.clear(), db.strategies.clear(), db.preps.clear(), db.photos.clear()]);
  });
}
