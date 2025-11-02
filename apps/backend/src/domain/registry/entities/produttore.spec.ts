/**
 * Produttore Entity - TDD Tests
 * Rappresenta un produttore di rifiuti nel sistema
 */

import { Produttore, ProduttoreProps } from './produttore'
import { PartitaIVA } from '../value-objects/partita-iva'
import { Indirizzo } from '../value-objects/indirizzo'

describe('Produttore Entity', () => {
  describe('create', () => {
    it('should create a new Produttore', () => {
      const props: ProduttoreProps = {
        ragioneSociale: 'Acme Srl',
        partitaIVA: PartitaIVA.create('12345678901'),
        sedeLegale: Indirizzo.create({
          via: 'Via Roma',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        }),
      }

      const produttore = Produttore.create(props)

      expect(produttore.id).toBeDefined()
      expect(produttore.ragioneSociale).toBe('Acme Srl')
      expect(produttore.partitaIVA.getValue()).toBe('12345678901')
    })

    it('should trim ragione sociale', () => {
      const props: ProduttoreProps = {
        ragioneSociale: '  Acme Srl  ',
        partitaIVA: PartitaIVA.create('12345678901'),
        sedeLegale: Indirizzo.create({
          via: 'Via Roma',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        }),
      }

      const produttore = Produttore.create(props)
      expect(produttore.ragioneSociale).toBe('Acme Srl')
    })

    it('should throw error for empty ragione sociale', () => {
      const props: ProduttoreProps = {
        ragioneSociale: '',
        partitaIVA: PartitaIVA.create('12345678901'),
        sedeLegale: Indirizzo.create({
          via: 'Via Roma',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        }),
      }

      expect(() => Produttore.create(props)).toThrow('Ragione sociale is required')
    })
  })

  describe('reconstitute', () => {
    it('should reconstitute from persistence', () => {
      const produttore = Produttore.reconstitute({
        id: 'prod-123',
        ragioneSociale: 'Acme Srl',
        partitaIVA: PartitaIVA.create('12345678901'),
        sedeLegale: Indirizzo.create({
          via: 'Via Roma',
          civico: '10',
          cap: '00100',
          citta: 'Roma',
          provincia: 'RM',
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      expect(produttore.id).toBe('prod-123')
      expect(produttore.ragioneSociale).toBe('Acme Srl')
    })
  })
})
