import { detectPatterns } from './detectors';
import { applyRedactions, assertNoLeak, PlaceholderMap } from './placeholders';
import type { Policy } from './policy';
import type { Entity, EntityType, RedactionResult, RiskReport, StepLocation, TraceStep } from './types';

export interface PipelineDeps {
  /** On-device semantic extractor (Gemini Nano). May throw when unavailable. */
  extractLocal?: (text: string, enabled: Set<EntityType>) => Promise<{ entities: Entity[]; location: StepLocation }>;
  /** Re-identification checker. Receives redacted text only. */
  checkRisk?: (redacted: string) => Promise<RiskReport>;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Lower bar in strict mode, higher bar in lenient mode. */
const thresholdFor = (policy: Policy) =>
  policy.strictness === 'strict' ? Math.min(policy.nanoConfidenceThreshold, 0.3)
  : policy.strictness === 'lenient' ? Math.max(policy.nanoConfidenceThreshold, 0.75)
  : policy.nanoConfidenceThreshold;

export async function redact(text: string, policy: Policy, deps: PipelineDeps): Promise<RedactionResult> {
  const enabled = new Set(policy.entityTypes);
  const trace: TraceStep[] = [];

  let t = now();
  const patternEntities = detectPatterns(text, enabled);
  trace.push({ step: 'Pattern detectors', location: 'local_code', ms: Math.round(now() - t), detail: `${patternEntities.length} found` });

  let semantic: Entity[] = [];
  let reducedProtection = false;
  t = now();
  if (deps.extractLocal) {
    try {
      const r = await deps.extractLocal(text, enabled);
      const min = thresholdFor(policy);
      semantic = r.entities.filter((e) => e.confidence >= min);
      trace.push({ step: 'Gemini Nano entity extraction', location: r.location, ms: Math.round(now() - t), detail: `${semantic.length} found` });
    } catch (e) {
      reducedProtection = true;
      trace.push({ step: 'Gemini Nano entity extraction', location: 'skipped', ms: Math.round(now() - t), detail: (e as Error).message });
    }
  } else {
    reducedProtection = true;
    trace.push({ step: 'Gemini Nano entity extraction', location: 'skipped', ms: 0, detail: 'No on-device model' });
  }

  const entities = [...patternEntities, ...semantic];
  const map = new PlaceholderMap();
  const redacted = applyRedactions(text, entities, map);
  return { original: text, redacted, entities, mapping: map.mapping, trace, reducedProtection };
}

/** Cloud-allowed step. Guards the privacy invariant before anything leaves the device. */
export async function reviewRisk(result: RedactionResult, deps: PipelineDeps): Promise<RiskReport | null> {
  if (!deps.checkRisk) return null;
  assertNoLeak(result.redacted, result.mapping);
  return deps.checkRisk(result.redacted);
}

/** Apply extra redactions (e.g. accepted cloud suggestions) on top of an existing result. */
export function addRedactions(result: RedactionResult, extra: Entity[]): RedactionResult {
  const all = [...result.entities, ...extra];
  const map = new PlaceholderMap();
  const redacted = applyRedactions(result.original, all, map);
  return { ...result, entities: all, redacted, mapping: map.mapping };
}
