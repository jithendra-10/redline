/**
 * Redline worker: a hidden offscreen document that owns Firebase + Gemini Nano.
 *
 * Content scripts on AI chat sites only capture the paste and show the overlay.
 * The raw text travels over an extension-internal port to this page, is redacted
 * on-device here, and only the result goes back. Nothing in this flow touches the network.
 */
import {
  createModels,
  DEFAULT_POLICY,
  extractEntitiesOnDevice,
  getDeviceStatus,
  initRedline,
  logAuditEvent,
  redact,
  warmUpDevice,
  watchPolicy,
  type Policy,
} from '@redline/core';
import { configFromEnv } from '@redline/ui/src/env';
import { PORT_NAME, type BackgroundRequest, type PolicySnapshot, type WorkerEvent, type WorkerRequest } from './protocol';

const config = configFromEnv(import.meta.env, 'extension');
const fb = config ? initRedline(config) : null;

let policy: Policy = DEFAULT_POLICY;
let models = fb ? createModels(fb.ai, policy) : null;
let device = 'unsupported';

async function refreshDevice() {
  device = await getDeviceStatus();
  return device;
}

/** Offscreen documents only get chrome.runtime; the background persists the snapshot. */
function publishPolicy() {
  const snapshot: PolicySnapshot = { policy, device };
  chrome.runtime.sendMessage({ type: 'policy-update', snapshot }).catch(() => {});
}

async function boot() {
  await refreshDevice();
  if (fb) {
    await watchPolicy(fb.remoteConfig, (p) => {
      policy = p;
      models = createModels(fb.ai, p);
      publishPolicy();
    });
  }
  publishPolicy();
  if (models && device === 'available') {
    warmUpDevice(models.extractor)
      .then((ms) => console.info(`[redline] Nano warm-up ${ms} ms`))
      .catch((e) => console.warn('[redline] Nano warm-up failed', e));
  }
}
// Never let a startup problem (e.g. Remote Config offline) block redaction: fall back to defaults.
const ready = boot().catch((e) => console.warn('[redline] worker boot problem, using defaults', e));

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  port.onMessage.addListener(async (msg: WorkerRequest) => {
    if (msg.type !== 'redact') return;
    const send = (e: WorkerEvent) => {
      try {
        port.postMessage(e);
      } catch {
        /* tab closed */
      }
    };
    try {
      await ready;
      if (device !== 'available') await refreshDevice();
      const m = models;
      const result = await redact(msg.text, policy, {
        onPatterns: (partial) => send({ type: 'partial', id: msg.id, result: partial }),
        extractLocal:
          m && device === 'available' ? (t, enabled) => extractEntitiesOnDevice(m.extractor, t, enabled) : undefined,
      });
      send({ type: 'final', id: msg.id, result });
    } catch (e) {
      send({ type: 'error', id: msg.id, message: (e as Error).message });
    }
  });
});

// Audit events arrive already stripped to counts; write them to Firestore.
chrome.runtime.onMessage.addListener((msg: BackgroundRequest) => {
  if (msg.type !== 'audit' || !fb) return false;
  logAuditEvent(fb, msg.event).catch((e) => console.warn('[redline] audit log failed', e));
  return false;
});
