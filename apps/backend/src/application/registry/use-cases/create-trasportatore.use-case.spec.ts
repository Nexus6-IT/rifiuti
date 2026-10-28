/**
 * CreateTrasportatore Use Case (F2-10 Task 3a): ruolo su ditta e sede.
 * Le regole della ditta (privato solo produttore, P.IVA/CF) stanno in `DitteService`: qui si
 * verifica che il use case le lasci passare con il loro stato HTTP e che il ruolo duplicato
 * produca il 400 giusto.
 */

import { CreateTrasportatoreUseCase } from './create-trasportatore.use-case'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import { DatiControparteNonValidiError } from '../../../core/domain/errors'
import { MESSAGGIO_PRIVATO_SOLO_PRODUTTORE } from '../../../domain/registry/value-objects/identificativo-fiscale'
import { CF_PERSONA_VALIDO, PIVA_VALIDA } from '../../../test-support/anagrafiche-di-test'

const SEDE = { via: 'Via Milano', civico: '50', cap: '20100', citta: 'Milano', provincia: 'MI' }

describe('CreateTrasportatoreUseCase', () => {
  let repository: any
  let ditte: { risolviPerRuolo: jest.Mock }
  let useCase: CreateTrasportatoreUseCase
  const tx = { marcatore: 'tx' }

  const comando = (over: object = {}) => ({
    ragioneSociale: 'Trasporti Eco Srl',
    partitaIVA: PIVA_VALIDA,
    sedeLegale: SEDE,
    numeroIscrizione: 'MI/001234',
    ...over,
  })

  beforeEach(() => {
    repository = {
      crea: jest.fn().mockResolvedValue(undefined),
      findByDittaId: jest.fn().mockResolvedValue(null),
      findByNumeroIscrizione: jest.fn().mockResolvedValue(null),
    }
    ditte = {
      risolviPerRuolo: jest.fn().mockResolvedValue({
        dittaId: 'ditta-1',
        sedeId: 'sede-1',
        ragioneSocialeDitta: 'Trasporti Eco Srl',
        partitaIva: PIVA_VALIDA,
        codiceFiscale: null,
        dittaEsistente: false,
        avvisi: [],
      }),
    }
    const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) }
    useCase = new CreateTrasportatoreUseCase(repository, prisma as never, ditte as never)
  })

  it('crea il trasportatore con numero iscrizione e scadenza', async () => {
    const scadenza = new Date('2028-01-31')
    const result = await useCase.execute(comando({ scadenzaIscrizione: scadenza }))

    expect(result.isSuccess).toBe(true)
    expect(ditte.risolviPerRuolo).toHaveBeenCalledWith(tx, 'TRASPORTATORE', expect.anything())
    expect(repository.crea).toHaveBeenCalledWith(tx, result.value.ruolo)
    expect(result.value.ruolo.numeroIscrizione).toBe('MI/001234')
    expect(result.value.ruolo.scadenzaIscrizione).toBe(scadenza)
  })

  it('un privato (solo codice fiscale) non puo essere trasportatore: errore tipizzato, non 400 generico', async () => {
    ditte.risolviPerRuolo.mockRejectedValue(
      new DatiControparteNonValidiError(MESSAGGIO_PRIVATO_SOLO_PRODUTTORE)
    )

    await expect(
      useCase.execute(comando({ partitaIVA: '', codiceFiscale: CF_PERSONA_VALIDO }))
    ).rejects.toThrow(MESSAGGIO_PRIVATO_SOLO_PRODUTTORE)
    expect(repository.crea).not.toHaveBeenCalled()
  })

  it('ruolo gia presente per la ditta: 400 con il messaggio del ruolo', async () => {
    repository.findByDittaId.mockResolvedValue(
      Trasportatore.create({
        dittaId: 'ditta-1',
        sedeId: 'sede-1',
        ragioneSociale: 'Esistente',
        partitaIVA: PartitaIVA.create(PIVA_VALIDA),
        sedeLegale: Indirizzo.create(SEDE),
        numeroIscrizione: 'MI/000001',
      })
    )

    const result = await useCase.execute(comando())

    expect(result.isFailure).toBe(true)
    expect(result.error).toBe('Esiste già un trasportatore per questa ditta')
    expect(repository.crea).not.toHaveBeenCalled()
  })

  it('numero iscrizione gia usato: rifiuta prima di aprire la transazione', async () => {
    repository.findByNumeroIscrizione.mockResolvedValue({} as Trasportatore)

    const result = await useCase.execute(comando())

    expect(result.isFailure).toBe(true)
    expect(ditte.risolviPerRuolo).not.toHaveBeenCalled()
  })
})
