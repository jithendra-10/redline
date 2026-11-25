import { ALL_ENTITY_TYPES, type EntityType } from './types';

export type Strictness = 'lenient' | 'balanced' | 'strict';
export type ReidCheckMode = 'cloud' | 'on_device' | 'off';

/** Org redaction policy. Delivered live via Firebase Remote Config. */
export interface Policy {
  entityTypes: EntityType[];
  strictness: Strictness;
  minPasteChars: number;
  siteAllowlist: string[];
  reidCheckMode: ReidCheckMode;
  allowOverride: boolean;
  nanoConfidenceThreshold: number;
  cloudModel: string;
  /** Keep magnitude of money amounts: [FINANCIAL_1 · $1M–10M] instead of [FINANCIAL_1]. */
  generalizeAmounts: boolean;
}

export const DEFAULT_POLICY: Policy = {
  entityTypes: ALL_ENTITY_TYPES,
  strictness: 'balanced',
  minPasteChars: 40,
  siteAllowlist: [
    'chatgpt.com', 'gemini.google.com', 'claude.ai', 'copilot.microsoft.com', 'www.perplexity.ai',
  ],
  reidCheckMode: 'cloud',
  allowOverride: true,
  nanoConfidenceThreshold: 0.5,
  cloudModel: 'gemini-3.5-flash-lite',
  generalizeAmounts: true,
};

/** Remote Config keys and their in-app defaults (strings, as RC stores them). */
export const RC_DEFAULTS: Record<string, string | number | boolean> = {
  redline_entity_types: JSON.stringify(DEFAULT_POLICY.entityTypes),
  redline_strictness: DEFAULT_POLICY.strictness,
  redline_min_paste_chars: DEFAULT_POLICY.minPasteChars,
  redline_site_allowlist: JSON.stringify(DEFAULT_POLICY.siteAllowlist),
  redline_reid_check_mode: DEFAULT_POLICY.reidCheckMode,
  redline_allow_override: DEFAULT_POLICY.allowOverride,
  redline_nano_confidence_threshold: DEFAULT_POLICY.nanoConfidenceThreshold,
  redline_cloud_model: DEFAULT_POLICY.cloudModel,
  redline_generalize_amounts: DEFAULT_POLICY.generalizeAmounts,
};

function parseList<T extends string>(raw: string, fallback: T[], allowed?: readonly string[]): T[] {
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return fallback;
    const items = v.filter((x): x is T => typeof x === 'string' && (!allowed || allowed.includes(x)));
    return items.length ? items : fallback;
  } catch {
    return fallback;
  }
}

const oneOf = <T extends string>(v: string, options: readonly T[], fallback: T): T =>
  (options as readonly string[]).includes(v) ? (v as T) : fallback;

/** Build a Policy from a string getter (Remote Config `getString`-shaped). */
export function policyFromValues(get: (key: string) => string): Policy {
  const num = (k: string, d: number) => {
    const n = Number(get(k));
    return Number.isFinite(n) && get(k) !== '' ? n : d;
  };
  return {
    entityTypes: parseList(get('redline_entity_types'), DEFAULT_POLICY.entityTypes, ALL_ENTITY_TYPES),
    strictness: oneOf(get('redline_strictness'), ['lenient', 'balanced', 'strict'], DEFAULT_POLICY.strictness),
    minPasteChars: num('redline_min_paste_chars', DEFAULT_POLICY.minPasteChars),
    siteAllowlist: parseList(get('redline_site_allowlist'), DEFAULT_POLICY.siteAllowlist),
    reidCheckMode: oneOf(get('redline_reid_check_mode'), ['cloud', 'on_device', 'off'], DEFAULT_POLICY.reidCheckMode),
    allowOverride: get('redline_allow_override') !== 'false',
    nanoConfidenceThreshold: num('redline_nano_confidence_threshold', DEFAULT_POLICY.nanoConfidenceThreshold),
    cloudModel: get('redline_cloud_model') || DEFAULT_POLICY.cloudModel,
    generalizeAmounts: get('redline_generalize_amounts') !== 'false',
  };
}
