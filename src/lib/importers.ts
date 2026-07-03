import type { Side, Trade, TradeSource } from '../domain/types';
import { categoryFromLabel, domainFromLabel } from '../domain/taxonomy';
import { headerKey, parseCSV, toISODateTime, toNumber } from './csv';
import { pointValue, symbolRoot } from './contracts';

export interface ImportResult {
  trades: Trade[];
  format: 'trade-log' | 'fills';
  warnings: string[];
  /** For trade-log parses: index of the source data row each trade came from (aligned with `trades`). */
  sourceRows: number[];
}

/** Find the index of the first header matching any alias (by normalized key). */
function findCol(headers: string[], aliases: string[]): number {
  const keys = headers.map(headerKey);
  for (const alias of aliases) {
    const i = keys.indexOf(headerKey(alias));
    if (i >= 0) return i;
  }
  // substring fallback
  for (const alias of aliases) {
    const a = headerKey(alias);
    const i = keys.findIndex((k) => k.includes(a) && a.length >= 4);
    if (i >= 0) return i;
  }
  return -1;
}

const COLS = {
  symbol: ['symbol', 'instrument', 'contract', 'market', 'ticker', 'security', 'inst', 'product', 'product code'],
  /** Trade date when the export splits date and times into separate columns (Trader One style) */
  date: ['date', 'trade date', 'trade day', 'trading day', 'day'],
  entryTime: ['entry date', 'entry time', 'entry date/time', 'open time', 'opened', 'entrydt', 'date/time', 'open', 'entry'],
  exitTime: ['exit date', 'exit time', 'exit date/time', 'close time', 'closed', 'exitdt', 'close', 'exit'],
  entryPrice: ['entry price', 'open price', 'avg entry price', 'price in', 'buy price', 'entry'],
  exitPrice: ['exit price', 'close price', 'avg exit price', 'price out', 'sell price', 'exit'],
  qty: ['quantity', 'qty', 'size', 'contracts', 'volume', 'filled qty', 'total size', 'lots', 'position'],
  side: ['side', 'direction', 'position', 'long/short', 'buy/sell', 'b/s', 'type', 'action'],
  pnl: ['realized p/l', 'realized pl', 'p/l', 'pl', 'pnl', 'profit', 'profit/loss', 'net p/l', 'net pnl', 'realized profit'],
  fees: ['commission', 'commissions', 'fees', 'fee', 'costs'],
  account: ['account', 'account id', 'acct'],
  // journal columns (Trader One captures, journal exports)
  domainTag: ['tag', 'domain', 'primary tag', 'edge domain'],
  category: ['sub tag', 'subtag', 'category', 'sub-tag'],
  tags: ['tags', 'labels', 'level 3', 'refinements'],
  description: ['description', 'notes', 'note', 'comment', 'comments'],
  learned: ['learned', 'lesson', 'what did you learn'],
  applyNext: ['apply', 'how to apply', 'application'],
  video: ['video', 'video url', 'recording'],
  // fill-mode columns
  fillTime: ['update time', 'fill time', 'time', 'timestamp', 'transact time', 'date/time', 'created time', 'time of update'],
  fillPrice: ['avg fill price', 'fill price', 'price', 'avg price', 'trade price'],
  fillQty: ['filled qty', 'qty filled', 'fill qty', 'quantity', 'qty', 'exec qty', 'filled'],
  status: ['status', 'order status'],
};

function normalizeSide(raw: string | undefined, pnlHint?: { entry: number; exit: number; pnl: number | null }): Side {
  const s = (raw ?? '').trim().toLowerCase();
  if (s.startsWith('l') || s === 'buy' || s === 'b' || s === 'bot' || s === 'bought') return 'LONG';
  if (s.startsWith('s') && s !== 'stopped') return 'SHORT';
  if (s === 'sell' || s === 'sld' || s === 'sold') return 'SHORT';
  if (pnlHint && pnlHint.pnl != null) {
    const longPnl = pnlHint.exit - pnlHint.entry;
    return Math.sign(longPnl) === Math.sign(pnlHint.pnl) || pnlHint.pnl === 0 ? 'LONG' : 'SHORT';
  }
  return 'LONG';
}

function blankTradeFields() {
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

export function makeImportKey(t: Pick<Trade, 'instrument' | 'entryTime' | 'exitTime' | 'qty' | 'side'>): string {
  return [t.instrument, t.entryTime, t.exitTime, t.qty, t.side].join('|');
}

/** Rows that are completed round-trips (MotiveWave trade log, generic journal exports). */
function parseTradeLog(
  headers: string[],
  rows: string[][],
  source: TradeSource,
  warnings: string[],
  sourceRows: number[] = [],
): Trade[] {
  const ci = {
    symbol: findCol(headers, COLS.symbol),
    date: findCol(headers, COLS.date),
    entryTime: findCol(headers, COLS.entryTime),
    exitTime: findCol(headers, COLS.exitTime),
    entryPrice: findCol(headers, COLS.entryPrice),
    exitPrice: findCol(headers, COLS.exitPrice),
    qty: findCol(headers, COLS.qty),
    side: findCol(headers, COLS.side),
    pnl: findCol(headers, COLS.pnl),
    fees: findCol(headers, COLS.fees),
    account: findCol(headers, COLS.account),
    domainTag: findCol(headers, COLS.domainTag),
    category: findCol(headers, COLS.category),
    tags: findCol(headers, COLS.tags),
    description: findCol(headers, COLS.description),
    learned: findCol(headers, COLS.learned),
    applyNext: findCol(headers, COLS.applyNext),
    video: findCol(headers, COLS.video),
  };
  const trades: Trade[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const get = (i: number) => (i >= 0 ? row[i] : undefined);
    const symbol = (get(ci.symbol) ?? '').trim();
    if (!symbol) continue;
    // Trader One-style exports split the trade date from time-only open/close columns
    const dateRaw = (get(ci.date) ?? '').trim();
    const when = (cell: string | undefined): string | null => {
      const c = (cell ?? '').trim();
      if (dateRaw && /^\d{1,2}:\d{2}(:\d{2})?$/.test(c)) return toISODateTime(`${dateRaw} ${c}`);
      return toISODateTime(c) ?? (dateRaw ? toISODateTime(dateRaw) : null);
    };
    const entryTime = when(get(ci.entryTime));
    const exitTime = when(get(ci.exitTime)) ?? entryTime;
    if (!entryTime) {
      warnings.push(`Skipped row with unparseable entry time: "${get(ci.entryTime) ?? ''}"`);
      continue;
    }
    const entryPrice = toNumber(get(ci.entryPrice)) ?? 0;
    const exitPrice = toNumber(get(ci.exitPrice)) ?? 0;
    const qty = Math.abs(toNumber(get(ci.qty)) ?? 0) || 1;
    let pnl = toNumber(get(ci.pnl));
    const fees = Math.abs(toNumber(get(ci.fees)) ?? 0);
    const side = normalizeSide(get(ci.side), { entry: entryPrice, exit: exitPrice, pnl });
    if (pnl == null) {
      const pv = pointValue(symbol);
      const move = side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice;
      pnl = move * pv * qty - fees;
    }
    const instrument = symbolRoot(symbol);
    const t: Trade = {
      date: entryTime.slice(0, 10),
      instrument,
      side,
      entryTime,
      exitTime: exitTime ?? entryTime,
      entryPrice,
      exitPrice,
      qty,
      pnl,
      fees,
      source,
      account: (get(ci.account) ?? '').trim(),
      ...blankTradeFields(),
    };
    // journal columns, when the export carries them (Trader One captures etc.)
    t.domain = domainFromLabel(get(ci.domainTag));
    t.category = (get(ci.category) ?? '').trim().toLowerCase() || null;
    const rawTags = (get(ci.tags) ?? '').trim();
    if (rawTags) {
      // "×" is the remove-button glyph next to each tag chip in Trader One's
      // UI — it doubles as the separator when the cell text is captured
      t.tags = rawTags
        .split(/[;,·|×]/)
        .map((x) => x.trim())
        .filter((x) => x && !/^(\+|add( tag)?|\+ add)$/i.test(x));
    }
    // Trader One tags a trade as one chain: Domain × Category × ... × free text.
    // Fold the leading entries into the taxonomy when they match.
    if (!t.domain && t.tags.length) {
      const inferred = domainFromLabel(t.tags[0]);
      if (inferred) {
        t.domain = inferred;
        t.tags = t.tags.slice(1);
        if (t.tags.length) {
          const cat = categoryFromLabel(inferred, t.tags[0]);
          if (cat) {
            t.category = cat;
            t.tags = t.tags.slice(1);
          }
        }
        t.tags = t.tags.filter((x) => x.toLowerCase() !== 'other');
      }
    }
    const cleanText = (v: string | undefined): string => {
      const s = (v ?? '').replace(/×/g, ' ').replace(/\s+/g, ' ').trim();
      // placeholder button text captured from empty journal cells
      if (/^(description|notes?|add (a )?(description|note)|learned|video)$/i.test(s)) return '';
      return s;
    };
    t.description = cleanText(get(ci.description));
    t.learned = cleanText(get(ci.learned));
    t.applyNext = cleanText(get(ci.applyNext));
    t.videoUrl = cleanText(get(ci.video));
    t.importKey = makeImportKey(t);
    trades.push(t);
    sourceRows.push(rowIdx);
  }
  return trades;
}

interface Fill {
  time: string;
  price: number;
  qty: number;
  isBuy: boolean;
}

/** Raw fills (Rithmic R Trader Pro export) → round-trip trades, FIFO per symbol. */
function parseFills(headers: string[], rows: string[][], warnings: string[]): Trade[] {
  const ci = {
    symbol: findCol(headers, COLS.symbol),
    side: findCol(headers, COLS.side),
    time: findCol(headers, COLS.fillTime),
    price: findCol(headers, COLS.fillPrice),
    qty: findCol(headers, COLS.fillQty),
    status: findCol(headers, COLS.status),
    account: findCol(headers, COLS.account),
  };
  const bySymbol = new Map<string, Fill[]>();
  const accounts = new Map<string, string>();
  for (const row of rows) {
    const get = (i: number) => (i >= 0 ? row[i] : undefined);
    const symbol = (get(ci.symbol) ?? '').trim();
    if (!symbol) continue;
    const status = (get(ci.status) ?? '').toLowerCase();
    if (ci.status >= 0 && status && !status.includes('fill') && !status.includes('complete')) continue;
    const time = toISODateTime(get(ci.time));
    const price = toNumber(get(ci.price));
    const qty = Math.abs(toNumber(get(ci.qty)) ?? 0);
    if (!time || price == null || !qty) continue;
    const sideRaw = (get(ci.side) ?? '').trim().toLowerCase();
    const isBuy = sideRaw.startsWith('b') || sideRaw === 'long';
    const key = symbol.toUpperCase();
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key)!.push({ time, price, qty, isBuy });
    const acct = (get(ci.account) ?? '').trim();
    if (acct) accounts.set(key, acct);
  }

  const trades: Trade[] = [];
  for (const [symbol, fills] of bySymbol) {
    fills.sort((a, b) => a.time.localeCompare(b.time));
    const pv = pointValue(symbol);
    const instrument = symbolRoot(symbol);
    // walk fills, closing a round trip every time net position returns to zero
    let position = 0;
    let legFills: Fill[] = [];
    for (const f of fills) {
      legFills.push(f);
      position += f.isBuy ? f.qty : -f.qty;
      if (position === 0 && legFills.length > 1) {
        const buys = legFills.filter((x) => x.isBuy);
        const sells = legFills.filter((x) => !x.isBuy);
        const buyQty = buys.reduce((s, x) => s + x.qty, 0);
        const sellQty = sells.reduce((s, x) => s + x.qty, 0);
        const avg = (xs: Fill[], q: number) => (q ? xs.reduce((s, x) => s + x.price * x.qty, 0) / q : 0);
        const avgBuy = avg(buys, buyQty);
        const avgSell = avg(sells, sellQty);
        const side: Side = legFills[0].isBuy ? 'LONG' : 'SHORT';
        const qty = Math.max(buyQty, sellQty);
        const pnl = (avgSell - avgBuy) * pv * Math.min(buyQty, sellQty);
        const t: Trade = {
          date: legFills[0].time.slice(0, 10),
          instrument,
          side,
          entryTime: legFills[0].time,
          exitTime: legFills[legFills.length - 1].time,
          entryPrice: side === 'LONG' ? avgBuy : avgSell,
          exitPrice: side === 'LONG' ? avgSell : avgBuy,
          qty,
          pnl,
          fees: 0,
          source: 'rithmic',
          account: accounts.get(symbol) ?? '',
          ...blankTradeFields(),
        };
        t.importKey = makeImportKey(t);
        trades.push(t);
        legFills = [];
      }
    }
    if (position !== 0) {
      warnings.push(`${symbol}: ${Math.abs(position)} contract(s) still open at end of file — open position skipped.`);
    }
  }
  trades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));
  return trades;
}

/**
 * Auto-detect the file format and parse:
 *  - MotiveWave trade-log / generic completed-trade exports → one trade per row
 *  - Rithmic R Trader Pro fills/orders export → FIFO round-trip construction
 */
export function importCSV(text: string): ImportResult {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('File has no data rows');

  // Some Rithmic exports carry preamble lines before the real header —
  // find the first row that contains a recognizable symbol column.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (findCol(rows[i], COLS.symbol) >= 0) {
      headerIdx = i;
      break;
    }
  }
  const headers = rows[headerIdx];
  const dataRows = rows.slice(headerIdx + 1);
  const warnings: string[] = [];

  const hasExit = findCol(headers, COLS.exitTime) >= 0 || findCol(headers, COLS.exitPrice) >= 0;
  const hasPnl = findCol(headers, COLS.pnl) >= 0;

  if (hasExit || hasPnl) {
    const source: TradeSource = headers.some((h) => headerKey(h).includes('motivewave')) ? 'motivewave' : 'csv';
    const sourceRows: number[] = [];
    const trades = parseTradeLog(headers, dataRows, source, warnings, sourceRows);
    if (!trades.length) throw new Error('No trades could be parsed — check the file format');
    return { trades, format: 'trade-log', warnings, sourceRows };
  }

  const trades = parseFills(headers, dataRows, warnings);
  if (!trades.length) throw new Error('No completed round-trip trades found in fills — check the file format');
  return { trades, format: 'fills', warnings, sourceRows: [] };
}
