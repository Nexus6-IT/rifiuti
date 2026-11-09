import { ModuliAttiviService } from './moduli-attivi.service'
import { ContrattoGruppoService } from '../billing/contratto-gruppo.service'

const RADICE = 'radice-uuid'
const FIGLIA = 'figlia-uuid'

function riga(extra: Record<string, unknown> = {}) {
  return {
    id: RADICE,
    parentTenantId: null,
    subscriptionTier: 'TRIAL',
    subscriptionStatus: 'ACTIVE',
    subscriptionEnd: null,
    firLimitPerMonth: 0,
    userLimitTotal: 7,
    featureFlags: null,
    featureTolte: null,
    aziendeLimit: null,
    ragioneSociale: 'X',
    madre: null,
    ...extra,
  }
}

function make(findUnique: jest.Mock) {
  const prisma: any = { tenant: { findUnique } }
  return new ModuliAttiviService(new ContrattoGruppoService(prisma))
}

describe('ModuliAttiviService', () => {
  it('piano TRIAL: fir, cer, anagrafiche, registro', async () => {
    const s = make(jest.fn().mockResolvedValue(riga()))
    expect((await s.moduliAttivi(RADICE)).sort()).toEqual(
      ['anagrafiche', 'cer', 'fir', 'registro'].sort()
    )
  })

  it('featureFlags aggiunge e featureTolte toglie', async () => {
    const s = make(
      jest.fn().mockResolvedValue(riga({ featureFlags: ['esg'], featureTolte: ['cer'] }))
    )
    const m = await s.moduliAttivi(RADICE)
    expect(m).toContain('esg')
    expect(m).not.toContain('cer')
    expect(m).toContain('fir')
  })

  it('una figlia ha i moduli della madre, non i propri', async () => {
    const madre = riga({ subscriptionTier: 'ENTERPRISE', featureTolte: ['pese'] })
    const s = make(
      jest
        .fn()
        .mockResolvedValue(
          riga({ id: FIGLIA, parentTenantId: RADICE, subscriptionTier: 'TRIAL', madre })
        )
    )
    const m = await s.moduliAttivi(FIGLIA)
    expect(m).toContain('rentri')
    expect(m).not.toContain('pese')
  })

  it('tenant assente: nessun modulo e nessun piano (fail-closed)', async () => {
    const s = make(jest.fn().mockResolvedValue(null))
    expect(await s.moduliAttivi('x')).toEqual([])
    expect(await s.pianoAzienda('x')).toBeNull()
  })

  it('pianoAzienda restituisce moduli, tier e limite utenti della radice', async () => {
    const s = make(jest.fn().mockResolvedValue(riga({ subscriptionTier: 'PROFESSIONAL' })))
    const p = await s.pianoAzienda(RADICE)
    expect(p?.tier).toBe('PROFESSIONAL')
    expect(p?.userLimitTotal).toBe(7)
    expect(p?.moduli).toContain('mud')
  })

  it('un errore del database si propaga (la decisione la prende il chiamante)', async () => {
    const s = make(jest.fn().mockRejectedValue(new Error('db giu')))
    await expect(s.moduliAttivi(RADICE)).rejects.toThrow('db giu')
  })
})
