/**
 * Trasportatore Entity - TDD Tests
 * Rappresenta un trasportatore di rifiuti nel sistema
 */

import { Trasportatore, TrasportatoreProps } from './trasportatore'
import { PartitaIVA } from '../value-objects/partita-iva'
import { Indirizzo } from '../value-objects/indirizzo'

describe('Trasportatore Entity', () => {
  describe('create', () => {
    it('should create a new Trasportatore', () => {
      const props: TrasportatoreProps = {
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
      }

      const trasportatore = Trasportatore.create(props)

      expect(trasportatore.id).toBeDefined()
      expect(trasportatore.ragioneSociale).toBe('Trasporti Eco Srl')
      expect(trasportatore.partitaIVA.getValue()).toBe('98765432109')
      expect(trasportatore.numeroIscrizione).toBe('MI/001234')
    })

    it('should trim ragione sociale', () => {
      const props: TrasportatoreProps = {
        ragioneSociale: '  Trasporti Eco Srl  ',
        partitaIVA: PartitaIVA.create('98765432109'),
        sedeLegale: Indirizzo.create({
          via: 'Via Milano',
          civico: '50',
          cap: '20100',
          citta: 'Milano',
          provincia: 'MI',
        }),
        numeroIscrizione: 'MI/001234',
      }

      const trasportatore = Trasportatore.create(props)
      expect(trasportatore.ragioneSociale).toBe('Trasporti Eco Srl')
    })

    it('should throw error for empty ragione sociale', () => {
      const props: TrasportatoreProps = {
        ragioneSociale: '',
        partitaIVA: PartitaIVA.create('98765432109'),
        sedeLegale: Indirizzo.create({
          via: 'Via Milano',
          civico: '50',
          cap: '20100',
          citta: 'Milano',
          provincia: 'MI',
        }),
        numeroIscrizione: 'MI/001234',
      }

      expect(() => Trasportatore.create(props)).toThrow('Ragione sociale is required')
    })

    it('should create without optional fields', () => {
      const props: TrasportatoreProps = {
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
      }

      const trasportatore = Trasportatore.create(props)

      expect(trasportatore.email).toBeUndefined()
      expect(trasportatore.telefono).toBeUndefined()
      expect(trasportatore.pec).toBeUndefined()
    })

    it('should create with optional contact fields', () => {
      const props: TrasportatoreProps = {
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
        email: 'info@trasporteco.it',
        telefono: '02-12345678',
        pec: 'trasporteco@pec.it',
      }

      const trasportatore = Trasportatore.create(props)

      expect(trasportatore.email).toBe('info@trasporteco.it')
      expect(trasportatore.telefono).toBe('02-12345678')
      expect(trasportatore.pec).toBe('trasporteco@pec.it')
    })
  })

  describe('reconstitute', () => {
    it('should reconstitute from persistence', () => {
      const trasportatore = Trasportatore.reconstitute({
        id: 'trasp-123',
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
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      expect(trasportatore.id).toBe('trasp-123')
      expect(trasportatore.ragioneSociale).toBe('Trasporti Eco Srl')
      expect(trasportatore.numeroIscrizione).toBe('MI/001234')
    })
  })

  describe('updateRagioneSociale', () => {
    it('should update ragione sociale', () => {
      const trasportatore = Trasportatore.create({
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
      })

      trasportatore.updateRagioneSociale('Trasporti Eco SpA')
      expect(trasportatore.ragioneSociale).toBe('Trasporti Eco SpA')
    })

    it('should throw error for empty ragione sociale', () => {
      const trasportatore = Trasportatore.create({
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
      })

      expect(() => trasportatore.updateRagioneSociale('')).toThrow('Ragione sociale is required')
    })
  })

  describe('updateSedeLegale', () => {
    it('should update sede legale', () => {
      const trasportatore = Trasportatore.create({
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
      })

      const nuovaSede = Indirizzo.create({
        via: 'Via Torino',
        civico: '100',
        cap: '10100',
        citta: 'Torino',
        provincia: 'TO',
      })

      trasportatore.updateSedeLegale(nuovaSede)
      expect(trasportatore.sedeLegale.getCitta()).toBe('Torino')
    })
  })

  describe('updateContatti', () => {
    it('should update contact information', () => {
      const trasportatore = Trasportatore.create({
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
      })

      trasportatore.updateContatti(
        'nuova@email.it',
        '02-99999999',
        'nuova@pec.it'
      )

      expect(trasportatore.email).toBe('nuova@email.it')
      expect(trasportatore.telefono).toBe('02-99999999')
      expect(trasportatore.pec).toBe('nuova@pec.it')
    })
  })

  describe('updateNumeroIscrizione', () => {
    it('should update numero iscrizione', () => {
      const trasportatore = Trasportatore.create({
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
      })

      trasportatore.updateNumeroIscrizione('MI/005678')
      expect(trasportatore.numeroIscrizione).toBe('MI/005678')
    })

    it('should throw error for empty numero iscrizione', () => {
      const trasportatore = Trasportatore.create({
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
      })

      expect(() => trasportatore.updateNumeroIscrizione('')).toThrow('Numero iscrizione is required')
    })
  })
})
