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

  describe('tenantConModulo (a lotti, per i job)', () => {
    const MADRE_ENT = riga({ id: 'madre', subscriptionTier: 'ENTERPRISE' })
    const MADRE_TRIAL = riga({ id: 'madre-trial' })

    function makeLotto(righe: unknown[]) {
      const findMany = jest.fn().mockResolvedValue(righe)
      const prisma: any = { tenant: { findMany, findUnique: jest.fn() } }
      return { s: new ModuliAttiviService(new ContrattoGruppoService(prisma)), findMany }
    }

    it('una sola query per molte aziende, qualunque sia il numero', async () => {
      const righe = Array.from({ length: 50 }, (_, i) =>
        riga({ id: `t${i}`, subscriptionTier: 'ENTERPRISE' })
      )
      const { s, findMany } = makeLotto(righe)
      const ok = await s.tenantConModulo(
        righe.map(r => (r as { id: string }).id),
        'rentri'
      )
      expect(findMany).toHaveBeenCalledTimes(1)
      expect(ok.size).toBe(50)
    })

    it('tiene solo le aziende col modulo attivo', async () => {
      const { s } = makeLotto([
        riga({ id: 'a', subscriptionTier: 'ENTERPRISE' }),
        riga({ id: 'b' }),
      ])
      const ok = await s.tenantConModulo(['a', 'b'], 'rentri')
      expect([...ok]).toEqual(['a'])
    })

    it('una figlia ha i moduli della madre, non i propri', async () => {
      const { s } = makeLotto([
        riga({ id: 'figlia-ent', parentTenantId: 'madre', madre: MADRE_ENT }),
        riga({
          id: 'figlia-trial',
          parentTenantId: 'madre-trial',
          subscriptionTier: 'ENTERPRISE',
          madre: MADRE_TRIAL,
        }),
      ])
      const ok = await s.tenantConModulo(['figlia-ent', 'figlia-trial'], 'rentri')
      expect([...ok]).toEqual(['figlia-ent'])
    })

    it('featureTolte della radice toglie il modulo', async () => {
      const { s } = makeLotto([
        riga({ id: 'a', subscriptionTier: 'ENTERPRISE', featureTolte: ['rentri'] }),
      ])
      expect((await s.tenantConModulo(['a'], 'rentri')).size).toBe(0)
    })

    it('elenco vuoto: nessuna query, insieme vuoto', async () => {
      const { s, findMany } = makeLotto([])
      expect((await s.tenantConModulo([], 'rentri')).size).toBe(0)
      expect(findMany).not.toHaveBeenCalled()
    })

    it('azienda inesistente: esclusa (fail-closed); un errore del database si propaga', async () => {
      const { s } = makeLotto([])
      expect((await s.tenantConModulo(['fantasma'], 'rentri')).size).toBe(0)
      const prisma: any = { tenant: { findMany: jest.fn().mockRejectedValue(new Error('db giu')) } }
      const rotto = new ModuliAttiviService(new ContrattoGruppoService(prisma))
      await expect(rotto.tenantConModulo(['a'], 'rentri')).rejects.toThrow('db giu')
    })
  })
})
