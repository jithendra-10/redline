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
  // US SSN, UK NHS number (3-3-4), Indian Aadhaar (4-4-4).
  { type: 'GOV_ID', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'GOV_ID', regex: /\b\d{3} \d{3} \d{4}\b/g },
  { type: 'GOV_ID', regex: /\b\d{4} \d{4} \d{4}\b/g },
  {
    type: 'PHONE',
    regex: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{3,4}[ .-]\d{3,4}(?:[ .-]\d{2,4})?\b/g,
    validate: (m) => m.replace(/\D/g, '').length >= 9,
  },
  // Money: $4.2M, €12,500, ₹12 lakh, USD 148,000, Rs. 5,00,000. Deterministic so it never flickers.
  {
    type: 'FINANCIAL',
    regex: /(?:[$€£₹]\s?|\b(?:USD|EUR|GBP|INR|Rs\.?)\s?)\d+(?:,\d+)*(?:\.\d+)?(?:\s?(?:million|billion|lakhs?|crores?|[KMB]|k|bn|mn)\b)?/g,
  },
  {
    type: 'DATE_OF_BIRTH',
    regex: /\b(?:DOB|D\.O\.B\.|date of birth|born(?: on)?)[:\s]*\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/gi,
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
