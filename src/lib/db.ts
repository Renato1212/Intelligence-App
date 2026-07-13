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
    // v4: uid index on every table for cloud sync (per-user, cross-device)
    this.version(4).stores({
      trades: '++id, uid, date, instrument, domain, strategyId, entryTime, importKey',
      debriefs: '++id, uid, &date',
      strategies: '++id, uid, name, status',
      preps: '++id, uid, &date',
      photos: '++id, uid, [parentType+parentId]',
    });
    // v3: fixed overnight fields (dollarFx/gold/oil/euStocks/bunds) become a
    // per-day list of chosen markets
    this.version(3).upgrade(async (tx) => {
      const LEGACY_LABELS: Record<string, string> = {
        dollarFx: 'Dollar / FX',
        gold: 'Gold (GC)',
        oil: 'Oil (CL)',
        euStocks: 'EU Stocks (FESX)',
        bunds: 'Bunds (FGBL)',
      };
      await tx
        .table('preps')
        .toCollection()
        .modify((p: DayPrep & { overnight?: Record<string, string> }) => {
          if (!p.overnightMarkets) {
            p.overnightMarkets = Object.entries(p.overnight ?? {})
              .filter(([, note]) => note?.trim())
              .map(([key, note]) => ({ market: LEGACY_LABELS[key] ?? key, note }));
          }
          delete p.overnight;
        });
    });
  }
}

export const db = new EdgeDB();

export function emptyPrep(date: string): DayPrep {
  return {
    date,
    overnightMarkets: [],
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

/**
 * Delete every trade (and each trade's attached photos), leaving debriefs,
 * strategies and preparations intact. Uses Collection.delete() rather than
 * Table.clear() so the per-row `deleting` hook fires — that keeps a signed-in
 * trader's cloud copy in sync (the deletions propagate) instead of the trades
 * reappearing on the next pull. Returns how many trades were removed.
 */
export async function clearTrades(): Promise<number> {
  const count = await db.trades.count();
  await db.transaction('rw', db.trades, db.photos, async () => {
    await db.photos.filter((p) => p.parentType === 'trade').delete();
    await db.trades.toCollection().delete();
  });
  return count;
}
