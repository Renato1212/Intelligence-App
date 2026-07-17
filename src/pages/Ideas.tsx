import { useEffect, useMemo, useState } from 'react';
import { Connects } from '../components/Connects';
import { Principle } from '../components/ui';
import { upcomingEvents, type CalendarEvent, type EdgeDomain } from '../lib/calendar';
import { analyzeSeries, loadCot, type CotAnalysis } from '../lib/cot';
import { loadCrossAsset, type PairCorr } from '../lib/crossAsset';
import { todayISO } from '../lib/format';
import {
  generateIdeas,
  monthToDate,
  type IdeaInputs,
  type TradeIdea,
} from '../lib/ideas';
import { fmpOhlcBarUrls, parseFmpOhlc, type OhlcBar } from '../lib/market';
import { loadNarrative, type ThemeSeries } from '../lib/narrative';
import { expectedMove, gammaProfile, loadCboeQuote, loadChain, vixRegime, type ExpectedMove, type GammaProfile, type VixRegime } from '../lib/options';
import { fetchDailyCloses } from '../lib/reactionLab';
import { daysToOpex, fetchEarnings } from '../lib/terminal';

/*
 * Conviction Board — the platform's answer to "so what do I trade?"
 *
 * Every other section produces a READ; this one produces PLANS. A rules-based
 * engine (lib/ideas.ts) scans the five Axia edge domains — central banks,
 * economic data, news & narrative, technicals, flow — and emits complete trade
 * ideas: thesis, trigger, entry, invalidation, targets, kill switch, plus the
 * cross-domain evidence for and against. Conviction (1–5) is the count of
 * domains agreeing minus the ones fighting it. No qualified setup = the board
 * says STAND DOWN, which is itself the discipline most platforms won't give.
 */

const DOMAIN_META: Record<EdgeDomain, { label: string; color: string }> = {
  'central-banks': { label: 'Central banks', color: 'var(--dom-cb)' },
  'economic-data': { label: 'Economic data', color: 'var(--dom-data)' },
  news: { label: 'News & narrative', color: 'var(--dom-news)' },
  technicals: { label: 'Technicals', color: 'var(--dom-tech)' },
  flow: { label: 'Flow', color: 'var(--dom-flow)' },
};
const DOMAIN_ORDER: EdgeDomain[] = ['central-banks', 'economic-data', 'news', 'technicals', 'flow'];

async function fetchOhlc(sym: string, days: number): Promise<OhlcBar[]> {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  for (const url of fmpOhlcBarUrls(sym, { from, to })) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      continue;
    }
    const bars = parseFmpOhlc(json);
    if (bars.length >= 5) return bars;
  }
  return [];
}

export default function Ideas() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [cot, setCot] = useState<CotAnalysis[]>([]);
  const [themes, setThemes] = useState<ThemeSeries[]>([]);
  const [corrBreaks, setCorrBreaks] = useState<PairCorr[]>([]);
  const [gamma, setGamma] = useState<GammaProfile | null>(null);
  const [em, setEm] = useState<ExpectedMove | null>(null);
  const [vol, setVol] = useState<VixRegime | null>(null);
  const [indexBars, setIndexBars] = useState<OhlcBar[]>([]);
  const [tltMtd, setTltMtd] = useState<number | null>(null);
  const [earningsCount, setEarningsCount] = useState(0);
  const [loadedFeeds, setLoadedFeeds] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) setLoadedFeeds((n) => n + 1); };
    setEvents(upcomingEvents(todayISO(), 7));

    void loadCot().then((r) => {
      if (!alive || !r.snapshot) return;
      setCot(r.snapshot.series.map(analyzeSeries).filter((a): a is CotAnalysis => !!a));
      tick();
    });
    void loadNarrative().then((r) => { if (alive) { setThemes(r.series); tick(); } });
    void loadCrossAsset().then((r) => { if (alive && r.read) { setCorrBreaks(r.read.breaks); tick(); } });
    void loadChain('_SPX').then(({ chain }) => {
      if (!alive || !chain) return;
      setGamma(gammaProfile(chain, 'nearest'));
      setEm(expectedMove(chain));
      tick();
    });
    void (async () => {
      const [v, v9, v3] = await Promise.all([loadCboeQuote('_VIX'), loadCboeQuote('_VIX9D'), loadCboeQuote('_VIX3M')]);
      if (alive && v.quote) { setVol(vixRegime(v.quote.price, v9.quote?.price ?? null, v3.quote?.price ?? null)); tick(); }
    })();
    void fetchOhlc('SPY', 320).then((bars) => { if (alive && bars.length) { setIndexBars(bars); tick(); } });
    void (async () => {
      const from = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      const closes = await fetchDailyCloses('TLT', from, todayISO());
      if (alive && closes?.length) { setTltMtd(monthToDate(closes)); tick(); }
    })();
    void (async () => {
      const to = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const rows = await fetchEarnings(todayISO(), to);
      if (alive && rows) { setEarningsCount(rows.length); tick(); }
    })();

    return () => { alive = false; };
  }, []);

  const board = useMemo(() => {
    const inputs: IdeaInputs = {
      nowISO: new Date().toISOString(),
      events,
      cot,
      themes,
      corrBreaks,
      gamma,
      em,
      vol,
      indexBars,
      spyMtd: monthToDate(indexBars),
      tltMtd,
      daysToOpex: daysToOpex(),
      earningsCount,
    };
    return generateIdeas(inputs);
  }, [events, cot, themes, corrBreaks, gamma, em, vol, indexBars, tltMtd, earningsCount]);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h1 className="page-title">Conviction Board</h1>
        <div className="page-sub">
          Executable trade ideas, generated by rules from the five edge domains. Each card is a complete plan —
          thesis, trigger, entry, invalidation, targets, kill switch — with the cross-domain evidence for and
          against it. Conviction is EARNED by agreement between domains, never granted by a single signal.
        </div>
      </div>

      {/* domain coverage strip */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {DOMAIN_ORDER.map((d) => {
          const active = board.activeDomains.includes(d);
          const meta = DOMAIN_META[d];
          const n = board.ideas.filter((x) => x.domain === d).length;
          return (
            <span
              key={d}
              className="small"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: `1px solid ${active ? meta.color : 'var(--hairline)'}`,
                color: active ? meta.color : 'var(--muted)',
                fontWeight: active ? 700 : 400,
              }}
            >
              {meta.label}
              {active ? ` · ${n} idea${n > 1 ? 's' : ''}` : ' · quiet'}
            </span>
          );
        })}
        <span className="hint" style={{ alignSelf: 'center' }}>{loadedFeeds} live feed{loadedFeeds === 1 ? '' : 's'} loaded — ideas sharpen as inputs arrive</span>
      </div>

      {board.standDown && (
        <div className="card" style={{ borderLeft: '4px solid var(--muted)' }}>
          <div style={{ fontWeight: 800, letterSpacing: 0.4 }}>STAND DOWN</div>
          <p className="small muted" style={{ margin: '6px 0 0', maxWidth: 860 }}>{board.standDown}</p>
        </div>
      )}

      {board.ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} />
      ))}

      <div className="card">
        <Principle domain="Conviction — why the board scores agreement, not signals">
          A single domain firing is a signal; three domains agreeing is a TRADE. The board scores every idea by
          cross-domain confluence because that is what conviction actually is: independent evidence pointing the
          same way. Take 4–5s at full planned size, 3s at reduced size only with your own read on top, and treat
          1–2s as watchlist items. And respect the empty board — the days with no qualified idea are the days the
          edge domains are quiet, and trading anyway is how the month's P&L leaks back out. The plan is written
          BEFORE the trigger so the decision under pressure is only "did the trigger print — yes or no".
        </Principle>
      </div>

      <Connects id="ideas" />
    </div>
  );
}

function ConvictionDots({ n, color }: { n: number; color: string }) {
  return (
    <span title={`conviction ${n}/5`} style={{ letterSpacing: 2, color }}>
      {'●'.repeat(n)}
      <span style={{ opacity: 0.25 }}>{'●'.repeat(5 - n)}</span>
    </span>
  );
}

function IdeaCard({ idea }: { idea: TradeIdea }) {
  const meta = DOMAIN_META[idea.domain];
  const biasColor = idea.bias === 'long' ? 'var(--profit)' : idea.bias === 'short' ? 'var(--loss)' : 'var(--gold)';
  return (
    <div className="card" style={{ borderLeft: `4px solid ${meta.color}` }}>
      <div className="row" style={{ gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="small" style={{ color: meta.color, fontWeight: 700 }}>{meta.label}</span>
        <span style={{ fontWeight: 800, fontSize: 16 }}>{idea.title}</span>
        <span className="mono" style={{ fontWeight: 700 }}>{idea.instrument}</span>
        <span className="small" style={{ color: biasColor, fontWeight: 700, textTransform: 'uppercase' }}>{idea.bias}</span>
        <span style={{ flex: 1 }} />
        <ConvictionDots n={idea.conviction} color={meta.color} />
      </div>
      <div className="small muted" style={{ marginTop: 2 }}>
        {idea.timeWindow} · {idea.horizon}
      </div>
      <p className="small" style={{ margin: '8px 0', maxWidth: 900 }}>{idea.thesis}</p>

      <div className="grid grid-2" style={{ gap: '4px 18px' }}>
        <PlanRow label="Trigger" text={idea.trigger} />
        <PlanRow label="Entry" text={idea.entry} />
        <PlanRow label="Invalidation" text={idea.invalidation} color="var(--loss)" />
        <PlanRow label="Targets" text={idea.targets.join(' · ')} color="var(--profit)" />
        <PlanRow label="Kill switch" text={idea.killSwitch} color="var(--gold)" />
      </div>

      {(idea.confirms.length > 0 || idea.conflicts.length > 0) && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {idea.confirms.map((c) => (
            <span key={c.slice(0, 28)} className="small" style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(67,164,92,0.12)', color: 'var(--profit)' }}>
              ✓ {c}
            </span>
          ))}
          {idea.conflicts.map((c) => (
            <span key={c.slice(0, 28)} className="small" style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(204,95,131,0.12)', color: 'var(--loss)' }}>
              ✕ {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PlanRow({ label, text, color }: { label: string; text: string; color?: string }) {
  return (
    <div className="small" style={{ display: 'flex', gap: 8 }}>
      <span style={{ minWidth: 88, fontWeight: 700, color: color ?? 'var(--gold)', flexShrink: 0 }}>{label}</span>
      <span className="muted">{text}</span>
    </div>
  );
}
