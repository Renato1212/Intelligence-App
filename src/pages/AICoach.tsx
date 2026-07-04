import { useState } from 'react';
import { useToast } from '../components/ui';
import { buildAIDossier, COACH_PROMPT } from '../lib/aiExport';
import { downloadFile } from '../lib/exporters';
import { todayISO } from '../lib/format';

const PROMPT_IDEAS = [
  {
    title: 'Find my hidden patterns',
    text: 'Using my journal dossier: find the 5 most statistically meaningful patterns I probably cannot see myself — correlations between time of day, instrument, domain, tags, preparation quality, scaling behaviour and outcomes. Rank them by impact on expectancy and show the evidence.',
  },
  {
    title: 'Audit my scaling decisions',
    text: 'Focus on the per-fill execution data in my dossier. Analyse how I scale in and out: do my adds improve or worsen my average price relative to the final outcome? Do market orders vs limit orders perform differently? What rules should I adopt for adds and partials?',
  },
  {
    title: 'Grade me like an AXIA coach',
    text: 'Act as an AXIA Futures coach. Using the grading rubric (trigger recognition, sizing, exit discipline, articulation, post-trade review — below/at/above standard) and my journal, write my quarterly performance review: strengths, the criterion holding me back, and the drill to fix it.',
  },
  {
    title: 'Build next week’s plan',
    text: 'From my recent preparations, debriefs and results, write my trading plan for next week: which edge domains and setups to focus on, which to avoid, risk limits per day based on my drawdown behaviour, and 3 process goals with measurable targets.',
  },
];

export default function AICoach() {
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const toast = useToast();

  const withDossier = async (fn: (md: string) => void | Promise<void>) => {
    setBusy(true);
    try {
      const md = await buildAIDossier();
      setSize(md.length);
      await fn(md);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">AI Coach</h1>
          <p className="page-sub">
            Turn any AI subscription — Claude, ChatGPT, Gemini — into your personal performance analyst. One click
            packages everything in Edge Intelligence (stats, every trade with fills and notes, debriefs,
            preparations, strategies) into a dossier built for AI analysis.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-title">Get your dossier</div>
          <div className="row">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                withDossier(async (md) => {
                  await navigator.clipboard.writeText(COACH_PROMPT + md);
                  toast('Coach prompt + full dossier copied — paste it into your AI chat');
                })
              }
            >
              {busy ? 'Building…' : 'Copy coach prompt + dossier'}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                withDossier(async (md) => {
                  await navigator.clipboard.writeText(md);
                  toast('Dossier copied to clipboard');
                })
              }
            >
              Copy dossier only
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                withDossier((md) => {
                  downloadFile(`edge-intelligence-dossier-${todayISO()}.md`, md, 'text/markdown');
                  toast('Dossier downloaded — attach the file to your AI chat');
                })
              }
            >
              Download .md file
            </button>
            {size != null && (
              <span className="muted small">
                ~{Math.round(size / 1000)}K characters (≈{Math.round(size / 4 / 1000)}K tokens)
              </span>
            )}
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            The dossier is plain Markdown: overview stats, edge tables by domain / setup / hour / instrument, coach
            grade profile, strategies with samples, the full chronological trade log (including per-fill scaling
            detail, tags, descriptions and lessons), every daily debrief and every preparation with its hypotheses.
            For large journals, attaching the downloaded file usually works better than pasting.
          </p>
        </div>

        <div className="card">
          <div className="card-title">
            Prompts that extract edge <span className="hint">click to copy, then paste after the dossier</span>
          </div>
          <div className="grid grid-2">
            {PROMPT_IDEAS.map((p) => (
              <div
                key={p.title}
                className="card clickable"
                style={{ background: 'var(--surface)', cursor: 'pointer' }}
                onClick={async () => {
                  await navigator.clipboard.writeText(p.text);
                  toast(`“${p.title}” prompt copied`);
                }}
              >
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>{p.title}</h3>
                <p className="muted small" style={{ margin: 0 }}>
                  {p.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">A workflow that compounds</div>
          <ul className="check">
            <li>
              <b>Weekly:</b> export the dossier and run the “hidden patterns” prompt. Turn one finding into a rule,
              write it into the relevant strategy in the Strategy Lab.
            </li>
            <li>
              <b>Monthly:</b> run the coach-review prompt and compare it with last month's — your grade profile should
              be trending toward “above standard” one criterion at a time.
            </li>
            <li>
              <b>Every import:</b> the more consistently you tag, grade and debrief, the sharper the AI's analysis
              gets — review discipline is literally the input to your edge discovery.
            </li>
          </ul>
        </div>
      </div>
    </>
  );
}
