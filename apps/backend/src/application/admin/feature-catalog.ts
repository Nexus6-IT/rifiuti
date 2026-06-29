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
  'registro',
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
  registro: 'Registro cronologico C/S (art. 190 D.Lgs 152/2006)',
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
// Il registro cronologico C/S è un adempimento OBBLIGATORIO di legge (art. 190
// D.Lgs 152/2006) per qualsiasi operatore, come il FIR: fa parte delle feature
// di base, non è un modulo premium.
const TRIAL_FEATURES: FeatureKey[] = ['fir', 'cer', 'anagrafiche', 'registro'];

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
 * Semantica (fix feature-flag propagation — WS-F):
 *  - Le feature di default del piano (`PLAN_FEATURES[subscriptionTier]`) sono
 *    SEMPRE incluse, indipendentemente dall'override. Questo garantisce che i
 *    tenant esistenti ricevano automaticamente le nuove feature aggiunte al
 *    loro piano (es. 'registro' aggiunto a PROFESSIONAL).
 *  - `featureFlags` è ADDITIVO: aggiunge feature extra oltre al piano
 *    (es. accesso anticipato a funzionalità premium per un tenant specifico).
 *  - Per RIMUOVERE una feature da un tenant si imposta `featureFlags = null`
 *    e si declassa il piano — non si usa l'array come blacklist.
 *
 * Invariante: un tenant TRIAL non riceve mai feature PROFESSIONAL/ENTERPRISE
 * da questo calcolo (le feature aggiuntive in `featureFlags` sono additive ma
 * un SUPER_ADMIN può tecnicamente aggiungere qualsiasi feature; è la sua
 * responsabilità, non un bug di sicurezza commerciale).
 */
export function effectiveFeatures(tenant: TenantFeatureSource): FeatureKey[] {
  const planFeatures = PLAN_FEATURES[tenant.subscriptionTier] ?? [];
  const flags = tenant.featureFlags;

  if (!Array.isArray(flags)) {
    // Nessun override: usa le feature del piano.
    return planFeatures;
  }

  // Override additivo: unione di (feature di piano) + (feature dell'override).
  // Garantisce che nuove feature aggiunte al piano si propaghino ai tenant
  // con override storico, senza togliere mai feature del piano corrente.
  const extraKeys = (flags as unknown[]).filter(isFeatureKey);
  const merged = new Set<FeatureKey>([...planFeatures, ...extraKeys]);
  return [...merged];
}
