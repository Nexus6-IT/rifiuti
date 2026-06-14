import { CreateProduttoreUseCase } from './create-produttore.use-case'

/**
 * Verifica la validazione comune/provincia contro le tabelle ISTAT condivise
 * nelle anagrafiche (qui: Produttore; trasportatore/destinatario simmetrici).
 */
describe('CreateProduttoreUseCase — validazione ISTAT', () => {
  let repository: any
  let referenceData: any

  const command = {
    ragioneSociale: 'Acme Srl',
    partitaIVA: '12345678901',
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' },
  }

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      findByPartitaIVA: jest.fn().mockResolvedValue(null),
    }
    referenceData = { validateLocalita: jest.fn() }
  })

  it('rifiuta la creazione se comune/provincia non valida (ISTAT popolato)', async () => {
    referenceData.validateLocalita.mockResolvedValue({ ok: false, error: 'Comune non valido' })
    const useCase = new CreateProduttoreUseCase(repository, referenceData)

    const result = await useCase.execute(command)

    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('Comune non valido')
    expect(repository.save).not.toHaveBeenCalled()
    expect(referenceData.validateLocalita).toHaveBeenCalledWith('Roma', 'RM')
  })

  it('crea se la località è valida', async () => {
    referenceData.validateLocalita.mockResolvedValue({ ok: true, comuneCode: '058091' })
    const useCase = new CreateProduttoreUseCase(repository, referenceData)

    const result = await useCase.execute(command)

    expect(result.isSuccess).toBe(true)
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('senza ReferenceDataService la validazione è saltata (retro-compatibilità)', async () => {
    const useCase = new CreateProduttoreUseCase(repository)
    const result = await useCase.execute(command)
    expect(result.isSuccess).toBe(true)
  })
})
