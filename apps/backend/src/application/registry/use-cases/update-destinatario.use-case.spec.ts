/**
 * UpdateDestinatario Use Case - TDD Tests
 *
 * Giro di correzione 1 sul Task 3 dello scadenzario — rilievo Importante:
 * la distinzione fra `undefined` (campo assente, scadenza non toccata) e
 * `null` (campo esplicitamente nullo, scadenza azzerata) non aveva copertura
 * oltre il livello di dominio. È il percorso che AZZERA una scadenza: se il
 * ramo `if (command.scadenzaAutorizzazione !== undefined)` venisse invertito,
 * l'effetto non sarebbe un errore visibile ma un avviso di scadenza che
 * smette di partire in silenzio.
 */

import { UpdateDestinatarioUseCase } from './update-destinatario.use-case'
import { DestinatarioRepository } from '../../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'

function creaDestinatario(scadenzaAutorizzazione?: Date): Destinatario {
  return Destinatario.create({
    ragioneSociale: 'Smaltimento Rifiuti SpA',
    partitaIVA: PartitaIVA.create('11122233344'),
    sede: Indirizzo.create({
      via: 'Via Napoli',
      civico: '100',
      cap: '80100',
      citta: 'Napoli',
      provincia: 'NA',
    }),
    numeroAutorizzazione: 'NA/AUT/2023/001',
    scadenzaAutorizzazione,
  })
}

describe('UpdateDestinatarioUseCase', () => {
  let useCase: UpdateDestinatarioUseCase
  let repository: jest.Mocked<DestinatarioRepository>

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByTenantId: jest.fn(),
      findByPartitaIVA: jest.fn(),
      findByNumeroAutorizzazione: jest.fn(),
      delete: jest.fn(),
    } as any

    useCase = new UpdateDestinatarioUseCase(repository)
  })

  describe('scadenzaAutorizzazione — distinzione undefined/null (Task 3, giro di correzione 1)', () => {
    it('campo assente (undefined) nella richiesta non tocca la scadenza esistente', async () => {
      const scadenzaOriginale = new Date('2027-01-15')
      const destinatario = creaDestinatario(scadenzaOriginale)
      repository.findById.mockResolvedValue(destinatario)

      // scadenzaAutorizzazione non presente nel comando: come una PUT senza quel campo.
      const result = await useCase.execute({ id: destinatario.id })

      expect(result.isSuccess).toBe(true)
      expect(result.value.scadenzaAutorizzazione).toBe(scadenzaOriginale)
    })

    it('campo esplicitamente null azzera davvero la scadenza esistente', async () => {
      const scadenzaOriginale = new Date('2027-01-15')
      const destinatario = creaDestinatario(scadenzaOriginale)
      repository.findById.mockResolvedValue(destinatario)

      const result = await useCase.execute({
        id: destinatario.id,
        scadenzaAutorizzazione: null,
      })

      expect(result.isSuccess).toBe(true)
      expect(result.value.scadenzaAutorizzazione).toBeUndefined()
    })

    it('una nuova data sostituisce quella esistente', async () => {
      const destinatario = creaDestinatario(new Date('2027-01-15'))
      repository.findById.mockResolvedValue(destinatario)
      const nuovaScadenza = new Date('2028-06-30')

      const result = await useCase.execute({
        id: destinatario.id,
        scadenzaAutorizzazione: nuovaScadenza,
      })

      expect(result.isSuccess).toBe(true)
      expect(result.value.scadenzaAutorizzazione).toBe(nuovaScadenza)
    })

    it('campo assente su un destinatario senza scadenza pregressa resta senza scadenza (non la inventa)', async () => {
      const destinatario = creaDestinatario(undefined)
      repository.findById.mockResolvedValue(destinatario)

      const result = await useCase.execute({ id: destinatario.id })

      expect(result.isSuccess).toBe(true)
      expect(result.value.scadenzaAutorizzazione).toBeUndefined()
    })
  })
})
