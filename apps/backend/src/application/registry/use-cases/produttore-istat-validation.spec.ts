import { CreateProduttoreUseCase } from './create-produttore.use-case'
import { PIVA_VALIDA } from '../../../test-support/anagrafiche-di-test'

/**
 * Verifica la validazione comune/provincia contro le tabelle ISTAT condivise
 * nelle anagrafiche (qui: Produttore; trasportatore/destinatario simmetrici).
 */
describe('CreateProduttoreUseCase — validazione ISTAT', () => {
  let repository: any
  let referenceData: any
  let prisma: any
  let ditte: any

  const command = {
    ragioneSociale: 'Acme Srl',
    partitaIVA: PIVA_VALIDA,
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' },
  }

  beforeEach(() => {
    repository = {
      crea: jest.fn(),
      findByDittaId: jest.fn().mockResolvedValue(null),
    }
    prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn({})) }
    ditte = {
      risolviPerRuolo: jest.fn().mockResolvedValue({
        dittaId: 'ditta-1',
        sedeId: 'sede-1',
        ragioneSocialeDitta: 'Acme Srl',
        partitaIva: PIVA_VALIDA,
        codiceFiscale: null,
        dittaEsistente: false,
        avvisi: [],
      }),
    }
    referenceData = { validateLocalita: jest.fn() }
  })

  it('rifiuta la creazione se comune/provincia non valida (ISTAT popolato)', async () => {
    referenceData.validateLocalita.mockResolvedValue({ ok: false, error: 'Comune non valido' })
    const useCase = new CreateProduttoreUseCase(repository, prisma, ditte, referenceData)

    const result = await useCase.execute(command)

    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('Comune non valido')
    expect(repository.crea).not.toHaveBeenCalled()
    expect(ditte.risolviPerRuolo).not.toHaveBeenCalled()
    expect(referenceData.validateLocalita).toHaveBeenCalledWith('Roma', 'RM')
  })

  it('crea se la località è valida', async () => {
    referenceData.validateLocalita.mockResolvedValue({ ok: true, comuneCode: '058091' })
    const useCase = new CreateProduttoreUseCase(repository, prisma, ditte, referenceData)

    const result = await useCase.execute(command)

    expect(result.isSuccess).toBe(true)
    expect(repository.crea).toHaveBeenCalledTimes(1)
  })

  it('senza ReferenceDataService la validazione è saltata (retro-compatibilità)', async () => {
    const useCase = new CreateProduttoreUseCase(repository, prisma, ditte)
    const result = await useCase.execute(command)
    expect(result.isSuccess).toBe(true)
  })
})
