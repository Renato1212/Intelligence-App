import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import type { DailyDebrief } from '../domain/types';
import { db } from '../lib/db';
import { dayPackHtml, dayPackMarkdown, downloadFile, openPrintView } from '../lib/exporters';
import { fmtDate } from '../lib/format';
import { MediaEditor } from './media';
import { useToast } from './ui';

function emptyDebrief(date: string): DailyDebrief {
  return { date, narrative: '', comparison: '', learned: '', applyNext: '', prepScore: null, executionScore: null, videoUrl: '', links: [] };
}

/** The Daily Debrief form for one date — self-loading, self-saving. */
export function DebriefEditor({ date }: { date: string }) {
  const existing = useLiveQuery(() => db.debriefs.where('date').equals(date).first(), [date]);
  const [draft, setDraft] = useState<DailyDebrief>(emptyDebrief(date));
  const toast = useToast();

  useEffect(() => {
    setDraft(existing ? { links: [], videoUrl: '', ...existing } : emptyDebrief(date));
  }, [existing, date]);

  const set = <K extends keyof DailyDebrief>(k: K, v: DailyDebrief[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const persist = async (record: DailyDebrief): Promise<number> => {
    if (record.id) {
      await db.debriefs.put(record);
      return record.id;
    }
    const id = await db.debriefs.add({ ...record, date });
    setDraft((d) => ({ ...d, id }));
    return id;
  };

  const save = async () => {
    await persist({ ...draft, date });
    toast('Daily debrief saved');
  };

  const exportPack = async (format: 'md' | 'json' | 'print') => {
    const [prep, trades, debrief] = await Promise.all([
      db.preps.where('date').equals(date).first(),
      db.trades.where('date').equals(date).toArray(),
      db.debriefs.where('date').equals(date).first(),
    ]);
    trades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));
    const parentIds = [
      ...(prep?.id ? [['prep', prep.id] as const] : []),
      ...(debrief?.id ? [['debrief', debrief.id] as const] : []),
      ...trades.filter((t) => t.id).map((t) => ['trade', t.id!] as const),
    ];
    const photos = (
      await Promise.all(parentIds.map(([pt, pid]) => db.photos.where('[parentType+parentId]').equals([pt, pid]).toArray()))
    ).flat();
    if (format === 'json') {
      downloadFile(`trading-day-${date}.json`, JSON.stringify({ date, prep, trades, debrief, photos: photos.map((p) => ({ ...p, dataUrl: `[image ${p.name}]` })) }, null, 2), 'application/json');
    } else if (format === 'md') {
      downloadFile(`trading-day-${date}.md`, dayPackMarkdown(date, prep, trades, debrief), 'text/markdown');
    } else {
      openPrintView(`Trading day ${fmtDate(date)}`, dayPackHtml(date, prep, trades, debrief, photos));
    }
  };

  const scorePicker = (label: string, key: 'prepScore' | 'executionScore') => (
    <div>
      <div className="small muted" style={{ marginBottom: 5 }}>
        {label}
      </div>
      <div className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`chip clickable ${draft[key] === n ? 'selected' : ''}`} onClick={() => set(key, draft[key] === n ? null : n)}>
            {n}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="stack">
      <label className="field">
        <span>What happened, what you did and how you were feeling during this trading day</span>
        <textarea rows={5} value={draft.narrative} onChange={(e) => set('narrative', e.target.value)} />
      </label>
      <label className="field">
        <span>Compare what happened with your preparation and hypothesis for this day</span>
        <textarea rows={4} value={draft.comparison} onChange={(e) => set('comparison', e.target.value)} />
      </label>
      <label className="field">
        <span>Did you learn something?</span>
        <textarea rows={3} value={draft.learned} onChange={(e) => set('learned', e.target.value)} />
      </label>
      <label className="field">
        <span>Is there something you can do to apply what you learned?</span>
        <textarea rows={3} value={draft.applyNext} onChange={(e) => set('applyNext', e.target.value)} />
      </label>
      <label className="field">
        <span>Recording of the trading day (video link)</span>
        <input value={draft.videoUrl ?? ''} onChange={(e) => set('videoUrl', e.target.value)} placeholder="https://…" />
      </label>
      <MediaEditor
        parentType="debrief"
        parentId={draft.id ?? null}
        links={draft.links ?? []}
        onLinksChange={(links) => set('links', links)}
        ensureParentId={() => persist({ ...draft, date })}
      />
      <div className="row" style={{ gap: 26 }}>
        {scorePicker('Preparation quality (1–5)', 'prepScore')}
        {scorePicker('Execution quality (1–5)', 'executionScore')}
        <span style={{ flex: 1 }} />
        <div className="row">
          <button className="btn sm" title="Export the full day (prep + trades + debrief) as Markdown" onClick={() => exportPack('md')}>
            ⬇ Markdown
          </button>
          <button className="btn sm" title="Print-ready view — save as PDF from the print dialog" onClick={() => exportPack('print')}>
            ⬇ PDF / Print
          </button>
          <button className="btn sm" title="Structured data export" onClick={() => exportPack('json')}>
            ⬇ JSON
          </button>
          <button className="btn primary" onClick={save}>
            {existing ? 'Update debrief' : 'Save debrief'}
          </button>
        </div>
      </div>
    </div>
  );
}
