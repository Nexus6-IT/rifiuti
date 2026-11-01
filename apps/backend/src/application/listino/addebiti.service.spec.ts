import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AddebitiService } from './addebiti.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const A = 'cccccccc-0000-4000-8000-000000000003'
const G = '11111111-0000-4000-8000-000000000001'
const I = '33333333-0000-4000-8000-000000000003'
const CAT = '44444444-0000-4000-8000-000000000004'

const rif = (id: string, codice = '001') => ({ id, codice, descrizione: `Rif ${codice}` })

const sei = (extra: Record<number, Record<string, unknown>> = {}) =>
  [1, 2, 3, 4, 5, 6].map(numero => ({
    id: `p${numero}`,
    tenantId: T,
    addebitoId: A,
    numero,
    prezzo: null,
    sconto: null,
    provvigione: null,
    ...(extra[numero] ?? {}),
  }))

const riga = (extra: Record<string, unknown> = {}) => ({
  id: A,
  tenantId: T,
  codice: '00001',
  descrizione: 'Trasporto',
  gruppoId: G,
  unitaMisura: 'KG',
  codiceIvaId: I,
  tipo: 'V',
  categoriaId: null,
  tipoProvvigione: 'SCONTATO',
  centroRicavoId: null,
  categoriaStatistica1Id: null,
  categoriaStatistica2Id: null,
  notaUsoInterno: 'nota riservata',
  appunti: 'appunti riservati',
  attivo: true,
  versione: 1,
  gruppo: rif(G),
  codiceIva: rif(I, '22'),
  categoria: null,
  centroRicavo: null,
  categoriaStatistica1: null,
  categoriaStatistica2: null,
  listini: sei(),
  ...extra,
})

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

const nuovo = (extra: Record<string, unknown> = {}) => ({
  descrizione: 'Trasporto',
  gruppoId: G,
  unitaMisura: 'kg',
  ...extra,
})

describe('AddebitiService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let service: AddebitiService
  /** Risposte di $queryRaw per tabella (riconosciuta dal testo SQL). */
  let sql: { codici: unknown[]; iva: unknown[]; codifiche: unknown[]; testi: string[] }

  beforeEach(() => {
    sql = {
      codici: [],
      iva: [{ id: I, attivo: true }],
      codifiche: [{ id: G, attivo: true, genere: 'GRUPPO' }],
      testi: [],
    }
    tx = {
      addebito: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn(async ({ data }: any) => riga({ id: A, codice: data.codice })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      prezzoListinoAddebito: {
        deleteMany: jest.fn().mockResolvedValue({ count: 6 }),
        createMany: jest.fn().mockResolvedValue({ count: 6 }),
      },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const s = strings.join('?')
        sql.testi.push(s)
        if (s.includes('FROM addebiti')) return sql.codici
        if (s.includes('codici_iva')) return sql.iva
        return sql.codifiche
      }),
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new AddebitiService(prisma)
  })

  describe('lettura', () => {
    it('vista: sempre sei listini, vuoti null, prezzi nella forma d’uscita, etichetta del tipo', async () => {
      tx.addebito.findFirst.mockResolvedValue(
        riga({
          listini: sei({ 2: { prezzo: new Prisma.Decimal('10.500000'), sconto: '10+5' } }),
        })
      )
      const v = await service.getById(T, A)
      expect(v.listini).toHaveLength(6)
      expect(v.listini[0]).toEqual({ numero: 1, prezzo: null, sconto: null, provvigione: null })
      expect(v.listini[1]).toEqual({
        numero: 2,
        prezzo: '10.50',
        sconto: '10+5',
        provvigione: null,
      })
      expect(v).toMatchObject({
        codice: '00001',
        gruppo: rif(G),
        codiceIva: rif(I, '22'),
        categoria: null,
        tipo: 'V',
        eliminabile: true,
        versione: 1,
      })
      expect(typeof v.etichettaTipo).toBe('string')
      expect(v.etichettaTipo.length).toBeGreaterThan(0)
    })

    it('non trovato: 404 con codice ADDEBITO_NON_TROVATO', async () => {
      tx.addebito.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, A))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('ADDEBITO_NON_TROVATO')
    })

    it('list: filtro testo su codice e descrizione, tipo, soloAttivi, paginazione e totale', async () => {
      tx.addebito.count.mockResolvedValue(41)
      const r = await service.list(T, {
        testo: '  trasp ',
        tipo: 'V',
        soloAttivi: true,
        pagina: 3,
        dimensione: 10,
      })
      expect(r.totale).toBe(41)
      expect(r.elementi).toHaveLength(1)
      const a = tx.addebito.findMany.mock.calls[0][0]
      expect(a.where).toEqual({
        tenantId: T,
        attivo: true,
        tipo: 'V',
        OR: [
          { codice: { contains: 'trasp', mode: 'insensitive' } },
          { descrizione: { contains: 'trasp', mode: 'insensitive' } },
        ],
      })
      expect(a.skip).toBe(20)
      expect(a.take).toBe(10)
      expect(tx.addebito.count.mock.calls[0][0].where).toEqual(a.where)
    })

    it('list senza filtri: solo l’azienda', async () => {
      await service.list(T, { pagina: 1, dimensione: 25 })
      expect(tx.addebito.findMany.mock.calls[0][0].where).toEqual({ tenantId: T })
    })

    it('prossimo-codice: primo libero a cinque cifre, 00000 escluso', async () => {
      sql.codici = [{ codice: '00001' }, { codice: '00002' }, { codice: '00004' }]
      expect(await service.prossimoCodice(T)).toBe('00003')
    })

    it('prossimo-codice senza addebiti: 00001; esauriti: 400', async () => {
      expect(await service.prossimoCodice(T)).toBe('00001')
      sql.codici = Array.from({ length: 99999 }, (_, i) => ({
        codice: String(i + 1).padStart(5, '0'),
      }))
      const e = await errore(service.prossimoCodice(T))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('ADDEBITO_CODICI_ESAURITI')
    })
  })

  describe('crea', () => {
    it('con codice: normalizza a cinque cifre, sei listini in blocco, audit senza appunti né nota', async () => {
      await service.crea(
        T,
        U,
        nuovo({
          codice: '12',
          appunti: 'dato riservato',
          notaUsoInterno: 'altro riservato',
          listini: [{ numero: 2, prezzo: '10,5', sconto: '10+5', provvigione: null }],
        })
      )
      const data = tx.addebito.create.mock.calls[0][0].data
      expect(data).toMatchObject({
        tenantId: T,
        codice: '00012',
        unitaMisura: 'KG',
        tipo: 'V',
        tipoProvvigione: 'SCONTATO',
        attivo: true,
      })
      const listini = tx.prezzoListinoAddebito.createMany.mock.calls[0][0].data
      expect(listini).toHaveLength(6)
      expect(listini[1]).toMatchObject({
        tenantId: T,
        addebitoId: A,
        numero: 2,
        prezzo: '10.5',
        sconto: '10+5',
      })
      expect(listini[0]).toMatchObject({ numero: 1, prezzo: null })
      const log = tx.activityLog.create.mock.calls[0][0].data
      expect(log).toMatchObject({ tenantId: T, userId: U, action: 'ADDEBITO_CREATO' })
      const json = JSON.stringify(log)
      expect(json).not.toContain('riservato')
      expect(json).not.toContain('appunti')
      expect(json).not.toContain('notaUsoInterno')
      expect(json).not.toContain('Trasporto')
    })

    it('senza codice: primo libero letto con FOR UPDATE; attivo omesso = true', async () => {
      sql.codici = [{ codice: '00001' }]
      await service.crea(T, U, nuovo())
      expect(tx.addebito.create.mock.calls[0][0].data).toMatchObject({
        codice: '00002',
        attivo: true,
      })
      expect(sql.testi.find(s => s.includes('FROM addebiti'))).toContain('FOR UPDATE')
    })

    it('senza codice, P2002: nuovo tentativo in una transazione nuova che prende il successivo', async () => {
      tx.addebito.create
        .mockRejectedValueOnce(errP('P2002'))
        .mockImplementationOnce(async ({ data }: any) => riga({ codice: data.codice }))
      await service.crea(T, U, nuovo())
      expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    })

    it('con codice duplicato: 409 ADDEBITO_CODICE_DUPLICATO senza nuovo tentativo', async () => {
      tx.addebito.create.mockRejectedValue(errP('P2002'))
      const e = await errore(service.crea(T, U, nuovo({ codice: '1' })))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('ADDEBITO_CODICE_DUPLICATO')
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('dati non validi: 400 con l’elenco, prima di toccare il database', async () => {
      const e = await errore(service.crea(T, U, { descrizione: '', unitaMisura: '' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('ADDEBITO_NON_VALIDO')
      expect(e.getResponse().message).toContain("Inserisci la descrizione dell'addebito.")
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('sconto non valido nel listino: 400 (cascataValida, mai DecimalError)', async () => {
      const e = await errore(
        service.crea(T, U, nuovo({ listini: [{ numero: 1, prezzo: '1', sconto: 'abc' }] }))
      )
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message[0]).toContain('Listino 1')
    })

    it('categoria al posto del gruppo: 400 con il messaggio del gruppo; letture FOR SHARE', async () => {
      sql.codifiche = [{ id: G, attivo: true, genere: 'CATEGORIA' }]
      const e = await errore(service.crea(T, U, nuovo({ codice: '5' })))
      expect(e.getResponse().message).toEqual([
        'Il gruppo scelto non esiste, è disattivato o non è un gruppo.',
      ])
      for (const s of sql.testi.filter(s => s.includes('codici_iva') || s.includes('codifiche'))) {
        expect(s).toContain('FOR SHARE')
      }
      expect(tx.addebito.create).not.toHaveBeenCalled()
    })

    it('codice IVA disattivato: 400', async () => {
      sql.iva = [{ id: I, attivo: false }]
      const e = await errore(service.crea(T, U, nuovo({ codice: '5', codiceIvaId: I })))
      expect(e.getResponse().message).toEqual(['Il codice IVA scelto non esiste o è disattivato.'])
    })
  })

  describe('modifica', () => {
    it('versione diversa: 409 prima di validare', async () => {
      const e = await errore(service.modifica(T, U, A, { versione: 7, descrizione: 'x' }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('ADDEBITO_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.addebito.updateMany).not.toHaveBeenCalled()
    })

    it('non trovato: 404', async () => {
      tx.addebito.findFirst.mockResolvedValue(null)
      const e = await errore(service.modifica(T, U, A, { versione: 1, descrizione: 'x' }))
      expect(e).toBeInstanceOf(NotFoundException)
    })

    it('campi e listini nella STESSA scrittura condizionata alla versione; listini sostituiti in blocco', async () => {
      await service.modifica(T, U, A, {
        versione: 1,
        descrizione: 'Nuovo nome',
        listini: [{ numero: 3, prezzo: '4', sconto: null, provvigione: '5' }],
      })
      const u = tx.addebito.updateMany.mock.calls[0][0]
      expect(u.where).toEqual({ id: A, tenantId: T, versione: 1 })
      expect(u.data).toMatchObject({ descrizione: 'Nuovo nome', versione: { increment: 1 } })
      expect(tx.prezzoListinoAddebito.deleteMany).toHaveBeenCalledWith({
        where: { addebitoId: A, tenantId: T },
      })
      const creati = tx.prezzoListinoAddebito.createMany.mock.calls[0][0].data
      expect(creati).toHaveLength(6)
      expect(creati[2]).toMatchObject({ numero: 3, prezzo: '4', provvigione: '5', addebitoId: A })
      // la riga dell'addebito si scrive PRIMA delle figlie (se la versione e' cambiata niente si tocca)
      expect(tx.addebito.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.prezzoListinoAddebito.deleteMany.mock.invocationCallOrder[0]
      )
      const log = tx.activityLog.create.mock.calls[0][0].data
      expect(log.action).toBe('ADDEBITO_MODIFICATO')
      expect(log.metadata.campi).toEqual(['descrizione', 'listini'])
    })

    it('solo listini: la versione sale comunque e non si riscrivono i campi', async () => {
      await service.modifica(T, U, A, {
        versione: 1,
        listini: [{ numero: 1, prezzo: '2', sconto: null, provvigione: null }],
      })
      expect(tx.addebito.updateMany.mock.calls[0][0].data).toEqual({ versione: { increment: 1 } })
    })

    it('listino con stesso valore in altra forma ("10.5" vs "10.50"): nessun cambiamento', async () => {
      tx.addebito.findFirst.mockResolvedValue(
        riga({ listini: sei({ 1: { prezzo: new Prisma.Decimal('10.500000') } }) })
      )
      await service.modifica(T, U, A, {
        versione: 1,
        listini: [{ numero: 1, prezzo: '10.5', sconto: null, provvigione: null }],
      })
      expect(tx.addebito.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('nessun cambiamento: nessuna scrittura né audit', async () => {
      await service.modifica(T, U, A, { versione: 1, descrizione: 'Trasporto' })
      expect(tx.addebito.updateMany).not.toHaveBeenCalled()
    })

    it('scrittura condizionata a zero righe: 409', async () => {
      tx.addebito.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.modifica(T, U, A, { versione: 1, descrizione: 'x' }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(tx.prezzoListinoAddebito.deleteMany).not.toHaveBeenCalled()
    })

    it('riferimenti: si controllano solo quelli cambiati e non null', async () => {
      sql.codifiche = [{ id: CAT, attivo: true, genere: 'CATEGORIA' }]
      await service.modifica(T, U, A, { versione: 1, categoriaId: CAT })
      const codifiche = sql.testi.filter(s => s.includes('codifiche_addebito'))
      expect(codifiche).toHaveLength(1)
      expect(sql.testi.some(s => s.includes('codici_iva'))).toBe(false)
    })

    it('null azzera un riferimento facoltativo e non lo controlla', async () => {
      tx.addebito.findFirst.mockResolvedValue(riga({ categoriaId: CAT, categoria: rif(CAT) }))
      await service.modifica(T, U, A, { versione: 1, categoriaId: null })
      expect(tx.addebito.updateMany.mock.calls[0][0].data.categoriaId).toBeNull()
      expect(sql.testi.some(s => s.includes('codifiche_addebito'))).toBe(false)
    })

    it('codice vuoto in modifica: 400 col messaggio del codice', async () => {
      const e = await errore(service.modifica(T, U, A, { versione: 1, codice: '' }))
      expect(e.getResponse().message).toEqual(['Il codice ha da 1 a 5 cifre.'])
    })

    it('codice duplicato: 409 ADDEBITO_CODICE_DUPLICATO', async () => {
      tx.addebito.updateMany.mockRejectedValue(errP('P2002'))
      const e = await errore(service.modifica(T, U, A, { versione: 1, codice: '2' }))
      expect(e.getResponse().error).toBe('ADDEBITO_CODICE_DUPLICATO')
    })

    it('unità di misura incompatibile col tipo T: 400', async () => {
      const e = await errore(
        service.modifica(T, U, A, { versione: 1, tipo: 'TS', unitaMisura: 'PZ' })
      )
      expect(e.getResponse().message).toContain(
        "Per gli addebiti di tipo T l'unità di misura è KG o TON."
      )
    })
  })

  describe('elimina', () => {
    it('elimina fisica con audit', async () => {
      await service.elimina(T, U, A, 1)
      expect(tx.addebito.deleteMany).toHaveBeenCalledWith({
        where: { id: A, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('ADDEBITO_ELIMINATO')
    })

    it('versione diversa: 409; non trovato: 404', async () => {
      const e = await errore(service.elimina(T, U, A, 9))
      expect(e).toBeInstanceOf(ConflictException)
      tx.addebito.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, A, 1))).toBeInstanceOf(NotFoundException)
    })

    it('citato altrove (P2003): 409 col testo intero di R9', async () => {
      tx.addebito.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, A, 1))
      expect(e.getResponse()).toEqual({
        error: 'ADDEBITO_IN_USO',
        message: "L'addebito è usato da elenchi di addebito: disattivalo invece di eliminarlo.",
      })
    })
  })
})
