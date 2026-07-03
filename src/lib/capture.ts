import type { Side, Trade } from '../domain/types';
import { domainFromLabel } from '../domain/taxonomy';
import { toISODateTime, toNumber } from './csv';
import { db } from './db';
import { importCSV, makeImportKey } from './importers';
import { symbolRoot } from './contracts';

/**
 * "Edge Capture" — the screen-extraction path for platforms with no API and
 * no CSV export (e.g. Trader One). A bookmarklet run on the logged-in page
 * reads every data table in the DOM (plus row images) and produces this JSON
 * payload; here it is parsed with the same header-alias engine as CSV
 * imports, so trade stats, tags, descriptions and photos come across.
 */
export interface CapturePayload {
  source: 'edge-capture';
  version: number;
  url?: string;
  title?: string;
  capturedAt?: string;
  tables: {
    headers: string[];
    rows: string[][];
    rowImages?: { row: number; src: string; dataUrl?: string }[];
  }[];
  /** v2+: JSON API responses recorded while the user browsed the platform */
  requests?: { url: string; body: string }[];
  /** v2+: page structure hints for debugging unsupported layouts */
  diagnostics?: {
    tables?: number;
    ariaGrids?: number;
    iframes?: number;
    crossOriginFrames?: number;
    canvases?: number;
    flutter?: boolean;
    jsonResponses?: number;
    /** v3: how many scan passes ran while recording (~1 per 800ms) */
    scans?: number;
    /** v3: distinct header signatures / total rows accumulated across all scans */
    accumulatedTables?: number;
    accumulatedRows?: number;
    textSample?: string;
  };
}

/** Structured diagnostics shown in the app when a capture yields zero trades. */
export interface CaptureDiagnostics {
  hint: string;
  raw?: CapturePayload['diagnostics'];
  /** Header row + one sample row for every table found, even ones that didn't parse as trades */
  tableSamples: { headers: string[]; sampleRow?: string[] }[];
  /** Flattened field names seen in JSON API responses, even ones rejected as non-trade arrays */
  jsonKeySamples: string[][];
}

export class CaptureError extends Error {
  diagnostics: CaptureDiagnostics;
  constructor(diagnostics: CaptureDiagnostics) {
    super(diagnostics.hint);
    this.name = 'CaptureError';
    this.diagnostics = diagnostics;
  }
}

export interface CaptureItem {
  trade: Trade;
  /** Same-origin images captured as data URLs → become photo attachments */
  images: { name: string; dataUrl: string }[];
  /** Cross-origin images that could not be inlined → become links */
  imageLinks: string[];
}

export interface CaptureParseResult {
  items: CaptureItem[];
  warnings: string[];
  sourceUrl: string;
}

function toCSVText(headers: string[], rows: string[][]): string {
  // quote anything the CSV layer could treat as a separator (it also splits on ; and tab)
  const cell = (v: string) => (/[",;\t\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers, ...rows].map((r) => r.map((c) => cell(c ?? '')).join(',')).join('\n');
}

export function isCapturePayload(text: string): boolean {
  if (!text.trimStart().startsWith('{')) return false;
  try {
    return JSON.parse(text)?.source === 'edge-capture';
  } catch {
    return false;
  }
}

/* ---------- JSON API response extraction (v2 network recording) ---------- */

const JSON_KEYS: Record<string, string[]> = {
  symbol: ['symbol', 'instrument', 'contract', 'market', 'ticker', 'inst', 'sym', 'symbolname', 'instrumentname'],
  date: ['date', 'tradedate', 'day', 'sessiondate'],
  entryTime: ['entrytime', 'opentime', 'entrydate', 'opened', 'openedat', 'openat', 'entryts', 'entryat', 'starttime', 'open', 'entry'],
  exitTime: ['exittime', 'closetime', 'exitdate', 'closed', 'closedat', 'closeat', 'endtime', 'close', 'exit'],
  entryPrice: ['entryprice', 'openprice', 'avgentryprice', 'pricein', 'avgopen', 'entryavg', 'openingprice', 'avgopenprice'],
  exitPrice: ['exitprice', 'closeprice', 'avgexitprice', 'priceout', 'avgclose', 'exitavg', 'closingprice', 'avgcloseprice'],
  qty: ['qty', 'quantity', 'size', 'contracts', 'volume', 'lots', 'totalsize', 'filledqty', 'positionsize'],
  side: ['side', 'direction', 'position', 'buysell', 'longshort', 'positiontype', 'tradeside', 'tradedirection'],
  pnl: [
    'pnl', 'profit', 'profitloss', 'realizedpnl', 'netpnl', 'pl', 'realized', 'netprofit', 'grosspnl',
    'result', 'totalpnl', 'closedpnl', 'tradepnl', 'netamount', 'gainloss',
  ],
  fees: ['commission', 'commissions', 'fees', 'fee'],
  tags: ['tags', 'labels', 'level3'],
  domain: ['tag', 'domain', 'primarytag', 'edgedomain'],
  category: ['subtag', 'category', 'subcategory'],
  description: ['description', 'notes', 'note', 'comment', 'comments', 'journal', 'text', 'debrief'],
  learned: ['learned', 'lesson', 'whatdidyoulearn'],
  applyNext: ['apply', 'howtoapply', 'application'],
  video: ['video', 'videourl', 'recording', 'videolink'],
  images: ['images', 'screenshots', 'photos', 'attachments', 'image', 'screenshot', 'imageurls'],
  account: ['account', 'accountid', 'accountname'],
};

function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Flatten one level of nesting: {entry:{price:1}} → {'entryprice':1}. */
function flatten(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out[normKey(k + k2)] = v2;
    }
    out[normKey(k)] = v;
  }
  return out;
}

function pickKey(flat: Record<string, unknown>, field: string): unknown {
  for (const alias of JSON_KEYS[field]) {
    if (alias in flat && flat[alias] != null && flat[alias] !== '') return flat[alias];
  }
  return undefined;
}

function toWhen(v: unknown, dateHint?: string): string | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    if (isNaN(ms)) return null;
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  const s = String(v).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s) && dateHint) return toISODateTime(`${dateHint} ${s}`);
  if (/^\d{10}(\d{3})?$/.test(s)) return toWhen(Number(s));
  return toISODateTime(s);
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  return toNumber(String(v ?? ''));
}

/** Recursively collect arrays of plain objects from a parsed JSON value. */
function collectArrays(node: unknown, out: Record<string, unknown>[][], depth = 0): void {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    if (node.length && node.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      out.push(node as Record<string, unknown>[]);
    }
    for (const x of node.slice(0, 50)) collectArrays(x, out, depth + 1);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) collectArrays(v, out, depth + 1);
  }
}

function blankJournal() {
  return {
    plannedRisk: null,
    domain: null,
    category: null,
    tags: [] as string[],
    strategyId: null,
    description: '',
    learned: '',
    applyNext: '',
    videoUrl: '',
    grades: {},
  };
}

function objectToItem(raw: Record<string, unknown>): CaptureItem | null {
  const flat = flatten(raw);
  const symbolRaw = pickKey(flat, 'symbol');
  if (typeof symbolRaw !== 'string' || !symbolRaw.trim() || symbolRaw.length > 20) return null;
  const dateHint = pickKey(flat, 'date') != null ? String(pickKey(flat, 'date')) : undefined;
  const entryTime = toWhen(pickKey(flat, 'entryTime'), dateHint) ?? (dateHint ? toISODateTime(dateHint) : null);
  if (!entryTime) return null;
  const pnl = toNum(pickKey(flat, 'pnl'));
  const entryPrice = toNum(pickKey(flat, 'entryPrice'));
  const exitPrice = toNum(pickKey(flat, 'exitPrice'));
  if (pnl == null && entryPrice == null) return null;

  const exitTime = toWhen(pickKey(flat, 'exitTime'), dateHint) ?? entryTime;
  let qty = toNum(pickKey(flat, 'qty')) ?? 1;
  const sideRaw = String(pickKey(flat, 'side') ?? '').toLowerCase();
  let side: Side;
  if (sideRaw.startsWith('l') || sideRaw.startsWith('b')) side = 'LONG';
  else if (sideRaw.startsWith('s')) side = 'SHORT';
  else if (qty < 0) side = 'SHORT';
  else if (pnl != null && entryPrice != null && exitPrice != null && exitPrice !== entryPrice) {
    side = Math.sign(exitPrice - entryPrice) === Math.sign(pnl) ? 'LONG' : 'SHORT';
  } else side = 'LONG';
  qty = Math.abs(qty) || 1;

  const tagsRaw = pickKey(flat, 'tags');
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((x) => String(x).trim()).filter(Boolean)
    : typeof tagsRaw === 'string'
      ? tagsRaw.split(/[;,·|]/).map((x) => x.trim()).filter(Boolean)
      : [];
  const imagesRaw = pickKey(flat, 'images');
  const imageList = Array.isArray(imagesRaw) ? imagesRaw : typeof imagesRaw === 'string' ? [imagesRaw] : [];
  const imageLinks = imageList.map((x) => String(x)).filter((u) => /^https?:/.test(u));

  const t: Trade = {
    date: entryTime.slice(0, 10),
    instrument: symbolRoot(symbolRaw.trim()),
    side,
    entryTime,
    exitTime,
    entryPrice: entryPrice ?? 0,
    exitPrice: exitPrice ?? 0,
    qty,
    pnl: pnl ?? 0,
    fees: Math.abs(toNum(pickKey(flat, 'fees')) ?? 0),
    source: 'capture',
    account: String(pickKey(flat, 'account') ?? '').slice(0, 40),
    ...blankJournal(),
  };
  t.domain = domainFromLabel(typeof pickKey(flat, 'domain') === 'string' ? (pickKey(flat, 'domain') as string) : null);
  const cat = pickKey(flat, 'category');
  t.category = typeof cat === 'string' && cat.trim() ? cat.trim().toLowerCase() : null;
  t.tags = tags;
  const str = (f: string) => {
    const v = pickKey(flat, f);
    return typeof v === 'string' ? v.trim() : '';
  };
  t.description = str('description');
  t.learned = str('learned');
  t.applyNext = str('applyNext');
  t.videoUrl = str('video');
  t.importKey = makeImportKey(t);
  return { trade: t, images: [], imageLinks };
}

function itemsFromRequests(requests: { url: string; body: string }[]): CaptureItem[] {
  const items: CaptureItem[] = [];
  for (const req of requests) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body);
    } catch {
      continue;
    }
    const arrays: Record<string, unknown>[][] = [];
    collectArrays(parsed, arrays);
    for (const arr of arrays) {
      const converted = arr.map(objectToItem).filter((x): x is CaptureItem => x != null);
      // only trust arrays where most objects look like trades — filters out
      // config lists, watchlists, user settings etc.
      if (converted.length && converted.length >= arr.length * 0.5) items.push(...converted);
    }
  }
  return items;
}

export function parseCapture(text: string): CaptureParseResult {
  const payload = JSON.parse(text) as CapturePayload;
  if (payload?.source !== 'edge-capture' || !Array.isArray(payload.tables)) {
    throw new Error('Not an Edge Capture file — run the bookmarklet on the platform page first');
  }
  const warnings: string[] = [];
  const items: CaptureItem[] = [];
  const seen = new Set<string>();

  for (const [ti, table] of payload.tables.entries()) {
    if (!table?.headers?.length || !table?.rows?.length) continue;
    let parsed;
    try {
      parsed = importCSV(toCSVText(table.headers, table.rows));
    } catch {
      continue; // not a trade table (nav, stats grid, ...) — skip silently
    }
    if (parsed.format !== 'trade-log') {
      warnings.push(`Table ${ti + 1} looked like raw fills — captured tables must be completed trades; skipped.`);
      continue;
    }
    const imagesByRow = new Map<number, { src: string; dataUrl?: string }[]>();
    for (const rec of table.rowImages ?? []) {
      if (!imagesByRow.has(rec.row)) imagesByRow.set(rec.row, []);
      imagesByRow.get(rec.row)!.push(rec);
    }
    parsed.trades.forEach((trade, i) => {
      if (trade.importKey && seen.has(trade.importKey)) return;
      if (trade.importKey) seen.add(trade.importKey);
      trade.source = 'capture';
      const rowRecs = imagesByRow.get(parsed.sourceRows[i]) ?? [];
      items.push({
        trade,
        images: rowRecs
          .filter((r) => r.dataUrl?.startsWith('data:image'))
          .map((r, j) => ({ name: `capture-${trade.date}-${j + 1}.jpg`, dataUrl: r.dataUrl! })),
        imageLinks: rowRecs.filter((r) => !r.dataUrl?.startsWith('data:image') && /^https?:/.test(r.src)).map((r) => r.src),
      });
    });
  }

  // v2: trades recorded from the page's own JSON API traffic
  if (payload.requests?.length) {
    for (const item of itemsFromRequests(payload.requests)) {
      if (item.trade.importKey && seen.has(item.trade.importKey)) continue;
      if (item.trade.importKey) seen.add(item.trade.importKey);
      items.push(item);
    }
  }

  if (!items.length) {
    const d = payload.diagnostics;
    const noTraffic = (d?.jsonResponses ?? 0) === 0 && (d?.accumulatedRows ?? d?.tables ?? 0) === 0;
    let hint: string;
    if (noTraffic) {
      hint =
        'Nothing was captured at all — no tables and no recorded network traffic. Click the bookmarklet BEFORE opening the trade log (so it can start recording), then browse your trades, then click the gold badge to finish.';
    } else if ((d?.accumulatedRows ?? 0) === 0 && (d?.jsonResponses ?? 0) > 0) {
      hint =
        'Data traffic was recorded but no trade rows were recognised in it. Import this file anyway — the diagnostics below show the actual field names, which is enough to add support for them.';
    } else {
      hint =
        'Rows were captured but none matched the trade shape closely enough. Import this file anyway — the diagnostics below show what was found.';
    }

    const tableSamples = (payload.tables ?? []).slice(0, 5).map((t) => ({ headers: t.headers, sampleRow: t.rows[0] }));
    const jsonKeySamples: string[][] = [];
    for (const req of payload.requests ?? []) {
      if (jsonKeySamples.length >= 5) break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(req.body);
      } catch {
        continue;
      }
      const arrays: Record<string, unknown>[][] = [];
      collectArrays(parsed, arrays);
      for (const arr of arrays) {
        if (jsonKeySamples.length >= 5) break;
        if (arr[0]) jsonKeySamples.push(Object.keys(flatten(arr[0])));
      }
    }

    throw new CaptureError({ hint, raw: d, tableSamples, jsonKeySamples });
  }
  return { items, warnings, sourceUrl: payload.url ?? '' };
}

/**
 * Merge captured items into the journal. Existing trades (same importKey)
 * are enriched — tags/notes/photos fill empty fields rather than overwrite.
 */
export async function importCapture(items: CaptureItem[]): Promise<{ added: number; enriched: number }> {
  let added = 0;
  let enriched = 0;
  for (const item of items) {
    const t = item.trade;
    const existing = t.importKey ? await db.trades.where('importKey').equals(t.importKey).first() : undefined;
    let id: number;
    if (existing) {
      const patch: Partial<Trade> = {};
      if (!existing.domain && t.domain) patch.domain = t.domain;
      if (!existing.category && t.category) patch.category = t.category;
      if (!existing.tags.length && t.tags.length) patch.tags = t.tags;
      if (!existing.description && t.description) patch.description = t.description;
      if (!existing.learned && t.learned) patch.learned = t.learned;
      if (!existing.videoUrl && t.videoUrl) patch.videoUrl = t.videoUrl;
      if (item.imageLinks.length) {
        const links = existing.links ?? [];
        const fresh = item.imageLinks.filter((u) => !links.some((l) => l.url === u));
        if (fresh.length) patch.links = [...links, ...fresh.map((u, i) => ({ label: `Capture image ${i + 1}`, url: u }))];
      }
      if (Object.keys(patch).length) {
        await db.trades.update(existing.id!, patch);
        enriched++;
      }
      id = existing.id!;
    } else {
      if (item.imageLinks.length) {
        t.links = item.imageLinks.map((u, i) => ({ label: `Capture image ${i + 1}`, url: u }));
      }
      id = await db.trades.add(t);
      added++;
    }
    for (const img of item.images) {
      const dupe = await db.photos
        .where('[parentType+parentId]')
        .equals(['trade', id])
        .filter((p) => p.dataUrl === img.dataUrl)
        .first();
      if (!dupe) {
        await db.photos.add({ parentType: 'trade', parentId: id, name: img.name, dataUrl: img.dataUrl, createdAt: new Date().toISOString() });
      }
    }
  }
  return { added, enriched };
}
