import { useEffect, useMemo, useState } from 'react';
import { Connects } from '../components/Connects';
import { Principle, StatTile, useToast } from '../components/ui';
import { db } from '../lib/db';
import { todayISO } from '../lib/format';
import { INSTRUMENTS, formatPrice, instrumentFor } from '../lib/instruments';
import { intradayBarUrls, parseFmpIntraday } from '../lib/market';
import {
  auctionRead, buildProfile, defaultFmt, groupSessions, openLocation, profileLevels, valueRelation,
  DAY_TYPE_LABEL, DAY_TYPE_MEANING, OPEN_TYPE_LABEL, OPEN_LOCATION_MEANING, VALUE_RELATION_MEANING,
  type IntradayBar, type SessionProfile,
} from '../lib/marketProfile';

/*
 * Market Profile — the auction, computed.
 *
 * The technical edge domain on the Axia programme is Market Profile, order flow
 * and volume analysis. Everywhere else this platform lets you WRITE about the
 * profile; here it builds one: TPO and volume distributions, value area and
 * POC, the initial balance and its extensions, the day type, the open type,
 * today's value against yesterday's, single prints, tails and poor extremes —
 * each with the trading implication spelled out, and the whole read one click
 * from your preparation notes.
 */

/** Instruments with a liquid, RTH-clean proxy to build the profile from. */
const PROFILE_INSTRUMENTS = INSTRUMENTS.filter((i) => i.proxy);

const VA_BG = 'rgba(211,169,79,0.10)';
const POC_COLOR = 'var(--gold)';

export default function Profile() {
  const [root, setRoot] = useState('ES');
  const [bars, setBars] = useState<IntradayBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionIdx, setSessionIdx] = useState(0); // 0 = most recent
  const [scaleRef, setScaleRef] = useState(''); // your contract's current price
  const toast = useToast();

  const spec = instrumentFor(root) ?? PROFILE_INSTRUMENTS[0];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setBars(null);
    setSessionIdx(0);
    void (async () => {
      for (const url of intradayBarUrls(spec.proxy!, '30min')) {
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
        const parsed = parseFmpIntraday(json);
        if (parsed.length >= 10) {
          if (alive) {
            setBars(parsed);
            setLoading(false);
          }
          return;
        }
      }
      if (alive) {
        setError(
          'No intraday history came back. The profile is built from 30-minute bars via the market-data connection — connect your FMP key in Settings (or set FMP_API_KEY on the deployment) and this fills in automatically.',
        );
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [spec.proxy, spec.root]);

  const sessions = useMemo(() => {
    if (!bars) return [];
    const grouped = [...groupSessions(bars).entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return grouped
      .map(([date, list]) => ({ date, profile: buildProfile(list, { date, symbol: spec.proxy ?? '' }) }))
      .filter((s) => s.profile);
  }, [bars, spec.proxy]);

  const current = sessions[sessionIdx]?.profile ?? null;
  const prior = sessions[sessionIdx + 1]?.profile ?? null;

  /*
   * Price scale. The profile is built from a liquid ETF proxy, so its prices
   * are the PROXY's — rendering them with the futures contract's convention
   * would invent quotes that do not exist (an IEF price of 95.53 formatted as
   * ZN reads "95'169"). So proxy prices get proxy formatting by default.
   *
   * Enter your contract's current price and every level is rescaled
   * proportionally into that contract's scale — then, and only then, the
   * contract's own tick formatting is the correct one to use. Profile
   * structure is relative, so proportional scaling preserves it.
   */
  const scale = useMemo(() => {
    const ref = Number(scaleRef);
    if (!scaleRef.trim() || !isFinite(ref) || ref <= 0 || !current?.close) return 1;
    return ref / current.close;
  }, [scaleRef, current]);
  const scaled = scale !== 1;
  const fmtPx = useMemo(
    () => (v: number) => (scaled ? formatPrice(spec, v * scale) : defaultFmt(v)),
    [scaled, scale, spec],
  );

  const read = useMemo(() => (current ? auctionRead(current, prior, fmtPx) : null), [current, prior, fmtPx]);
  const levels = useMemo(() => (current ? profileLevels(current, prior) : []), [current, prior]);

  async function copyToPrep() {
    if (!current || !read) return;
    const date = todayISO();
    const text = [
      `${spec.root} — ${read.headline} (session ${current.date})`,
      ...read.lines.map((l) => `• ${l}`),
      '',
      'Plan:',
      ...read.plan.map((l) => `• ${l}`),
      '',
      `Levels: ${levels.slice(0, 8).map((l) => `${l.label} ${fmtPx(l.price)}`).join(' · ')}`,
    ].join('\n');
    const existing = await db.preps.where('date').equals(date).first();
    if (existing?.id != null) {
      const merged = existing.profile?.trim() ? `${existing.profile.trim()}\n\n${text}` : text;
      await db.preps.update(existing.id, { profile: merged });
    } else {
      const { emptyPrep } = await import('../lib/db');
      await db.preps.add({ ...emptyPrep(date), profile: text });
    }
    toast(`Auction read written into today's preparation (${date}).`);
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h1 className="page-title">Market Profile</h1>
        <div className="page-sub">
          The auction, computed. TPO and volume distribution, value area, initial balance and extension,
          day type, open type, and how today&apos;s value sits against yesterday&apos;s — with the trading
          implication of each, in the vocabulary you were trained in.
        </div>
      </div>

      {/* instrument + session selectors */}
      <div className="card">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {PROFILE_INSTRUMENTS.map((i) => (
            <button key={i.root} className={`btn sm ${i.root === root ? 'primary' : ''}`} onClick={() => setRoot(i.root)}>
              {i.root}
            </button>
          ))}
          <span className="hint" style={{ alignSelf: 'center', marginLeft: 6 }}>
            {spec.name} · {spec.exchange} · RTH {spec.rthOpen}–{spec.rthClose} ET · profile from {spec.proxy} 30-minute bars
          </span>
        </div>
        {sessions.length > 1 && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {sessions.slice(0, 8).map((s, i) => (
              <button key={s.date} className={`btn sm ${i === sessionIdx ? 'primary' : ''}`} onClick={() => setSessionIdx(i)}>
                {i === 0 ? 'Latest' : s.date.slice(5)}
              </button>
            ))}
          </div>
        )}
        {/* price scale — proxy prices by default, rescaled to the contract on request */}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--hairline)' }}>
          <span
            className="small"
            style={{ padding: '3px 9px', borderRadius: 999, fontWeight: 700, border: `1px solid ${scaled ? 'var(--gold)' : 'var(--hairline)'}`, color: scaled ? 'var(--gold)' : 'var(--muted)' }}
          >
            {scaled ? `Levels in ${spec.root}` : `Levels in ${spec.proxy}`}
          </span>
          <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {spec.root} price now
            <input
              value={scaleRef}
              onChange={(e) => setScaleRef(e.target.value)}
              placeholder="—"
              style={{ width: 100 }}
              title={`Enter the current ${spec.root} price to rescale every level from ${spec.proxy} into ${spec.root}`}
            />
          </label>
          <span className="hint" style={{ flex: 1, minWidth: 260 }}>
            {scaled
              ? `Rescaled from ${spec.proxy} by ×${scale.toFixed(4)} and formatted in ${spec.root} ticks. Structure is exact; prices are proportional, so confirm the final tick on your own chart.`
              : `The profile is built from ${spec.proxy}, so these are ${spec.proxy} prices. The STRUCTURE (day type, value, extension) transfers to ${spec.root} unchanged — type your ${spec.root} price above to rescale the levels.`}
          </span>
        </div>
      </div>

      {loading && <div className="card muted small">Building the profile from 30-minute bars…</div>}
      {error && <div className="card small muted">{error}</div>}

      {current && read && (
        <>
          {/* the headline read */}
          <div className="card" style={{ borderLeft: '4px solid var(--dom-tech)' }}>
            <div className="row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 17, color: 'var(--dom-tech)' }}>{read.headline}</span>
              <span className="muted small">{spec.root} · session {current.date} · {current.periods} brackets</span>
              <span style={{ flex: 1 }} />
              <button className="btn sm" onClick={copyToPrep}>Send read to preparation</button>
            </div>
            <div className="stack" style={{ gap: 7, marginTop: 10 }}>
              {read.lines.map((l) => (
                <div key={l.slice(0, 30)} className="small muted" style={{ lineHeight: 1.55 }}>• {l}</div>
              ))}
            </div>
          </div>

          {/* structure tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 10 }}>
            <StatTile small label="Day type" value={DAY_TYPE_LABEL[current.dayType]} delta={`${current.rangeVsIb.toFixed(2)}× initial balance`} />
            <StatTile small label="Open type" value={OPEN_TYPE_LABEL[current.openType]} delta={`open ${fmtPx(current.open)}`} />
            <StatTile small label="Value area" value={`${fmtPx(current.val)} – ${fmtPx(current.vah)}`} delta={`POC ${fmtPx(current.poc)}`} />
            <StatTile small label="Initial balance" value={`${fmtPx(current.ibLow)} – ${fmtPx(current.ibHigh)}`} delta={`${fmtPx(current.ibRange)} wide`} />
            <StatTile
              small
              label="Range extension"
              value={current.extUp === 0 && current.extDown === 0 ? 'none' : `${current.extUp > 0 ? `+${fmtPx(current.extUp)}` : ''}${current.extUp > 0 && current.extDown > 0 ? ' / ' : ''}${current.extDown > 0 ? `−${fmtPx(current.extDown)}` : ''}`}
              delta={current.extUp > 0 && current.extDown > 0 ? 'both sides — two-sided auction' : current.extUp > 0 ? 'initiative buying' : current.extDown > 0 ? 'initiative selling' : 'contained by the first hour'}
            />
            <StatTile small label="Close position" value={`${Math.round(current.closePosition * 100)}%`} delta="of the day range" valueClass={current.closePosition >= 0.8 ? 'pos' : current.closePosition <= 0.2 ? 'neg' : undefined} />
            {prior && (
              <StatTile small label="Value vs prior" value={valueRelation(current, prior).replace(/-/g, ' ')} delta={`open ${openLocation(current.open, prior).replace(/-/g, ' ')}`} />
            )}
            <StatTile
              small
              label="Extremes"
              value={
                current.extremes.highAtClose || current.extremes.lowAtClose
                  ? `unfinished ${current.extremes.highAtClose ? 'high' : 'low'}`
                  : current.extremes.poorHigh || current.extremes.poorLow
                    ? `poor ${current.extremes.poorHigh ? 'high' : ''}${current.extremes.poorHigh && current.extremes.poorLow ? ' + ' : ''}${current.extremes.poorLow ? 'low' : ''}`
                    : 'finished'
              }
              delta={
                current.extremes.highAtClose || current.extremes.lowAtClose
                  ? 'closed at the extreme — a target, not a defended level'
                  : `excess ${current.extremes.buyingTailTicks} rows below / ${current.extremes.sellingTailTicks} above`
              }
              valueClass={current.extremes.poorHigh || current.extremes.poorLow || current.extremes.highAtClose || current.extremes.lowAtClose ? 'neg' : undefined}
            />
          </div>

          {/* the profile itself */}
          <div className="card">
            <div className="card-title">
              The distribution
              <span className="hint">TPO letters — one per 30-minute bracket · value area shaded · POC ◆ · IB bracket marked · volume bar per row</span>
            </div>
            <ProfileGrid p={current} fmtPx={fmtPx} rthOpen={spec.rthOpen} />
          </div>

          {/* the plan */}
          <div className="card">
            <div className="card-title">
              What it means for the next session <span className="hint">the auction read turned into IF-THEN statements</span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              {read.plan.map((l) => (
                <div key={l.slice(0, 30)} className="small" style={{ lineHeight: 1.55 }}>
                  <span style={{ color: 'var(--gold)', fontWeight: 700 }}>→ </span>
                  <span className="muted">{l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* levels */}
          <div className="card">
            <div className="card-title">
              Reference levels <span className="hint">carry these into the session — each one says why it matters</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data" style={{ minWidth: 560 }}>
                <thead>
                  <tr><th>Level</th><th style={{ textAlign: 'right' }}>Price</th><th>Why it matters</th></tr>
                </thead>
                <tbody>
                  {levels.map((l) => (
                    <tr key={`${l.label}-${l.price}`}>
                      <td style={{ color: l.kind === 'value' ? POC_COLOR : l.kind === 'gap' ? 'var(--dom-tech)' : undefined, fontWeight: l.kind === 'value' ? 700 : 400 }}>{l.label}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtPx(l.price)}</td>
                      <td className="muted small">{l.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* teaching detail */}
          <div className="card">
            <div className="card-title">Why this day type, and what it does next</div>
            <p className="small muted" style={{ lineHeight: 1.6, maxWidth: 940 }}>{DAY_TYPE_MEANING[current.dayType]}</p>
            {prior && (
              <>
                <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', marginTop: 10 }}>Value migration</div>
                <p className="small muted" style={{ lineHeight: 1.6, maxWidth: 940 }}>{VALUE_RELATION_MEANING[valueRelation(current, prior)]}</p>
                <div className="small" style={{ fontWeight: 700, color: 'var(--gold)', marginTop: 10 }}>The open</div>
                <p className="small muted" style={{ lineHeight: 1.6, maxWidth: 940 }}>{OPEN_LOCATION_MEANING[openLocation(current.open, prior)]}</p>
              </>
            )}
            <Principle domain="Technical — the auction is the only story price tells">
              A profile is not a chart pattern; it is a record of who was in control and where the market agreed
              on price. Read it in this order and it never lies to you: <b>the open</b> (did one side commit, or
              is this rotation?), <b>the initial balance</b> (how much did the first hour agree on?), <b>the
              extension</b> (who forced the issue, and was it accepted?), <b>value</b> (did the market agree with
              yesterday, or reprice?), and finally <b>the extremes</b> (was the auction finished, or is there
              business left?). Every high-quality trade in this domain is one of two things — a rejection at a
              known reference, or acceptance through one. Everything else is noise dressed up as a setup.
            </Principle>
          </div>
        </>
      )}

      <Connects id="profile" />
    </div>
  );
}

/** The TPO letter grid: price axis, letters, value-area shading, volume bars. */
function ProfileGrid({ p, fmtPx, rthOpen }: { p: SessionProfile; fmtPx: (v: number) => string; rthOpen: string }) {
  const maxTpo = Math.max(...p.rows.map((r) => r.tpoCount), 1);
  const maxVol = Math.max(...p.rows.map((r) => r.volume), 1);
  const descending = [...p.rows].sort((a, b) => b.price - a.price);

  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="mono" style={{ fontSize: 11, lineHeight: '15px', minWidth: 520 }}>
        {descending.map((r) => {
          const inVa = r.price >= p.val - 1e-9 && r.price <= p.vah + 1e-9;
          const isPoc = Math.abs(r.price - p.poc) < 1e-9;
          const isVpoc = Math.abs(r.price - p.vpoc) < 1e-9;
          const inIb = r.price >= p.ibLow - 1e-9 && r.price <= p.ibHigh + 1e-9;
          const isHigh = Math.abs(r.price - p.high) < p.bucket;
          const isLow = Math.abs(r.price - p.low) < p.bucket;
          return (
            <div key={r.price} style={{ display: 'flex', alignItems: 'center', background: inVa ? VA_BG : undefined, height: 15 }}>
              {/* IB bracket rail */}
              <span style={{ width: 4, alignSelf: 'stretch', background: inIb ? 'var(--dom-tech)' : 'transparent', opacity: 0.55, flexShrink: 0 }} title={inIb ? 'inside the initial balance' : undefined} />
              {/* price */}
              <span style={{ width: 74, textAlign: 'right', paddingRight: 6, color: isPoc ? POC_COLOR : 'var(--muted)', fontWeight: isPoc ? 700 : 400, flexShrink: 0 }}>
                {fmtPx(r.price)}
              </span>
              {/* poc / vpoc markers */}
              <span style={{ width: 16, color: POC_COLOR, flexShrink: 0 }}>{isPoc ? '◆' : isVpoc ? '◇' : ''}</span>
              {/* the letters */}
              <span
                style={{
                  flex: 1,
                  whiteSpace: 'nowrap',
                  letterSpacing: 0.5,
                  color: r.single ? 'var(--loss)' : isPoc ? POC_COLOR : 'var(--text)',
                  opacity: r.single ? 0.9 : 0.55 + 0.45 * (r.tpoCount / maxTpo),
                }}
                title={r.single ? 'single print — price ran through without auctioning' : `${r.tpoCount} periods`}
              >
                {r.letters}
              </span>
              {/* volume histogram */}
              <span style={{ width: 92, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ height: 8, width: `${(r.volume / maxVol) * 62}px`, background: isVpoc ? POC_COLOR : 'var(--dom-tech)', opacity: 0.5 }} />
              </span>
              {/* extreme flags */}
              <span className="small" style={{ width: 74, flexShrink: 0, color: 'var(--loss)', fontSize: 9.5 }}>
                {isHigh && p.extremes.poorHigh ? 'POOR HIGH' : isLow && p.extremes.poorLow ? 'POOR LOW' : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        Rows are {defaultFmt(p.bucket)} wide (in {p.symbol || "feed"} points). Letters are 30-minute brackets in order (A = {rthOpen} ET).
        <span style={{ color: 'var(--loss)' }}> Red letters</span> are single prints — price passed through without
        auctioning, so they act as magnets on the way back. The <span style={{ color: 'var(--dom-tech)' }}>left rail</span> marks
        the initial balance; the shaded band is the value area; ◆ is the time POC and ◇ the volume POC.
      </div>
    </div>
  );
}
