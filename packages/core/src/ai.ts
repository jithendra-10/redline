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
// field and short keys. {"e":[{"t":"PERSON","s":"Priya Shah"}]}
const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    e: {
      type: 'array',
      items: {
        type: 'object',
        properties: { t: { type: 'string', enum: SEMANTIC_TYPES }, s: { type: 'string' } },
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

export function createModels(ai: AI, policy: Policy) {
  const extractor = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: { ...LANGS, initialPrompts: [{ role: 'system', content: [{ type: 'text', value: EXTRACT_SYSTEM }] }] },
      promptOptions: { responseConstraint: ENTITY_SCHEMA },
    },
  });

  const riskMode =
    policy.reidCheckMode === 'on_device' ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_IN_CLOUD;
  const riskChecker = getGenerativeModel(ai, {
    mode: riskMode,
    onDeviceParams: { createOptions: LANGS, promptOptions: { responseConstraint: RISK_SCHEMA } },
    inCloudParams: {
      model: policy.cloudModel,
      systemInstruction: RISK_SYSTEM,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: RISK_SCHEMA, temperature: 0.2 },
    },
  });

  return { extractor, riskChecker };
}

const EXTRACT_SYSTEM = `Extract private details from the user's text for redaction. Copy each span exactly.
t is one of: PERSON (a person's name), ORG (company, firm, hospital), CLIENT_ID (case/matter/account/patient/employee/record number),
ADDRESS (street address or specific place), MEDICAL_CONDITION, MEDICATION (drug and dose), PROJECT_CODENAME.
List each distinct span once. Skip job titles and generic words.`;

const RISK_SYSTEM = `You are a privacy reviewer. The text has ALREADY been redacted: values like [PERSON_1] are placeholders.
Judge whether a reader could still re-identify a specific person or organization from what remains
(unique roles, small-group descriptors, rare events, exact dates, locations, combinations of quasi-identifiers).
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
  await withTimeout(extractor.generateContent('Hello from Redline.'), 60_000, 'Nano warm-up');
  return Math.round(performance.now() - t0);
}

/** Must be called from a user gesture if a download is needed. */
export async function prepareDevice(model: GenerativeModel, onProgress?: (p: number) => void): Promise<void> {
  await model.initializeDeviceModel?.(onProgress);
}

const locationOf = (src: InferenceSource | undefined, fallback: StepLocation): StepLocation =>
  src === InferenceSource.ON_DEVICE ? 'on_device' : src === InferenceSource.IN_CLOUD ? 'in_cloud' : fallback;

/** A stuck Prompt API session (or network) must never freeze the UI. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
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
  const res = await withTimeout(extractor.generateContent(text), 30_000, 'On-device extraction');
  const location = locationOf(res.response.inferenceSource, 'on_device');
  if (location !== 'on_device') {
    throw new Error('Redline privacy invariant: raw-text extraction did not run on-device.');
  }
  const parsed = parseJson<{ e?: Array<{ t?: string; s?: string }> }>(res.response.text());
  const seen = new Set<string>();
  const entities: Entity[] = [];
  for (const item of parsed.e ?? []) {
    const span = item.s?.trim();
    const type = item.t as EntityType;
    if (!span || !enabled.has(type)) continue;
    // Nano must quote verbatim; drop anything it invented or repeated.
    if (!text.toLowerCase().includes(span.toLowerCase()) || seen.has(span.toLowerCase())) continue;
    seen.add(span.toLowerCase());
    entities.push({ text: span, type, confidence: 0.8, source: 'on_device' });
  }
  return { entities, location };
}

/** Re-identification risk check. Caller must pass REDACTED text only (enforced in pipeline). */
export async function checkReidRisk(riskChecker: GenerativeModel, redacted: string): Promise<RiskReport> {
  const t0 = performance.now();
  const res = await withTimeout(riskChecker.generateContent(redacted), 30_000, 'Re-identification check');
  const parsed = parseJson<Omit<RiskReport, 'location' | 'ms'>>(res.response.text());
  return {
    risk: parsed.risk ?? 'medium',
    reasons: parsed.reasons ?? [],
    suggestedRedactions: (parsed.suggestedRedactions ?? []).filter(
      (s) => s.text && !/^\[[A-Z_]+_\d+\]$/.test(s.text) && redacted.includes(s.text),
    ),
    location: locationOf(res.response.inferenceSource, 'in_cloud'),
    ms: Math.round(performance.now() - t0),
  };
}
