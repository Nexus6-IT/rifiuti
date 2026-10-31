import { AvvisoRentriCorrezioneService } from './avviso-rentri-correzione.service'

describe('AvvisoRentriCorrezioneService', () => {
  const logger = { setContext: jest.fn(), warn: jest.fn() }
  function crea(riga: { stato: string } | null | Error) {
    const prisma = {
      movimentoTrasmissioneRentri: {
        findFirst: jest.fn(() =>
          riga instanceof Error ? Promise.reject(riga) : Promise.resolve(riga)
        ),
      },
    }
    return { prisma, service: new AvvisoRentriCorrezioneService(prisma as any, logger as any) }
  }

  it.each(['TRASMESSA', 'GIA_SU_RENTRI'])(
    'predecessore %s: avviso di rettifica o annullamento',
    async stato => {
      const { service, prisma } = crea({ stato })
      expect(await service.calcola('t1', 'm1', 'RETTIFICA')).toBe(
        "L'annotazione corretta era già su RENTRI: la correzione sarà trasmessa come rettifica."
      )
      expect(await service.calcola('t1', 'm1', 'ANNULLAMENTO')).toBe(
        "L'annotazione corretta era già su RENTRI: la correzione sarà trasmessa come annullamento."
      )
      expect(prisma.movimentoTrasmissioneRentri.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 't1', movimentoId: 'm1' },
        select: { stato: true },
      })
    }
  )

  it.each([
    'DA_TRASMETTERE',
    'IN_INVIO',
    'ATTESA_ESITO',
    'INCERTA',
    'RIFIUTATA',
    'NON_TRASMISSIBILE',
  ])('predecessore %s: nessun avviso', async stato => {
    expect(await crea({ stato }).service.calcola('t1', 'm1', 'RETTIFICA')).toBeNull()
  })

  it('predecessore senza riga: nessun avviso', async () => {
    expect(await crea(null).service.calcola('t1', 'm1', 'ANNULLAMENTO')).toBeNull()
  })

  it('errore di lettura: null e warn senza dati (la correzione e gia stata scritta)', async () => {
    const { service } = crea(new Error('db giu'))
    expect(await service.calcola('t1', 'm1', 'RETTIFICA')).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('m1')
  })
})
