/**
 * Destinatario Entity - TDD Tests
 * Rappresenta un destinatario di rifiuti nel sistema
 */

import { Destinatario, DestinatarioProps } from './destinatario'
import { PartitaIVA } from '../value-objects/partita-iva'
import { Indirizzo } from '../value-objects/indirizzo'

describe('Destinatario Entity', () => {
  describe('create', () => {
    it('should create a new Destinatario', () => {
      const props: DestinatarioProps = {
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
      }

      const destinatario = Destinatario.create(props)

      expect(destinatario.id).toBeDefined()
      expect(destinatario.ragioneSociale).toBe('Smaltimento Rifiuti SpA')
      expect(destinatario.partitaIVA.getValue()).toBe('11122233344')
      expect(destinatario.numeroAutorizzazione).toBe('NA/AUT/2023/001')
    })

    it('should trim ragione sociale', () => {
      const props: DestinatarioProps = {
        ragioneSociale: '  Smaltimento Rifiuti SpA  ',
        partitaIVA: PartitaIVA.create('11122233344'),
        sede: Indirizzo.create({
          via: 'Via Napoli',
          civico: '100',
          cap: '80100',
          citta: 'Napoli',
          provincia: 'NA',
        }),
        numeroAutorizzazione: 'NA/AUT/2023/001',
      }

      const destinatario = Destinatario.create(props)
      expect(destinatario.ragioneSociale).toBe('Smaltimento Rifiuti SpA')
    })

    it('should throw error for empty ragione sociale', () => {
      const props: DestinatarioProps = {
        ragioneSociale: '',
        partitaIVA: PartitaIVA.create('11122233344'),
        sede: Indirizzo.create({
          via: 'Via Napoli',
          civico: '100',
          cap: '80100',
          citta: 'Napoli',
          provincia: 'NA',
        }),
        numeroAutorizzazione: 'NA/AUT/2023/001',
      }

      expect(() => Destinatario.create(props)).toThrow('Ragione sociale is required')
    })

    it('should create without optional fields', () => {
      const props: DestinatarioProps = {
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
      }

      const destinatario = Destinatario.create(props)

      expect(destinatario.email).toBeUndefined()
      expect(destinatario.telefono).toBeUndefined()
      expect(destinatario.pec).toBeUndefined()
    })

    it('should create with optional contact fields', () => {
      const props: DestinatarioProps = {
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
        email: 'info@smaltimento.it',
        telefono: '081-9876543',
        pec: 'smaltimento@pec.it',
      }

      const destinatario = Destinatario.create(props)

      expect(destinatario.email).toBe('info@smaltimento.it')
      expect(destinatario.telefono).toBe('081-9876543')
      expect(destinatario.pec).toBe('smaltimento@pec.it')
    })
  })

  describe('reconstitute', () => {
    it('should reconstitute from persistence', () => {
      const destinatario = Destinatario.reconstitute({
        id: 'dest-123',
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
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      expect(destinatario.id).toBe('dest-123')
      expect(destinatario.ragioneSociale).toBe('Smaltimento Rifiuti SpA')
      expect(destinatario.numeroAutorizzazione).toBe('NA/AUT/2023/001')
    })
  })

  describe('updateRagioneSociale', () => {
    it('should update ragione sociale', () => {
      const destinatario = Destinatario.create({
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
      })

      destinatario.updateRagioneSociale('Smaltimento Rifiuti Srl')
      expect(destinatario.ragioneSociale).toBe('Smaltimento Rifiuti Srl')
    })

    it('should throw error for empty ragione sociale', () => {
      const destinatario = Destinatario.create({
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
      })

      expect(() => destinatario.updateRagioneSociale('')).toThrow('Ragione sociale is required')
    })
  })

  describe('updateSede', () => {
    it('should update sede', () => {
      const destinatario = Destinatario.create({
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
      })

      const nuovaSede = Indirizzo.create({
        via: 'Via Palermo',
        civico: '200',
        cap: '90100',
        citta: 'Palermo',
        provincia: 'PA',
      })

      destinatario.updateSede(nuovaSede)
      expect(destinatario.sede.getCitta()).toBe('Palermo')
    })
  })

  describe('updateContatti', () => {
    it('should update contact information', () => {
      const destinatario = Destinatario.create({
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
      })

      destinatario.updateContatti(
        'nuova@email.it',
        '081-1234567',
        'nuova@pec.it'
      )

      expect(destinatario.email).toBe('nuova@email.it')
      expect(destinatario.telefono).toBe('081-1234567')
      expect(destinatario.pec).toBe('nuova@pec.it')
    })
  })

  describe('updateNumeroAutorizzazione', () => {
    it('should update numero autorizzazione', () => {
      const destinatario = Destinatario.create({
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
      })

      destinatario.updateNumeroAutorizzazione('NA/AUT/2024/002')
      expect(destinatario.numeroAutorizzazione).toBe('NA/AUT/2024/002')
    })

    it('should throw error for empty numero autorizzazione', () => {
      const destinatario = Destinatario.create({
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
      })

      expect(() => destinatario.updateNumeroAutorizzazione('')).toThrow('Numero autorizzazione is required')
    })
  })
})
