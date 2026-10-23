/**
 * UpdateTrasportatore Use Case - TDD Tests
 *
 * Giro di correzione 1 sul Task 3 dello scadenzario — rilievo Importante:
 * la distinzione fra `undefined` (campo assente, scadenza non toccata) e
 * `null` (campo esplicitamente nullo, scadenza azzerata) non aveva copertura
 * oltre il livello di dominio. È il percorso che AZZERA una scadenza: se il
 * ramo `if (command.scadenzaIscrizione !== undefined)` venisse invertito,
 * l'effetto non sarebbe un errore visibile ma un avviso di scadenza che
 * smette di partire in silenzio.
 */

import { UpdateTrasportatoreUseCase } from './update-trasportatore.use-case'
import { TrasportatoreRepository } from '../../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'

function creaTrasportatore(scadenzaIscrizione?: Date): Trasportatore {
  return Trasportatore.create({
    ragioneSociale: 'Trasporti Eco Srl',
    partitaIVA: PartitaIVA.create('98765432109'),
    sedeLegale: Indirizzo.create({
      via: 'Via Milano',
      civico: '50',
      cap: '20100',
      citta: 'Milano',
      provincia: 'MI',
    }),
    numeroIscrizione: 'MI/001234',
    scadenzaIscrizione,
  })
}

describe('UpdateTrasportatoreUseCase', () => {
  let useCase: UpdateTrasportatoreUseCase
  let repository: jest.Mocked<TrasportatoreRepository>

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByTenantId: jest.fn(),
      findByPartitaIVA: jest.fn(),
      findByNumeroIscrizione: jest.fn(),
      delete: jest.fn(),
    } as any

    useCase = new UpdateTrasportatoreUseCase(repository)
  })

  describe('scadenzaIscrizione — distinzione undefined/null (Task 3, giro di correzione 1)', () => {
    it('campo assente (undefined) nella richiesta non tocca la scadenza esistente', async () => {
      const scadenzaOriginale = new Date('2027-01-15')
      const trasportatore = creaTrasportatore(scadenzaOriginale)
      repository.findById.mockResolvedValue(trasportatore)

      // scadenzaIscrizione non presente nel comando: come una PUT senza quel campo.
      const result = await useCase.execute({ id: trasportatore.id })

      expect(result.isSuccess).toBe(true)
      expect(result.value.scadenzaIscrizione).toBe(scadenzaOriginale)
    })

    it('campo esplicitamente null azzera davvero la scadenza esistente', async () => {
      const scadenzaOriginale = new Date('2027-01-15')
      const trasportatore = creaTrasportatore(scadenzaOriginale)
      repository.findById.mockResolvedValue(trasportatore)

      const result = await useCase.execute({ id: trasportatore.id, scadenzaIscrizione: null })

      expect(result.isSuccess).toBe(true)
      expect(result.value.scadenzaIscrizione).toBeUndefined()
    })

    it('una nuova data sostituisce quella esistente', async () => {
      const trasportatore = creaTrasportatore(new Date('2027-01-15'))
      repository.findById.mockResolvedValue(trasportatore)
      const nuovaScadenza = new Date('2028-06-30')

      const result = await useCase.execute({
        id: trasportatore.id,
        scadenzaIscrizione: nuovaScadenza,
      })

      expect(result.isSuccess).toBe(true)
      expect(result.value.scadenzaIscrizione).toBe(nuovaScadenza)
    })

    it('campo assente su un trasportatore senza scadenza pregressa resta senza scadenza (non la inventa)', async () => {
      const trasportatore = creaTrasportatore(undefined)
      repository.findById.mockResolvedValue(trasportatore)

      const result = await useCase.execute({ id: trasportatore.id })

      expect(result.isSuccess).toBe(true)
      expect(result.value.scadenzaIscrizione).toBeUndefined()
    })
  })
})
