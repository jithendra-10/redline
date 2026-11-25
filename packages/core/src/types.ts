export type EntityType =
  | 'PERSON'
  | 'ORG'
  | 'CLIENT_ID'
  | 'EMAIL'
  | 'PHONE'
  | 'ADDRESS'
  | 'DATE_OF_BIRTH'
  | 'GOV_ID'
  | 'CARD_NUMBER'
  | 'BANK_ACCOUNT'
  | 'MEDICAL_CONDITION'
  | 'MEDICATION'
  | 'FINANCIAL'
  | 'PROJECT_CODENAME'
  | 'SECRET_URL';

export const ALL_ENTITY_TYPES: EntityType[] = [
  'PERSON', 'ORG', 'CLIENT_ID', 'EMAIL', 'PHONE', 'ADDRESS', 'DATE_OF_BIRTH', 'GOV_ID',
  'CARD_NUMBER', 'BANK_ACCOUNT', 'MEDICAL_CONDITION', 'MEDICATION', 'FINANCIAL',
  'PROJECT_CODENAME', 'SECRET_URL',
];

/**
 * Types the semantic (Nano) pass is asked to find; the rest are deterministic.
 * Kept short on purpose: every output token costs on-device latency.
 */
export const SEMANTIC_TYPES: EntityType[] = [
  'PERSON', 'ORG', 'CLIENT_ID', 'ADDRESS', 'MEDICAL_CONDITION', 'MEDICATION', 'PROJECT_CODENAME',
];

export type DetectorSource = 'pattern' | 'on_device' | 'cloud_suggestion' | 'user';

export interface Entity {
  text: string;
  type: EntityType;
  confidence: number;
  source: DetectorSource;
}

/** Where a pipeline step actually ran. */
export type StepLocation = 'local_code' | 'on_device' | 'in_cloud' | 'skipped';

export interface TraceStep {
  step: string;
  location: StepLocation;
  ms: number;
  detail?: string;
}

export interface RedactionResult {
  original: string;
  redacted: string;
  entities: Entity[];
  /** placeholder -> original value. Never leaves the device. */
  mapping: Record<string, string>;
  /** Extra sensitive strings replaced via aliases (e.g. surname "Shah" of "Priya Shah"). */
  aliases: string[];
  trace: TraceStep[];
  /** True when the on-device model was unavailable and only patterns ran. */
  reducedProtection: boolean;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskReport {
  risk: RiskLevel;
  reasons: string[];
  suggestedRedactions: { text: string; type: EntityType }[];
  location: StepLocation;
  ms: number;
}
