import { useState, type ReactNode } from 'react';
import { isPlaceholder, PLACEHOLDER_RE, rehydrate, type RedactionResult, type RedlineConfig, type RiskReport, type StepLocation } from '@redline/core';
import { useRedline } from './useRedline';

const SAMPLES: Record<string, string> = {
  Legal: `Hi, please tighten this email to opposing counsel:
"Our client Priya Shah (matter #LGL-2291) will not accept the Acme Corp settlement of $4.2M. As the only female partner in our Austin office, Ms. Shah has asked that all calls go to her cell +1 512-555-0148 or priya.shah@shahlegal.com."`,
  Medical: `Summarize this referral for the specialist: Patient John Miller, DOB 03/14/1961, MRN 448812, presented at St. Mary's Hospital with suspected chronic lymphocytic leukemia. Currently on ibrutinib 420mg daily. Referred by Dr. Anita Rao.`,
  HR: `Rewrite this kindly: We are terminating Daniel Okafor (employee ID E-10432) from Project Falcon effective Friday. His salary of $148,000 will be paid through December. Contact his manager Laura Chen at laura.chen@northwind.io.`,
};

const LOC_LABEL: Record<StepLocation, string> = {
  local_code: 'Local code',
  on_device: 'On-device · Gemini Nano',
  in_cloud: 'Cloud · redacted text only',
  skipped: 'Skipped',
};

function LocBadge({ loc }: { loc: StepLocation }) {
  return <span className={`rl-badge rl-badge--${loc}`}>{loc === 'in_cloud' ? '☁' : loc === 'skipped' ? '–' : '🔒'} {LOC_LABEL[loc]}</span>;
}

function highlightPlaceholders(text: string): ReactNode[] {
  return text.split(new RegExp(`(${PLACEHOLDER_RE.source})`, 'g')).map((part, i) =>
    isPlaceholder(part) ? <mark key={i} className="rl-ph">{part}</mark> : <span key={i}>{part}</span>,
  );
}

function highlightOriginal(text: string, values: string[]): ReactNode[] {
  if (!values.length) return [text];
  const esc = values.sort((a, b) => b.length - a.length).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  const lower = new Set(values.map((v) => v.toLowerCase()));
  return text.split(re).map((part, i) =>
    lower.has(part.toLowerCase()) ? <del key={i} className="rl-struck">{part}</del> : <span key={i}>{part}</span>,
  );
}

const DEVICE_TEXT: Record<string, string> = {
  available: 'Gemini Nano ready on this device',
  downloadable: 'Gemini Nano can be downloaded',
  downloading: 'Gemini Nano is downloading…',
  unavailable: 'Gemini Nano not available on this device',
  unsupported: 'This browser has no on-device model (Prompt API)',
};

export function Playground({ config, surface }: { config: RedlineConfig | null; surface: 'web' | 'extension' }) {
  const rl = useRedline(config);
  const [input, setInput] = useState(SAMPLES.Legal!);
  const [result, setResult] = useState<RedactionResult | null>(null);
  const [risk, setRisk] = useState<RiskReport | null>(null);
  const [busy, setBusy] = useState<'redact' | 'risk' | null>(null);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');

  const doRedact = async () => {
    setBusy('redact');
    setError(null);
    setRisk(null);
    try {
      setResult(
        await rl.runRedact(input, (p) => {
          setResult(p);
          setPartial(true);
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPartial(false);
      setBusy(null);
    }
  };

  const doRisk = async () => {
    if (!result) return;
    setBusy('risk');
    setError(null);
    try {
      setRisk(await rl.runRisk(result));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const nanoReady = rl.device === 'available';

  return (
    <div className={`rl rl--${surface}`}>
      <header className="rl-header">
        <div className="rl-brand">
          <span className="rl-logo">Redline</span>
          <span className="rl-tag">Privacy firewall for AI chat</span>
        </div>
        <div className="rl-status">
          <span className={`rl-dot ${nanoReady && rl.warm !== 'warming' ? 'ok' : 'warn'}`} />{' '}
          {nanoReady && rl.warm === 'warming' ? 'Loading Gemini Nano into memory…' : DEVICE_TEXT[rl.device]}
          {(rl.device === 'downloadable' || rl.device === 'downloading') && rl.configured && (
            <button className="rl-btn rl-btn--ghost" onClick={rl.downloadNano} disabled={rl.downloadProgress !== null}>
              {rl.downloadProgress !== null ? `Downloading ${Math.round(rl.downloadProgress * 100)}%` : 'Download Nano'}
            </button>
          )}
        </div>
      </header>

      {!rl.configured && (
        <div className="rl-banner">
          Firebase is not configured, so only the local pattern detectors run. Copy <code>.env.example</code> to{' '}
          <code>.env</code> and fill in your Firebase web app config.
        </div>
      )}

      <section className="rl-card">
        <div className="rl-row">
          <h2>1 · Paste what you were about to send to an AI</h2>
          <div className="rl-samples">
            {Object.keys(SAMPLES).map((k) => (
              <button key={k} className="rl-chip" onClick={() => { setInput(SAMPLES[k]!); setResult(null); setRisk(null); }}>
                {k}
              </button>
            ))}
          </div>
        </div>
        <textarea className="rl-input" value={input} onChange={(e) => setInput(e.target.value)} rows={surface === 'web' ? 6 : 8} />
        <button className="rl-btn" onClick={doRedact} disabled={busy !== null || !input.trim()}>
          {busy === 'redact' ? 'Redacting…' : 'Redact'}
        </button>
      </section>

      {error && <div className="rl-banner rl-banner--error">{error}</div>}

      {result && (
        <section className="rl-card">
          <div className="rl-row">
            <h2>2 · What stays on your device vs. what you send</h2>
            {partial ? (
              <span className="rl-badge rl-badge--on_device rl-pulse">🔒 Gemini Nano reviewing on-device…</span>
            ) : (
              result.reducedProtection && <span className="rl-badge rl-badge--skipped">Reduced protection: patterns only</span>
            )}
          </div>
          <div className="rl-diff">
            <div>
              <h3>Original · never leaves this device</h3>
              <p className="rl-text">{highlightOriginal(result.original, Object.values(result.mapping))}</p>
            </div>
            <div>
              <h3>{partial ? 'Redacted · draft, still checking' : 'Redacted · safe to paste'}</h3>
              <p className={`rl-text ${partial ? 'rl-provisional' : ''}`}>{highlightPlaceholders(result.redacted)}</p>
              <button className="rl-btn rl-btn--ghost" disabled={partial} onClick={() => navigator.clipboard.writeText(result.redacted)}>Copy redacted</button>
            </div>
          </div>

          <ol className="rl-trace">
            {result.trace.map((s, i) => (
              <li key={i}>
                <LocBadge loc={s.location} /> <strong>{s.step}</strong> <span className="rl-muted">{s.ms} ms · {s.detail}</span>
              </li>
            ))}
            {partial && (
              <li>
                <span className="rl-badge rl-badge--on_device rl-pulse">🔒 On-device · Gemini Nano</span>{' '}
                <strong>Finding names, companies, IDs and medical terms…</strong>{' '}
                <span className="rl-muted">numbers and emails were caught instantly; the rest takes a few seconds</span>
              </li>
            )}
            {risk && (
              <li>
                <LocBadge loc={risk.location} /> <strong>Re-identification check</strong> <span className="rl-muted">{risk.ms} ms</span>
              </li>
            )}
          </ol>

          <div className="rl-row">
            <button className="rl-btn" onClick={doRisk} disabled={busy !== null || partial || !rl.configured || rl.policy.reidCheckMode === 'off'}>
              {busy === 'risk' ? 'Checking…' : 'Check re-identification risk'}
            </button>
            <span className="rl-muted">Only the redacted text is sent. Originals are blocked in code.</span>
          </div>

          {risk && (
            <div className={`rl-risk rl-risk--${risk.risk}`}>
              <strong>Risk: {risk.risk.toUpperCase()}</strong>
              <ul>{risk.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              {risk.suggestedRedactions.length > 0 && (
                <button className="rl-btn" onClick={() => { setResult(rl.applySuggestions(result, risk.suggestedRedactions)); setRisk(null); }}>
                  Also redact: {risk.suggestedRedactions.map((s) => `“${s.text}”`).join(', ')}
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="rl-card">
          <h2>3 · Paste the AI's reply to restore the real names (locally)</h2>
          <textarea className="rl-input" value={reply} onChange={(e) => setReply(e.target.value)} rows={3}
            placeholder="e.g. Dear counsel, [PERSON_1] declines the [ORG_1] offer…" />
          {reply && <p className="rl-text">{rehydrate(reply, result.mapping)}</p>}
        </section>
      )}

      <footer className="rl-footer">
        <span>🔒 {rl.stats.localCalls} on-device calls</span>
        <span>☁ {rl.stats.cloudCalls} cloud calls</span>
        <span>{rl.stats.bytesKeptLocal.toLocaleString()} B of raw text kept local</span>
        <span>{rl.stats.bytesSentToCloud.toLocaleString()} B redacted text sent</span>
        <span className="rl-muted">Policy: {rl.policy.strictness}{rl.policyLive ? ' · live from Remote Config' : ' · defaults'}</span>
      </footer>
    </div>
  );
}
