import type { Entity, EntityType } from './types';

/**
 * Deterministic, instant, fully local detectors. These run before Gemini Nano
 * and are the protection floor when no on-device model is available.
 */
interface PatternDetector {
  type: EntityType;
  regex: RegExp;
  validate?: (match: string) => boolean;
}

export function luhnValid(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const DETECTORS: PatternDetector[] = [
  { type: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // URLs that carry tokens/keys/signatures in the query string.
  {
    type: 'SECRET_URL',
    regex: /\bhttps?:\/\/[^\s]+[?&](?:token|key|sig|signature|auth|access_token|code)=[^\s&]+[^\s]*/gi,
  },
  { type: 'CARD_NUMBER', regex: /\b(?:\d[ -]?){12,18}\d\b/g, validate: luhnValid },
  { type: 'BANK_ACCOUNT', regex: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g },
  // A number with a +country code is a phone, whatever its grouping. Runs before the
  // ID patterns, so "+123 234 2345" isn't read as a 3-3-4 NHS number.
  {
    type: 'PHONE',
    regex: /\+\d{1,3}[ .-]?\(?\d{1,5}\)?(?:[ .-]?\d{2,5}){1,4}\b/g,
    validate: (m) => {
      const n = m.replace(/\D/g, '').length;
      return n >= 9 && n <= 15;
    },
  },
  // US SSN, UK NHS number (3-3-4), Indian Aadhaar (4-4-4).
  { type: 'GOV_ID', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'GOV_ID', regex: /\b\d{3} \d{3} \d{4}\b/g },
  { type: 'GOV_ID', regex: /\b\d{4} \d{4} \d{4}\b/g },
  // Case / matter / patient / employee / policy numbers: LGL-2291, PT-77120, ARB/22/417, CV-2024-00813.
  {
    type: 'CLIENT_ID',
    regex: /\b[A-Z]{1,5}[-/]\d{2,}(?:[-/][A-Z0-9]+)*\b/g,
    // Not identifiers: COVID-19, ISO-9001, RFC-7231, SARS-2… (standards, diseases, models).
    validate: (m) =>
      m.replace(/\D/g, '').length >= 4 && !/^(ISO|IEC|RFC|COVID|SARS|MERS|EN|DIN|IEEE|ANSI|GPT|MIL|NIST|SOC|PCI|USB|HDMI)\b/.test(m),
  },
  // Bare numbers right after an ID keyword: "MRN 448812", "(ID 55102)", "account 4417-2290-1183".
  {
    type: 'CLIENT_ID',
    regex: /(?<=\b(?:MRN|ID|ref|reference|policy|account|acct|matter|case(?: no\.?)?|employee(?: no\.?)?|patient(?: no\.?)?)[\s:#.]*)\d[\d-]{3,}\d\b/gi,
  },
  // After IDs, so "account 4417-2290-1183" isn't mistaken for a phone number.
  {
    type: 'PHONE',
    // US 512-555-0148, UK 020 7946 0958, India 98450 12345, with optional +country code.
    regex: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\b\d{2,5}[ .-]\d{3,5}(?:[ .-]\d{2,5})?\b/g,
    validate: (m) => {
      const n = m.replace(/\D/g, '').length;
      return n >= 9 && n <= 15;
    },
  },
  // Money: $4.2M, €12,500, ₹12 lakh, USD 148,000, Rs. 5,00,000. Deterministic so it never flickers.
  {
    type: 'FINANCIAL',
    regex: /(?:[$€£₹]\s?|\b(?:USD|EUR|GBP|INR|Rs\.?)\s?)\d+(?:,\d+)*(?:\.\d+)?(?:\s?(?:million|billion|lakhs?|crores?|[KMB]|k|bn|mn)\b)?/g,
  },
  // Shorthand amounts without a currency symbol: "10k", "1.5M", "5 lakh", "2 crore".
  // Deterministic, so Nano's guesses ("10k" as a person or condition) can't override them.
  {
    type: 'FINANCIAL',
    // Not money: "4K TV", "5k run", "10k steps", "2M views".
    regex:
      /\b\d+(?:\.\d+)?\s?(?:k|K|M|mn|bn|million|billion|lakhs?|crores?)\b(?!\s?(?:tv|run|race|steps|resolution|monitor|display|video|views|subscribers|followers|words|users|downloads|km|miles)\b)/gi,
  },
  {
    type: 'DATE_OF_BIRTH',
    regex: /\b(?:DOB|D\.O\.B\.|date of birth|born(?: on)?)[:\s]*\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/gi,
  },
  // A capitalised name right after an honorific is almost always a person:
  // "Mr. Reyes", "Dr. Anita Rao", "Hon. Margaret Okonkwo". The honorific itself stays.
  {
    type: 'PERSON',
    regex: /(?<=\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Hon|Sir|Dame|Judge|Justice)\.?\s+)[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){0,2}\b/g,
  },
];

export function detectPatterns(text: string, enabled: Set<EntityType>): Entity[] {
  const found: Entity[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);

  for (const det of DETECTORS) {
    if (!enabled.has(det.type)) continue;
    for (const m of text.matchAll(det.regex)) {
      const value = m[0].trim();
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (!value || overlaps(start, end)) continue;
      if (det.validate && !det.validate(value)) continue;
      taken.push([start, end]);
      found.push({ text: value, type: det.type, confidence: 1, source: 'pattern' });
    }
  }
  return found;
}
