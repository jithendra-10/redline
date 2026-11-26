import { useState } from 'react';
import {
  DEFAULT_POLICY,
  redact,
  SAMPLES,
  scoreSample,
  summarize,
  type EvalSummary,
  type RedlineConfig,
  type SampleScore,
} from '@redline/core';
import { useRedline } from './useRedline';

const pct = (c: number, t: number) => (t ? `${Math.round((100 * c) / t)}%` : '–');

type Scored = SampleScore & { hidden?: boolean };

interface Run {
  label: string;
  scores: Scored[];
  summary: EvalSummary;
}

/** Runs the 30 labelled samples through the real pipeline (Gemini Nano in this browser). */
export function EvalPage({ config }: { config: RedlineConfig | null }) {
  const rl = useRedline(config);
  const [runs, setRuns] = useState<Run[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [repeats, setRepeats] = useState(1);

  const runBaseline = async () => {
    const scores: SampleScore[] = [];
    for (const s of SAMPLES) {
      const t0 = performance.now();
      const r = await redact(s.text, DEFAULT_POLICY, {});
      scores.push(scoreSample(s, r, Math.round(performance.now() - t0)));
    }
    setRuns((prev) => [...prev, { label: 'Patterns only (no Nano)', scores, summary: summarize(scores, SAMPLES) }]);
  };

  const runNano = async () => {
    // Chrome throttles GPU work in background tabs; record whether the tab was hidden
    // during each sample so slow/failed calls can be attributed correctly.
    let wasHidden = document.hidden;
    const onVis = () => { if (document.hidden) wasHidden = true; };
    document.addEventListener('visibilitychange', onVis);
    for (let rep = 1; rep <= repeats; rep++) {
      const scores: Scored[] = [];
      for (const [i, s] of SAMPLES.entries()) {
        setProgress(`Run ${rep}/${repeats} · sample ${i + 1}/${SAMPLES.length} · ${s.id}`);
        wasHidden = document.hidden;
        const t0 = performance.now();
        const r = await rl.runRedact(s.text);
        scores.push({ ...scoreSample(s, r, Math.round(performance.now() - t0)), hidden: wasHidden });
      }
      const label = `Patterns + Gemini Nano${repeats > 1 ? ` · run ${rep}` : ''}`;
      setRuns((prev) => [...prev, { label, scores, summary: summarize(scores, SAMPLES) }]);
    }
    document.removeEventListener('visibilitychange', onVis);
    setProgress(null);
  };

  const nanoReady = rl.device === 'available' && rl.warm === 'ready';
  const last = runs[runs.length - 1];

  return (
    <div className="rl">
      <header className="rl-header">
        <div className="rl-brand">
          <span className="rl-logo">Redline</span>
          <span className="rl-tag">Accuracy eval · 30 labelled samples (10 legal, 10 medical, 10 HR)</span>
        </div>
        <div className="rl-status">
          <span className={`rl-dot ${nanoReady ? 'ok' : 'warn'}`} />{' '}
          {nanoReady ? 'Gemini Nano ready' : rl.warm === 'warming' ? 'Loading Gemini Nano…' : `Nano: ${rl.device}`}
        </div>
      </header>

      <section className="rl-card">
        <h2>What this measures</h2>
        <p className="rl-muted">
          Recall = share of labelled sensitive spans that do <strong>not</strong> survive redaction. A “leaked sample” has at
          least one span left in the text. Latency is end-to-end per paste on this device. Run 3× to see how consistent Nano is.
        </p>
        <div className="rl-row">
          <div className="rl-samples">
            <button className="rl-btn rl-btn--ghost" onClick={runBaseline} disabled={!!progress}>Run patterns-only baseline</button>
            <button className="rl-btn" onClick={runNano} disabled={!!progress || !nanoReady}>Run with Gemini Nano</button>
            <select className="rl-chip" value={repeats} onChange={(e) => setRepeats(Number(e.target.value))} disabled={!!progress}>
              <option value={1}>1 run</option>
              <option value={3}>3 runs</option>
            </select>
          </div>
          {progress && <span className="rl-badge rl-badge--on_device rl-pulse">{progress}</span>}
        </div>
        {progress && (
          <div className="rl-banner">Keep this tab visible while the eval runs. Chrome slows on-device AI in background tabs.</div>
        )}
      </section>

      {runs.length > 0 && (
        <section className="rl-card">
          <h2>Summary</h2>
          <table className="rl-table">
            <thead>
              <tr><th>Run</th><th>Recall</th><th>Leaked samples</th><th>Legal</th><th>Medical</th><th>HR</th><th>Median</th><th>p90</th><th>Nano retried</th><th>Nano failed</th><th>Tab hidden</th></tr>
            </thead>
            <tbody>
              {runs.map((r, i) => (
                <tr key={i}>
                  <td>{r.label}</td>
                  <td><strong>{(r.summary.recall * 100).toFixed(1)}%</strong></td>
                  <td>{r.summary.leakedSamples}/30</td>
                  {(['legal', 'medical', 'hr'] as const).map((d) => (
                    <td key={d}>{pct(r.summary.byDomain[d]?.caught ?? 0, r.summary.byDomain[d]?.total ?? 0)}</td>
                  ))}
                  <td>{(r.summary.medianMs / 1000).toFixed(1)} s</td>
                  <td>{(r.summary.p90Ms / 1000).toFixed(1)} s</td>
                  <td>{r.summary.nanoRetried}</td>
                  <td>{r.summary.nanoFailed}</td>
                  <td>{r.scores.filter((x) => x.hidden).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {last && (
        <section className="rl-card">
          <h2>By entity type · {last.label}</h2>
          <table className="rl-table">
            <thead><tr><th>Type</th><th>Caught</th><th>Recall</th></tr></thead>
            <tbody>
              {Object.entries(last.summary.byType)
                .sort((a, b) => a[1].caught / a[1].total - b[1].caught / b[1].total)
                .map(([type, v]) => (
                  <tr key={type}><td>{type}</td><td>{v.caught}/{v.total}</td><td>{pct(v.caught, v.total)}</td></tr>
                ))}
            </tbody>
          </table>
        </section>
      )}

      {last && (
        <section className="rl-card">
          <h2>Misses · {last.label}</h2>
          <table className="rl-table">
            <thead><tr><th>Sample</th><th>Caught</th><th>Missed spans</th><th>Time</th><th>Nano</th><th>Tab hidden</th></tr></thead>
            <tbody>
              {last.scores.map((s) => (
                <tr key={s.id} className={s.missed.length ? 'rl-miss' : ''}>
                  <td>{s.id}</td>
                  <td>{s.caught}/{s.total}</td>
                  <td>{s.missed.map((m) => `${m.type}: “${m.text}”`).join(' · ') || '—'}</td>
                  <td>{(s.ms / 1000).toFixed(1)} s</td>
                  <td>{s.nano}</td>
                  <td>{s.hidden ? 'yes' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
