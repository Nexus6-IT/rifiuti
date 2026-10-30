/**
 * CreateProduttore Use Case - TDD Tests (F2-10 Task 3a: ruolo su ditta e sede)
 */

import { Prisma } from '@prisma/client'
import { CreateProduttoreUseCase } from './create-produttore.use-case'
import { ProduttoreRepository } from '../../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import {
  DatiControparteNonValidiError,
  DittaIdentificativiInConflittoError,
} from '../../../core/domain/errors'
import { PIVA_VALIDA } from '../../../test-support/anagrafiche-di-test'
import { RisoluzioneRuolo } from '../ditte/ditte.service'

const SEDE = { via: 'Via Roma', civico: '10', cap: '00100', citta: 'Roma', provincia: 'RM' }

function risoluzione(over: Partial<RisoluzioneRuolo> = {}): RisoluzioneRuolo {
  return {
    dittaId: 'ditta-1',
    sedeId: 'sede-1',
    ragioneSocialeDitta: 'Acme Srl',
    partitaIva: PIVA_VALIDA,
    codiceFiscale: null,
    dittaEsistente: false,
    avvisi: [],
    contatti: { email: null, telefono: null, pec: null },
    ...over,
  }
}

describe('CreateProduttoreUseCase', () => {
  let useCase: CreateProduttoreUseCase
  let repository: jest.Mocked<ProduttoreRepository>
  let ditte: { risolviPerRuolo: jest.Mock }
  let tx: object
  let prisma: { $transaction: jest.Mock }

  const comando = (over: object = {}) => ({
    ragioneSociale: 'Acme Srl',
    partitaIVA: PIVA_VALIDA,
    sedeLegale: SEDE,
    ...over,
  })

  beforeEach(() => {
    repository = {
      crea: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(),
      findById: jest.fn(),
      findByTenantId: jest.fn(),
      findByDittaId: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    } as any
    tx = { marcatore: 'tx' }
    prisma = { $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) }
    ditte = { risolviPerRuolo: jest.fn().mockResolvedValue(risoluzione()) }

    useCase = new CreateProduttoreUseCase(repository, prisma as never, ditte as never)
  })

  describe('execute', () => {
    it('crea il produttore in UNA transazione: ditta e sede risolte, poi la riga di ruolo', async () => {
      const result = await useCase.execute(comando())

      expect(result.isSuccess).toBe(true)
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(ditte.risolviPerRuolo).toHaveBeenCalledWith(
        tx,
        'PRODUTTORE',
        expect.objectContaining({ ragioneSociale: 'Acme Srl', partitaIva: PIVA_VALIDA })
      )
      expect(repository.findByDittaId).toHaveBeenCalledWith(tx, 'ditta-1')
      expect(repository.crea).toHaveBeenCalledTimes(1)
      expect(repository.crea.mock.calls[0][0]).toBe(tx)
      const p = result.value.ruolo
      expect(p.ragioneSociale).toBe('Acme Srl')
      expect(p.dittaId).toBe('ditta-1')
      expect(p.sedeId).toBe('sede-1')
      expect(p.partitaIVA?.getValue()).toBe(PIVA_VALIDA)
      expect(result.value.dittaEsistente).toBe(false)
      expect(result.value.avvisi).toEqual([])
    })

    it('riusa una ditta esistente: la ragione sociale della ditta vince e l avviso arriva', async () => {
      ditte.risolviPerRuolo.mockResolvedValue(
        risoluzione({
          dittaEsistente: true,
          ragioneSocialeDitta: 'ACME S.R.L.',
          avvisi: [
            'La ragione sociale registrata per questa ditta è «ACME S.R.L.»: è stata mantenuta.',
          ],
        })
      )

      const result = await useCase.execute(comando({ ragioneSociale: 'Acme Srl' }))

      expect(result.isSuccess).toBe(true)
      expect(result.value.ruolo.ragioneSociale).toBe('ACME S.R.L.')
      expect(result.value.dittaEsistente).toBe(true)
      expect(result.value.avvisi).toHaveLength(1)
    })

    it('i contatti dell entita sono quelli EFFETTIVI della sede, non quelli della richiesta', async () => {
      ditte.risolviPerRuolo.mockResolvedValue(
        risoluzione({
          dittaEsistente: true,
          contatti: { email: 'sede@acme.it', telefono: null, pec: 'sede@pec.it' },
        })
      )

      const result = await useCase.execute(
        comando({ email: 'richiesta@acme.it', pec: 'richiesta@pec.it' })
      )

      expect(result.isSuccess).toBe(true)
      expect(result.value.ruolo.email).toBe('sede@acme.it')
      expect(result.value.ruolo.pec).toBe('sede@pec.it')
    })

    it('rifiuta (400) se la ditta ha gia un produttore e non inserisce nulla', async () => {
      repository.findByDittaId.mockResolvedValue(
        Produttore.create({
          dittaId: 'ditta-1',
          sedeId: 'sede-1',
          ragioneSociale: 'Esistente Srl',
          partitaIVA: PartitaIVA.create(PIVA_VALIDA),
          sedeLegale: Indirizzo.create(SEDE),
        })
      )

      const result = await useCase.execute(comando())

      expect(result.isFailure).toBe(true)
      expect(result.error).toBe('Esiste già un produttore per questa ditta')
      expect(repository.crea).not.toHaveBeenCalled()
    })

    it('traduce il P2002 sul vincolo (tenant, ditta) nello stesso 400', async () => {
      repository.crea.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['tenant_id', 'ditta_id'] },
        })
      )

      const result = await useCase.execute(comando())

      expect(result.isFailure).toBe(true)
      expect(result.error).toBe('Esiste già un produttore per questa ditta')
    })

    it('un P2002 su altro vincolo non viene mascherato', async () => {
      repository.crea.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'x',
          meta: { target: ['tenant_id', 'altro'] },
        })
      )

      const result = await useCase.execute(comando())

      expect(result.isFailure).toBe(true)
      expect(result.error).not.toContain('per questa ditta')
    })

    it('lascia passare gli errori di ditta (409/400 tipizzati) senza trasformarli in 400 generico', async () => {
      ditte.risolviPerRuolo.mockRejectedValue(new DittaIdentificativiInConflittoError())
      await expect(useCase.execute(comando())).rejects.toBeInstanceOf(
        DittaIdentificativiInConflittoError
      )

      ditte.risolviPerRuolo.mockRejectedValue(new DatiControparteNonValidiError('Dato non valido'))
      await expect(useCase.execute(comando())).rejects.toBeInstanceOf(DatiControparteNonValidiError)
    })

    it('accetta anche il codice fiscale oltre alla P.IVA e lo passa al servizio', async () => {
      await useCase.execute(comando({ codiceFiscale: 'RSSMRA80A01H501U' }))

      expect(ditte.risolviPerRuolo).toHaveBeenCalledWith(
        tx,
        'PRODUTTORE',
        expect.objectContaining({ codiceFiscale: 'RSSMRA80A01H501U' })
      )
    })

    it('crea con i campi di contatto facoltativi', async () => {
      ditte.risolviPerRuolo.mockResolvedValue(
        risoluzione({
          contatti: { email: 'info@acme.it', telefono: '06-12345678', pec: 'acme@pec.it' },
        })
      )
      const result = await useCase.execute(
        comando({ email: 'info@acme.it', telefono: '06-12345678', pec: 'acme@pec.it' })
      )

      expect(result.isSuccess).toBe(true)
      const produttore = result.value.ruolo
      expect(produttore.email).toBe('info@acme.it')
      expect(produttore.telefono).toBe('06-12345678')
      expect(produttore.pec).toBe('acme@pec.it')
    })
  })
})
