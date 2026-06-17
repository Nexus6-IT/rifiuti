import { SubscriptionTier } from '@prisma/client';

/**
 * Feature catalog — catalogo delle feature attivabili per-tenant.
 *
 * Le feature sono "moduli funzionali" che il piano di abbonamento
 * (`subscriptionTier`) abilita di default e che il SUPER_ADMIN può
 * sovrascrivere puntualmente per singolo tenant tramite `Tenant.featureFlags`.
 *
 * Risoluzione effettiva: vedi `effectiveFeatures()`.
 *   - se `featureFlags` è valorizzato (array) → è un override esplicito;
 *   - se è null/assente → si derivano dal piano (`PLAN_FEATURES[tier]`).
 */

/** Chiavi feature riconosciute dalla piattaforma. */
export const FEATURE_KEYS = [
  'fir',
  'cer',
  'anagrafiche',
  'mud',
  'giacenze',
  'contratti',
  'esg',
  'anomalie',
  'rentri',
  'reference_data',
] as const;

/** Tipo della singola chiave feature. */
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Etichette in italiano per ciascuna feature (per UI / admin). */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  fir: 'Formulari (FIR)',
  cer: 'Codici CER',
  anagrafiche: 'Anagrafiche (produttori/trasportatori/destinatari)',
  mud: 'Dichiarazione MUD',
  giacenze: 'Giacenze',
  contratti: 'Contratti',
  esg: 'Reportistica ESG',
  anomalie: 'Rilevamento anomalie',
  rentri: 'Interoperabilità RENTRI',
  reference_data: 'Dati di riferimento (ISTAT/ATECO)',
};

/**
 * Feature abilitate di default da ciascun piano.
 *   - TRIAL:        funzionalità di base (formulari, CER, anagrafiche).
 *   - PROFESSIONAL: TRIAL + moduli operativi avanzati.
 *   - ENTERPRISE:   tutte le feature del catalogo.
 */
const TRIAL_FEATURES: FeatureKey[] = ['fir', 'cer', 'anagrafiche'];

const PROFESSIONAL_FEATURES: FeatureKey[] = [
  ...TRIAL_FEATURES,
  'mud',
  'giacenze',
  'contratti',
  'esg',
  'anomalie',
];

export const PLAN_FEATURES: Record<SubscriptionTier, FeatureKey[]> = {
  [SubscriptionTier.TRIAL]: TRIAL_FEATURES,
  [SubscriptionTier.PROFESSIONAL]: PROFESSIONAL_FEATURES,
  [SubscriptionTier.ENTERPRISE]: [...FEATURE_KEYS],
};

/** Type guard: la chiave è una feature valida del catalogo? */
export function isFeatureKey(value: unknown): value is FeatureKey {
  return (
    typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Forma minima del tenant necessaria a calcolare le feature effettive.
 * Compatibile con il record `Tenant` di Prisma (campi in più sono ignorati).
 */
export interface TenantFeatureSource {
  subscriptionTier: SubscriptionTier;
  /** Override admin: array di chiavi feature. Se null/assente → deriva dal piano. */
  featureFlags?: unknown;
}

/**
 * Feature effettivamente abilitate per un tenant.
 *
 * - Se `featureFlags` è un array → override esplicito (filtrato sulle sole
 *   chiavi valide del catalogo, per robustezza verso dati legacy/sporchi).
 * - Altrimenti → default derivati dal piano `subscriptionTier`.
 */
export function effectiveFeatures(tenant: TenantFeatureSource): FeatureKey[] {
  const flags = tenant.featureFlags;
  if (Array.isArray(flags)) {
    return flags.filter(isFeatureKey);
  }
  return PLAN_FEATURES[tenant.subscriptionTier] ?? [];
}
