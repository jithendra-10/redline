import { detectPatterns } from './detectors';
import { applyRedactions, assertNoLeak, PlaceholderMap } from './placeholders';
import type { Policy } from './policy';
import type { Entity, EntityType, RedactionResult, RiskReport, StepLocation, TraceStep } from './types';

export interface PipelineDeps {
  /** On-device semantic extractor (Gemini Nano). May throw when unavailable. */
  extractLocal?: (text: string, enabled: Set<EntityType>) => Promise<{ entities: Entity[]; location: StepLocation }>;
  /** Re-identification checker. Receives redacted text only. */
  checkRisk?: (redacted: string) => Promise<RiskReport>;
  /** Called with the instant pattern-only result while Nano is still working. */
  onPatterns?: (partial: RedactionResult) => void;
}

function build(text: string, entities: Entity[], keepMeaning: boolean) {
  const map = new PlaceholderMap({ keepMeaning });
  const redacted = applyRedactions(text, entities, map);
  return { redacted, mapping: map.mapping, aliases: map.aliases };
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY = '(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?';
const PLAIN_DATE = new RegExp(
  `^(?:${WEEKDAY},?\\s*)?(?:${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s*\\d{4})?|${MONTH}(?:\\s+\\d{4})?|${WEEKDAY}|\\d{4})$`,
  'i',
);

/**
 * A bare date, month or weekday ("November 30", "Friday", "Jan 15, 2026") doesn't
 * identify anyone, and hiding it costs the AI meaning. Nano sometimes tags these,
 * so they're never redacted by the semantic pass (dates of birth have their own pattern).
 */
export const isPlainDate = (s: string) => PLAIN_DATE.test(s.trim());

/** Every [start, end) occurrence of `needle` in `text`, case-insensitive. */
function ranges(text: string, needle: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const hay = text.toLowerCase();
  const n = needle.toLowerCase();
  if (!n) return out;
  for (let i = hay.indexOf(n); i !== -1; i = hay.indexOf(n, i + 1)) out.push([i, i + n.length]);
  return out;
}

/**
 * Pattern detectors are deterministic and correctly typed (money, phone, email, IDs),
 * so they win wherever they matched. A Nano span overlapping a pattern match is dropped:
 * e.g. Nano's "2,400/month" as CLIENT_ID would otherwise swallow "$2,400" and leave "$[CLIENT_ID_1]".
 */
export function withoutPatternOverlap(semantic: Entity[], patterns: Entity[], text: string): Entity[] {
  // Name-after-honorific is a partial, weak pattern: it never overrides Nano.
  const strong = patterns.filter((p) => p.type !== 'PERSON');
  return semantic.filter((e) => {
    if (strong.some((p) => p.text.toLowerCase() === e.text.toLowerCase())) return false;
    const eRanges = ranges(text, e.text);
    const overlapping = strong.filter((p) =>
      ranges(text, p.text).some(([a, b]) => eRanges.some(([s, en]) => s < b && en > a)),
    );
    if (!overlapping.length) return true;
    // Safety: dropping a Nano span must never expose the part the pattern didn't cover.
    // Drop only if what's left is generic (no capitals, no digits), e.g. "/month".
    let rest = e.text;
    for (const p of overlapping) {
      rest = rest.replace(new RegExp(p.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
      // Also strip the pattern's digits-only core (Nano often omits the currency symbol).
      const core = p.text.replace(/^[^\d]+/, '');
      if (core) rest = rest.split(core).join(' ');
    }
    return /[A-Z0-9]/.test(rest);
  });
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
  deps.onPatterns?.({ original: text, ...build(text, patternEntities, policy.keepMeaning), entities: patternEntities, trace: [...trace], reducedProtection: !deps.extractLocal });

  let semantic: Entity[] = [];
  let reducedProtection = false;
  t = now();
  if (deps.extractLocal) {
    // One retry: in the eval, most misses were whole Nano calls that hung or returned
    // broken output, not wrong answers. A second attempt usually succeeds.
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await deps.extractLocal(text, enabled);
        const min = thresholdFor(policy);
        semantic = withoutPatternOverlap(
          r.entities.filter((e) => e.confidence >= min && !isPlainDate(e.text)),
          patternEntities,
          text,
        );
        trace.push({
          step: 'Gemini Nano entity extraction',
          location: r.location,
          ms: Math.round(now() - t),
          detail: `${semantic.length} found${attempt > 1 ? ' · after retry' : ''}`,
        });
        lastError = null;
        break;
      } catch (e) {
        lastError = e as Error;
      }
    }
    if (lastError) {
      reducedProtection = true;
      trace.push({ step: 'Gemini Nano entity extraction', location: 'skipped', ms: Math.round(now() - t), detail: `failed twice: ${lastError.message}` });
    }
  } else {
    reducedProtection = true;
    trace.push({ step: 'Gemini Nano entity extraction', location: 'skipped', ms: 0, detail: 'No on-device model' });
  }

  const entities = [...patternEntities, ...semantic];
  return { original: text, ...build(text, entities, policy.keepMeaning), entities, trace, reducedProtection };
}

/** Cloud-allowed step. Guards the privacy invariant before anything leaves the device. */
export async function reviewRisk(result: RedactionResult, deps: PipelineDeps): Promise<RiskReport | null> {
  if (!deps.checkRisk) return null;
  assertNoLeak(result.redacted, result.mapping, result.aliases);
  return deps.checkRisk(result.redacted);
}

/** Apply extra redactions (e.g. accepted cloud suggestions) on top of an existing result. */
export function addRedactions(result: RedactionResult, extra: Entity[], policy: Policy): RedactionResult {
  const all = [...result.entities, ...extra];
  return { ...result, entities: all, ...build(result.original, all, policy.keepMeaning) };
}
