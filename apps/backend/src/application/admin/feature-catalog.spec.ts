import { SubscriptionTier } from '@prisma/client'
import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  PLAN_FEATURES,
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
