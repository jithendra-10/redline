import { hintFor } from './meaning';
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

  constructor(private readonly opts: { keepMeaning?: boolean } = {}) {}

  placeholderFor(entity: Entity): string {
    const key = entity.text.toLowerCase();
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const n = (this.counters.get(entity.type) ?? 0) + 1;
    this.counters.set(entity.type, n);
    // Utility-preserving redaction: keep what the AI needs, drop what identifies.
    const hint = this.opts.keepMeaning ? hintFor(entity) : null;
    const ph = hint ? `[${entity.type}_${n} · ${hint}]` : `[${entity.type}_${n}]`;
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

/** Matches any Redline placeholder, with or without a range hint: [PERSON_1], [FINANCIAL_1 · $1M–10M]. */
export const PLACEHOLDER_RE = /\[[A-Z_]+_\d+(?: · [^\]]+)?\]/g;
export const isPlaceholder = (s: string) => new RegExp(`^${PLACEHOLDER_RE.source}$`).test(s);

const escapeRegex =(s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  // Nano sometimes returns "Ms. Shah" as its own person. If every name part of a
  // PERSON is contained in a fuller PERSON's name, it's the same person.
  const persons = ordered.filter((e) => e.type === 'PERSON');
  const canonical = new Map<Entity, Entity>();
  for (const e of persons) {
    const parts = nameParts(e.text).map((p) => p.toLowerCase());
    if (!parts.length) continue;
    const fuller = persons
      .filter((o) => o !== e && nameParts(o.text).length > parts.length)
      .find((o) => {
        const op = new Set(nameParts(o.text).map((p) => p.toLowerCase()));
        return parts.every((p) => op.has(p));
      });
    if (fuller) canonical.set(e, fuller);
  }

  const replacements: Array<[string, string]> = [];
  for (const e of ordered) if (!canonical.has(e)) replacements.push([e.text, map.placeholderFor(e)]);
  for (const [e, full] of canonical) map.alias(e.text, map.placeholderFor(full));

  // A person's surname or first name alone ("Shah") maps to the same placeholder.
  for (const e of ordered) {
    if (e.type !== 'PERSON' || canonical.has(e)) continue;
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
  // Match on the stable key (PERSON_1), not the full placeholder: chatbots often drop
  // or reword the hint ("[PERSON_1]", "[PERSON_1 - client]", "[ person_1 ]").
  const byKey = new Map<string, string>();
  for (const [ph, value] of Object.entries(mapping)) {
    const key = ph.match(/^\[?([A-Z_]+_\d+)/)?.[1];
    if (key) byKey.set(key, value);
  }
  return text.replace(/\[\s*([A-Za-z_]+_\d+)\b[^\]\n]{0,60}\]/g, (whole, key: string) => byKey.get(key.toUpperCase()) ?? whole);
}

/** "[PERSON_1 · client]" -> "PERSON_1". */
export const placeholderKey = (ph: string) => ph.match(/^\[?([A-Z_]+_\d+)/)?.[1] ?? null;

/**
 * Merge one paste's mapping into a tab-level session (key -> value) so that several
 * pastes in the same chat never reuse [PERSON_1] for two different people:
 * the same value keeps its existing key; a new value with a clashing key is renumbered.
 * Returns the redacted text rewritten to the session's keys.
 */
export function mergeIntoSession(
  session: Record<string, string>,
  redacted: string,
  mapping: Record<string, string>,
): { redacted: string; session: Record<string, string> } {
  const next = { ...session };
  const byValue = new Map(Object.entries(next).map(([k, v]) => [v.toLowerCase(), k]));
  const rename = new Map<string, string>();
  for (const [ph, value] of Object.entries(mapping)) {
    const key = placeholderKey(ph);
    if (!key) continue;
    const existing = byValue.get(value.toLowerCase());
    if (existing) {
      rename.set(key, existing);
      continue;
    }
    let target = key;
    if (target in next) {
      const type = key.replace(/_\d+$/, '');
      let n = 1;
      while (`${type}_${n}` in next) n++;
      target = `${type}_${n}`;
    }
    next[target] = value;
    byValue.set(value.toLowerCase(), target);
    rename.set(key, target);
  }
  const out = redacted.replace(/\[([A-Z_]+_\d+)/g, (m, k: string) => `[${rename.get(k) ?? k}`);
  return { redacted: out, session: next };
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
