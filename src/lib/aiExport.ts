import { CRITERIA, categoryLabel, domainOf } from '../domain/taxonomy';
import { buildFocus } from './confluence';
import { analyzeSeries, cachedCot, FLAG_LABEL } from './cot';
import { db } from './db';
import { fmtMoney, fmtPct, todayISO } from './format';
import { bucketStats, computeStats, gradeProfile, hourOfTrade } from './stats';

/**
 * Build a complete, token-efficient dossier of everything in the journal —
 * made to be pasted into Claude / ChatGPT / any AI so a monthly AI
 * subscription becomes a personal trading-performance analyst with full
 * access to the data.
 */
export async function buildAIDossier(): Promise<string> {
  const [trades, debriefs, preps, strategies] = await Promise.all([
    db.trades.toArray(),
    db.debriefs.toArray(),
    db.preps.toArray(),
    db.strategies.toArray(),
  ]);
  trades.sort((a, b) => a.entryTime.localeCompare(b.entryTime));
  debriefs.sort((a, b) => a.date.localeCompare(b.date));
  preps.sort((a, b) => a.date.localeCompare(b.date));

  const s = computeStats(trades);
  let md = `# Trading journal dossier — Edge Intelligence export
Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · framework: AXIA 5 Edge Domains (Central Banks, Economic Data, News/Geo-Macro, Technicals, Flow Events)

## Overview
- Trades: ${s.count} across ${s.tradingDays} trading days (${trades[0]?.date ?? '—'} → ${trades[trades.length - 1]?.date ?? '—'})
- Net P&L: ${fmtMoney(s.netPnl, { sign: true })} · expectancy ${fmtMoney(s.expectancy, { sign: true })}/trade${s.avgR != null ? ` · avg ${s.avgR.toFixed(2)}R (${s.rCount} trades with risk defined)` : ''}
- Win rate ${fmtPct(s.winRate)} · profit factor ${isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : 'inf'} · avg win ${fmtMoney(s.avgWin)} vs avg loss ${fmtMoney(s.avgLoss)}
- Max drawdown ${fmtMoney(-s.maxDrawdown)} · longest win streak ${s.maxWinStreak} · longest loss streak ${s.maxLossStreak}
- Review discipline: ${fmtPct(s.taggedRate, 0)} tagged, ${fmtPct(s.gradedRate, 0)} coach-graded

`;

  const bucketBlock = (title: string, rows: ReturnType<typeof bucketStats>) => {
    if (!rows.length) return '';
    let out = `## ${title}\n| Bucket | Trades | Win rate | Expectancy | Net P&L |\n| --- | --- | --- | --- | --- |\n`;
    for (const b of rows) out += `| ${b.label} | ${b.count} | ${fmtPct(b.winRate, 0)} | ${fmtMoney(b.expectancy, { sign: true })} | ${fmtMoney(b.netPnl, { sign: true })} |\n`;
    return out + '\n';
  };

  md += bucketBlock('Edge by domain (Level-1 tag)', bucketStats(trades, (t) => t.domain, (k) => domainOf(k)?.name ?? k));
  md += bucketBlock(
    'Edge by setup (domain · category)',
    bucketStats(
      trades.filter((t) => t.domain && t.category),
      (t) => `${t.domain}|${t.category}`,
      (k) => {
        const [d, c] = k.split('|');
        return `${domainOf(d)?.short ?? d} · ${categoryLabel(d, c)}`;
      },
    ).sort((a, b) => b.netPnl - a.netPnl),
  );
  md += bucketBlock('Edge by entry hour', bucketStats(trades, hourOfTrade).sort((a, b) => a.key.localeCompare(b.key)));
  md += bucketBlock('Edge by instrument', bucketStats(trades, (t) => t.instrument).sort((a, b) => b.netPnl - a.netPnl));

  const gp = gradeProfile(trades).filter((g) => g.count > 0);
  if (gp.length) {
    md += `## Coach grade profile (0 = below standard, 1 = at, 2 = above)\n`;
    for (const g of gp) md += `- ${CRITERIA.find((c) => c.id === g.criterion)?.label}: ${g.avg.toFixed(2)} (${g.count} graded)\n`;
    md += '\n';
  }

  if (strategies.length) {
    md += `## Strategies\n`;
    for (const st of strategies) {
      const linked = trades.filter((t) => t.strategyId === st.id);
      const ls = computeStats(linked);
      md += `### ${st.name} [${st.status}]${st.domain ? ` — ${domainOf(st.domain)?.name}` : ''}\n`;
      if (st.hypothesis) md += `Hypothesis: ${st.hypothesis}\n`;
      if (st.rules) md += `Rules: ${st.rules}\n`;
      md += linked.length
        ? `Sample: ${ls.count} trades · net ${fmtMoney(ls.netPnl, { sign: true })} · win ${fmtPct(ls.winRate, 0)} · expectancy ${fmtMoney(ls.expectancy, { sign: true })}\n\n`
        : `Sample: no linked trades yet\n\n`;
    }
  }

  // current market positioning context (CFTC COT, cached from Market Intel)
  const cot = cachedCot();
  if (cot?.reportDate && cot.series.length) {
    md += `## Market positioning context (CFTC Commitments of Traders, report ${cot.reportDate})\nLarge speculators' net futures position; percentile = where the latest net sits in its 3-year weekly range.\n| Market | Specs net | Δ week | 3y pctile | Signals |\n| --- | --- | --- | --- | --- |\n`;
    for (const series of cot.series) {
      const a = analyzeSeries(series);
      if (!a) continue;
      md += `| ${a.market.symbol} ${a.market.label} | ${a.specNet.toLocaleString()} | ${a.specWow >= 0 ? '+' : ''}${a.specWow.toLocaleString()} | ${a.pctile3y ?? '—'} | ${a.flags.map((f) => FLAG_LABEL[f]).join(', ') || '—'} |\n`;
    }
    const focus = buildFocus(trades, cot, todayISO()).filter((r) => r.confluence >= 1).slice(0, 8);
    if (focus.length) {
      md += `\nThis week's confluence (positioning × scheduled catalysts × this trader's own per-instrument edge):\n`;
      for (const r of focus) md += `- ${r.symbol} (${r.confluence}/3 reads): ${r.reasons.join(' · ')}\n`;
    }
    md += '\n';
  }

  md += `## Trade log (chronological)\nFormat: date time | instrument side qty | entry→exit | P&L (R) | domain/category | tags | fills\n\n`;
  for (const t of trades) {
    const r = t.plannedRisk ? ` (${(t.pnl / t.plannedRisk).toFixed(2)}R)` : '';
    const execs = t.executions?.length
      ? ` | fills: ${t.executions.map((e) => `${e.action[0]}${e.qty}@${e.price}${e.orderType !== 'unknown' ? `/${e.orderType[0]}` : ''}`).join(' ')}`
      : '';
    md += `- ${t.date} ${t.entryTime.slice(11, 16)} | ${t.instrument} ${t.side} x${t.qty} | ${t.entryPrice}→${t.exitPrice} | ${fmtMoney(t.pnl, { sign: true })}${r} | ${t.domain ?? 'untagged'}${t.category ? `/${t.category}` : ''} | ${t.tags.join(', ') || '—'}${execs}\n`;
    if (t.description) md += `  - What happened: ${t.description}\n`;
    if (t.learned) md += `  - Learned: ${t.learned}\n`;
    if (t.applyNext) md += `  - Apply: ${t.applyNext}\n`;
    const grades = Object.entries(t.grades ?? {});
    if (grades.length) md += `  - Grades: ${grades.map(([c, g]) => `${c}=${g}`).join(', ')}\n`;
  }
  md += '\n';

  if (debriefs.length) {
    md += `## Daily debriefs\n`;
    for (const d of debriefs) {
      md += `### ${d.date}${d.prepScore != null ? ` (prep ${d.prepScore}/5${d.executionScore != null ? `, execution ${d.executionScore}/5` : ''})` : ''}\n`;
      if (d.narrative) md += `What happened: ${d.narrative}\n`;
      if (d.comparison) md += `Vs preparation: ${d.comparison}\n`;
      if (d.learned) md += `Learned: ${d.learned}\n`;
      if (d.applyNext) md += `Apply: ${d.applyNext}\n`;
      md += '\n';
    }
  }

  if (preps.length) {
    md += `## Day preparations (hypotheses & plans)\n`;
    for (const p of preps) {
      md += `### ${p.date}\n`;
      const on = (p.overnightMarkets ?? []).filter((m) => m.note);
      if (on.length) md += `Overnight: ${on.map((m) => `${m.market}: ${m.note}`).join(' · ')}\n`;
      if (p.overnightImplication) md += `Implication: ${p.overnightImplication}\n`;
      const hyps = (p.hypotheses ?? []).filter((h) => h.inPlay || h.expectation);
      for (const h of hyps) md += `- ${h.title}: in play ${h.inPlay || '—'}; expect ${h.expectation || '—'}; LIS ${h.lineInSand || '—'}\n`;
      md += '\n';
    }
  }

  return md;
}

export const COACH_PROMPT = `You are an elite trading performance coach for a discretionary futures trader trained in the AXIA Futures methodology (the 5 Edge Domains: Central Banks, Economic Data, News/Geo-Macro, Technicals, Flow Events; coach grading on trigger recognition, sizing, exit discipline, articulation, post-trade review).

Below is my complete trading journal export. Analyse it like a coach who wants me funded and consistent:
1. Where is my edge strongest and weakest (domain, setup, hour, instrument)? Quantify it.
2. Find hidden patterns and correlations I likely can't see myself — including between my preparation quality, hypotheses, debrief notes and the P&L that followed.
3. Diagnose my execution from the per-fill data where present (scaling behaviour, order types, average-price progression).
4. What single behaviour change would add the most expectancy? What should I stop doing entirely?
5. Give me a concrete 2-week improvement plan with measurable checkpoints.

Be direct, quantitative and specific — reference actual trades and dates from the data.

`;
