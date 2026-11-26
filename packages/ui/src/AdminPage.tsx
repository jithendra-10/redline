import { useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { collection, getFirestore, limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import type { AuditEvent, RedlineConfig } from '@redline/core';
import { getFirebase, useRedline } from './useRedline';

type EventDoc = AuditEvent & { uid: string; ts: Timestamp | null };


const TYPE_LABEL: Record<string, string> = {
  PERSON: 'People', ORG: 'Organisations', CLIENT_ID: 'Case / client IDs', EMAIL: 'Emails', PHONE: 'Phone numbers',
  ADDRESS: 'Addresses', DATE_OF_BIRTH: 'Dates of birth', GOV_ID: 'Government IDs', CARD_NUMBER: 'Card numbers',
  BANK_ACCOUNT: 'Bank accounts', MEDICAL_CONDITION: 'Medical conditions', MEDICATION: 'Medications',
  FINANCIAL: 'Money amounts', PROJECT_CODENAME: 'Project codenames', SECRET_URL: 'Secret links',
};

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rl-tile">
      <div className="rl-tile-label">{label}</div>
      <div className="rl-tile-value">{value}</div>
      {sub && <div className="rl-muted">{sub}</div>}
    </div>
  );
}

/** Org admin console: live policy (Remote Config) + content-free audit stats (Firestore). */
export function AdminPage({ config }: { config: RedlineConfig | null }) {
  const fb = getFirebase(config);
  const rl = useRedline(config); // live Remote Config policy
  const [user, setUser] = useState<User | null>(null);
  const [events, setEvents] = useState<EventDoc[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [range, setRange] = useState<7 | 30>(7);
  const [authError, setAuthError] = useState<string | null>(null);

  const signIn = async () => {
    if (!fb) return;
    setAuthError(null);
    const auth = getAuth(fb.app);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code;
      // Popup blocked (common on locked-down browsers): fall back to a full-page redirect.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, provider);
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setAuthError((e as Error).message);
      }
    }
  };

  useEffect(() => {
    if (!fb) return;
    return onAuthStateChanged(getAuth(fb.app), setUser);
  }, [fb]);

  useEffect(() => {
    if (!fb || !user || user.isAnonymous) return;
    setDenied(false);
    const q = query(collection(getFirestore(fb.app), 'events'), orderBy('ts', 'desc'), limit(2000));
    return onSnapshot(
      q,
      (snap) => setEvents(snap.docs.map((d) => d.data() as EventDoc)),
      () => setDenied(true),
    );
  }, [fb, user]);

  const inRange = useMemo(() => {
    const cutoff = Date.now() - range * 86_400_000;
    return (events ?? []).filter((e) => (e.ts?.toMillis() ?? Date.now()) >= cutoff);
  }, [events, range]);

  const stats = useMemo(() => {
    const redacted = inRange.filter((e) => e.action === 'redacted');
    const byType: Record<string, number> = {};
    for (const e of redacted) for (const [t, n] of Object.entries(e.counts ?? {})) byType[t] = (byType[t] ?? 0) + (n ?? 0);
    const bySite: Record<string, number> = {};
    for (const e of inRange) bySite[e.site] = (bySite[e.site] ?? 0) + 1;
    return {
      pastes: inRange.length,
      items: redacted.reduce((a, e) => a + (e.total ?? 0), 0),
      overrides: inRange.filter((e) => e.action === 'original').length,
      onDevice: inRange.filter((e) => e.nanoUsed).length,
      medianMs: median(inRange.filter((e) => e.nanoUsed).map((e) => e.nanoMs ?? 0)),
      byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
      bySite: Object.entries(bySite).sort((a, b) => b[1] - a[1]),
    };
  }, [inRange]);

  const projectId = config?.firebase.projectId;
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
  const maxType = stats.byType[0]?.[1] ?? 1;

  return (
    <div className="rl">
      <header className="rl-header">
        <div className="rl-brand">
          <span className="rl-logo">Redline</span>
          <span className="rl-tag">Admin console</span>
        </div>
        <div className="rl-status">
          {user && !user.isAnonymous ? (
            <>
              {user.email}
              <button className="rl-btn rl-btn--ghost" onClick={() => signOut(getAuth(fb!.app))}>Sign out</button>
            </>
          ) : null}
        </div>
      </header>

      {!fb && <div className="rl-banner">Firebase is not configured. See docs/SETUP.md.</div>}

      {fb && (!user || user.isAnonymous) && (
        <section className="rl-card">
          <h2>Sign in to view your organisation's Redline activity</h2>
          <p className="rl-muted">
            The audit log holds counts and categories only. Firestore rules reject any text, so nothing anyone pasted can appear here.
          </p>
          <button className="rl-btn" onClick={signIn}>
            Sign in with Google
          </button>
          {authError && <div className="rl-banner rl-banner--error">{authError}</div>}
        </section>
      )}

      {user && !user.isAnonymous && denied && (
        <section className="rl-card">
          <h2>You're signed in, but not an admin yet</h2>
          <p className="rl-muted">
            In the Firebase console, open Firestore, create a collection named <code>admins</code>, and add a document whose ID is your user ID:
          </p>
          <div className="rl-row">
            <code className="rl-code">{user.uid}</code>
            <button className="rl-btn rl-btn--ghost" onClick={() => navigator.clipboard.writeText(user.uid)}>Copy ID</button>
          </div>
          <p className="rl-muted">Add any field (for example <code>role: "admin"</code>), save, and this page updates by itself after a reload.</p>
        </section>
      )}


      {events && !denied && (
        <>
          <div className="rl-row">
            <h2 className="rl-section-title">Activity</h2>
            <div className="rl-samples" role="group" aria-label="Time range">
              {([7, 30] as const).map((d) => (
                <button key={d} className={`rl-chip ${range === d ? 'rl-chip--on' : ''}`} onClick={() => setRange(d)}>
                  Last {d} days
                </button>
              ))}
            </div>
          </div>

          <div className="rl-tiles">
            <Tile label="Pastes reviewed" value={stats.pastes.toLocaleString()} />
            <Tile label="Sensitive items removed" value={stats.items.toLocaleString()} />
            <Tile label="Ran on-device" value={pct(stats.onDevice, stats.pastes)} sub={stats.medianMs ? `median ${(stats.medianMs / 1000).toFixed(1)} s` : undefined} />
            <Tile label="Sent unredacted" value={pct(stats.overrides, stats.pastes)} sub={`${stats.overrides} "Insert original"`} />
          </div>

          <section className="rl-card">
            <h2>What was removed</h2>
            {stats.byType.length === 0 ? (
              <p className="rl-muted">No redactions in this period yet.</p>
            ) : (
              <ul className="rl-bars" aria-label="Sensitive items removed, by type">
                {stats.byType.map(([type, n]) => (
                  <li key={type} title={`${TYPE_LABEL[type] ?? type}: ${n}`}>
                    <span className="rl-bar-label">{TYPE_LABEL[type] ?? type}</span>
                    <span className="rl-bar-track">
                      <span className="rl-bar-fill" style={{ width: `${Math.max(2, (100 * n) / maxType)}%` }} />
                    </span>
                    <span className="rl-bar-value">{n.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rl-card">
            <h2>By site</h2>
            <table className="rl-table">
              <thead><tr><th>Site</th><th>Pastes</th></tr></thead>
              <tbody>{stats.bySite.map(([s, n]) => <tr key={s}><td>{s}</td><td>{n}</td></tr>)}</tbody>
            </table>
          </section>

          <section className="rl-card">
            <h2>Recent events</h2>
            <table className="rl-table">
              <thead><tr><th>Time</th><th>Site</th><th>Action</th><th>Items</th><th>Where it ran</th></tr></thead>
              <tbody>
                {inRange.slice(0, 25).map((e, i) => (
                  <tr key={i}>
                    <td>{e.ts ? e.ts.toDate().toLocaleString() : 'just now'}</td>
                    <td>{e.site}</td>
                    <td>{e.action}</td>
                    <td>{e.total}</td>
                    <td>{e.nanoUsed ? `On-device · ${(e.nanoMs / 1000).toFixed(1)} s` : 'Patterns only'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="rl-card">
        <div className="rl-row">
          <h2>Live policy</h2>
          <span className={`rl-badge ${rl.policyLive ? 'rl-badge--on_device' : 'rl-badge--skipped'}`}>
            {rl.policyLive ? 'Live from Remote Config' : 'Defaults'}
          </span>
        </div>
        <table className="rl-table">
          <tbody>
            <tr><td>Strictness</td><td>{rl.policy.strictness}</td></tr>
            <tr><td>Keep meaning in placeholders</td><td>{rl.policy.keepMeaning ? 'On ([ORG_1 · hospital])' : 'Off ([ORG_1])'}</td></tr>
            <tr><td>Allow "Insert original"</td><td>{rl.policy.allowOverride ? 'Yes' : 'No'}</td></tr>
            <tr><td>Re-identification check</td><td>{rl.policy.reidCheckMode}</td></tr>
            <tr><td>Minimum paste length</td><td>{rl.policy.minPasteChars} characters</td></tr>
            <tr><td>Protected sites</td><td>{rl.policy.siteAllowlist.join(', ')}</td></tr>
            <tr><td>Entity types</td><td>{rl.policy.entityTypes.length} of 15</td></tr>
          </tbody>
        </table>
        {projectId && (
          <p className="rl-muted">
            Change any value in{' '}
            <a href={`https://console.firebase.google.com/project/${projectId}/config`} target="_blank" rel="noreferrer">
              Remote Config
            </a>{' '}
            and publish. Every Redline extension picks it up within seconds, with no update or reinstall.
          </p>
        )}
      </section>
    </div>
  );
}
