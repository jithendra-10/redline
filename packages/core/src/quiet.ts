import type { Entity, EntityType, RedactionResult } from './types';

/**
 * Quiet mode: everyday questions shouldn't trigger a privacy card.
 * The card is shown only when a paste/message contains something that identifies
 * a person or exposes a confidential record. Money amounts, organisation names and
 * a city on their own go through untouched.
 */
const ALWAYS_SENSITIVE: EntityType[] = [
  'PERSON', 'CLIENT_ID', 'EMAIL', 'PHONE', 'GOV_ID', 'CARD_NUMBER', 'BANK_ACCOUNT',
  'DATE_OF_BIRTH', 'MEDICAL_CONDITION', 'MEDICATION', 'SECRET_URL', 'PROJECT_CODENAME',
];

export function isSensitiveEntity(e: Pick<Entity, 'type' | 'text'>): boolean {
  if (ALWAYS_SENSITIVE.includes(e.type)) return true;
  // A street-level address (has a house/unit number) identifies where someone lives;
  // a city or neighbourhood alone does not.
  if (e.type === 'ADDRESS') return /\d/.test(e.text);
  return false; // FINANCIAL, ORG
}

/** True when the user should see the Redline card for this result. */
export function needsReview(result: RedactionResult): boolean {
  return result.entities.some(isSensitiveEntity);
}
