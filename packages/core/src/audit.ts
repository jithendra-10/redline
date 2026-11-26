import { placeholderKey } from './placeholders';
import type { EntityType, RedactionResult } from './types';

/** clean = nothing sensitive found, passed through untouched (quiet mode). */
export type AuditAction = 'redacted' | 'original' | 'cancelled' | 'clean';

/**
 * A privacy-safe audit event: counts and categories only, never content.
 * Firestore rules (firestore.rules) enforce exactly this shape server-side.
 */
export interface AuditEvent {
  site: string;
  action: AuditAction;
  counts: Partial<Record<EntityType, number>>;
  total: number;
  nanoMs: number;
  nanoUsed: boolean;
  reduced: boolean;
  chars: number;
}

/** Builds the event from a redaction result. Distinct values are counted per type. */
export function buildAuditEvent(result: RedactionResult, action: AuditAction, hostname: string): AuditEvent {
  const counts: Partial<Record<EntityType, number>> = {};
  for (const ph of Object.keys(result.mapping)) {
    const key = placeholderKey(ph);
    if (!key) continue;
    const type = key.replace(/_\d+$/, '') as EntityType;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  const nano = result.trace.find((s) => s.step.includes('Nano'));
  return {
    site: hostname.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 64),
    action,
    counts,
    total: Object.keys(result.mapping).length,
    nanoMs: Math.min(120_000, Math.max(0, Math.round(nano?.ms ?? 0))),
    nanoUsed: nano?.location === 'on_device',
    reduced: result.reducedProtection,
    chars: Math.min(200_000, result.original.length),
  };
}
