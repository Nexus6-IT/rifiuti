import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { DatiControparteNonValidiError, SedeNonValidaPerRuoloError } from '../../core/domain/errors'
import { AgentiService } from './agenti.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const A = 'cccccccc-0000-4000-8000-000000000003'
const D = 'dddddddd-0000-4000-8000-000000000004'
const S = 'eeeeeeee-0000-4000-8000-000000000005'
const S2 = 'ffffffff-0000-4000-8000-000000000006'

const sede = (extra: Record<string, unknown> = {}) => ({
  id: S,
  tenantId: T,
  dittaId: D,
  denominazione: null,
  via: 'Via Roma',
  civico: '1',
  cap: '00100',
  comune: 'Roma',
  provincia: 'RM',
  referente: null,
  email: null,
  telefono: null,
  pec: null,
  principale: true,
  attiva: true,
  ...extra,
})

const riga = (extra: Record<string, unknown> = {}) => ({
  id: A,
  tenantId: T,
  dittaId: D,
  sedeId: S,
  codice: 'AG1',
  note: null,
  attivo: true,
  versione: 1,
  ditta: { id: D, ragioneSociale: 'Agenzia Rossi', partitaIva: '12345678903', codiceFiscale: null },
  sede: sede(),
  ...extra,
})

const dati = {
  ragioneSociale: 'Agenzia Rossi',
  partitaIva: '12345678903',
  indirizzo: { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' },
  codice: 'AG1',
  note: 'Zona nord',
}

const errP = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta })

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

const gruppo = (righe: Array<Record<string, unknown>> = []) => jest.fn().mockResolvedValue(righe)

describe('AgentiService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let ditte: { risolviPerRuolo: jest.Mock }
  let service: AgentiService

  beforeEach(() => {
    tx = {
      agente: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({ id: A }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      sedeDitta: { findFirst: jest.fn().mockResolvedValue({ id: S2 }) },
      cliente: { groupBy: gruppo() },
      contrattoCliente: { groupBy: gruppo() },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    ditte = {
      risolviPerRuolo: jest.fn().mockResolvedValue({
        dittaId: D,
        sedeId: S,
        ragioneSocialeDitta: 'Agenzia Rossi',
        partitaIva: '12345678903',
        codiceFiscale: null,
        dittaEsistente: false,
        avvisi: [],
        contatti: { email: null, telefono: null, pec: null },
      }),
    }
    // la prima findFirst di `crea` e' il controllo del ruolo gia' presente (nessuno), la seconda la rilettura
    service = new AgentiService(prisma, ditte as any)
  })

  describe('crea', () => {
    beforeEach(() => {
      tx.agente.findFirst.mockReset()
      tx.agente.findFirst.mockResolvedValueOnce(null).mockResolvedValue(riga())
    })

    it('risolve la ditta con ruolo AGENTE, scrive la riga e risponde con la vista', async () => {
      const r = await service.crea(T, U, dati)
      expect(ditte.risolviPerRuolo).toHaveBeenCalledWith(
        tx,
        'AGENTE',
        expect.objectContaining({ ragioneSociale: 'Agenzia Rossi', partitaIva: '12345678903' })
      )
      const passati = ditte.risolviPerRuolo.mock.calls[0][2]
      expect(passati).not.toHaveProperty('codice')
      expect(passati).not.toHaveProperty('note')
      expect(tx.agente.create.mock.calls[0][0].data).toEqual({
        tenantId: T,
        dittaId: D,
        sedeId: S,
        codice: 'AG1',
        note: 'Zona nord',
      })
      expect(r).toMatchObject({ dittaEsistente: false, avvisi: [], agente: { id: A, versione: 1 } })
    })

    it('audit AGENTE_CREATO con agenteId, dittaId e dittaEsistente e nient’altro', async () => {
      ditte.risolviPerRuolo.mockResolvedValue({
        ...(await ditte.risolviPerRuolo()),
        dittaEsistente: true,
      })
      await service.crea(T, U, dati)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ tenantId: T, userId: U, action: 'AGENTE_CREATO' })
      expect(audit.metadata).toEqual({ agenteId: A, dittaId: D, dittaEsistente: true })
      const json = JSON.stringify(audit)
      for (const vietato of ['12345678903', 'Zona nord', 'AG1', 'Agenzia Rossi']) {
        expect(json).not.toContain(vietato)
      }
    })

    it('privato senza partita IVA: il 400 di D18 arriva così com’è, niente scrittura', async () => {
      ditte.risolviPerRuolo.mockRejectedValue(
        new DatiControparteNonValidiError(
          'Un privato senza partita IVA può essere solo produttore o cliente.'
        )
      )
      const e = await errore(service.crea(T, U, { ...dati, partitaIva: undefined }))
      expect(e).toBeInstanceOf(DatiControparteNonValidiError)
      expect(e.message).toBe('Un privato senza partita IVA può essere solo produttore o cliente.')
      expect(tx.agente.create).not.toHaveBeenCalled()
    })

    it('ruolo già presente per la ditta: 400 "Esiste già un agente per questa ditta"', async () => {
      tx.agente.findFirst.mockReset()
      tx.agente.findFirst.mockResolvedValue({ id: 'altro' })
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toBe('Esiste già un agente per questa ditta')
      expect(tx.agente.create).not.toHaveBeenCalled()
    })

    it('codice non valido: 400 AGENTE_NON_VALIDO senza toccare la ditta', async () => {
      const e = await errore(service.crea(T, U, { ...dati, codice: 'a b!' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('AGENTE_NON_VALIDO')
      expect(e.getResponse().message[0]).toContain('Il codice agente')
      expect(ditte.risolviPerRuolo).not.toHaveBeenCalled()
    })

    it('codice e note vuoti diventano assenti', async () => {
      await service.crea(T, U, { ...dati, codice: '  ', note: '' })
      expect(tx.agente.create.mock.calls[0][0].data).toMatchObject({ codice: null, note: null })
    })

    it('sedeId non attiva o di un’altra ditta: 400 sede non valida, niente scrittura', async () => {
      tx.sedeDitta.findFirst.mockResolvedValue(null)
      const e = await errore(service.crea(T, U, { ...dati, sedeId: S2 }))
      expect(e).toBeInstanceOf(SedeNonValidaPerRuoloError)
      expect(e.message).toBe("La sede indicata non è una sede attiva dell'agente scelto")
      expect(tx.agente.create).not.toHaveBeenCalled()
    })

    it('sedeId valida: è la sede predefinita dell’agente', async () => {
      await service.crea(T, U, { ...dati, sedeId: S2 })
      expect(tx.sedeDitta.findFirst.mock.calls[0][0].where).toMatchObject({
        id: S2,
        dittaId: D,
        tenantId: T,
        attiva: true,
      })
      expect(tx.agente.create.mock.calls[0][0].data.sedeId).toBe(S2)
    })

    it('P2002 sul codice (target col nome): 409 AGENTE_CODICE_DUPLICATO', async () => {
      tx.agente.create.mockRejectedValue(errP('P2002', { target: 'agenti_tenant_id_codice_key' }))
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('AGENTE_CODICE_DUPLICATO')
    })

    it('P2002 senza target (RLS) con codice già di un altro: riletto, 409 del codice', async () => {
      tx.agente.create.mockRejectedValue(errP('P2002', { target: null }))
      tx.agente.findFirst.mockReset()
      // controllo del ruolo (nessuno), poi `rileggiVincolo` trova un altro agente col codice
      tx.agente.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'altro' })
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('AGENTE_CODICE_DUPLICATO')
      expect(tx.agente.findFirst.mock.calls[1][0].where).toMatchObject({
        tenantId: T,
        codice: 'AG1',
      })
    })

    it('P2002 senza target (RLS) e codice libero: è il vincolo della ditta, 400 del ruolo presente', async () => {
      tx.agente.create.mockRejectedValue(errP('P2002', { target: null }))
      tx.agente.findFirst.mockReset()
      tx.agente.findFirst.mockResolvedValue(null)
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toBe('Esiste già un agente per questa ditta')
    })

    it('P2002 sulla ditta (target col nome): 400 del ruolo presente', async () => {
      tx.agente.create.mockRejectedValue(errP('P2002', { target: ['tenant_id', 'ditta_id'] }))
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toBe('Esiste già un agente per questa ditta')
    })
  })

  describe('list / getById', () => {
    it('conta clienti e contratti con tre groupBy per tutta la pagina', async () => {
      tx.cliente.groupBy.mockResolvedValue([{ agenteId: A, _count: { _all: 2 } }])
      tx.contrattoCliente.groupBy
        .mockResolvedValueOnce([{ agenteId: A, _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ agenteId: A, _count: { _all: 3 } }])
      const r = await service.list(T, { pagina: 1, dimensione: 25 })
      expect(r.totale).toBe(1)
      expect(r.elementi[0]).toMatchObject({ clienti: 2, contratti: 1, eliminabile: false })
      expect(tx.cliente.groupBy).toHaveBeenCalledTimes(1)
      expect(tx.contrattoCliente.groupBy).toHaveBeenCalledTimes(2)
      expect(tx.contrattoCliente.groupBy.mock.calls[0][0].where).toMatchObject({
        eliminatoIl: null,
      })
    })

    it('un agente citato solo da contratti eliminati: contratti 0 ma non eliminabile (R25)', async () => {
      tx.contrattoCliente.groupBy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ agenteId: A, _count: { _all: 1 } }])
      const [v] = (await service.list(T, { pagina: 1, dimensione: 25 })).elementi
      expect(v).toMatchObject({ clienti: 0, contratti: 0, eliminabile: false })
    })

    it('nessun riferimento: eliminabile; la sede è nel formato SedeDto (citta)', async () => {
      const v = await service.getById(T, A)
      expect(v).toMatchObject({
        eliminabile: true,
        ditta: { id: D, ragioneSociale: 'Agenzia Rossi' },
        sede: { id: S, citta: 'Roma', principale: true, attiva: true },
      })
    })

    it('pagina, dimensione, testo e soloAttivi arrivano alla query', async () => {
      await service.list(T, { pagina: 3, dimensione: 10, testo: ' rossi ', soloAttivi: true })
      const q = tx.agente.findMany.mock.calls[0][0]
      expect(q).toMatchObject({ skip: 20, take: 10 })
      expect(q.where).toMatchObject({ tenantId: T, attivo: true })
      expect(JSON.stringify(q.where.OR)).toContain('rossi')
      expect(JSON.stringify(q.where.OR)).not.toContain(' rossi ')
    })

    it('getById: non trovato = 404 AGENTE_NON_TROVATO', async () => {
      tx.agente.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, A))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('AGENTE_NON_TROVATO')
    })
  })

  describe('modifica', () => {
    it('versione diversa: 409 AGENTE_MODIFICATO_NEL_FRATTEMPO senza scrivere', async () => {
      const e = await errore(service.modifica(T, U, A, { note: 'x', versione: 5 }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('AGENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.agente.updateMany).not.toHaveBeenCalled()
    })

    it('nessun cambiamento: niente scrittura né audit', async () => {
      await service.modifica(T, U, A, { codice: 'AG1', versione: 1 })
      expect(tx.agente.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('modifica codice e note: versione incrementata, audit AGENTE_MODIFICATO con i soli nomi dei campi', async () => {
      await service.modifica(T, U, A, { codice: 'AG2', note: 'Nuove note', versione: 1 })
      const w = tx.agente.updateMany.mock.calls[0][0]
      expect(w.where).toEqual({ id: A, tenantId: T, versione: 1 })
      expect(w.data).toEqual({ codice: 'AG2', note: 'Nuove note', versione: { increment: 1 } })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ action: 'AGENTE_MODIFICATO', userId: U })
      expect(audit.metadata).toEqual({ agenteId: A, campi: ['codice', 'note'] })
      expect(JSON.stringify(audit)).not.toContain('Nuove note')
    })

    it('note null toglie le note; campo assente lascia invariato', async () => {
      tx.agente.findFirst.mockResolvedValue(riga({ note: 'Vecchie' }))
      await service.modifica(T, U, A, { note: null, versione: 1 })
      expect(tx.agente.updateMany.mock.calls[0][0].data).toEqual({
        note: null,
        versione: { increment: 1 },
      })
      tx.agente.updateMany.mockClear()
      await service.modifica(T, U, A, { codice: 'AG9', versione: 1 })
      expect(tx.agente.updateMany.mock.calls[0][0].data).toEqual({
        codice: 'AG9',
        versione: { increment: 1 },
      })
    })

    it('codice null toglie il codice', async () => {
      await service.modifica(T, U, A, { codice: null, versione: 1 })
      expect(tx.agente.updateMany.mock.calls[0][0].data.codice).toBeNull()
    })

    it('disattiva: audit AGENTE_DISATTIVATO; riattiva: AGENTE_RIATTIVATO', async () => {
      await service.modifica(T, U, A, { attivo: false, versione: 1 })
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'AGENTE_DISATTIVATO',
        metadata: { agenteId: A },
      })
      tx.agente.findFirst.mockResolvedValue(riga({ attivo: false }))
      tx.activityLog.create.mockClear()
      await service.modifica(T, U, A, { attivo: true, versione: 1 })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('AGENTE_RIATTIVATO')
    })

    it('sedeId non valida: 400 sede non valida per il ruolo', async () => {
      tx.sedeDitta.findFirst.mockResolvedValue(null)
      const e = await errore(service.modifica(T, U, A, { sedeId: S2, versione: 1 }))
      expect(e).toBeInstanceOf(SedeNonValidaPerRuoloError)
      expect(tx.agente.updateMany).not.toHaveBeenCalled()
    })

    it('sedeId valida: cambia la sede predefinita', async () => {
      await service.modifica(T, U, A, { sedeId: S2, versione: 1 })
      expect(tx.agente.updateMany.mock.calls[0][0].data.sedeId).toBe(S2)
    })

    it('codice non valido: 400 AGENTE_NON_VALIDO', async () => {
      const e = await errore(service.modifica(T, U, A, { codice: 'no no', versione: 1 }))
      expect(e.getResponse().error).toBe('AGENTE_NON_VALIDO')
    })

    it('P2002 senza target (RLS): riletto, 409 AGENTE_CODICE_DUPLICATO', async () => {
      tx.agente.updateMany.mockRejectedValue(errP('P2002', { target: null }))
      const e = await errore(service.modifica(T, U, A, { codice: 'AG2', versione: 1 }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('AGENTE_CODICE_DUPLICATO')
    })

    it('scrittura che non tocca righe (modificato nel frattempo): 409', async () => {
      tx.agente.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.modifica(T, U, A, { note: 'x', versione: 1 }))
      expect(e.getResponse().error).toBe('AGENTE_MODIFICATO_NEL_FRATTEMPO')
    })

    it('non trovato: 404', async () => {
      tx.agente.findFirst.mockResolvedValue(null)
      expect((await errore(service.modifica(T, U, A, { versione: 1 }))).getResponse().error).toBe(
        'AGENTE_NON_TROVATO'
      )
    })
  })

  describe('elimina', () => {
    it('elimina con la versione e scrive AGENTE_ELIMINATO', async () => {
      await service.elimina(T, U, A, 1)
      expect(tx.agente.deleteMany.mock.calls[0][0].where).toEqual({
        id: A,
        tenantId: T,
        versione: 1,
      })
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'AGENTE_ELIMINATO',
        metadata: { agenteId: A, dittaId: D },
      })
    })

    it('citato da clienti o contratti (P2003): 409 AGENTE_IN_USO con il testo di D13', async () => {
      tx.agente.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, A, 1))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({
        error: 'AGENTE_IN_USO',
        message: "L'agente è indicato su clienti o contratti: disattivalo invece di eliminarlo.",
      })
    })

    it('versione diversa: 409 senza cancellare', async () => {
      const e = await errore(service.elimina(T, U, A, 9))
      expect(e.getResponse().error).toBe('AGENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.agente.deleteMany).not.toHaveBeenCalled()
    })
  })

  describe('attiviPerId', () => {
    it('mappa id -> { id, attivo } dell’azienda corrente; lista vuota senza query', async () => {
      tx.agente.findMany.mockResolvedValue([{ id: A, attivo: false }])
      const m = await TenantContext.run({ tenantId: T }, () => service.attiviPerId(tx, [A, S]))
      expect(m.get(A)).toEqual({ id: A, attivo: false })
      expect(m.has(S)).toBe(false)
      expect(tx.agente.findMany.mock.calls[0][0].where).toEqual({ tenantId: T, id: { in: [A, S] } })
      tx.agente.findMany.mockClear()
      expect(
        (await TenantContext.run({ tenantId: T }, () => service.attiviPerId(tx, []))).size
      ).toBe(0)
      expect(tx.agente.findMany).not.toHaveBeenCalled()
    })
  })
})
