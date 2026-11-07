import { BadRequestException } from '@nestjs/common'
import { ImpostazioniFatturazioneService } from './impostazioni-fatturazione.service'

// Il database non si tocca: la validazione della data avviene prima di ogni accesso.
describe('ImpostazioniFatturazioneService — validazione', () => {
  const prisma: any = {
    $transaction: jest.fn(),
    impostazioneFatturazione: { findFirst: jest.fn() },
  }
  const service = new ImpostazioniFatturazioneService(prisma)

  beforeEach(() => jest.clearAllMocks())

  it.each(['2026-13-40', '01/01/2026', '2026-02-30', ''])(
    'data %j: 400 con details.errori sul campo, nessun accesso al database',
    async data => {
      const err = await service
        .imposta('t', 'u', { fatturazioneDa: data, versione: 0 })
        .catch(e => e)
      expect(err).toBeInstanceOf(BadRequestException)
      const corpo = err.getResponse() as any
      expect(corpo.details.errori).toEqual([
        expect.objectContaining({ campo: 'fatturazioneDa', messaggio: expect.any(String) }),
      ])
      expect(prisma.$transaction).not.toHaveBeenCalled()
    }
  )

  it('GET senza riga: spenta, versione 0', async () => {
    prisma.impostazioneFatturazione.findFirst.mockResolvedValue(null)
    await expect(
      // nelContestoTenant richiede il TenantContext: se fallisce qui il test lo dira'
      service.leggi('t')
    ).resolves.toEqual({
      fatturazioneDa: null,
      definitiveAttive: false,
      versione: 0,
      modificatoIl: null,
    })
  })
})
