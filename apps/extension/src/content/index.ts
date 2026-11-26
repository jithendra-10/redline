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
import { isSensitiveEntity, needsReview } from '@redline/core/src/quiet';
import type { RedactionResult } from '@redline/core/src/types';
import { PORT_NAME, type PolicySnapshot, type TabRequest, type TabState, type WorkerEvent } from '../protocol';
import {
  editableFrom,
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
import { Indicator } from './indicator';

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

/** Asks the on-device worker to redact `text`. Returns a function that stops listening. */
function runWorker(
  text: string,
  on: { partial?: (r: RedactionResult) => void; final: (r: RedactionResult) => void; error: (m: string) => void },
): () => void {
  let done = false;
  let port: chrome.runtime.Port | undefined;
  const id = Math.random().toString(36).slice(2);
  const stop = () => {
    done = true;
    safely(() => port?.disconnect());
  };
  const timeout = setTimeout(() => {
    if (!done) on.error('Redline did not respond in time. Nothing was sent or inserted.');
    stop();
  }, 60_000);
  ensureWorker()
    .then(() => {
      if (done) return;
      port = chrome.runtime.connect({ name: PORT_NAME });
      port.onMessage.addListener((ev: WorkerEvent) => {
        if (ev.id !== id || done) return;
        if (ev.type === 'error') {
          clearTimeout(timeout);
          on.error(ev.message);
          stop();
        } else if (ev.type === 'partial') on.partial?.(ev.result);
        else if (ev.type === 'final') {
          clearTimeout(timeout);
          on.final(ev.result);
          stop();
        }
      });
      port.postMessage({ type: 'redact', id, text });
    })
    .catch((e) => {
      clearTimeout(timeout);
      if (!done) on.error(extensionAlive() ? (e as Error).message : RELOAD_MESSAGE);
      stop();
    });
  return () => {
    clearTimeout(timeout);
    stop();
  };
}

/** Same action on the same text within 10 s is logged once (kept in memory, never stored). */
let lastAudit: { text: string; action: AuditAction; at: number } | null = null;

function closeOverlay() {
  if (overlay && lastComposer) showIndicatorFor(getText(lastComposer).trim());
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
  checked = null;
  indicator.set({ kind: 'idle' });
  // Editors (ProseMirror, Quill, Lexical) update their state asynchronously.
  setTimeout(() => submit(target), 60);
}

function review(text: string, target: Editable, mode: Mode, precomputed?: RedactionResult) {
  const saved = saveSelection(target);
  indicator.set({ kind: 'hidden' }); // the card takes over while it's open
  let latest: RedactionResult | null = null;

  const audit = (action: AuditAction) => {
    if (!latest || !extensionAlive()) return;
    const now = Date.now();
    if (lastAudit && lastAudit.text === text && lastAudit.action === action && now - lastAudit.at < 10_000) return;
    lastAudit = { text, action, at: now };
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

  const onFinal = (result: RedactionResult) => {
    if (!overlay) return;
    latest = result;
    // Quiet mode: if Nano ran and found nothing sensitive, don't interrupt the user.
    if (policy.quietMode && !result.reducedProtection && !needsReview(result)) {
      passThrough();
      return;
    }
    overlay.expand();
    overlay.update(result, true);
  };

  if (precomputed) {
    // Checked in the background while the user was typing: decide instantly.
    onFinal(precomputed);
    return;
  }

  runWorker(text, {
    partial: (r) => {
      if (!overlay) return;
      latest = r;
      overlay.update(r, false);
    },
    final: onFinal,
    error: (m) => {
      // Fail safe: nothing is inserted or sent until the user decides.
      overlay?.expand();
      overlay?.error(m);
    },
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

// ---------------- Live check while typing ----------------
const indicator = new Indicator();
/** Result of the last background check, keyed by the exact text it checked. */
let checked: { text: string; result: RedactionResult } | null = null;
let checking: { text: string; stop: () => void } | null = null;
let typingTimer = 0;

function showIndicatorFor(text: string) {
  if (!policy.checkOnSend || !siteAllowed()) return indicator.set({ kind: 'hidden' });
  if (text.length < policy.minPasteChars) return indicator.set({ kind: 'idle' });
  if (checked?.text === text) {
    const r = checked.result;
    const count = r.entities.filter((x) => isSensitiveEntity(x)).length;
    return indicator.set(needsReview(r) || r.reducedProtection ? { kind: 'found', count: Math.max(count, 1) } : { kind: 'clean' });
  }
  indicator.set(checking ? { kind: 'checking' } : { kind: 'idle' });
}

/** After the user pauses typing, check the message on-device so Enter can decide instantly. */
function backgroundCheck(composer: Editable) {
  const text = getText(composer).trim();
  showIndicatorFor(text);
  if (text.length < policy.minPasteChars || checked?.text === text || checking?.text === text) return;
  checking?.stop();
  const stop = runWorker(text, {
    final: (result) => {
      checking = null;
      checked = { text, result };
      if (lastComposer) showIndicatorFor(getText(lastComposer).trim());
    },
    error: () => {
      checking = null;
      if (lastComposer) showIndicatorFor(getText(lastComposer).trim());
    },
  });
  checking = { text, stop };
  indicator.set({ kind: 'checking' });
}

function onInput(e: Event) {
  if (!e.isTrusted || !policy.checkOnSend || !siteAllowed()) return;
  const ed = editableFrom(e.target);
  if (!ed) return;
  lastComposer = ed;
  indicator.attach(ed);
  showIndicatorFor(getText(ed).trim());
  clearTimeout(typingTimer);
  typingTimer = window.setTimeout(() => backgroundCheck(ed), 1000);
}

// ---------------- Trigger 2: send (typed text) ----------------
function logClean(text: string, result: RedactionResult) {
  const now = Date.now();
  if (lastAudit && lastAudit.text === text && lastAudit.action === 'clean' && now - lastAudit.at < 10_000) return;
  lastAudit = { text, action: 'clean', at: now };
  if (!extensionAlive()) return;
  const event = buildAuditEvent(result, 'clean', host);
  safely(() => chrome.runtime.sendMessage({ type: 'audit', event }))?.catch(() => {});
}

/** Returns true if Redline took over this send. */
function interceptSend(composer: Editable | null, e: Event): boolean {
  if (!composer || overlay || !policy.checkOnSend || !siteAllowed()) return false;
  const text = getText(composer).trim();
  if (text.length < policy.minPasteChars) return false;
  if (approvedText !== null && text === approvedText.trim()) {
    approvedText = null; // approved once; the next edit is checked again
    return false;
  }
  const pre = checked?.text === text ? checked.result : undefined;
  // Already checked while typing and nothing sensitive: send immediately, no interruption.
  if (pre && policy.quietMode && !pre.reducedProtection && !needsReview(pre)) {
    logClean(text, pre);
    checked = null;
    indicator.set({ kind: 'idle' });
    return false;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  checking?.stop();
  checking = null;
  review(text, composer, 'send', pre);
  return true;
}

function onKeydown(e: KeyboardEvent) {
  if (!e.isTrusted || e.key !== 'Enter' || e.shiftKey || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
  interceptSend(editableFrom(e.target), e);
}

/** True if `btn` sits in the same chat-box container as `composer` (a few levels up). */
function sameComposer(btn: Element, composer: Element): boolean {
  let node: Element | null = composer;
  for (let i = 0; node && i < 12; i++, node = node.parentElement) if (node.contains(btn)) return true;
  return false;
}

function onClick(e: MouseEvent) {
  if (!e.isTrusted) return;
  const btn = isSendButton(e.target);
  if (!btn || !lastComposer || !lastComposer.isConnected) return;
  // Only the send button that belongs to the chat box the user was typing in.
  if (!sameComposer(btn, lastComposer)) return;
  interceptSend(lastComposer, e);
}

window.addEventListener('focusin', (e) => {
  const ed = editableFrom(e.target);
  if (!ed) return;
  lastComposer = ed;
  if (policy.checkOnSend && siteAllowed()) {
    indicator.attach(ed);
    showIndicatorFor(getText(ed).trim());
  }
});
window.addEventListener('input', onInput, true);

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
