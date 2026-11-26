import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type AI,
  type GenerativeModel,
} from 'firebase/ai';
import type { Policy } from './policy';
import { ALL_ENTITY_TYPES, SEMANTIC_TYPES, type Entity, type EntityType, type RiskReport, type StepLocation } from './types';

/**
 * Hybrid inference via Firebase AI Logic.
 *
 * Privacy invariant: the entity extractor sees RAW text, so it is pinned to
 * ONLY_ON_DEVICE (Gemini Nano). It can never fall back to the cloud.
 * The re-identification checker only ever sees REDACTED text, so it may use
 * the cloud model (or Nano, if policy says "on_device").
 */

const LANGS = { expectedInputs: [{ type: 'text' as const, languages: ['en'] }], expectedOutputs: [{ type: 'text' as const, languages: ['en'] }] };

// Compact on purpose: output tokens dominate on-device latency, so no confidence
// field and short keys. {"e":[{"t":"MEDICAL_CONDITION","s":"CLL","g":"blood cancer"}]}
// g = optional meaning-preserving category, validated by safeHint before use.
const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    e: {
      type: 'array',
      items: {
        type: 'object',
        properties: { t: { type: 'string', enum: SEMANTIC_TYPES }, s: { type: 'string' }, g: { type: 'string' } },
        required: ['t', 's'],
      },
    },
  },
  required: ['e'],
};

const RISK_SCHEMA = {
  type: 'object',
  properties: {
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    reasons: { type: 'array', items: { type: 'string' } },
    suggestedRedactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, type: { type: 'string', enum: ALL_ENTITY_TYPES } },
        required: ['text', 'type'],
      },
    },
  },
  required: ['risk', 'reasons', 'suggestedRedactions'],
};

/**
 * The SDK keeps our promptOptions object by reference and passes it to Chrome's
 * session.prompt(). Chrome accepts an AbortSignal there, so we attach a fresh
 * signal per call: a timed-out Nano call is truly cancelled and frees the model,
 * instead of running on and blocking every call queued behind it.
 */
export interface AbortablePromptOptions {
  responseConstraint?: object;
  signal?: AbortSignal;
}
const PROMPT_OPTIONS = new WeakMap<GenerativeModel, AbortablePromptOptions>();

/** On-device calls run one at a time (warm-up included) so they never fight for the GPU. */
const QUEUES = new WeakMap<GenerativeModel, Promise<unknown>>();

/** Exported for tests. */
export function attachPromptOptions(model: GenerativeModel, opts: AbortablePromptOptions): void {
  PROMPT_OPTIONS.set(model, opts);
}

export async function runOnDevice<T>(
  model: GenerativeModel,
  ms: number,
  what: string,
  call: () => Promise<T>,
): Promise<T> {
  const previous = QUEUES.get(model) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    const ctrl = new AbortController();
    const opts = PROMPT_OPTIONS.get(model);
    if (opts) opts.signal = ctrl.signal;
    try {
      return await withTimeout(call(), ms, what, () => ctrl.abort());
    } finally {
      if (opts && opts.signal === ctrl.signal) delete opts.signal;
    }
  });
  QUEUES.set(model, run);
  return run;
}

/** Greedy decoding: same input -> same output. Only Chrome extensions may set these. */
export interface Sampling {
  topK: number;
  temperature: number;
}

interface LanguageModelWithParams {
  params?: () => Promise<{ defaultTemperature: number; maxTopK: number } | null>;
  create: (o: object) => Promise<{ destroy: () => void }>;
}

/**
 * Probes whether this context lets us pin Nano to deterministic output.
 * Returns the options to use, or undefined (web pages, older Chrome) to keep defaults.
 */
export async function probeDeterministicSampling(): Promise<Sampling | undefined> {
  const lm = (globalThis as { LanguageModel?: LanguageModelWithParams }).LanguageModel;
  if (!lm?.params) return undefined;
  for (const candidate of [{ topK: 1, temperature: 0 }, { topK: 1, temperature: 0.1 }]) {
    try {
      const s = await lm.create({ ...LANGS, ...candidate });
      s.destroy();
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

export function createModels(ai: AI, policy: Policy, sampling?: Sampling) {
  const extractorPromptOptions: AbortablePromptOptions = { responseConstraint: ENTITY_SCHEMA };
  const extractor = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        ...LANGS,
        ...sampling,
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: EXTRACT_SYSTEM }] }],
      },
      promptOptions: extractorPromptOptions,
    },
  });
  PROMPT_OPTIONS.set(extractor, extractorPromptOptions);

  const riskMode =
    policy.reidCheckMode === 'on_device' ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_IN_CLOUD;
  // Cloud first (stronger reasoning). If the cloud call fails (network, quota, API off),
  // the SDK falls back to Gemini Nano, so the reviewer prompt must exist on both sides.
  // Either way it only ever sees REDACTED text (enforced by reviewRisk / assertNoLeak).
  const riskPromptOptions: AbortablePromptOptions = { responseConstraint: RISK_SCHEMA };
  const riskChecker = getGenerativeModel(ai, {
    mode: riskMode,
    onDeviceParams: {
      createOptions: { ...LANGS, initialPrompts: [{ role: 'system', content: [{ type: 'text', value: RISK_SYSTEM }] }] },
      promptOptions: riskPromptOptions,
    },
    inCloudParams: {
      model: policy.cloudModel,
      systemInstruction: RISK_SYSTEM,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RISK_SCHEMA, temperature: 0.2 },
    },
  });

  PROMPT_OPTIONS.set(riskChecker, riskPromptOptions);

  return { extractor, riskChecker };
}

const EXTRACT_SYSTEM = `Extract private details from the user's text for redaction. Copy each span exactly.
t is one of: PERSON (a person's name), ORG (company, firm, hospital), CLIENT_ID (case/matter/account/patient/employee/record number),
ADDRESS (street address or specific place), MEDICAL_CONDITION, MEDICATION (drug and dose), PROJECT_CODENAME.
List each distinct span once. Skip job titles and generic words.
For MEDICAL_CONDITION, MEDICATION, ORG and ADDRESS also give g: a generic 1-3 word category that keeps the meaning
but never repeats the span (e.g. leukemia -> "blood cancer", ibrutinib 420mg -> "cancer drug", Acme Corp -> "company",
12 Baker Street -> "street address", Austin -> "city", Bandra, Mumbai -> "neighbourhood"). Omit g for other types.`;

const RISK_SYSTEM = `You are a privacy reviewer. The text has ALREADY been redacted: values like [PERSON_1] are placeholders.
Judge whether a reader could still re-identify a specific person or organization from what remains
(unique roles, small-group descriptors, rare events, exact dates, locations, combinations of quasi-identifiers).
Placeholders may carry a magnitude hint like [FINANCIAL_1 · $1M–10M]; that hint is intentional.
Return risk (low/medium/high), short reasons, and suggestedRedactions: verbatim spans from the text that should also be redacted.
Never suggest placeholders themselves.`;

export type DeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

interface LanguageModelStatic {
  availability(options?: object): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
}

/** Reads Chrome's Prompt API availability directly, for the status UI. */
export async function getDeviceStatus(): Promise<DeviceStatus> {
  const lm = (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  if (!lm) return 'unsupported';
  try {
    return await lm.availability(LANGS);
  } catch {
    return 'unavailable';
  }
}

/**
 * Warm-up: loads Nano into memory before the first real paste. The SDK keeps the
 * last session alive, so the model stays resident afterwards. Removes ~10 s from
 * the first redaction. Safe to call without a user gesture once downloaded.
 */
export async function warmUpDevice(extractor: GenerativeModel): Promise<number> {
  const t0 = performance.now();
  await runOnDevice(extractor, 60_000, 'Nano warm-up', () => extractor.generateContent('Hello from Redline.'));
  return Math.round(performance.now() - t0);
}

/** Must be called from a user gesture if a download is needed. */
export async function prepareDevice(model: GenerativeModel, onProgress?: (p: number) => void): Promise<void> {
  await model.initializeDeviceModel?.(onProgress);
}

const locationOf = (src: InferenceSource | undefined, fallback: StepLocation): StepLocation =>
  src === InferenceSource.ON_DEVICE ? 'on_device' : src === InferenceSource.IN_CLOUD ? 'in_cloud' : fallback;

/** A stuck Prompt API session (or network) must never freeze the UI. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${what} timed out after ${ms / 1000}s`));
    }, ms);
    p.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

/**
 * Nano's JSON is sometimes cut off or malformed. Instead of discarding the whole
 * answer, keep every complete {"t":..,"s":..} object that parses on its own.
 */
export function salvageEntityJson(raw: string): Array<{ t?: string; s?: string; g?: string }> {
  try {
    const parsed = parseJson<{ e?: Array<{ t?: string; s?: string; g?: string }> }>(raw);
    if (Array.isArray(parsed.e)) return parsed.e;
  } catch {
    /* fall through to salvage */
  }
  const out: Array<{ t?: string; s?: string; g?: string }> = [];
  for (const m of raw.matchAll(/\{[^{}]*\}/g)) {
    try {
      const obj = JSON.parse(m[0]);
      if (obj && typeof obj.s === 'string' && typeof obj.t === 'string') out.push(obj);
    } catch {
      /* skip broken object */
    }
  }
  if (!out.length) throw new Error('Nano returned no usable JSON');
  return out;
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  return JSON.parse(cleaned) as T;
}

/** On-device semantic pass. Throws if Nano is unavailable (ONLY_ON_DEVICE never falls back). */
export async function extractEntitiesOnDevice(
  extractor: GenerativeModel,
  text: string,
  enabled: Set<EntityType>,
): Promise<{ entities: Entity[]; location: StepLocation }> {
  const res = await runOnDevice(extractor, 20_000, 'On-device extraction', () => extractor.generateContent(text));
  const location = locationOf(res.response.inferenceSource, 'on_device');
  if (location !== 'on_device') {
    throw new Error('Redline privacy invariant: raw-text extraction did not run on-device.');
  }
  const items = salvageEntityJson(res.response.text());
  const seen = new Set<string>();
  const entities: Entity[] = [];
  for (const item of items) {
    const span = item.s?.trim();
    const type = item.t as EntityType;
    if (!span || !enabled.has(type)) continue;
    // Nano must quote verbatim; drop anything it invented or repeated.
    if (!text.toLowerCase().includes(span.toLowerCase()) || seen.has(span.toLowerCase())) continue;
    seen.add(span.toLowerCase());
    entities.push({ text: span, type, confidence: 0.8, source: 'on_device', ...(item.g ? { hint: item.g } : {}) });
  }
  return { entities, location };
}

/**
 * Models sometimes "suggest" redacting the placeholders themselves ("PERSON_1",
 * "Call [ORG_1] at [PHONE_1]"). Keep only short spans of real, still-visible text
 * that appear verbatim and don't overlap any placeholder.
 */
export function cleanSuggestions(
  suggestions: RiskReport['suggestedRedactions'],
  redacted: string,
): RiskReport['suggestedRedactions'] {
  const seen = new Set<string>();
  return suggestions.filter((sg) => {
    const t = sg.text?.trim();
    if (!t || t.length < 2 || t.length > 60) return false;
    if (/[[\]]|\b[A-Z_]+_\d+\b/.test(t)) return false; // contains a placeholder or its key (PERSON_1)
    if (!/[A-Za-z0-9]/.test(t) || !redacted.includes(t)) return false;
    if (seen.has(t.toLowerCase())) return false;
    seen.add(t.toLowerCase());
    return true;
  }).map((sg) => ({ ...sg, text: sg.text.trim() }));
}

/** Re-identification risk check. Caller must pass REDACTED text only (enforced in pipeline). */
export async function checkReidRisk(riskChecker: GenerativeModel, redacted: string): Promise<RiskReport> {
  const t0 = performance.now();
  const res = await runOnDevice(riskChecker, 30_000, 'Re-identification check', () => riskChecker.generateContent(redacted));
  const parsed = parseJson<Omit<RiskReport, 'location' | 'ms'>>(res.response.text());
  return {
    risk: parsed.risk ?? 'medium',
    reasons: parsed.reasons ?? [],
    suggestedRedactions: cleanSuggestions(parsed.suggestedRedactions ?? [], redacted),
    location: locationOf(res.response.inferenceSource, 'in_cloud'),
    ms: Math.round(performance.now() - t0),
  };
}
