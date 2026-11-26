import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_POLICY } from '@redline/core/src/policy';
import type { LocalStats, PolicySnapshot, TabState } from '../protocol';

const SITE = 'https://redline-hybrid.web.app';

const DEVICE_TEXT: Record<string, string> = {
  available: 'Gemini Nano ready on this device',
  downloadable: 'Gemini Nano not downloaded yet',
  downloading: 'Gemini Nano is downloading…',
  unavailable: 'Gemini Nano unavailable: patterns only',
  unsupported: 'No on-device model: patterns only',
};

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function askTab<T>(msg: object): Promise<T | null> {
  const id = await activeTabId();
  if (id === undefined) return null;
  try {
    return (await chrome.tabs.sendMessage(id, msg)) as T;
  } catch {
    return null; // not an AI chat page (no content script), or the page needs a reload
  }
}

/** The extension's control panel: status, per-site pause, this tab's redactions, stats. */
export function Panel() {
  const [snap, setSnap] = useState<PolicySnapshot | null>(null);
  const [tab, setTab] = useState<TabState | null>(null);
  const [paused, setPaused] = useState<string[]>([]);
  const [stats, setStats] = useState<LocalStats | null>(null);

  const refresh = useCallback(async () => {
    const v = await chrome.storage.local.get(['redlinePolicy', 'redlinePausedSites', 'redlineStats']);
    setSnap((v.redlinePolicy as PolicySnapshot) ?? null);
    setPaused((v.redlinePausedSites as string[]) ?? []);
    setStats((v.redlineStats as LocalStats) ?? null);
    setTab(await askTab<TabState>({ type: 'tab-state' }));
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'ensure-worker' }).catch(() => {});
    refresh();
    const t = setInterval(refresh, 2000);
    const onTab = () => refresh();
    chrome.tabs.onActivated.addListener(onTab);
    return () => {
      clearInterval(t);
      chrome.tabs.onActivated.removeListener(onTab);
    };
  }, [refresh]);

  const policy = { ...DEFAULT_POLICY, ...snap?.policy };
  const device = snap?.device ?? 'unsupported';
  const nanoOk = device === 'available';
  const isPaused = !!tab && paused.includes(tab.host);
  const entries = Object.entries(tab?.session ?? {});

  const togglePause = async () => {
    if (!tab) return;
    const next = isPaused ? paused.filter((h) => h !== tab.host) : [...paused, tab.host];
    await chrome.storage.local.set({ redlinePausedSites: next });
    setPaused(next);
  };

  const toggleReveal = async () => {
    await askTab({ type: 'toggle-reveal' });
    refresh();
  };

  const total = stats ? stats.redacted + stats.clean + stats.original + stats.cancelled : 0;

  return (
    <div className="rl rl--extension">
      <header className="rl-header">
        <div className="rl-brand">
          <span className="rl-logo">Redline</span>
          <span className="rl-tag">Privacy firewall for AI chat</span>
        </div>
      </header>

      <section className="rl-card">
        <div className="rl-row">
          <h2>{!tab ? 'Not an AI chat page' : !tab.protectedSite ? 'This site isn’t protected' : isPaused ? 'Paused on this site' : 'Protecting this site'}</h2>
          <span className={`rl-badge ${tab?.protectedSite && !isPaused ? 'rl-badge--on_device' : 'rl-badge--skipped'}`}>
            {tab?.protectedSite && !isPaused ? 'On' : 'Off'}
          </span>
        </div>
        <p className="rl-muted">
          {tab ? tab.host : 'Open ChatGPT, Gemini, Claude, Copilot or Perplexity. If one is open, reload it once.'}
        </p>
        <div className="rl-status">
          <span className={`rl-dot ${nanoOk ? 'ok' : 'warn'}`} /> {DEVICE_TEXT[device] ?? device}
        </div>
        {tab?.protectedSite && (
          <button className="rl-btn rl-btn--ghost" onClick={togglePause}>
            {isPaused ? `Resume on ${tab.host}` : `Pause on ${tab.host}`}
          </button>
        )}
      </section>

      <section className="rl-card">
        <div className="rl-row">
          <h2>This chat</h2>
          {entries.length > 0 && (
            <button className="rl-btn rl-btn--ghost" onClick={toggleReveal}>
              {tab?.revealOn ? 'Hide real names' : 'Show real names'}
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="rl-muted">Nothing redacted in this tab yet. Paste or type something with names, IDs or contacts.</p>
        ) : (
          <>
            <p className="rl-muted">Only you can see these values. They stay in this tab and are forgotten when it closes.</p>
            <table className="rl-table">
              <tbody>
                {entries.map(([k, v]) => (
                  <tr key={k}>
                    <td><mark className="rl-ph">[{k}]</mark></td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="rl-card">
        <h2>How Redline behaves</h2>
        <table className="rl-table">
          <tbody>
            <tr><td>Checks</td><td>{policy.checkOnSend ? 'Pastes and typed messages' : 'Pastes only'}</td></tr>
            <tr><td>Everyday messages</td><td>{policy.quietMode ? 'Go through untouched if nothing sensitive' : 'Always show the card'}</td></tr>
            <tr><td>Placeholders</td><td>{policy.keepMeaning ? 'Keep meaning ([ORG_1 · hospital])' : 'Plain ([ORG_1])'}</td></tr>
            <tr><td>Strictness</td><td>{policy.strictness}</td></tr>
          </tbody>
        </table>
        <p className="rl-muted">Set by your organisation via Firebase Remote Config.</p>
      </section>

      {stats && total > 0 && (
        <section className="rl-card">
          <h2>On this device</h2>
          <div className="rl-tiles">
            <div className="rl-tile"><div className="rl-tile-label">Messages checked</div><div className="rl-tile-value">{total}</div></div>
            <div className="rl-tile"><div className="rl-tile-label">Items removed</div><div className="rl-tile-value">{stats.items}</div></div>
          </div>
          <p className="rl-muted">
            {stats.redacted} redacted · {stats.clean} clean · {stats.original} sent as original · {stats.cancelled} cancelled
          </p>
        </section>
      )}

      <footer className="rl-footer">
        <a href={SITE} target="_blank" rel="noreferrer">Playground</a>
        <a href={`${SITE}/eval`} target="_blank" rel="noreferrer">Accuracy eval</a>
        <a href={`${SITE}/admin`} target="_blank" rel="noreferrer">Admin console</a>
      </footer>
    </div>
  );
}
