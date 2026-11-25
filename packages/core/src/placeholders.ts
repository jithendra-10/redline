import type { Entity } from './types';

/**
 * Consistent, reversible placeholders: "Acme Corp" -> "[ORG_1]" everywhere.
 * The mapping stays on the device so the AI's reply can be re-hydrated locally.
 */
export class PlaceholderMap {
  private byValue = new Map<string, string>();
  private counters = new Map<string, number>();
  readonly mapping: Record<string, string> = {};

  placeholderFor(entity: Entity): string {
    const key = entity.text.toLowerCase();
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const n = (this.counters.get(entity.type) ?? 0) + 1;
    this.counters.set(entity.type, n);
    const ph = `[${entity.type}_${n}]`;
    this.byValue.set(key, ph);
    this.mapping[ph] = entity.text;
    return ph;
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replace every occurrence of each entity, longest first so substrings don't win. */
export function applyRedactions(text: string, entities: Entity[], map: PlaceholderMap): string {
  const unique = new Map<string, Entity>();
  for (const e of entities) {
    const k = e.text.toLowerCase();
    if (e.text.trim().length < 2) continue;
    if (!unique.has(k)) unique.set(k, e);
  }
  const sorted = [...unique.values()].sort((a, b) => b.text.length - a.text.length);
  let out = text;
  for (const e of sorted) {
    const ph = map.placeholderFor(e);
    // Word boundaries only when the entity starts/ends with a word char.
    const pre = /^\w/.test(e.text) ? '\\b' : '';
    const post = /\w$/.test(e.text) ? '\\b' : '';
    out = out.replace(new RegExp(`${pre}${escapeRegex(e.text)}${post}`, 'gi'), ph);
  }
  return out;
}

/** Swap placeholders back to real values. Runs locally only. */
export function rehydrate(text: string, mapping: Record<string, string>): string {
  return text.replace(/\[[A-Z_]+_\d+\]/g, (ph) => mapping[ph] ?? ph);
}

/**
 * Privacy invariant: throws if any original sensitive value is present in a
 * payload about to leave the device. Every cloud call goes through this.
 */
export function assertNoLeak(payload: string, mapping: Record<string, string>): void {
  const lower = payload.toLowerCase();
  for (const value of Object.values(mapping)) {
    if (value.length >= 2 && lower.includes(value.toLowerCase())) {
      throw new Error('Redline privacy invariant: refusing to send original sensitive text to the cloud.');
    }
  }
}
