import type { BackgroundRequest, LocalStats } from './protocol';

// Clicking the toolbar icon opens the Redline side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

const OFFSCREEN_URL = 'offscreen.html';
let creating: Promise<void> | null = null;

/** Keeps exactly one offscreen worker alive; it hosts Firebase + Gemini Nano. */
async function ensureWorker(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs on-device Gemini Nano redaction so pasted text never leaves the device.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
  if (msg.type === 'policy-update') {
    chrome.storage.local.set({ redlinePolicy: msg.snapshot }).catch(console.error);
    return false;
  }
  if (msg.type === 'audit') {
    // Local per-device counters for the side panel (counts only, like the audit log).
    chrome.storage.local.get('redlineStats').then((v) => {
      const s: LocalStats = { redacted: 0, clean: 0, original: 0, cancelled: 0, items: 0, ...(v.redlineStats as LocalStats | undefined) };
      s[msg.event.action] += 1;
      if (msg.event.action === 'redacted') s.items += msg.event.total;
      return chrome.storage.local.set({ redlineStats: s });
    }).catch(console.error);
    return false;
  }
  if (msg.type === 'ensure-worker') {
    ensureWorker()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async response
  }
  return false;
});

// Start the worker early so Nano is warm before the first paste.
chrome.runtime.onStartup.addListener(() => void ensureWorker());
chrome.runtime.onInstalled.addListener(() => void ensureWorker());
