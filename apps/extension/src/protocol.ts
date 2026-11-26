import type { AuditEvent, Policy, RedactionResult } from '@redline/core/src/index';

/** Port name used by content scripts to talk to the offscreen redaction worker. */
export const PORT_NAME = 'redline-redact';

/** content -> background (one-shot) */
export type BackgroundRequest =
  | { type: 'ensure-worker' }
  /** offscreen -> background: offscreen documents can't use chrome.storage, so the background saves it. */
  | { type: 'policy-update'; snapshot: PolicySnapshot }
  /** content -> offscreen: content-free audit event (counts only). */
  | { type: 'audit'; event: AuditEvent };

/** content -> offscreen (over the port) */
export type WorkerRequest = { type: 'redact'; id: string; text: string };

/** offscreen -> content (over the port) */
export type WorkerEvent =
  | { type: 'partial'; id: string; result: RedactionResult }
  | { type: 'final'; id: string; result: RedactionResult }
  | { type: 'error'; id: string; message: string };

export interface PolicySnapshot {
  policy: Policy;
  device: string;
}
