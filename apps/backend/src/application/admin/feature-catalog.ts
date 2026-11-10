import { SubscriptionTier } from '@prisma/client'

/**
 * Feature catalog — catalogo delle feature attivabili per-tenant.
 *
 * Le feature sono "moduli funzionali" che il piano di abbonamento
 * (`subscriptionTier`) abilita di default e che il SUPER_ADMIN può
 * modificare per singolo tenant: `Tenant.featureFlags` (aggiunti) e
 * `Tenant.featureTolte` (tolti).
 *
 * Risoluzione effettiva: vedi `effectiveFeatures()`.
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
  'pese',
  'comunicazioni',
] as const

/** Tipo della singola chiave feature. */
export type FeatureKey = (typeof FEATURE_KEYS)[number]

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
  pese: 'Pese (inserimento manuale)',
  comunicazioni: 'Comunicazioni a consorzi e osservatori',
}

/**
 * Feature abilitate di default da ciascun piano.
 *   - TRIAL:        funzionalità di base (formulari, CER, anagrafiche).
 *   - PROFESSIONAL: TRIAL + moduli operativi avanzati.
 *   - ENTERPRISE:   tutte le feature del catalogo.
 */
// Il registro cronologico C/S è un adempimento OBBLIGATORIO di legge (art. 190
// D.Lgs 152/2006) per qualsiasi operatore, come il FIR: fa parte delle feature
// di base, non è un modulo premium.
const TRIAL_FEATURES: FeatureKey[] = ['fir', 'cer', 'anagrafiche', 'registro']

const PROFESSIONAL_FEATURES: FeatureKey[] = [
  ...TRIAL_FEATURES,
  'mud',
  'giacenze',
  'contratti',
  'esg',
  'anomalie',
  'pese',
]

export const PLAN_FEATURES: Record<SubscriptionTier, FeatureKey[]> = {
  [SubscriptionTier.TRIAL]: TRIAL_FEATURES,
  [SubscriptionTier.PROFESSIONAL]: PROFESSIONAL_FEATURES,
  [SubscriptionTier.ENTERPRISE]: [...FEATURE_KEYS],
}

/** Type guard: la chiave è una feature valida del catalogo? */
export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && (FEATURE_KEYS as readonly string[]).includes(value)
}

/**
 * Forma minima del tenant necessaria a calcolare le feature effettive.
 * Compatibile con il record `Tenant` di Prisma (campi in più sono ignorati).
 */
export interface TenantFeatureSource {
  subscriptionTier: SubscriptionTier
  /** Moduli AGGIUNTI oltre al piano (array di chiavi). Null/assente = nessuno. */
  featureFlags?: unknown
  /** Moduli del piano TOLTI a questa azienda (array di chiavi). Null/assente = nessuno. */
  featureTolte?: unknown
}

function chiaviValide(valore: unknown): FeatureKey[] {
  return Array.isArray(valore) ? (valore as unknown[]).filter(isFeatureKey) : []
}

/**
 * Feature effettivamente abilitate per un tenant:
 *   (moduli del piano ∪ `featureFlags` aggiunti) − `featureTolte`.
 *
 * Un modulo nuovo del piano arriva quindi a tutte le aziende che non l'hanno tolto.
 * Un modulo tolto prevale sempre su uno aggiunto.
 */
export function effectiveFeatures(tenant: TenantFeatureSource): FeatureKey[] {
  const planFeatures = PLAN_FEATURES[tenant.subscriptionTier] ?? []
  const tolte = new Set<FeatureKey>(chiaviValide(tenant.featureTolte))
  const merged = new Set<FeatureKey>([...planFeatures, ...chiaviValide(tenant.featureFlags)])
  return [...merged].filter(k => !tolte.has(k))
}

/**
 * Dalla selezione completa di moduli al delta rispetto al piano:
 * aggiunti = selezione − piano, tolti = piano − selezione.
 */
export function calcolaDeltaModuli(
  tier: SubscriptionTier,
  selezione: readonly string[]
): { aggiunti: FeatureKey[]; tolti: FeatureKey[] } {
  const piano = PLAN_FEATURES[tier] ?? []
  const scelti = new Set<FeatureKey>(selezione.filter(isFeatureKey))
  return {
    aggiunti: [...scelti].filter(k => !piano.includes(k)),
    tolti: piano.filter(k => !scelti.has(k)),
  }
}
