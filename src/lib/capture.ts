import type { Trade } from '../domain/types';
import { db } from './db';
import { importCSV } from './importers';

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

  if (!items.length) {
    throw new Error(
      'No trade tables recognised in the capture. Open the trade log / journal list view in the platform, then run the bookmarklet again.',
    );
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
