import type { DailyDebrief, DayPrep, Photo, Trade } from '../domain/types';
import { categoryLabel, CRITERIA, domainOf } from '../domain/taxonomy';
import { fmtDate, fmtDuration, fmtMoney, fmtR, fmtTime } from './format';
import { rMultiple } from './stats';

/* ---------- download / share primitives ---------- */

export function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Open a print-ready view in a new tab; the browser's print dialog saves it as PDF. */
export function openPrintView(title: string, bodyHtml: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1a1815; margin: 40px auto; max-width: 800px; padding: 0 20px; line-height: 1.55; }
  h1 { font-size: 24px; border-bottom: 2px solid #b78834; padding-bottom: 8px; }
  h2 { font-size: 15px; letter-spacing: 0.1em; text-transform: uppercase; color: #8a6a1f; margin-top: 28px; }
  h3 { font-size: 14px; margin-bottom: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #f6f1e6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
  .meta { color: #666; font-size: 13px; }
  .pos { color: #067806; } .neg { color: #c03030; }
  .box { border: 1px solid #e2ddd2; border-radius: 8px; padding: 12px 16px; margin: 10px 0; }
  .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #999; margin-bottom: 2px; }
  img.photo { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; margin: 6px 0; }
  a { color: #1c5cab; }
  p { white-space: pre-wrap; margin: 4px 0 12px; }
  @media print { body { margin: 10mm; } .noprint { display: none; } }
</style></head><body>
<div class="noprint" style="background:#f6f1e6;padding:10px 14px;border-radius:8px;margin-bottom:20px;">
  Use your browser's <b>Print</b> (Cmd/Ctrl+P) and choose <b>Save as PDF</b>. <button onclick="window.print()">Print / Save as PDF</button>
</div>
${bodyHtml}
</body></html>`);
  w.document.close();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function para(label: string, text: string | undefined | null): string {
  if (!text?.trim()) return '';
  return `<div class="lbl">${esc(label)}</div><p>${esc(text)}</p>`;
}

function mdSection(label: string, text: string | undefined | null): string {
  if (!text?.trim()) return '';
  return `**${label}**\n\n${text.trim()}\n\n`;
}

function linksHtml(links?: { label: string; url: string }[]): string {
  if (!links?.length) return '';
  return `<div class="lbl">Links</div><ul>${links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label || l.url)}</a></li>`).join('')}</ul>`;
}

function linksMd(links?: { label: string; url: string }[]): string {
  if (!links?.length) return '';
  return `**Links**\n\n${links.map((l) => `- [${l.label || l.url}](${l.url})`).join('\n')}\n\n`;
}

function photosHtml(photos: Photo[]): string {
  if (!photos.length) return '';
  return `<h2>Photos</h2>${photos.map((p) => `<img class="photo" src="${p.dataUrl}" alt="${esc(p.name)}">`).join('')}`;
}

/* ---------- trade debrief ---------- */

function tradeHeaderHtml(t: Trade): string {
  const d = domainOf(t.domain);
  const r = rMultiple(t);
  return `<h1>Trade debrief — ${esc(t.instrument)} ${t.side}</h1>
<div class="meta">${fmtDate(t.date)} · ${fmtTime(t.entryTime)} → ${fmtTime(t.exitTime)} (${fmtDuration(t.entryTime, t.exitTime)}) · ${t.qty} lots${t.account ? ` · ${esc(t.account)}` : ''}</div>
<div class="box">
  <table><tr><th>Net P&amp;L</th><th>Entry → Exit</th><th>R multiple</th><th>Domain</th><th>Category</th><th>Tags</th></tr>
  <tr><td class="${t.pnl >= 0 ? 'pos' : 'neg'}"><b>${fmtMoney(t.pnl, { sign: true })}</b></td>
  <td>${t.entryPrice} → ${t.exitPrice}</td><td>${fmtR(r)}</td>
  <td>${d ? esc(d.name) : '—'}</td><td>${esc(categoryLabel(t.domain, t.category) || '—')}</td>
  <td>${esc(t.tags.join(', ') || '—')}</td></tr></table>
</div>`;
}

export function tradeDebriefHtml(t: Trade, photos: Photo[]): string {
  const grades = Object.entries(t.grades ?? {});
  return `${tradeHeaderHtml(t)}
<h2>Debrief</h2>
${para('Description — expecting vs what happened', t.description)}
${para('What did you learn?', t.learned)}
${para('How to apply what you learned', t.applyNext)}
${t.videoUrl ? `<div class="lbl">Video</div><p><a href="${esc(t.videoUrl)}">${esc(t.videoUrl)}</a></p>` : ''}
${linksHtml(t.links)}
${
  grades.length
    ? `<h2>Coach grading</h2><table><tr><th>Criterion</th><th>Grade</th></tr>${grades
        .map(([c, g]) => `<tr><td>${esc(CRITERIA.find((x) => x.id === c)?.label ?? c)}</td><td>${g === 'above' ? 'Above standard' : g === 'at' ? 'At standard' : 'Below standard'}</td></tr>`)
        .join('')}</table>`
    : ''
}
${photosHtml(photos)}`;
}

export function tradeDebriefMarkdown(t: Trade, photos: Photo[]): string {
  const d = domainOf(t.domain);
  const r = rMultiple(t);
  const grades = Object.entries(t.grades ?? {});
  return `# Trade Debrief — ${t.instrument} ${t.side}

| Field | Value |
| --- | --- |
| Date | ${fmtDate(t.date)} |
| Enter time | ${fmtTime(t.entryTime)} |
| Exit time | ${fmtTime(t.exitTime)} |
| Duration | ${fmtDuration(t.entryTime, t.exitTime)} |
| Total size | ${t.qty} |
| Entry → Exit | ${t.entryPrice} → ${t.exitPrice} |
| Net P&L | ${fmtMoney(t.pnl, { sign: true })} |
| R multiple | ${fmtR(r)} |
| Tag | ${d ? d.name : '—'} |
| Sub tag | ${categoryLabel(t.domain, t.category) || '—'} |
| Tags | ${t.tags.join(', ') || '—'} |

${mdSection('Description (what you were expecting and what happened)', t.description)}${mdSection('What did you learn?', t.learned)}${mdSection('How to apply what you learned', t.applyNext)}${t.videoUrl ? `**Video:** ${t.videoUrl}\n\n` : ''}${linksMd(t.links)}${
    grades.length
      ? `**Coach grading**\n\n${grades.map(([c, g]) => `- ${CRITERIA.find((x) => x.id === c)?.label ?? c}: ${g} standard`).join('\n')}\n\n`
      : ''
  }${photos.length ? `*${photos.length} photo(s) attached — included in the HTML/PDF export.*\n` : ''}`;
}

/* ---------- day pack (prep + trades + debrief) ---------- */

function dayTradesTableHtml(trades: Trade[]): string {
  if (!trades.length) return '<p class="meta">No trades recorded this day.</p>';
  const total = trades.reduce((s, t) => s + t.pnl, 0);
  return `<table><tr><th>Time</th><th>Inst</th><th>Side</th><th>Qty</th><th>Entry → Exit</th><th>Domain</th><th>Tags</th><th>P&amp;L</th></tr>
${trades
  .map(
    (t) => `<tr><td>${fmtTime(t.entryTime)}</td><td>${esc(t.instrument)}</td><td>${t.side}</td><td>${t.qty}</td>
<td>${t.entryPrice} → ${t.exitPrice}</td><td>${esc(domainOf(t.domain)?.short ?? '—')}</td><td>${esc(t.tags.join(', '))}</td>
<td class="${t.pnl >= 0 ? 'pos' : 'neg'}">${fmtMoney(t.pnl, { sign: true })}</td></tr>`,
  )
  .join('')}
<tr><td colspan="7"><b>Day total</b></td><td class="${total >= 0 ? 'pos' : 'neg'}"><b>${fmtMoney(total, { sign: true })}</b></td></tr></table>`;
}

function prepHtml(prep: DayPrep): string {
  const markets = prep.overnightMarkets ?? [];
  return `<h2>Preparation</h2>
${
  markets.length
    ? `<h3>Overnights</h3><table><tr><th>Market</th><th>Read</th></tr>${markets
        .map((m) => `<tr><td><b>${esc(m.market)}</b></td><td>${esc(m.note || '—')}</td></tr>`)
        .join('')}</table>`
    : ''
}
${para('Moved significantly? Same movement or one market alone?', prep.overnightMoved)}
${para('Implication for your main markets', prep.overnightImplication)}
<h3>News</h3>
${para('Priced in', prep.newsPricedIn)}
${para('Developing', prep.newsDeveloping)}
${
  prep.events.length
    ? `<h3>Events</h3><table><tr><th>Time</th><th>Data/Speaker</th><th>Expectations</th><th>Notes</th></tr>${prep.events
        .map((e) => `<tr><td>${esc(e.time)}</td><td>${esc(e.name)}</td><td>${esc(e.expectations)}</td><td>${esc(e.notes)}</td></tr>`)
        .join('')}</table>`
    : ''
}
<h3>Chart analysis</h3>
${para('Daily chart', prep.dailyChart)}
${para('Profile analysis (RTH)', prep.profile)}
${para('60 min — scope, structure, positioning', prep.sixtyMin)}
${para('5 min — areas of interest', prep.fiveMin)}
${
  prep.hypotheses.some((h) => h.inPlay || h.expectation || h.lineInSand)
    ? `<h3>Hypotheses</h3><table><tr><th></th><th>In play</th><th>Expectation</th><th>Line in sand</th></tr>${prep.hypotheses
        .map((h) => `<tr><td><b>${esc(h.title)}</b></td><td>${esc(h.inPlay)}</td><td>${esc(h.expectation)}</td><td>${esc(h.lineInSand)}</td></tr>`)
        .join('')}</table>`
    : ''
}
${prep.videoUrl ? `<div class="lbl">Video</div><p><a href="${esc(prep.videoUrl)}">${esc(prep.videoUrl)}</a></p>` : ''}
${linksHtml(prep.links)}`;
}

export type DayExportScope = 'all' | 'prep' | 'trades' | 'debrief';

export const SCOPE_TITLES: Record<DayExportScope, string> = {
  all: 'Trading day',
  prep: 'Day preparation',
  trades: 'Trades',
  debrief: 'Daily debrief',
};

export function dayPackHtml(
  date: string,
  prep: DayPrep | undefined,
  trades: Trade[],
  debrief: DailyDebrief | undefined,
  photos: Photo[],
  scope: DayExportScope = 'all',
): string {
  return `<h1>${SCOPE_TITLES[scope]} — ${fmtDate(date)}</h1>
<div class="meta">Keep perspective on moves · What is the implication? · Add risk to high value trades</div>
${(scope === 'all' || scope === 'prep') && prep ? prepHtml(prep) : ''}
${scope === 'all' || scope === 'trades' ? `<h2>Trades</h2>\n${dayTradesTableHtml(trades)}` : ''}
${
  (scope === 'all' || scope === 'debrief') && debrief
    ? `<h2>Daily debrief</h2>
${para('What happened, what you did and how you were feeling', debrief.narrative)}
${para('Compared with preparation and hypothesis', debrief.comparison)}
${para('Did you learn something?', debrief.learned)}
${para('How to apply what you learned', debrief.applyNext)}
${debrief.prepScore != null ? `<p class="meta">Preparation quality: ${debrief.prepScore}/5${debrief.executionScore != null ? ` · Execution quality: ${debrief.executionScore}/5` : ''}</p>` : ''}
${debrief.videoUrl ? `<div class="lbl">Day recording</div><p><a href="${esc(debrief.videoUrl)}">${esc(debrief.videoUrl)}</a></p>` : ''}
${linksHtml(debrief.links)}`
    : ''
}
${photosHtml(photos)}`;
}

export function dayPackMarkdown(
  date: string,
  prep: DayPrep | undefined,
  trades: Trade[],
  debrief: DailyDebrief | undefined,
  scope: DayExportScope = 'all',
): string {
  let md = `# ${SCOPE_TITLES[scope]} — ${fmtDate(date)}\n\n> Keep perspective on moves · What is the implication? · Add risk to high value trades\n\n`;
  if ((scope === 'all' || scope === 'prep') && prep) {
    md += `## Preparation\n\n`;
    const markets = prep.overnightMarkets ?? [];
    if (markets.length) {
      md += `### Overnights\n\n| Market | Read |\n| --- | --- |\n${markets.map((m) => `| **${m.market}** | ${m.note || '—'} |`).join('\n')}\n\n`;
    }
    md += mdSection('Moved significantly? Same movement or one market alone?', prep.overnightMoved);
    md += mdSection('Implication for main markets', prep.overnightImplication);
    md += mdSection('News — priced in', prep.newsPricedIn);
    md += mdSection('News — developing', prep.newsDeveloping);
    if (prep.events.length) {
      md += `### Events\n\n| Time | Data/Speaker | Expectations | Notes |\n| --- | --- | --- | --- |\n${prep.events.map((e) => `| ${e.time} | ${e.name} | ${e.expectations} | ${e.notes} |`).join('\n')}\n\n`;
    }
    md += mdSection('Daily chart', prep.dailyChart);
    md += mdSection('Profile analysis (RTH)', prep.profile);
    md += mdSection('60 min', prep.sixtyMin);
    md += mdSection('5 min', prep.fiveMin);
    const hyps = prep.hypotheses.filter((h) => h.inPlay || h.expectation || h.lineInSand);
    if (hyps.length) {
      md += `### Hypotheses\n\n${hyps.map((h) => `- **${h.title}** — In play: ${h.inPlay || '—'} · Expectation: ${h.expectation || '—'} · LIS: ${h.lineInSand || '—'}`).join('\n')}\n\n`;
    }
    md += linksMd(prep.links);
  }
  if (scope === 'all' || scope === 'trades') {
    md += `## Trades\n\n`;
    if (trades.length) {
      md += `| Time | Inst | Side | Qty | Entry → Exit | Domain | Tags | P&L |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n`;
      md += trades
        .map(
          (t) =>
            `| ${fmtTime(t.entryTime)} | ${t.instrument} | ${t.side} | ${t.qty} | ${t.entryPrice} → ${t.exitPrice} | ${domainOf(t.domain)?.short ?? '—'} | ${t.tags.join(', ')} | ${fmtMoney(t.pnl, { sign: true })} |`,
        )
        .join('\n');
      md += `\n\n**Day total: ${fmtMoney(trades.reduce((s, t) => s + t.pnl, 0), { sign: true })}**\n\n`;
    } else {
      md += `No trades recorded this day.\n\n`;
    }
  }
  if ((scope === 'all' || scope === 'debrief') && debrief) {
    md += `## Daily debrief\n\n`;
    md += mdSection('What happened, what you did and how you were feeling', debrief.narrative);
    md += mdSection('Compared with preparation and hypothesis', debrief.comparison);
    md += mdSection('Did you learn something?', debrief.learned);
    md += mdSection('How to apply what you learned', debrief.applyNext);
    if (debrief.prepScore != null) md += `Preparation quality: ${debrief.prepScore}/5\n`;
    if (debrief.executionScore != null) md += `Execution quality: ${debrief.executionScore}/5\n`;
    if (debrief.videoUrl) md += `\n**Day recording:** ${debrief.videoUrl}\n`;
    md += linksMd(debrief.links);
  }
  return md;
}

/* ---------- CSV exports ---------- */

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tradesToCSV(trades: Trade[]): string {
  const header = [
    'Date', 'Entry time', 'Exit time', 'Instrument', 'Side', 'Quantity', 'Entry price', 'Exit price',
    'Net P&L', 'Fees', 'Planned risk', 'R multiple', 'Domain', 'Category', 'Tags', 'Strategy id',
    'Description', 'Learned', 'Apply', 'Video', 'Account',
  ];
  const rows = trades.map((t) =>
    [
      t.date, t.entryTime, t.exitTime, t.instrument, t.side, t.qty, t.entryPrice, t.exitPrice,
      t.pnl, t.fees, t.plannedRisk ?? '', rMultiple(t)?.toFixed(3) ?? '', t.domain ?? '',
      t.category ?? '', t.tags.join('; '), t.strategyId ?? '', t.description, t.learned, t.applyNext,
      t.videoUrl, t.account,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}
