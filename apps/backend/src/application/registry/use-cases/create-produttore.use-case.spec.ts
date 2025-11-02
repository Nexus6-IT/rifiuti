/**
 * CreateProduttore Use Case - TDD Tests
 */

import { CreateProduttoreUseCase } from './create-produttore.use-case'
import { ProduttoreRepository } from '../../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'

describe('CreateProduttoreUseCase', () => {
  let useCase: CreateProduttoreUseCase
  let repository: jest.Mocked<ProduttoreRepository>

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByTenantId: jest.fn(),
      findByPartitaIVA: jest.fn(),
      delete: jest.fn(),
    } as any

    useCase = new CreateProduttoreUseCase(repository)
  })

  describe('execute', () => {
    it('should create a new Produttore', async () => {
      const command = {
        ragioneSociale: 'Acme Srl',
        partitaIVA: '12345678901',
        sedeLegale: {
          via: 'Via Roma',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        },
      }

      repository.findByPartitaIVA.mockResolvedValue(null)

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.ragioneSociale).toBe('Acme Srl')
      expect(repository.save).toHaveBeenCalledTimes(1)
    })

    it('should fail if Partita IVA already exists', async () => {
      const command = {
        ragioneSociale: 'Acme Srl',
        partitaIVA: '12345678901',
        sedeLegale: {
          via: 'Via Roma',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        },
      }

      const existingProduttore = Produttore.create({
        ragioneSociale: 'Existing Srl',
        partitaIVA: PartitaIVA.create('12345678901'),
        sedeLegale: Indirizzo.create({
          via: 'Via Milano',
          civico: '20',
          cap: '20100',
          citta: 'Milano',
          provincia: 'MI',
        }),
      })

      repository.findByPartitaIVA.mockResolvedValue(existingProduttore)

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('already exists')
      expect(repository.save).not.toHaveBeenCalled()
    })

    it('should create with optional contact fields', async () => {
      const command = {
        ragioneSociale: 'Acme Srl',
        partitaIVA: '12345678901',
        sedeLegale: {
          via: 'Via Roma',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        },
        email: 'info@acme.it',
        telefono: '06-12345678',
        pec: 'acme@pec.it',
      }

      repository.findByPartitaIVA.mockResolvedValue(null)

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      const produttore = result.value
      expect(produttore.email).toBe('info@acme.it')
      expect(produttore.telefono).toBe('06-12345678')
      expect(produttore.pec).toBe('acme@pec.it')
    })
  })
})
