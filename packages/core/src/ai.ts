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

const ENTITY_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: SEMANTIC_TYPES },
          confidence: { type: 'number' },
        },
        required: ['text', 'type', 'confidence'],
      },
    },
  },
  required: ['entities'],
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

const EXTRACT_SYSTEM = `You are a privacy redaction engine. Find sensitive spans in the user's text.
Return ONLY spans copied verbatim from the text. Types:
PERSON (names of people), ORG (companies, firms, hospitals, schools), CLIENT_ID (case, matter, account, patient or employee numbers),
ADDRESS (street addresses, specific locations), MEDICAL_CONDITION (diagnoses, symptoms), MEDICATION (drug names, dosages),
FINANCIAL (salaries, deal values, account balances), PROJECT_CODENAME (internal project or product code names).
Do not include generic words, job titles alone, or public figures mentioned in passing. Confidence is 0..1.`;

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
  const parsed = parseJson<{ entities?: Array<{ text?: string; type?: string; confidence?: number }> }>(
    res.response.text(),
  );
  const entities: Entity[] = (parsed.entities ?? [])
    .filter((e): e is { text: string; type: EntityType; confidence?: number } =>
      typeof e.text === 'string' && typeof e.type === 'string' && enabled.has(e.type as EntityType))
    // Nano must quote verbatim; drop anything it invented.
    .filter((e) => text.toLowerCase().includes(e.text.toLowerCase()))
    .map((e) => ({ text: e.text, type: e.type, confidence: e.confidence ?? 0.5, source: 'on_device' as const }));
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
