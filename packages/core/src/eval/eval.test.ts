import { describe, expect, it } from 'vitest';
import { redact } from '../pipeline';
import { DEFAULT_POLICY } from '../policy';
import { SAMPLES } from './samples';
import { PATTERN_TYPES, scoreSample, survives } from './score';

describe('30-sample eval set', () => {
  it('has 30 samples, 10 per domain, and every label appears verbatim in its text', () => {
    expect(SAMPLES).toHaveLength(30);
    for (const d of ['legal', 'medical', 'hr']) expect(SAMPLES.filter((s) => s.domain === d)).toHaveLength(10);
    for (const s of SAMPLES) for (const m of s.must) expect(survives(m.text, s.text), `${s.id}: ${m.text}`).toBe(true);
  });

  it('pattern detectors alone catch 100% of pattern-type spans (no Nano)', async () => {
    const misses: string[] = [];
    for (const s of SAMPLES) {
      const r = await redact(s.text, DEFAULT_POLICY, {});
      const score = scoreSample(s, r, 0);
      for (const m of score.missed) if (PATTERN_TYPES.includes(m.type)) misses.push(`${s.id}: ${m.type} "${m.text}"`);
    }
    expect(misses).toEqual([]);
  });
});
