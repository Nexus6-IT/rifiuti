import { SubscriptionTier } from '@prisma/client'
import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  PLAN_FEATURES,
  calcolaDeltaModuli,
  effectiveFeatures,
  isFeatureKey,
} from './feature-catalog'

describe('feature-catalog: pese', () => {
  it('pese nel piano PROFESSIONAL, non in TRIAL', () => {
    expect(PLAN_FEATURES[SubscriptionTier.PROFESSIONAL]).toContain('pese')
    expect(PLAN_FEATURES[SubscriptionTier.TRIAL]).not.toContain('pese')
    expect(PLAN_FEATURES[SubscriptionTier.ENTERPRISE]).toContain('pese')
  })

  it('è una chiave valida con etichetta in italiano', () => {
    expect(FEATURE_KEYS).toContain('pese')
    expect(isFeatureKey('pese')).toBe(true)
    expect(FEATURE_LABELS.pese).toBe('Pese (inserimento manuale)')
  })

  it('un tenant TRIAL non la riceve, uno PROFESSIONAL sì', () => {
    expect(effectiveFeatures({ subscriptionTier: SubscriptionTier.TRIAL })).not.toContain('pese')
    expect(effectiveFeatures({ subscriptionTier: SubscriptionTier.PROFESSIONAL })).toContain('pese')
  })
})

describe('effectiveFeatures: moduli aggiunti e tolti', () => {
  const T = SubscriptionTier.TRIAL

  it('un modulo del piano tolto è assente', () => {
    const f = effectiveFeatures({ subscriptionTier: T, featureTolte: ['cer'] })
    expect(f).not.toContain('cer')
    expect(f).toContain('fir')
  })

  it('un modulo aggiunto è presente', () => {
    const f = effectiveFeatures({ subscriptionTier: T, featureFlags: ['esg'] })
    expect(f).toContain('esg')
  })

  it('un modulo nuovo del piano arriva anche a chi ha tolto altri moduli', () => {
    const f = effectiveFeatures({
      subscriptionTier: SubscriptionTier.PROFESSIONAL,
      featureFlags: [],
      featureTolte: ['esg'],
    })
    expect(f).toContain('pese')
    expect(f).not.toContain('esg')
  })

  it('un modulo tolto prevale su uno aggiunto', () => {
    const f = effectiveFeatures({
      subscriptionTier: T,
      featureFlags: ['esg'],
      featureTolte: ['esg'],
    })
    expect(f).not.toContain('esg')
  })

  it('con entrambe le colonne null restano solo i moduli del piano', () => {
    const f = effectiveFeatures({ subscriptionTier: T, featureFlags: null, featureTolte: null })
    expect([...f].sort()).toEqual([...PLAN_FEATURES[T]].sort())
  })
})

describe('calcolaDeltaModuli', () => {
  it('aggiunti = selezione - piano, tolti = piano - selezione', () => {
    const d = calcolaDeltaModuli(SubscriptionTier.TRIAL, ['fir', 'esg'])
    expect(d.aggiunti).toEqual(['esg'])
    expect([...d.tolti].sort()).toEqual(['anagrafiche', 'cer', 'registro'])
  })

  it('selezione vuota = tutto il piano tolto', () => {
    const d = calcolaDeltaModuli(SubscriptionTier.TRIAL, [])
    expect(d.aggiunti).toEqual([])
    expect(d.tolti.length).toBe(PLAN_FEATURES[SubscriptionTier.TRIAL].length)
  })
})

describe('feature-catalog: ritiri', () => {
  it('ritiri nel piano PROFESSIONAL e ENTERPRISE, non in TRIAL', () => {
    expect(PLAN_FEATURES[SubscriptionTier.PROFESSIONAL]).toContain('ritiri')
    expect(PLAN_FEATURES[SubscriptionTier.ENTERPRISE]).toContain('ritiri')
    expect(PLAN_FEATURES[SubscriptionTier.TRIAL]).not.toContain('ritiri')
  })

  it('è una chiave valida con etichetta in italiano', () => {
    expect(FEATURE_KEYS).toContain('ritiri')
    expect(isFeatureKey('ritiri')).toBe(true)
    expect(FEATURE_LABELS.ritiri).toBe('Ritiri programmati')
  })

  it('un tenant TRIAL non la riceve, uno PROFESSIONAL sì, e si può togliere', () => {
    expect(effectiveFeatures({ subscriptionTier: SubscriptionTier.TRIAL })).not.toContain('ritiri')
    expect(effectiveFeatures({ subscriptionTier: SubscriptionTier.PROFESSIONAL })).toContain(
      'ritiri'
    )
    expect(
      effectiveFeatures({
        subscriptionTier: SubscriptionTier.PROFESSIONAL,
        featureTolte: ['ritiri'],
      })
    ).not.toContain('ritiri')
  })
})

describe('feature-catalog: comunicazioni', () => {
  it('il modulo comunicazioni e solo in ENTERPRISE e si aggiunge ai piani via featureFlags', () => {
    expect(FEATURE_KEYS).toContain('comunicazioni')
    expect(PLAN_FEATURES[SubscriptionTier.ENTERPRISE]).toContain('comunicazioni')
    expect(PLAN_FEATURES[SubscriptionTier.PROFESSIONAL]).not.toContain('comunicazioni')
    expect(PLAN_FEATURES[SubscriptionTier.TRIAL]).not.toContain('comunicazioni')
    expect(
      effectiveFeatures({
        subscriptionTier: SubscriptionTier.PROFESSIONAL,
        featureFlags: ['comunicazioni'],
      })
    ).toContain('comunicazioni')
  })
})
