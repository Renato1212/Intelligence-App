import { useState } from 'react';
import type { Photo } from '../domain/types';
import { db } from '../lib/db';
import { dayPackHtml, dayPackMarkdown, downloadFile, openPrintView, SCOPE_TITLES, type DayExportScope } from '../lib/exporters';
import { fmtDate } from '../lib/format';

const SCOPES: DayExportScope[] = ['all', 'prep', 'trades', 'debrief'];
const SCOPE_LABELS: Record<DayExportScope, string> = {
  all: 'Full day',
  prep: 'Preparation only',
  trades: 'Trades only',
  debrief: 'Debrief only',
};
const FILE_PREFIX: Record<DayExportScope, string> = {
  all: 'trading-day',
  prep: 'preparation',
  trades: 'trades',
  debrief: 'debrief',
};

/** Export one date's preparation / trades / debrief — individually or combined. */
export function DayExportBar({ date }: { date: string }) {
  const [scope, setScope] = useState<DayExportScope>('all');

  const run = async (format: 'md' | 'json' | 'print') => {
    const [prep, trades, debrief] = await Promise.all([
      db.preps.where('date').equals(date).first(),
      db.trades.where('date').equals(date).toArray(),
      db.debriefs.where('date').equals(date).first(),
    ]);
    trades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));

    const parentIds: [Photo['parentType'], number][] = [];
    if ((scope === 'all' || scope === 'prep') && prep?.id) parentIds.push(['prep', prep.id]);
    if ((scope === 'all' || scope === 'debrief') && debrief?.id) parentIds.push(['debrief', debrief.id]);
    if (scope === 'all' || scope === 'trades') for (const t of trades) if (t.id) parentIds.push(['trade', t.id]);
    const photos = (
      await Promise.all(parentIds.map(([pt, pid]) => db.photos.where('[parentType+parentId]').equals([pt, pid]).toArray()))
    ).flat();

    const name = `${FILE_PREFIX[scope]}-${date}`;
    if (format === 'md') {
      downloadFile(`${name}.md`, dayPackMarkdown(date, prep, trades, debrief, scope), 'text/markdown');
    } else if (format === 'json') {
      const payload: Record<string, unknown> = { date, scope };
      if (scope === 'all' || scope === 'prep') payload.prep = prep;
      if (scope === 'all' || scope === 'trades') payload.trades = trades;
      if (scope === 'all' || scope === 'debrief') payload.debrief = debrief;
      payload.photos = photos.map((p) => ({ ...p, dataUrl: `[image ${p.name}]` }));
      downloadFile(`${name}.json`, JSON.stringify(payload, null, 2), 'application/json');
    } else {
      openPrintView(`${SCOPE_TITLES[scope]} ${fmtDate(date)}`, dayPackHtml(date, prep, trades, debrief, photos, scope));
    }
  };

  return (
    <div className="row" style={{ gap: 6 }}>
      <span className="small muted">Export:</span>
      {SCOPES.map((s) => (
        <span key={s} className={`chip clickable ${scope === s ? 'selected' : ''}`} onClick={() => setScope(s)}>
          {SCOPE_LABELS[s]}
        </span>
      ))}
      <span style={{ width: 6 }} />
      <button className="btn sm" onClick={() => run('md')}>
        ⬇ Markdown
      </button>
      <button className="btn sm" title="Print-ready view — save as PDF from the print dialog" onClick={() => run('print')}>
        ⬇ PDF / Print
      </button>
      <button className="btn sm" onClick={() => run('json')}>
        ⬇ JSON
      </button>
    </div>
  );
}
