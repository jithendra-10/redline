/**
 * Redline content script (AI chat sites).
 *
 * Two triggers, one flow:
 *  - PASTE: a large paste into the chat box is held, redacted on-device, then inserted.
 *  - SEND:  a typed message is checked when the user presses Enter / clicks Send.
 *
 * Quiet mode (default): while Gemini Nano checks, only a small chip shows. If nothing
 * sensitive is found, the text goes through untouched; the full card appears only when
 * a person, ID, contact, health detail etc. is detected.
 *
 * The raw text goes only to the extension's own offscreen worker (on-device). The
 * placeholder -> value mapping stays in this tab's memory.
 */
import { DEFAULT_POLICY, type Policy } from '@redline/core/src/policy';
import { mergeIntoSession } from '@redline/core/src/placeholders';
import { buildAuditEvent, type AuditAction } from '@redline/core/src/audit';
import { addRedactions } from '@redline/core/src/pipeline';
import { needsReview } from '@redline/core/src/quiet';
import type { RedactionResult } from '@redline/core/src/types';
import { PORT_NAME, type PolicySnapshot, type TabRequest, type TabState, type WorkerEvent } from '../protocol';
import {
  editableFrom,
  findSendButton,
  getText,
  insertText,
  isSendButton,
  saveSelection,
  selectAll,
  submit,
  type Editable,
} from './editable';
import { Overlay } from './overlay';
import { Reveal } from './reveal';

type Mode = 'paste' | 'send';

let policy: Policy = DEFAULT_POLICY;
let pausedSites: string[] = [];

/** Runs a chrome.* call, ignoring "Extension context invalidated" from stale tabs. */
function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

safely(() => chrome.storage.local.get(['redlinePolicy', 'redlinePausedSites']))?.then((v) => {
  const snap = v.redlinePolicy as PolicySnapshot | undefined;
  if (snap?.policy) policy = { ...DEFAULT_POLICY, ...snap.policy };
  pausedSites = (v.redlinePausedSites as string[] | undefined) ?? [];
});
safely(() =>
  chrome.storage.onChanged.addListener((changes) => {
    const snap = changes.redlinePolicy?.newValue as PolicySnapshot | undefined;
    if (snap?.policy) policy = { ...DEFAULT_POLICY, ...snap.policy };
    if (changes.redlinePausedSites) pausedSites = (changes.redlinePausedSites.newValue as string[]) ?? [];
  }),
);

let session: Record<string, string> = {};
let overlay: Overlay | null = null;
let overlayEls: Element[] = [];
/** Text the user already approved (redacted or original) — never re-checked on send. */
let approvedText: string | null = null;
let lastComposer: Editable | null = null;
const reveal = new Reveal(() => session, () => overlayEls);

const host = location.hostname;

function siteAllowed(): boolean {
  if (pausedSites.includes(host)) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true; // local demo / mock chat page
  return policy.siteAllowlist.some((s) => host === s || host.endsWith(`.${s}`));
}

/** After the extension is updated or reloaded, scripts already in open tabs lose chrome.runtime. */
const extensionAlive = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id;

const RELOAD_MESSAGE =
  'Redline was updated. Reload this page (F5) to keep protecting your messages. Nothing was sent or inserted.';

async function ensureWorker(): Promise<void> {
  if (!extensionAlive()) throw new Error(RELOAD_MESSAGE);
  const res = await chrome.runtime.sendMessage({ type: 'ensure-worker' });
  if (!res?.ok) throw new Error(res?.error ?? 'Redline worker unavailable');
}

function closeOverlay() {
  overlay?.destroy();
  overlay = null;
  overlayEls = [];
  window.removeEventListener('keydown', onOverlayKey, true);
}

function onOverlayKey(e: KeyboardEvent) {
  if (!overlay || e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    // Stop the chat site from sending while Redline is deciding.
    e.preventDefault();
    e.stopImmediatePropagation();
    overlay.requestInsert();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    overlay.requestCancel();
  }
}

/** Puts text into the composer: at the caret (paste) or replacing everything (send). */
function place(target: Editable, mode: Mode, saved: ReturnType<typeof saveSelection>, text: string) {
  if (mode === 'paste') insertText(target, saved, text);
  else insertText(target, selectAll(target), text);
}

function sendAfterInsert(target: Editable, text: string) {
  approvedText = text;
  // Editors (ProseMirror, Quill, Lexical) update their state asynchronously.
  setTimeout(() => submit(target), 60);
}

function review(text: string, target: Editable, mode: Mode) {
  const saved = saveSelection(target);
  let latest: RedactionResult | null = null;
  const id = Math.random().toString(36).slice(2);

  const audit = (action: AuditAction) => {
    if (!latest || !extensionAlive()) return;
    const event = buildAuditEvent(latest, action, host);
    safely(() => chrome.runtime.sendMessage({ type: 'audit', event }))?.catch(() => {});
  };

  /** Nothing sensitive (quiet mode): let the original through untouched. */
  const passThrough = () => {
    audit('clean');
    closeOverlay();
    if (mode === 'paste') insertText(target, saved, text);
    else sendAfterInsert(target, text);
  };

  overlay = new Overlay(
    {
      onInsertRedacted: () => {
        if (!latest) return;
        const merged = mergeIntoSession(session, latest.redacted, latest.mapping);
        session = merged.session;
        audit('redacted');
        closeOverlay();
        place(target, mode, saved, merged.redacted);
        if (mode === 'send') sendAfterInsert(target, merged.redacted);
        else approvedText = null;
        if (Object.keys(session).length) {
          reveal.show();
          reveal.refresh();
        }
      },
      onInsertOriginal: () => {
        audit('original');
        closeOverlay();
        if (mode === 'paste') insertText(target, saved, text);
        else sendAfterInsert(target, text);
      },
      onCancel: () => {
        audit('cancelled');
        closeOverlay(); // send mode: the typed text stays in the box for editing
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
              const port = safely(() => chrome.runtime.connect({ name: PORT_NAME }));
              if (!port) {
                overlay.setRisk({ state: 'error', message: RELOAD_MESSAGE });
                return;
              }
              const t = setTimeout(() => {
                overlay?.setRisk({ state: 'error', message: 'timed out' });
                safely(() => port.disconnect());
              }, 45_000);
              port.onMessage.addListener((ev: WorkerEvent) => {
                if (ev.id !== rid) return;
                clearTimeout(t);
                if (ev.type === 'risk-result') overlay?.setRisk({ state: 'done', report: ev.report });
                else if (ev.type === 'error') overlay?.setRisk({ state: 'error', message: ev.message });
                safely(() => port.disconnect());
              });
              safely(() => port.postMessage({ type: 'risk', id: rid, result: latest }));
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
    {
      allowOverride: policy.allowOverride,
      anchor: target.getBoundingClientRect(),
      mode,
      compact: policy.quietMode,
    },
  );
  overlayEls = [...document.querySelectorAll('redline-overlay')];
  window.addEventListener('keydown', onOverlayKey, true);

  ensureWorker()
    .then(() => {
      const port = chrome.runtime.connect({ name: PORT_NAME });
      const timeout = setTimeout(() => {
        // Worker never answered: fail safe (nothing inserted or sent until the user decides).
        overlay?.expand();
        overlay?.error('Redline did not respond in time. Nothing was sent or inserted.');
        safely(() => port.disconnect());
      }, 60_000);
      port.onMessage.addListener((ev: WorkerEvent) => {
        if (ev.id !== id || !overlay) return;
        if (ev.type === 'error') {
          clearTimeout(timeout);
          overlay.expand();
          overlay.error(ev.message);
          safely(() => port.disconnect());
          return;
        }
        if (ev.type === 'risk-result') return;
        latest = ev.result;
        if (ev.type === 'final') {
          clearTimeout(timeout);
          safely(() => port.disconnect());
          // Quiet mode: if Nano ran and found nothing sensitive, don't interrupt the user.
          if (policy.quietMode && !ev.result.reducedProtection && !needsReview(ev.result)) {
            passThrough();
            return;
          }
          overlay.expand();
        }
        overlay.update(ev.result, ev.type === 'final');
      });
      port.postMessage({ type: 'redact', id, text });
    })
    .catch((e) => {
      overlay?.expand();
      overlay?.error(extensionAlive() ? (e as Error).message : RELOAD_MESSAGE);
    });
}

// ---------------- Trigger 1: paste ----------------
function onPaste(e: ClipboardEvent) {
  // Our own re-inserted paste is untrusted; let it through.
  if (!e.isTrusted || overlay || !siteAllowed()) return;
  const target = editableFrom(e.target);
  if (!target) return;
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (text.trim().length < policy.minPasteChars) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  review(text, target, 'paste');
}

// ---------------- Trigger 2: send (typed text) ----------------
/** Returns true if Redline took over this send. */
function interceptSend(composer: Editable | null, e: Event): boolean {
  if (!composer || overlay || !policy.checkOnSend || !siteAllowed()) return false;
  const text = getText(composer).trim();
  if (text.length < policy.minPasteChars) return false;
  if (approvedText !== null && text === approvedText.trim()) {
    approvedText = null; // approved once; the next edit is checked again
    return false;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  review(text, composer, 'send');
  return true;
}

function onKeydown(e: KeyboardEvent) {
  if (!e.isTrusted || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
  interceptSend(editableFrom(e.target), e);
}

function onClick(e: MouseEvent) {
  if (!e.isTrusted) return;
  const btn = isSendButton(e.target);
  if (!btn || !lastComposer || !lastComposer.isConnected) return;
  // Only the send button that belongs to the chat box the user was typing in.
  if (findSendButton(lastComposer) !== btn) return;
  interceptSend(lastComposer, e);
}

window.addEventListener('focusin', (e) => {
  const ed = editableFrom(e.target);
  if (ed) lastComposer = ed;
});

// Capture phase on window: we see paste / Enter / Send before the site's editor does.
window.addEventListener('paste', onPaste, true);
window.addEventListener('keydown', onKeydown, true);
window.addEventListener('click', onClick, true);

// ---------------- Side panel queries ----------------
safely(() =>
  chrome.runtime.onMessage.addListener((msg: TabRequest, _sender, sendResponse) => {
    if (msg.type === 'toggle-reveal') {
      if (Object.keys(session).length) {
        reveal.show();
        reveal.toggle();
      }
    } else if (msg.type !== 'tab-state') return false;
    const paused = pausedSites.includes(host);
    const state: TabState = {
      host,
      protectedSite: host === 'localhost' || host === '127.0.0.1' || policy.siteAllowlist.some((s) => host === s || host.endsWith(`.${s}`)),
      paused,
      revealOn: reveal.isOn,
      session,
    };
    sendResponse(state);
    return false;
  }),
);
