import type { EntityType, RedactionResult } from '../types';
import type { Sample } from './samples';

/** Types handled by deterministic pattern detectors (must be 100% even without Nano). */
export const PATTERN_TYPES: EntityType[] = [
  'EMAIL', 'PHONE', 'GOV_ID', 'CARD_NUMBER', 'BANK_ACCOUNT', 'FINANCIAL', 'DATE_OF_BIRTH', 'SECRET_URL', 'CLIENT_ID',
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True if `span` still appears in the redacted text (word-bounded, case-insensitive). */
export function survives(span: string, redacted: string): boolean {
  const pre = /^\w/.test(span) ? '\\b' : '';
  const post = /\w$/.test(span) ? '\\b' : '';
  return new RegExp(`${pre}${escape(span)}${post}`, 'i').test(redacted);
}

function nanoStatus(result: RedactionResult): SampleScore['nano'] {
  const step = result.trace.find((t) => t.step.includes('Nano'));
  if (!step || step.detail === 'No on-device model') return 'off';
  if (step.location === 'skipped') return 'failed';
  return step.detail?.includes('after retry') ? 'retried' : 'ok';
}

export interface SampleScore {
  id: string;
  domain: Sample['domain'];
  total: number;
  caught: number;
  missed: Array<{ text: string; type: EntityType }>;
  ms: number;
  nanoRan: boolean;
  /** ok = first try, retried = succeeded on retry, failed = both attempts failed, off = not used. */
  nano: 'ok' | 'retried' | 'failed' | 'off';
}

export function scoreSample(sample: Sample, result: RedactionResult, ms: number): SampleScore {
  const missed = sample.must.filter((m) => survives(m.text, result.redacted));
  return {
    id: sample.id,
    domain: sample.domain,
    total: sample.must.length,
    caught: sample.must.length - missed.length,
    missed,
    ms,
    nanoRan: result.trace.some((t) => t.location === 'on_device'),
    nano: nanoStatus(result),
  };
}

export interface EvalSummary {
  recall: number;
  leakedSamples: number;
  byType: Record<string, { caught: number; total: number }>;
  byDomain: Record<string, { caught: number; total: number }>;
  medianMs: number;
  p90Ms: number;
  nanoRetried: number;
  nanoFailed: number;
}

export function summarize(scores: SampleScore[], samples: Sample[]): EvalSummary {
  const byType: EvalSummary['byType'] = {};
  const byDomain: EvalSummary['byDomain'] = {};
  for (const s of scores) {
    const sample = samples.find((x) => x.id === s.id)!;
    for (const m of sample.must) {
      const t = (byType[m.type] ??= { caught: 0, total: 0 });
      t.total++;
      if (!s.missed.some((x) => x.text === m.text)) t.caught++;
    }
    const d = (byDomain[s.domain] ??= { caught: 0, total: 0 });
    d.total += s.total;
    d.caught += s.caught;
  }
  const total = scores.reduce((a, s) => a + s.total, 0);
  const caught = scores.reduce((a, s) => a + s.caught, 0);
  const times = scores.map((s) => s.ms).sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))] ?? 0;
  return {
    recall: total ? caught / total : 0,
    leakedSamples: scores.filter((s) => s.missed.length > 0).length,
    byType,
    byDomain,
    medianMs: pct(0.5),
    p90Ms: pct(0.9),
    nanoRetried: scores.filter((s) => s.nano === 'retried').length,
    nanoFailed: scores.filter((s) => s.nano === 'failed').length,
  };
}
