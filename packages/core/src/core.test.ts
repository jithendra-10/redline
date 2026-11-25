import { describe, expect, it, vi } from 'vitest';
import { detectPatterns, luhnValid } from './detectors';
import { assertNoLeak, rehydrate } from './placeholders';
import { DEFAULT_POLICY, policyFromValues } from './policy';
import { redact, reviewRisk } from './pipeline';
import { ALL_ENTITY_TYPES, type Entity } from './types';

const all = new Set(ALL_ENTITY_TYPES);

describe('pattern detectors', () => {
  it('finds email, phone, SSN and a Luhn-valid card', () => {
    const t = 'Mail jane.doe@acme.com or call +1 415-555-0132. SSN 123-45-6789, card 4111 1111 1111 1111.';
    const types = detectPatterns(t, all).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['EMAIL', 'PHONE', 'GOV_ID', 'CARD_NUMBER']));
  });
  it('rejects non-Luhn digit runs as cards', () => {
    expect(luhnValid('4111 1111 1111 1112')).toBe(false);
    expect(detectPatterns('order 1234 5678 9012 3456', new Set(['CARD_NUMBER'])).length).toBe(0);
  });
  it('finds money amounts deterministically', () => {
    const t = 'Settlement of $4.2M, salary $148,000, fee ₹12 lakh, bonus USD 5,000 and €900.';
    const found = detectPatterns(t, all).filter((e) => e.type === 'FINANCIAL').map((e) => e.text);
    expect(found).toEqual(['$4.2M', '$148,000', '₹12 lakh', 'USD 5,000', '€900']);
  });
  it('respects disabled types', () => {
    expect(detectPatterns('jane@acme.com', new Set(['PHONE']))).toEqual([]);
  });
});

describe('pipeline', () => {
  const nano = (entities: Omit<Entity, 'source'>[]) =>
    vi.fn(async () => ({ entities: entities.map((e) => ({ ...e, source: 'on_device' as const })), location: 'on_device' as const }));

  it('redacts consistently and re-hydrates locally', async () => {
    const text = 'Priya Shah from Acme Corp emailed priya@acme.com. Priya Shah wants the Acme Corp deal at $4.2M.';
    const r = await redact(text, DEFAULT_POLICY, {
      extractLocal: nano([
        { text: 'Priya Shah', type: 'PERSON', confidence: 0.9 },
        { text: 'Acme Corp', type: 'ORG', confidence: 0.9 },
        { text: '$4.2M', type: 'FINANCIAL', confidence: 0.8 },
      ]),
    });
    expect(r.redacted).not.toMatch(/Priya Shah|Acme Corp|priya@acme\.com|\$4\.2M/);
    expect(r.redacted.match(/\[PERSON_1\]/g)?.length).toBe(2);
    expect(r.reducedProtection).toBe(false);
    expect(rehydrate(r.redacted, r.mapping)).toBe(text);
  });

  it('redacts a surname used alone ("Ms. Shah") under the same placeholder', async () => {
    const text = 'Our client Priya Shah declined. Ms. Shah asked that calls go to Dr. Rao, not Anita Rao.';
    const r = await redact(text, DEFAULT_POLICY, {
      extractLocal: nano([
        { text: 'Priya Shah', type: 'PERSON', confidence: 0.9 },
        { text: 'Anita Rao', type: 'PERSON', confidence: 0.9 },
      ]),
    });
    expect(r.redacted).toBe('Our client [PERSON_1] declined. Ms. [PERSON_1] asked that calls go to Dr. [PERSON_2], not [PERSON_2].');
    expect(() => assertNoLeak(r.redacted, r.mapping, r.aliases)).not.toThrow();
    expect(() => assertNoLeak('Ms. Shah', r.mapping, r.aliases)).toThrow();
  });

  it('does not alias inside other words (Shah vs shahlegal.com)', async () => {
    const r = await redact('Priya Shah, priya@shahlegal.com', DEFAULT_POLICY, {
      extractLocal: nano([{ text: 'Priya Shah', type: 'PERSON', confidence: 0.9 }]),
    });
    expect(r.redacted).toBe('[PERSON_1], [EMAIL_1]');
  });

  it('emits an instant pattern-only result before Nano finishes', async () => {
    const partials: string[] = [];
    await redact('Mail bob@example.org about Bob Lee', DEFAULT_POLICY, {
      onPatterns: (p) => partials.push(p.redacted),
      extractLocal: nano([{ text: 'Bob Lee', type: 'PERSON', confidence: 0.9 }]),
    });
    expect(partials).toEqual(['Mail [EMAIL_1] about Bob Lee']);
  });

  it('falls back to patterns with reduced protection when Nano is unavailable', async () => {
    const r = await redact('Contact bob@example.org now please', DEFAULT_POLICY, {
      extractLocal: async () => { throw new Error('LanguageModel unavailable'); },
    });
    expect(r.reducedProtection).toBe(true);
    expect(r.redacted).toContain('[EMAIL_1]');
    expect(r.trace.find((s) => s.step.includes('Nano'))?.location).toBe('skipped');
  });

  it('drops low-confidence entities in lenient mode', async () => {
    const r = await redact('Talked to Sam today', { ...DEFAULT_POLICY, strictness: 'lenient' }, {
      extractLocal: nano([{ text: 'Sam', type: 'PERSON', confidence: 0.6 }]),
    });
    expect(r.redacted).toBe('Talked to Sam today');
  });

  it('never sends original values to the cloud risk check', async () => {
    const checkRisk = vi.fn(async (_redacted: string) => ({ risk: 'low' as const, reasons: [], suggestedRedactions: [], location: 'in_cloud' as const, ms: 1 }));
    const r = await redact('Dr. Anita Rao treats patient John Miller for leukemia.', DEFAULT_POLICY, {
      extractLocal: nano([
        { text: 'Anita Rao', type: 'PERSON', confidence: 0.9 },
        { text: 'John Miller', type: 'PERSON', confidence: 0.9 },
        { text: 'leukemia', type: 'MEDICAL_CONDITION', confidence: 0.9 },
      ]),
    });
    await reviewRisk(r, { checkRisk });
    const sent = checkRisk.mock.calls[0]?.[0] ?? '';
    expect(sent).toContain('[PERSON_1]');
    for (const v of Object.values(r.mapping)) expect(sent).not.toContain(v);
  });

  it('assertNoLeak blocks a payload containing an original value', () => {
    expect(() => assertNoLeak('hello John Miller', { '[PERSON_1]': 'John Miller' })).toThrow(/privacy invariant/);
  });
});

describe('policy from Remote Config', () => {
  it('parses values and falls back on garbage', () => {
    const vals: Record<string, string> = {
      redline_entity_types: '["PERSON","NOT_A_TYPE"]',
      redline_strictness: 'strict',
      redline_min_paste_chars: 'abc',
      redline_reid_check_mode: 'on_device',
      redline_allow_override: 'false',
    };
    const p = policyFromValues((k) => vals[k] ?? '');
    expect(p.entityTypes).toEqual(['PERSON']);
    expect(p.strictness).toBe('strict');
    expect(p.minPasteChars).toBe(DEFAULT_POLICY.minPasteChars);
    expect(p.reidCheckMode).toBe('on_device');
    expect(p.allowOverride).toBe(false);
    expect(p.cloudModel).toBe(DEFAULT_POLICY.cloudModel);
  });
});
