/**
 * Redline content script (AI chat sites).
 *
 * Intercepts large pastes into the chat input, sends the text over an
 * extension-internal port to the offscreen worker (Gemini Nano, on-device),
 * shows the live redaction, and inserts the redacted version on Enter.
 * The placeholder -> value mapping stays in this tab's memory only.
 */
import { DEFAULT_POLICY, type Policy } from '@redline/core/src/policy';
import { mergeIntoSession } from '@redline/core/src/placeholders';
import { buildAuditEvent, type AuditAction } from '@redline/core/src/audit';
import { addRedactions } from '@redline/core/src/pipeline';
import type { RedactionResult } from '@redline/core/src/types';
import { PORT_NAME, type PolicySnapshot, type WorkerEvent } from '../protocol';
import { editableFrom, insertText, saveSelection, type Editable } from './editable';
import { Overlay } from './overlay';
import { Reveal } from './reveal';

let policy: Policy = DEFAULT_POLICY;
chrome.storage.local.get('redlinePolicy').then((v) => {
  const snap = v.redlinePolicy as PolicySnapshot | undefined;
  if (snap?.policy) policy = snap.policy;
});
chrome.storage.onChanged.addListener((changes) => {
  const snap = changes.redlinePolicy?.newValue as PolicySnapshot | undefined;
  if (snap?.policy) policy = snap.policy;
});

let session: Record<string, string> = {};
let overlay: Overlay | null = null;
let overlayEls: Element[] = [];
const reveal = new Reveal(() => session, () => overlayEls);

function siteAllowed(): boolean {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true; // local demo / mock chat page
  return policy.siteAllowlist.some((s) => host === s || host.endsWith(`.${s}`));
}

/** After the extension is updated or reloaded, scripts already in open tabs lose chrome.runtime. */
const extensionAlive = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id;

const RELOAD_MESSAGE =
  'Redline was updated. Reload this page (F5) to keep protecting your pastes. Your text was not inserted.';

async function ensureWorker(): Promise<void> {
  if (!extensionAlive()) throw new Error(RELOAD_MESSAGE);
  const res = await chrome.runtime.sendMessage({ type: 'ensure-worker' });
  if (!res?.ok) throw new Error(res?.error ?? 'Redline worker unavailable');
}

function closeOverlay() {
  overlay?.destroy();
  overlay = null;
  overlayEls = [];
  window.removeEventListener('keydown', onKey, true);
}

function onKey(e: KeyboardEvent) {
  if (!overlay || e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    // Stop the chat site from sending the (empty) message.
    e.preventDefault();
    e.stopImmediatePropagation();
    overlay.requestInsert();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeOverlay();
  }
}

function startRedaction(text: string, target: Editable) {
  const saved = saveSelection(target);
  let latest: RedactionResult | null = null;
  const id = Math.random().toString(36).slice(2);

  const audit = (action: AuditAction) => {
    if (!latest) return;
    if (!extensionAlive()) return;
    const event = buildAuditEvent(latest, action, location.hostname);
    chrome.runtime.sendMessage({ type: 'audit', event }).catch(() => {});
  };

  const finish = (insert: string | null) => {
    closeOverlay();
    if (insert !== null) insertText(target, saved, insert);
  };

  overlay = new Overlay(
    {
      onInsertRedacted: () => {
        if (!latest) return;
        const merged = mergeIntoSession(session, latest.redacted, latest.mapping);
        session = merged.session;
        audit('redacted');
        finish(merged.redacted);
        if (Object.keys(session).length) {
          reveal.show();
          reveal.refresh();
        }
      },
      onInsertOriginal: () => {
        audit('original');
        finish(text);
      },
      onCancel: () => {
        audit('cancelled');
        finish(null);
      },
      ...(policy.reidCheckMode === 'off'
        ? {}
        : {
            onCheckRisk: () => {
              if (!latest || !overlay) return;
              if (!extensionAlive()) {
                overlay.setRisk({ state: 'error', message: RELOAD_MESSAGE });
                return;
              }
              overlay.setRisk({ state: 'checking' });
              const rid = Math.random().toString(36).slice(2);
              const port = chrome.runtime.connect({ name: PORT_NAME });
              const t = setTimeout(() => {
                overlay?.setRisk({ state: 'error', message: 'timed out' });
                port.disconnect();
              }, 45_000);
              port.onMessage.addListener((ev: WorkerEvent) => {
                if (ev.id !== rid) return;
                clearTimeout(t);
                if (ev.type === 'risk-result') overlay?.setRisk({ state: 'done', report: ev.report });
                else if (ev.type === 'error') overlay?.setRisk({ state: 'error', message: ev.message });
                port.disconnect();
              });
              port.postMessage({ type: 'risk', id: rid, result: latest });
            },
            onApplySuggestions: (suggestions) => {
              if (!latest || !overlay) return;
              latest = addRedactions(
                latest,
                suggestions.map((x) => ({ ...x, confidence: 1, source: 'cloud_suggestion' as const })),
                policy,
              );
              overlay.update(latest, true);
              overlay.setRisk({ state: 'idle' });
            },
          }),
    },
    policy.allowOverride,
    target.getBoundingClientRect(),
  );
  overlayEls = [...document.querySelectorAll('redline-overlay')];
  window.addEventListener('keydown', onKey, true);

  ensureWorker()
    .then(() => {
      const port = chrome.runtime.connect({ name: PORT_NAME });
      const timeout = setTimeout(() => {
        // Worker never answered: fail safe (nothing inserted until the user decides).
        overlay?.error('Redline did not respond in time. Your text was not inserted.');
        port.disconnect();
      }, 60_000);
      port.onMessage.addListener((ev: WorkerEvent) => {
        if (ev.id !== id || !overlay) return;
        if (ev.type === 'error') {
          clearTimeout(timeout);
          overlay.error(ev.message);
          port.disconnect();
          return;
        }
        if (ev.type === 'risk-result') return;
        latest = ev.result;
        overlay.update(ev.result, ev.type === 'final');
        if (ev.type === 'final') {
          clearTimeout(timeout);
          port.disconnect();
        }
      });
      port.postMessage({ type: 'redact', id, text });
    })
    .catch((e) => overlay?.error((e as Error).message));
}

function onPaste(e: ClipboardEvent) {
  // Our own re-inserted paste is untrusted; let it through.
  if (!e.isTrusted || overlay || !siteAllowed()) return;
  const target = editableFrom(e.target);
  if (!target) return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (text.trim().length < policy.minPasteChars) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  startRedaction(text, target);
}

// Capture phase on window: we see the paste before the site's editor does.
window.addEventListener('paste', onPaste, true);
