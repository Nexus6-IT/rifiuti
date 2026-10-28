import { RiapriTrasmissioneRentriUseCase } from './riapri-trasmissione-rentri.use-case'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'

/**
 * La conferma «Ritrasmetti» si consuma qui, in modo sincrono nella richiesta
 * HTTP: il job accodato dopo è un job normale, senza flag, quindi un retry di
 * BullMQ non può riaprire nulla da solo.
 */
describe('RiapriTrasmissioneRentriUseCase', () => {
  const TENANT_ID = 'tenant-riapri'
  let useCase: RiapriTrasmissioneRentriUseCase
  let firRepository: { findById: jest.Mock; save: jest.Mock }
  const logger = { setContext: jest.fn(), info: jest.fn() }

  function firReale(tenantId = TENANT_ID): FIR {
    const fir = FIR.create({
      produttoreId: 'produttore-1',
      rifiuto: {
        cerCode: '13 02 05*',
        quantita: 120,
        unitaMisura: UnitaMisura.KG,
        statoFisico: 'Liquido',
        caratteristichePericolo: 'HP14',
      },
      trasportatoreId: 'trasportatore-1',
      destinatarioId: 'destinatario-1',
      tenantId,
    })
    fir.emetti('FIR-2026-000001', {
      firmatario: 'Produttore',
      timestamp: new Date(),
      certificato: 'cert',
    })
    fir.clearDomainEvents()
    return fir
  }

  function firIncerto(tenantId = TENANT_ID): FIR {
    const fir = firReale(tenantId)
    fir.avviaTentativoRentri(new Date())
    fir.segnaTrasmissioneIncerta('esito incerto')
    fir.clearDomainEvents()
    return fir
  }

  beforeEach(() => {
    firRepository = { findById: jest.fn(), save: jest.fn().mockResolvedValue(undefined) }
    useCase = new RiapriTrasmissioneRentriUseCase(firRepository as any, logger as any)
  })

  it('trasmissione incerta: riapre (PENDING) e salva', async () => {
    const fir = firIncerto()
    firRepository.findById.mockResolvedValue(fir)

    await useCase.execute(fir.id, TENANT_ID)

    expect(fir.rentriSyncStatus.getStatus()).toBe('PENDING')
    expect(fir.canSyncToRENTRI()).toBe(true)
    expect(firRepository.save).toHaveBeenCalledWith(fir)
  })

  it('stato non riapribile: RIAPERTURA_RENTRI_NON_CONSENTITA, nessun salvataggio', async () => {
    firRepository.findById.mockResolvedValue(firReale())

    await expect(useCase.execute('fir-x', TENANT_ID)).rejects.toMatchObject({
      code: 'RIAPERTURA_RENTRI_NON_CONSENTITA',
    })
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it('FIR inesistente: NOT_FOUND', async () => {
    firRepository.findById.mockResolvedValue(null)

    await expect(useCase.execute('fir-x', TENANT_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(firRepository.save).not.toHaveBeenCalled()
  })

  it("FIR di un'altra azienda: NOT_FOUND, nessuna riapertura", async () => {
    const fir = firIncerto('tenant-altro')
    firRepository.findById.mockResolvedValue(fir)

    await expect(useCase.execute(fir.id, TENANT_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
    expect(firRepository.save).not.toHaveBeenCalled()
  })
})
