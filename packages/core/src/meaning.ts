import type { Entity } from './types';

/**
 * Utility-preserving redaction ("keep the meaning, drop the identity").
 *
 * Each placeholder may carry a short hint so the AI can still reason:
 *   $4.2M                  -> [FINANCIAL_1 · $1M–10M]
 *   St. Mary's Hospital    -> [ORG_1 · hospital]
 *   leukemia               -> [MEDICAL_CONDITION_1 · blood cancer]   (hint from Gemini Nano)
 *
 * Hints are deterministic where possible, and every hint passes `safeHint`
 * so it can never echo the value it replaces.
 */

const MULTIPLIERS: Array<[RegExp, number]> = [
  [/\b(?:billion|bn)\b|\dB\b/i, 1e9],
  [/\bcrores?\b/i, 1e7],
  [/\b(?:million|mn)\b|\dM\b/, 1e6],
  [/\blakhs?\b/i, 1e5],
  [/\dk\b|\dK\b/, 1e3],
];

const fmt = (sym: string, v: number) =>
  v >= 1e9 ? `${sym}${v / 1e9}B` : v >= 1e6 ? `${sym}${v / 1e6}M` : v >= 1e3 ? `${sym}${v / 1e3}K` : `${sym}${v}`;

/** "$4.2M" -> "$1M–10M"; "₹12 lakh" -> "₹1M–10M"; "€900" -> "€100–1K". */
export function moneyRange(amount: string): string | null {
  const num = amount.match(/\d+(?:,\d+)*(?:\.\d+)?/);
  if (!num) return null;
  let value = Number(num[0].replace(/,/g, ''));
  for (const [re, mult] of MULTIPLIERS) if (re.test(amount)) { value *= mult; break; }
  if (!Number.isFinite(value) || value <= 0) return null;
  const sym = amount.match(/[$€£₹]/)?.[0] ?? amount.match(/USD|EUR|GBP|INR|Rs/)?.[0]?.concat(' ') ?? '';
  const lo = 10 ** Math.floor(Math.log10(value));
  return `${fmt(sym, lo)}–${fmt('', lo * 10)}`;
}

/** "DOB 03/14/1961" -> "born 1960s". Picks the 4-digit year, else a 2-digit year at either end. */
export function birthDecade(dob: string): string | null {
  const y4 = dob.match(/\b(19|20)\d{2}\b/);
  let year = y4 ? Number(y4[0]) : NaN;
  if (!y4) {
    // The year is the last 2-digit group: 3/14/61 -> 61.
    const y2 = [...dob.matchAll(/[/.-](\d{2})\b/g)].pop();
    if (y2) {
      const n = Number(y2[1]);
      year = n > 30 ? 1900 + n : 2000 + n;
    }
  }
  return Number.isFinite(year) ? `born ${Math.floor(year / 10) * 10}s` : null;
}

const ORG_KINDS: Array<[RegExp, string]> = [
  [/\b(hospital|clinic|medical cent(er|re)|health|healthcare|infirmary)\b/i, 'hospital'],
  [/\b(university|college|school|academy|institute)\b/i, 'school'],
  [/\b(bank|capital|financial|credit union|securities|fund)\b/i, 'financial firm'],
  [/\b(llp|law|legal|attorneys?|solicitors?|advocates)\b/i, 'law firm'],
  [/\b(pharma|pharmaceuticals?|biotech|labs?)\b/i, 'pharma company'],
  [/\b(ministry|department|agency|council|government|municipal)\b/i, 'government body'],
  [/\b(foundation|charity|trust|ngo)\b/i, 'non-profit'],
  [/\b(inc|corp|corporation|ltd|limited|llc|plc|gmbh|co|company|group|technologies|systems|io)\b\.?/i, 'company'],
];

const PERSONAL_MAIL = /@(gmail|yahoo|hotmail|outlook|live|icloud|proton|protonmail|aol|rediffmail|ymail)\./i;

const PHONE_COUNTRY: Array<[string, string]> = [
  ['+1', 'US/Canada number'], ['+44', 'UK number'], ['+91', 'Indian number'], ['+61', 'Australian number'],
  ['+49', 'German number'], ['+33', 'French number'], ['+65', 'Singapore number'], ['+971', 'UAE number'],
];

function cardBrand(card: string): string {
  const d = card.replace(/\D/g, '');
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^(60|65|81|82)/.test(d)) return 'RuPay/Discover';
  return 'payment card';
}

/** Deterministic hint for an entity, or null when the type has no safe generalization. */
export function deterministicHint(e: Entity): string | null {
  switch (e.type) {
    case 'FINANCIAL': return moneyRange(e.text);
    case 'DATE_OF_BIRTH': return birthDecade(e.text);
    case 'EMAIL': return PERSONAL_MAIL.test(e.text) ? 'personal email' : 'work email';
    case 'PHONE': {
      const t = e.text.replace(/\s/g, '');
      const hit = [...PHONE_COUNTRY].sort((a, b) => b[0].length - a[0].length).find(([c]) => t.startsWith(c));
      return hit ? hit[1] : 'phone number';
    }
    case 'CARD_NUMBER': return cardBrand(e.text);
    case 'ORG': return ORG_KINDS.find(([re]) => re.test(e.text))?.[1] ?? null;
    case 'BANK_ACCOUNT': return 'bank account';
    case 'GOV_ID': return 'government ID';
    case 'SECRET_URL': return 'link with access token';
    default: return null;
  }
}

const words = (s: string) => s.toLowerCase().match(/[a-z]{3,}/g) ?? [];

/**
 * A hint is unsafe if it repeats any word of the value it replaces
 * ("St. Mary's Hospital" -> "Mary's hospital" is rejected, "hospital" passes
 * only because it was produced for a value where we strip it below).
 */
export function safeHint(hint: string | null | undefined, original: string): string | null {
  if (!hint) return null;
  const clean = hint.replace(/[[\]·|]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 40) return null;
  const orig = new Set(words(original));
  // Generic category words are allowed even if the org name contains them ("Hospital").
  const generic = new Set(['hospital', 'clinic', 'school', 'university', 'college', 'bank', 'company', 'firm', 'law', 'group']);
  if (words(clean).some((w) => orig.has(w) && !generic.has(w))) return null;
  return clean;
}

/** Final hint for a placeholder: Nano's hint if safe, else the deterministic one. */
export function hintFor(e: Entity): string | null {
  if (e.type === 'FINANCIAL' || e.type === 'DATE_OF_BIRTH' || e.type === 'CARD_NUMBER') {
    return deterministicHint(e); // contain digits/symbols by design; computed, not echoed
  }
  return safeHint(e.hint, e.text) ?? safeHint(deterministicHint(e), e.text);
}
