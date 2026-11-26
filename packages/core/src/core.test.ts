import { describe, expect, it, vi } from 'vitest';
import { detectPatterns, luhnValid } from './detectors';
import { assertNoLeak, mergeIntoSession, rehydrate } from './placeholders';
import { birthDecade, moneyRange, safeHint } from './meaning';
import { buildAuditEvent } from './audit';
import { attachPromptOptions, cleanSuggestions, runOnDevice, salvageEntityJson, type AbortablePromptOptions } from './ai';
import type { GenerativeModel } from 'firebase/ai';
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

  it('merges "Ms. Shah" into [PERSON_1] even when Nano returns it as its own person', async () => {
    const text = 'Our client Priya Shah declined. Ms. Shah asked for a call.';
    const r = await redact(text, DEFAULT_POLICY, {
      extractLocal: nano([
        { text: 'Priya Shah', type: 'PERSON', confidence: 0.9 },
        { text: 'Ms. Shah', type: 'PERSON', confidence: 0.9 },
      ]),
    });
    expect(r.redacted).toBe('Our client [PERSON_1] declined. [PERSON_1] asked for a call.');
    expect(Object.keys(r.mapping).filter((k) => k.startsWith('[PERSON'))).toEqual(['[PERSON_1]']);
  });

  it('does not alias inside other words (Shah vs shahlegal.com)', async () => {
    const r = await redact('Priya Shah, priya@shahlegal.com', DEFAULT_POLICY, {
      extractLocal: nano([{ text: 'Priya Shah', type: 'PERSON', confidence: 0.9 }]),
    });
    expect(r.redacted).toBe('[PERSON_1], [EMAIL_1 · work email]');
  });

  it('emits an instant pattern-only result before Nano finishes', async () => {
    const partials: string[] = [];
    await redact('Mail bob@example.org about Bob Lee', DEFAULT_POLICY, {
      onPatterns: (p) => partials.push(p.redacted),
      extractLocal: nano([{ text: 'Bob Lee', type: 'PERSON', confidence: 0.9 }]),
    });
    expect(partials).toEqual(['Mail [EMAIL_1 · work email] about Bob Lee']);
  });

  it('falls back to patterns with reduced protection when Nano is unavailable', async () => {
    const r = await redact('Contact bob@example.org now please', DEFAULT_POLICY, {
      extractLocal: async () => { throw new Error('LanguageModel unavailable'); },
    });
    expect(r.reducedProtection).toBe(true);
    expect(r.redacted).toContain('[EMAIL_1 · work email]');
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

describe('utility-preserving money redaction', () => {
  it('maps amounts to an order-of-magnitude range', () => {
    expect(moneyRange('$4.2M')).toBe('$1M–10M');
    expect(moneyRange('$148,000')).toBe('$100K–1M');
    expect(moneyRange('₹12 lakh')).toBe('₹1M–10M');
    expect(moneyRange('€900')).toBe('€100–1K');
    expect(moneyRange('USD 5,000')).toBe('USD 1K–10K');
  });

  it('keeps magnitude in the placeholder and still re-hydrates exactly', async () => {
    const text = 'They offered $4.2M to settle.';
    const r = await redact(text, DEFAULT_POLICY, {});
    expect(r.redacted).toBe('They offered [FINANCIAL_1 · $1M–10M] to settle.');
    expect(rehydrate(r.redacted, r.mapping)).toBe(text);
  });

  it('hides magnitude when policy turns generalization off', async () => {
    const r = await redact('They offered $4.2M.', { ...DEFAULT_POLICY, keepMeaning: false }, {});
    expect(r.redacted).toBe('They offered [FINANCIAL_1].');
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

describe('keep meaning across all types', () => {
  const nanoE = (entities: Array<{ text: string; type: Entity['type']; hint?: string }>) =>
    async () => ({ entities: entities.map((e) => ({ ...e, confidence: 0.9, source: 'on_device' as const })), location: 'on_device' as const });

  it('adds safe hints per type', async () => {
    const text =
      'Patient John Miller, DOB 03/14/1961, at St. Mary\'s Hospital has chronic lymphocytic leukemia, on ibrutinib 420mg. ' +
      'Email john.miller@gmail.com, office j.miller@acme.io, phone +1 415-555-0132, card 4111 1111 1111 1111.';
    const r = await redact(text, DEFAULT_POLICY, {
      extractLocal: nanoE([
        { text: 'John Miller', type: 'PERSON' },
        { text: "St. Mary's Hospital", type: 'ORG', hint: 'hospital' },
        { text: 'chronic lymphocytic leukemia', type: 'MEDICAL_CONDITION', hint: 'blood cancer' },
        { text: 'ibrutinib 420mg', type: 'MEDICATION', hint: 'cancer drug' },
      ]),
    });
    for (const ph of [
      '[PERSON_1]', '[DATE_OF_BIRTH_1 · born 1960s]', '[ORG_1 · hospital]', '[MEDICAL_CONDITION_1 · blood cancer]',
      '[MEDICATION_1 · cancer drug]', '[EMAIL_1 · personal email]', '[EMAIL_2 · work email]',
      '[PHONE_1 · US/Canada number]', '[CARD_NUMBER_1 · Visa]',
    ]) expect(r.redacted).toContain(ph);
    expect(rehydrate(r.redacted, r.mapping)).toBe(text);
  });

  it('rejects a hint that echoes the original value', () => {
    expect(safeHint("Mary's hospital", "St. Mary's Hospital")).toBeNull();
    expect(safeHint('leukemia', 'chronic lymphocytic leukemia')).toBeNull();
    expect(safeHint('hospital', "St. Mary's Hospital")).toBe('hospital');
    expect(safeHint('blood cancer', 'chronic lymphocytic leukemia')).toBe('blood cancer');
  });

  it('falls back to a deterministic org kind when Nano gives none', async () => {
    const r = await redact('Talk to Northwind Legal LLP and Acme Corp.', DEFAULT_POLICY, {
      extractLocal: nanoE([
        { text: 'Northwind Legal LLP', type: 'ORG' },
        { text: 'Acme Corp', type: 'ORG' },
      ]),
    });
    expect(r.redacted).toBe('Talk to [ORG_1 · law firm] and [ORG_2 · company].');
  });

  it('birth decade handles 2-digit years', () => {
    expect(birthDecade('DOB 3/14/61')).toBe('born 1960s');
    expect(birthDecade('born on 2001-05-02')).toBe('born 2000s');
  });

  it('strips all hints when keepMeaning is off', async () => {
    const r = await redact('Mail a@gmail.com about $5,000', { ...DEFAULT_POLICY, keepMeaning: false }, {});
    expect(r.redacted).toBe('Mail [EMAIL_1] about [FINANCIAL_1]');
  });
});

describe('client ID patterns', () => {
  it('catches case/patient/account numbers but not standards or diseases', () => {
    const t = 'Matter LGL-2291, MRN 448812, account 4417-2290-1183, ARB/22/417. COVID-19 test, ISO-9001, HER2-positive, Q3 2024.';
    const ids = detectPatterns(t, all).filter((e) => e.type === 'CLIENT_ID').map((e) => e.text);
    expect(ids).toEqual(['LGL-2291', 'ARB/22/417', '448812', '4417-2290-1183']);
  });
});

describe('re-hydration is robust to chatbot rewording', () => {
  it('restores values when the AI drops or rewords the hint', () => {
    const mapping = { '[PERSON_1 · client]': 'Priya Shah', '[FINANCIAL_1 · $1M–10M]': '$4.2M' };
    expect(rehydrate('Dear [PERSON_1], the [FINANCIAL_1 - $1M-10M] offer… regards to [ person_1 · client ].', mapping))
      .toBe('Dear Priya Shah, the $4.2M offer… regards to Priya Shah.');
    expect(rehydrate('Unknown [PERSON_9] and [not a placeholder]', mapping)).toBe('Unknown [PERSON_9] and [not a placeholder]');
  });
});

describe('eval-driven robustness', () => {
  it('catches names after honorifics without Nano', () => {
    const t = 'Mr. Reyes will not sign. Dr. Anita Rao referred Mrs. Grace Holloway to Hon. Margaret Okonkwo on 12 May.';
    const people = detectPatterns(t, all).filter((e) => e.type === 'PERSON').map((e) => e.text);
    expect(people).toEqual(['Reyes', 'Anita Rao', 'Grace Holloway', 'Margaret Okonkwo']);
  });

  it('salvages complete entities from cut-off Nano JSON', () => {
    const raw = '{"e":[{"t":"PERSON","s":"John Miller"},{"t":"ORG","s":"St. Mary\'s Hospital","g":"hospital"},{"t":"MEDICATION","s":"ibru';
    expect(salvageEntityJson(raw).map((x) => x.s)).toEqual(['John Miller', "St. Mary's Hospital"]);
    expect(() => salvageEntityJson('garbage')).toThrow();
  });

  it('retries Nano once after a failure', async () => {
    let calls = 0;
    const r = await redact('Talk to Bob Lee today please', DEFAULT_POLICY, {
      extractLocal: async () => {
        calls++;
        if (calls === 1) throw new Error('timed out');
        return { entities: [{ text: 'Bob Lee', type: 'PERSON', confidence: 0.9, source: 'on_device' }], location: 'on_device' };
      },
    });
    expect(calls).toBe(2);
    expect(r.redacted).toBe('Talk to [PERSON_1] today please');
    expect(r.reducedProtection).toBe(false);
    expect(r.trace.find((s) => s.step.includes('Nano'))?.detail).toContain('after retry');
  });

  it('merges a pattern-found surname with Nano\'s full name', async () => {
    const r = await redact('Our client Priya Shah declined. Ms. Shah called.', DEFAULT_POLICY, {
      extractLocal: async () => ({ entities: [{ text: 'Priya Shah', type: 'PERSON', confidence: 0.9, source: 'on_device' }], location: 'on_device' }),
    });
    expect(r.redacted).toBe('Our client [PERSON_1] declined. Ms. [PERSON_1] called.');
  });
});

describe('on-device call control', () => {
  it('aborts a timed-out call and runs calls one at a time', async () => {
    const opts: AbortablePromptOptions = {};
    const model = {} as GenerativeModel;
    attachPromptOptions(model, opts);
    const order: string[] = [];
    let aborted = false;

    const hung = runOnDevice(model, 50, 'Hung call', () => {
      const signal = opts.signal!;
      order.push('hung:start');
      return new Promise<string>((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }));
    });
    const next = runOnDevice(model, 1000, 'Next call', async () => {
      order.push('next:start');
      return 'ok';
    });

    await expect(hung).rejects.toThrow(/timed out/);
    await expect(next).resolves.toBe('ok');
    expect(aborted).toBe(true);
    expect(order).toEqual(['hung:start', 'next:start']);
    expect(opts.signal).toBeUndefined();
  });
});

describe('multi-paste session', () => {
  it('keeps one key per person across pastes and renumbers clashes', () => {
    let session: Record<string, string> = {};
    const a = mergeIntoSession(session, 'Ask [PERSON_1 · client] about [ORG_1 · company]', {
      '[PERSON_1 · client]': 'Priya Shah', '[ORG_1 · company]': 'Acme Corp',
    });
    session = a.session;
    expect(a.redacted).toBe('Ask [PERSON_1 · client] about [ORG_1 · company]');

    // Second paste: a different person is also PERSON_1, and Priya is PERSON_2.
    const b = mergeIntoSession(session, '[PERSON_1] met [PERSON_2] at [ORG_1 · company]', {
      '[PERSON_1]': 'Tom Becker', '[PERSON_2]': 'Priya Shah', '[ORG_1 · company]': 'Acme Corp',
    });
    expect(b.redacted).toBe('[PERSON_2] met [PERSON_1] at [ORG_1 · company]');
    expect(b.session).toEqual({ PERSON_1: 'Priya Shah', ORG_1: 'Acme Corp', PERSON_2: 'Tom Becker' });
    expect(rehydrate('[PERSON_2] emailed [PERSON_1 · client]', b.session)).toBe('Tom Becker emailed Priya Shah');
  });
});

describe('audit event', () => {
  it('contains counts and categories only, never content', async () => {
    const r = await redact('Our client Priya Shah of Acme Corp owes $4.2M; mail priya@acme.io', DEFAULT_POLICY, {
      extractLocal: async () => ({
        entities: [
          { text: 'Priya Shah', type: 'PERSON', confidence: 0.9, source: 'on_device' },
          { text: 'Acme Corp', type: 'ORG', confidence: 0.9, source: 'on_device' },
        ],
        location: 'on_device',
      }),
    });
    const ev = buildAuditEvent(r, 'redacted', 'Gemini.Google.com');
    expect(ev).toMatchObject({ site: 'gemini.google.com', action: 'redacted', total: 4, nanoUsed: true, reduced: false });
    expect(ev.counts).toEqual({ PERSON: 1, ORG: 1, FINANCIAL: 1, EMAIL: 1 });
    const json = JSON.stringify(ev);
    for (const secret of ['Priya', 'Shah', 'Acme', '4.2', 'priya@']) expect(json).not.toContain(secret);
  });
});

describe('risk suggestions', () => {
  it('drops placeholders and fragments containing them; keeps real visible text', () => {
    const redacted = 'Rewrite for [PERSON_1] at [ADDRESS_1]: the only female partner in our Austin office. Call [ORG_1] at [PHONE_1 · phone number].';
    const out = cleanSuggestions(
      [
        { text: 'PERSON_1', type: 'PERSON' },
        { text: 'Call [ORG_1] at [PHONE_1 · phone number]', type: 'ORG' },
        { text: '$[CLIENT_ID_1]', type: 'CLIENT_ID' },
        { text: 'Austin', type: 'ADDRESS' },
        { text: ' Austin ', type: 'ADDRESS' },
        { text: 'Boston', type: 'ADDRESS' },
        { text: 'the only female partner', type: 'PERSON' },
      ],
      redacted,
    );
    expect(out.map((x) => x.text)).toEqual(['Austin', 'the only female partner']);
  });
});
