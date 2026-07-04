import { createClient, type Session, type User } from '@supabase/supabase-js';
import { db } from './db';

/**
 * Cloud accounts & sync (Supabase).
 *
 * Design: IndexedDB stays the source the UI reads (fast, offline-capable);
 * every local write is mirrored to a per-user `ei_records` row keyed by a
 * stable uuid (`uid`), protected by row-level security. On sign-in the
 * remote state is pulled and local ids are re-mapped so cross-record
 * references (trade→strategy, photo→parent) stay intact across devices.
 *
 * The anon key below is a public client credential by design — all data
 * access is enforced by RLS policies on the server.
 */
const SUPABASE_URL = 'https://cgttccgreglscijytwuo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_BYO4N52GLSybEk1J3sLeaA_RMJPOxMC';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type TableName = 'trades' | 'debriefs' | 'preps' | 'strategies' | 'photos';
const TABLES: TableName[] = ['strategies', 'trades', 'debriefs', 'preps', 'photos'];
const LAST_USER_KEY = 'ei-last-user';
const LOCAL_ONLY_KEY = 'ei-local-only';

/* ---------- auth readiness (for the login gate) ---------- */

let authReady = false;
const authListeners = new Set<() => void>();

export function isAuthReady(): boolean {
  return authReady;
}

/** Fires whenever the signed-in user or local-only preference changes. */
export function onAuthChange(fn: () => void): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

function notifyAuth(): void {
  for (const fn of authListeners) fn();
}

/** Whether the trader chose to use the app on this device without an account. */
export function isLocalOnly(): boolean {
  return localStorage.getItem(LOCAL_ONLY_KEY) === '1';
}

export function setLocalOnly(v: boolean): void {
  if (v) localStorage.setItem(LOCAL_ONLY_KEY, '1');
  else localStorage.removeItem(LOCAL_ONLY_KEY);
  notifyAuth();
}

export type SyncState = { status: 'off' | 'syncing' | 'idle' | 'error'; detail?: string; lastSync?: string };

let state: SyncState = { status: 'off' };
const listeners = new Set<(s: SyncState) => void>();

function setState(next: SyncState) {
  state = next;
  for (const fn of listeners) fn(state);
}

export function getSyncState(): SyncState {
  return state;
}

export function onSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

/** True while we are writing remote data into Dexie — hooks must not echo it back. */
let applyingRemote = false;
let session: Session | null = null;
const dirtyTables = new Set<TableName>();
const pendingDeletes: { table: TableName; uid: string }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(table: TableName) {
  if (applyingRemote) return;
  dirtyTables.add(table);
  if (!session) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 2500);
}

async function ensureUids(table: TableName): Promise<void> {
  const rows = await db.table(table).toArray();
  const missing = rows.filter((r) => !r.uid);
  if (!missing.length) return;
  applyingRemote = true;
  try {
    await db.table(table).bulkPut(missing.map((r) => ({ ...r, uid: crypto.randomUUID() })));
  } finally {
    applyingRemote = false;
  }
}

type PushRecord = { uid: string; user_id: string; table_name: TableName; payload: Record<string, unknown>; updated_at: string };

/**
 * Build the rows to upsert for a table, enriching cross-table references
 * with the STABLE uid of the record they point to (not the local numeric
 * id, which is only valid on the device that assigned it — two devices can
 * independently reuse the same auto-increment number for unrelated
 * records). Trades carry `strategyUid`; photos carry `parentUid`. Both are
 * resolved back to a local id during rebuild in `fullSync`.
 */
async function buildRecords(table: TableName): Promise<PushRecord[]> {
  await ensureUids(table);
  const rows = await db.table(table).toArray();
  const now = new Date().toISOString();

  let strategyUidById: Map<number, string> | null = null;
  if (table === 'trades') {
    const strategies = await db.strategies.toArray();
    strategyUidById = new Map(strategies.filter((s) => s.id != null && s.uid).map((s) => [s.id as number, s.uid as string]));
  }
  let parentUidMaps: Record<string, Map<number, string>> | null = null;
  if (table === 'photos') {
    const [trades, debriefs, preps] = await Promise.all([db.trades.toArray(), db.debriefs.toArray(), db.preps.toArray()]);
    parentUidMaps = {
      trade: new Map(trades.filter((t) => t.id != null && t.uid).map((t) => [t.id as number, t.uid as string])),
      debrief: new Map(debriefs.filter((d) => d.id != null && d.uid).map((d) => [d.id as number, d.uid as string])),
      prep: new Map(preps.filter((p) => p.id != null && p.uid).map((p) => [p.id as number, p.uid as string])),
    };
  }

  // demo/sample data is throwaway and must never reach a real cloud profile
  const source = rows.filter((r) => (table === 'trades' ? (r as { source?: string }).source !== 'demo' : true));

  return source.map((r) => {
    const payload: Record<string, unknown> = { ...r };
    if (strategyUidById) {
      const sid = (r as { strategyId?: number | null }).strategyId;
      payload.strategyUid = typeof sid === 'number' ? (strategyUidById.get(sid) ?? null) : null;
    }
    if (parentUidMaps) {
      const rec = r as { parentType: string; parentId: number };
      payload.parentUid = parentUidMaps[rec.parentType]?.get(rec.parentId) ?? null;
    }
    return { uid: r.uid as string, user_id: session!.user.id, table_name: table, payload, updated_at: now };
  });
}

async function pushTable(table: TableName): Promise<void> {
  const records = await buildRecords(table);
  const chunkSize = table === 'photos' ? 15 : 200;
  for (let i = 0; i < records.length; i += chunkSize) {
    const { error } = await supabase.from('ei_records').upsert(records.slice(i, i + chunkSize), { onConflict: 'uid' });
    if (error) throw new Error(error.message);
  }
}

async function flush(): Promise<void> {
  if (!session) return;
  const tables = [...dirtyTables];
  dirtyTables.clear();
  const deletes = pendingDeletes.splice(0);
  setState({ ...state, status: 'syncing' });
  try {
    for (const t of tables) await pushTable(t);
    if (deletes.length) {
      const { error } = await supabase.from('ei_records').delete().in('uid', deletes.map((d) => d.uid));
      if (error) throw new Error(error.message);
    }
    setState({ status: 'idle', lastSync: new Date().toISOString() });
  } catch (e) {
    // retry on next change
    for (const t of tables) dirtyTables.add(t);
    pendingDeletes.push(...deletes);
    setState({ status: 'error', detail: e instanceof Error ? e.message : String(e) });
  }
}

async function fetchRemote(table: TableName): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const page = 500;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('ei_records')
      .select('uid, payload, updated_at')
      .eq('table_name', table)
      .order('updated_at', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) out.push({ ...(row.payload as Record<string, unknown>), uid: row.uid, __updatedAt: row.updated_at });
    if (!data || data.length < page) break;
  }
  return out;
}

/**
 * debriefs and preps have a UNIQUE(date) index locally, but two devices can
 * each create a record for the same date offline. Keep the most recently
 * updated per date so the rebuild never hits a constraint error.
 */
function dedupeByDate(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byDate = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const date = String(r.date ?? '');
    const existing = byDate.get(date);
    if (!existing || String(r.__updatedAt ?? '') >= String(existing.__updatedAt ?? '')) byDate.set(date, r);
  }
  return [...byDate.values()];
}

/**
 * Pull the account's data and make it the local state. Local records whose
 * uid is unknown remotely are pushed first (covers "used offline, then
 * signed in"), then everything is rebuilt locally with ids re-mapped so
 * strategy links and photo parents stay correct.
 */
export async function fullSync(): Promise<void> {
  if (!session) throw new Error('Not signed in');
  setState({ ...state, status: 'syncing' });
  try {
    // 1. push local records the server doesn't know yet
    for (const t of TABLES) {
      await ensureUids(t);
      const localRows = await db.table(t).toArray();
      if (!localRows.length) continue;
      const { data, error } = await supabase.from('ei_records').select('uid').eq('table_name', t);
      if (error) throw new Error(error.message);
      const remoteUids = new Set((data ?? []).map((r) => r.uid));
      const freshUids = new Set(localRows.filter((r) => !remoteUids.has(r.uid)).map((r) => r.uid as string));
      if (freshUids.size) {
        const records = (await buildRecords(t)).filter((rec) => freshUids.has(rec.uid));
        const chunkSize = t === 'photos' ? 15 : 200;
        for (let i = 0; i < records.length; i += chunkSize) {
          const { error: e2 } = await supabase.from('ei_records').upsert(records.slice(i, i + chunkSize), { onConflict: 'uid' });
          if (e2) throw new Error(e2.message);
        }
      }
    }

    // 2. pull everything and rebuild local with id re-mapping
    const remote: Record<TableName, Record<string, unknown>[]> = {
      strategies: await fetchRemote('strategies'),
      trades: await fetchRemote('trades'),
      debriefs: dedupeByDate(await fetchRemote('debriefs')),
      preps: dedupeByDate(await fetchRemote('preps')),
      photos: await fetchRemote('photos'),
    };
    // strip the transient sort field before anything is written to Dexie
    for (const t of TABLES) for (const r of remote[t]) delete r.__updatedAt;

    applyingRemote = true;
    try {
      await db.transaction('rw', db.trades, db.debriefs, db.strategies, db.preps, db.photos, async () => {
        await Promise.all(TABLES.map((t) => db.table(t).clear()));
        // keyed by the record's own stable uid — never by its local numeric
        // id, which is only meaningful on the device that assigned it
        const stratMap = new Map<string, number>();
        for (const p of remote.strategies) {
          const uid = p.uid as string;
          const { id: _drop, ...rest } = p;
          void _drop;
          const newId = (await db.strategies.add(rest as never)) as number;
          stratMap.set(uid, newId);
        }
        const parentMaps: Record<'trade' | 'debrief' | 'prep', Map<string, number>> = { trade: new Map(), debrief: new Map(), prep: new Map() };
        for (const p of remote.trades) {
          const uid = p.uid as string;
          const strategyUid = p.strategyUid as string | null | undefined;
          const { id: _drop, strategyUid: _drop2, ...rest } = p as Record<string, unknown>;
          void _drop;
          void _drop2;
          const rec = rest as { strategyId?: number | null };
          rec.strategyId = strategyUid ? (stratMap.get(strategyUid) ?? null) : null;
          const newId = (await db.trades.add(rest as never)) as number;
          parentMaps.trade.set(uid, newId);
        }
        for (const p of remote.debriefs) {
          const uid = p.uid as string;
          const { id: _drop, ...rest } = p;
          void _drop;
          const newId = (await db.debriefs.add(rest as never)) as number;
          parentMaps.debrief.set(uid, newId);
        }
        for (const p of remote.preps) {
          const uid = p.uid as string;
          const { id: _drop, ...rest } = p;
          void _drop;
          const newId = (await db.preps.add(rest as never)) as number;
          parentMaps.prep.set(uid, newId);
        }
        for (const p of remote.photos) {
          const parentUid = p.parentUid as string | null | undefined;
          const { id: _drop, parentUid: _drop2, ...rest } = p as Record<string, unknown>;
          void _drop;
          void _drop2;
          const rec = rest as { parentType: 'trade' | 'debrief' | 'prep'; parentId: number };
          const mapped = parentUid ? parentMaps[rec.parentType]?.get(parentUid) : undefined;
          if (mapped == null) continue; // orphan photo — parent gone
          rec.parentId = mapped;
          await db.photos.add(rest as never);
        }
      });
    } finally {
      applyingRemote = false;
    }
    // remote is authoritative and already carries stable uids + uid-based
    // cross-references, so the freshly rebuilt local state mirrors it — no
    // re-push needed (cross-device links resolve by uid, not local id).
    dirtyTables.clear();
    setState({ status: 'idle', lastSync: new Date().toISOString() });
  } catch (e) {
    setState({ status: 'error', detail: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/* ---------- auth ---------- */

export function currentUser(): User | null {
  return session?.user ?? null;
}

export async function signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

async function onSignedIn(s: Session): Promise<void> {
  session = s;
  localStorage.removeItem(LOCAL_ONLY_KEY); // signing in supersedes local-only mode
  // demo/sample data is throwaway exploration data and must never merge
  // into a real cloud account — strip it before anything gets pushed
  applyingRemote = true;
  try {
    const demoTrades = await db.trades.filter((t) => t.source === 'demo').toArray();
    if (demoTrades.length) await db.trades.bulkDelete(demoTrades.map((t) => t.id!));
  } finally {
    applyingRemote = false;
  }
  const lastUser = localStorage.getItem(LAST_USER_KEY);
  if (lastUser && lastUser !== s.user.id) {
    // a different trader used this browser before — never mix accounts
    applyingRemote = true;
    try {
      await db.transaction('rw', db.trades, db.debriefs, db.strategies, db.preps, db.photos, async () => {
        await Promise.all(TABLES.map((t) => db.table(t).clear()));
      });
    } finally {
      applyingRemote = false;
    }
  }
  localStorage.setItem(LAST_USER_KEY, s.user.id);
  try {
    await fullSync();
  } catch {
    // state already set to error; user can retry from the Account page
  }
}

let hooksRegistered = false;

function registerHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  for (const t of TABLES) {
    const table = db.table(t);
    table.hook('creating', function (_pk, obj: { uid?: string }) {
      if (!obj.uid) obj.uid = crypto.randomUUID();
      scheduleFlush(t);
    });
    table.hook('updating', function (_mods, _pk, obj: { uid?: string }) {
      scheduleFlush(t);
      if (!obj.uid) return { uid: crypto.randomUUID() };
      return undefined;
    });
    table.hook('deleting', function (_pk, obj: { uid?: string }) {
      if (!applyingRemote && obj?.uid && session) pendingDeletes.push({ table: t, uid: obj.uid });
      scheduleFlush(t);
    });
  }
}

/** Call once at app boot. */
export function initCloud(): void {
  registerHooks();
  const markReady = () => {
    if (!authReady) {
      authReady = true;
      notifyAuth();
    }
  };
  supabase.auth.onAuthStateChange((event, s) => {
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') && s) {
      const first = !session;
      session = s;
      if (first && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) void onSignedIn(s);
      notifyAuth();
    } else if (event === 'SIGNED_OUT') {
      session = null;
      setState({ status: 'off' });
      notifyAuth();
    } else if (event === 'INITIAL_SESSION') {
      notifyAuth();
    }
    markReady();
  });
  // Fallback: if the auth backend is unreachable (offline / blocked), don't
  // leave the app stuck on a splash — resolve as "no session" after 2.5s.
  setTimeout(markReady, 2500);
}

/* ---------- media storage ---------- */

/** Upload a photo/video to the account's cloud folder; returns a shareable URL. */
export async function uploadMedia(file: File): Promise<string> {
  if (!session) throw new Error('Sign in on the Account page to upload media to the cloud');
  if (file.size > 200 * 1024 * 1024) throw new Error('File too large (200 MB max)');
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `${session.user.id}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from('ei-media').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error(error.message);
  return supabase.storage.from('ei-media').getPublicUrl(path).data.publicUrl;
}
