import type { Entity } from './types';

/**
 * Consistent, reversible placeholders: "Acme Corp" -> "[ORG_1]" everywhere.
 * The mapping stays on the device so the AI's reply can be re-hydrated locally.
 */
export class PlaceholderMap {
  private byValue = new Map<string, string>();
  private counters = new Map<string, number>();
  readonly mapping: Record<string, string> = {};
  /** Lowercased value -> placeholder, for aliases such as a surname on its own. */
  readonly aliasTo = new Map<string, string>();

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

  has(value: string): boolean {
    return this.byValue.has(value.toLowerCase());
  }

  alias(value: string, placeholder: string): void {
    const key = value.toLowerCase();
    if (!this.byValue.has(key) && !this.aliasTo.has(key)) this.aliasTo.set(key, placeholder);
  }

  get aliases(): string[] {
    return [...this.aliasTo.keys()];
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'madam', 'mx']);

/** "Dr. Anita Rao" -> ["Anita", "Rao"]: name parts that identify the person on their own. */
export function nameParts(fullName: string): string[] {
  return fullName
    .split(/\s+/)
    .map((p) => p.replace(/[.,]/g, ''))
    .filter((p) => p.length >= 3 && /^[A-Z]/.test(p) && !HONORIFICS.has(p.toLowerCase()));
}

/** Replace every occurrence of each entity, longest first so substrings don't win. */
export function applyRedactions(text: string, entities: Entity[], map: PlaceholderMap): string {
  const unique = new Map<string, Entity>();
  for (const e of entities) {
    const k = e.text.toLowerCase();
    if (e.text.trim().length < 2) continue;
    if (!unique.has(k)) unique.set(k, e);
  }

  // Assign placeholders in reading order so numbering is stable ([PERSON_1] is the first person).
  const ordered = [...unique.values()].sort(
    (a, b) => text.toLowerCase().indexOf(a.text.toLowerCase()) - text.toLowerCase().indexOf(b.text.toLowerCase()),
  );
  const replacements: Array<[string, string]> = [];
  for (const e of ordered) replacements.push([e.text, map.placeholderFor(e)]);

  // A person's surname or first name alone ("Ms. Shah") maps to the same placeholder.
  for (const e of ordered) {
    if (e.type !== 'PERSON') continue;
    const ph = map.placeholderFor(e);
    for (const part of nameParts(e.text)) {
      if (map.has(part)) continue;
      map.alias(part, ph);
    }
  }
  for (const [alias, ph] of map.aliasTo) replacements.push([alias, ph]);

  replacements.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [value, ph] of replacements) {
    // Word boundaries only when the value starts/ends with a word char.
    const pre = /^\w/.test(value) ? '\\b' : '';
    const post = /\w$/.test(value) ? '\\b' : '';
    out = out.replace(new RegExp(`${pre}${escapeRegex(value)}${post}`, 'gi'), ph);
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
export function assertNoLeak(payload: string, mapping: Record<string, string>, aliases: string[] = []): void {
  for (const value of [...Object.values(mapping), ...aliases]) {
    if (value.length < 2) continue;
    const pre = /^\w/.test(value) ? '\\b' : '';
    const post = /\w$/.test(value) ? '\\b' : '';
    if (new RegExp(`${pre}${escapeRegex(value)}${post}`, 'i').test(payload)) {
      throw new Error('Redline privacy invariant: refusing to send original sensitive text to the cloud.');
    }
  }
}
