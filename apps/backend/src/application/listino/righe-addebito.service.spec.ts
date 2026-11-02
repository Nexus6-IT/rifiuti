import { Prisma } from '@prisma/client'
import { RigheAddebitoService } from './righe-addebito.service'

const errP2002 = () =>
  new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 'test' })

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const E = 'dddddddd-0000-4000-8000-000000000004'
const R = 'eeeeeeee-0000-4000-8000-000000000005'
const A = 'ffffffff-0000-4000-8000-000000000006'
const I = '11111111-0000-4000-8000-000000000007'
const CLI = '22222222-0000-4000-8000-000000000008'

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

/** Riga come la restituisce Prisma con l'INCLUDE del servizio. */
const rigaDb = (extra: Record<string, unknown> = {}) => ({
  id: R,
  tenantId: T,
  elencoId: E,
  tipo: 'CER',
  cerCode: '20 03 01',
  addebitoId: null,
  riferimento: null,
  descrizione: null,
  tipoQuantita: 'PESO_NETTO',
  quantitaFissa: null,
  unitaMisura: 'KG',
  prezzo: new Prisma.Decimal('1'),
  prezzoSpeciale: false,
  sconto: null,
  provvigione: null,
  tipoProvvigione: null,
  codiceIvaId: I,
  tipologiaRifiuto: 'URBANO',
  statoFisico: null,
  operazione: null,
  categoriaId: null,
  centroRicavoId: null,
  applicaA: null,
  condizioniRiferite: null,
  condizione: null,
  minimoFatturabile: null,
  minimoPerCategoria: false,
  riferimentoGiorno: null,
  riferimentoMese: null,
  periodoScadenze: null,
  periodoExtraDal: null,
  periodoExtraAl: null,
  cerProposta: [],
  addebitiProposti: [],
  stimaAnnuaKg: null,
  appunti: null,
  notaUsoInterno: null,
  versione: 1,
  addebito: null,
  codiceIva: { id: I, codice: '22', descrizione: 'IVA 22' },
  categoria: null,
  centroRicavo: null,
  scaglioni: [],
  scadenze: [],
  elenco: {
    codice: '001',
    contratto: {
      id: C,
      numero: 'CC-1',
      dataInizio: new Date('2026-01-01T00:00:00Z'),
      dataFine: null,
    },
  },
  ...extra,
})

describe('RigheAddebitoService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let service: RigheAddebitoService
  let stato: string
  let catalogo: string[]
  let principale: string | null
  let elencoBloccabile: boolean

  beforeEach(() => {
    stato = 'ATTIVO'
    principale = null
    elencoBloccabile = true
    catalogo = ['20 03 01', '20 01 21*']
    tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        const s = strings.join('?')
        if (s.includes('contratti_cliente')) {
          return [
            { id: C, numero: 'CC-1', stato, clienteId: CLI, contrattoPrincipaleId: principale },
          ]
        }
        if (s.includes('elenchi_addebiti')) return elencoBloccabile ? [{ id: E }] : []
        if (s.includes('codici_iva')) return [{ id: I, attivo: true }]
        if (s.includes('"addebiti"')) return [{ attivo: true, tipo: 'V' }]
        return []
      }),
      $executeRaw: jest.fn().mockResolvedValue(1),
      contrattoCliente: { findFirst: jest.fn().mockResolvedValue({ clienteId: CLI }) },
      cliente: {
        findFirst: jest.fn().mockResolvedValue({
          listino: null,
          provvigionePredefinita: null,
          tipoProvvigionePredefinita: null,
        }),
      },
      elencoAddebiti: {
        findFirst: jest.fn().mockResolvedValue({ contrattoId: C, codice: '001', id: E }),
      },
      cERCode: {
        findMany: jest.fn(async ({ where }: any) =>
          catalogo.filter(c => where.code.in.includes(c)).map(code => ({ code }))
        ),
        findFirst: jest.fn().mockResolvedValue({ description: 'Rifiuti urbani indifferenziati' }),
      },
      rentriCodificaSemplice: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ externalId: '2', name: 'Liquido' }]),
      },
      addebito: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      rigaAddebito: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async () => ({ id: R })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      scaglioneRigaAddebito: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      scadenzaRigaAddebito: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new RigheAddebitoService(prisma)
    // Riga appena scritta: la rilettura (dopo create/update) la restituisce.
    tx.rigaAddebito.findFirst.mockImplementation(async ({ where, include }: any) =>
      include && where.id === R ? rigaDb() : null
    )
  })

  const corpoCer = (extra: Record<string, unknown> = {}) => ({
    tipo: 'CER',
    cerCode: '200301',
    tipoQuantita: 'PESO_NETTO',
    unitaMisura: 'KG',
    prezzo: '1',
    codiceIvaId: I,
    ...extra,
  })

  describe('crea', () => {
    it('scrive il CER nella forma del catalogo e propone la tipologia dal CER del catalogo', async () => {
      await service.crea(T, U, E, corpoCer({ cerCode: '200121' }))
      const data = tx.rigaAddebito.create.mock.calls[0][0].data
      expect(data).toMatchObject({
        tenantId: T,
        elencoId: E,
        tipo: 'CER',
        cerCode: '20 01 21*',
        tipologiaRifiuto: 'URBANO_PERICOLOSO',
        riferimento: null,
      })
    })

    it('legge il CER del catalogo PRIMA di normalizzare, sul CER scritto', async () => {
      await service.crea(T, U, E, corpoCer({ cerCode: '20 01 21' }))
      expect(tx.cERCode.findMany).toHaveBeenCalled()
      const candidati = tx.cERCode.findMany.mock.calls[0][0].where.code.in
      expect(candidati).toEqual(expect.arrayContaining(['20 01 21', '20 01 21*']))
    })

    it('CER non nel catalogo: 400 R36 con il messaggio sul campo cerCode, nessuna scrittura', async () => {
      const e = await errore(service.crea(T, U, E, corpoCer({ cerCode: '200399' })))
      expect(e.getStatus()).toBe(400)
      expect(e.getResponse()).toMatchObject({
        error: 'RIGA_ADDEBITO_NON_VALIDA',
        errori: [{ campo: 'cerCode', messaggio: expect.stringContaining('non è nel catalogo') }],
      })
      expect(e.getResponse().message).toEqual([expect.stringContaining('non è nel catalogo')])
      // Copia che il filtro globale inoltra al client.
      expect(e.getResponse().details.errori).toEqual(e.getResponse().errori)
      expect(tx.rigaAddebito.create).not.toHaveBeenCalled()
    })

    it('errori del dominio e dei riferimenti insieme, ciascuno col suo campo', async () => {
      tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
        strings.join('?').includes('contratti_cliente')
          ? [{ id: C, numero: 'CC-1', stato, clienteId: CLI, contrattoPrincipaleId: null }]
          : strings.join('?').includes('elenchi_addebiti')
            ? [{ id: E }]
            : []
      )
      const e = await errore(service.crea(T, U, E, corpoCer({ prezzo: undefined })))
      const campi = e.getResponse().errori.map((x: any) => x.campo)
      expect(campi).toEqual(expect.arrayContaining(['prezzo', 'codiceIvaId']))
    })

    it("riferimento '' diventa null (il CHECK del database respinge '')", async () => {
      await service.crea(T, U, E, corpoCer({ riferimento: '' }))
      expect(tx.rigaAddebito.create.mock.calls[0][0].data.riferimento).toBeNull()
    })

    it('m2: elenco eliminato fra la lettura e il lock: 404 vero, non "riga usata da movimenti"', async () => {
      elencoBloccabile = false
      const e = await errore(service.crea(T, U, E, corpoCer()))
      expect(e.getStatus()).toBe(404)
      expect(e.getResponse()).toMatchObject({ error: 'ELENCO_ADDEBITI_NON_TROVATO' })
      expect(tx.rigaAddebito.create).not.toHaveBeenCalled()
    })

    it('m10: P2002 dell’indice unico (target nullo con la RLS) diventa 409 RIGA_ADDEBITO_DUPLICATA', async () => {
      tx.rigaAddebito.create.mockRejectedValue(errP2002())
      const e = await errore(service.crea(T, U, E, corpoCer()))
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'RIGA_ADDEBITO_DUPLICATA' })
    })

    it('I3: campi obbligatori null: errori per campo, mai un errore della pipe', async () => {
      const e = await errore(
        service.crea(T, U, E, corpoCer({ unitaMisura: null, codiceIvaId: null, cerProposta: null }))
      )
      expect(e.getResponse().errori).toEqual(
        expect.arrayContaining([
          { campo: 'unitaMisura', messaggio: 'Indica l’unità di misura.' },
          { campo: 'codiceIvaId', messaggio: 'Indica il codice IVA.' },
        ])
      )
    })

    it('m5: cerProposta nella forma del catalogo', async () => {
      await service.crea(T, U, E, {
        tipo: 'V',
        addebitoId: A,
        tipoQuantita: 'UNO',
        unitaMisura: 'NR',
        prezzo: '1',
        codiceIvaId: I,
        cerProposta: ['200121', '200301/R1'],
      })
      expect(tx.rigaAddebito.create.mock.calls[0][0].data.cerProposta).toEqual([
        '20 01 21*',
        '20 03 01/R1',
      ])
    })

    it('contratto annullato: 409 LISTINO_NON_MODIFICABILE, prima di tutto il resto', async () => {
      stato = 'ANNULLATO'
      const e = await errore(service.crea(T, U, E, corpoCer()))
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'LISTINO_NON_MODIFICABILE' })
      expect(tx.cERCode.findMany).not.toHaveBeenCalled()
    })

    it('contratto allegato (D17): niente CER, 400 sul tipo', async () => {
      principale = 'ffffffff-0000-4000-8000-0000000000aa'
      const e = await errore(service.crea(T, U, E, corpoCer()))
      expect(e.getResponse().errori).toEqual([
        { campo: 'tipo', messaggio: 'In un contratto allegato non si inseriscono righe CER.' },
      ])
    })

    it('elenco di un altro contratto eliminato o di un’altra azienda: 404', async () => {
      tx.elencoAddebiti.findFirst.mockResolvedValue(null)
      const e = await errore(service.crea(T, U, E, corpoCer()))
      expect(e.getStatus()).toBe(404)
      expect(e.getResponse()).toMatchObject({ error: 'ELENCO_ADDEBITI_NON_TROVATO' })
    })

    it('audit con id, numero del contratto, tipo e CER, senza appunti né note', async () => {
      await service.crea(T, U, E, corpoCer({ appunti: 'riservato', notaUsoInterno: 'interno' }))
      const meta = tx.activityLog.create.mock.calls[0][0].data.metadata
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('RIGA_ADDEBITO_CREATA')
      expect(meta).toMatchObject({ numeroContratto: 'CC-1', tipo: 'CER', codiceElenco: '001' })
      expect(JSON.stringify(meta)).not.toMatch(/riservato|interno/)
    })

    it('lock consultivi di R40: contratto per M…, cliente solo per $D con #', async () => {
      tx.$queryRaw.mockClear()
      // I lock si prendono prima della validazione: l'esito della creazione non conta qui.
      await service.crea(T, U, E, { tipo: 'MW', unitaMisura: 'EUR' }).catch(() => undefined)
      const sql = tx.$executeRaw.mock.calls.map((c: any) => c[0].join('?'))
      expect(sql).toHaveLength(1)
      expect(sql[0]).toContain('listino-contratto')
      tx.$executeRaw.mockClear()
      await service.crea(T, U, E, { tipo: '$D', unitaMisura: '#' }).catch(() => undefined)
      const sql2 = tx.$executeRaw.mock.calls.map((c: any) => c[0].join('?'))
      expect(sql2[0]).toContain('listino-cliente')
      expect(sql2[1]).toContain('listino-contratto')
      tx.$executeRaw.mockClear()
      await service.crea(T, U, E, corpoCer())
      expect(tx.$executeRaw).not.toHaveBeenCalled()
    })
  })

  describe('modifica', () => {
    beforeEach(() => {
      tx.rigaAddebito.findFirst.mockImplementation(async ({ where, include, select }: any) => {
        if (where.id !== R) return null
        if (select) {
          return { elencoId: E, tipo: 'CER', unitaMisura: 'KG', elenco: { contrattoId: C } }
        }
        return include ? rigaDb({ tipologiaRifiuto: 'SPECIALE' }) : null
      })
    })

    it('stessa versione e stesso CER rimandato: la tipologia scelta a mano NON si sovrascrive', async () => {
      const r = await service.modifica(T, U, R, { versione: 1, cerCode: '200301', prezzo: '2' })
      const data = tx.rigaAddebito.updateMany.mock.calls[0][0].data
      expect(data).not.toHaveProperty('tipologiaRifiuto')
      expect(data).not.toHaveProperty('cerCode')
      expect(data).toMatchObject({ prezzo: '2', versione: { increment: 1 } })
      expect(r.id).toBe(R)
    })

    it('CER cambiato e tipologia non indicata: si ripropone dal CER nuovo', async () => {
      await service.modifica(T, U, R, { versione: 1, cerCode: '20 01 21*' })
      const data = tx.rigaAddebito.updateMany.mock.calls[0][0].data
      expect(data).toMatchObject({ cerCode: '20 01 21*', tipologiaRifiuto: 'URBANO_PERICOLOSO' })
    })

    it('nessun cambiamento reale: nessuna scrittura e nessun audit', async () => {
      await service.modifica(T, U, R, { versione: 1, cerCode: '20 03 01', prezzo: '1.00' })
      expect(tx.rigaAddebito.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('versione diversa: 409 modificata nel frattempo', async () => {
      const e = await errore(service.modifica(T, U, R, { versione: 7, prezzo: '3' }))
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'RIGA_ADDEBITO_MODIFICATA_NEL_FRATTEMPO' })
    })

    it('fasce non inviate: invariate (nessun delete né create)', async () => {
      await service.modifica(T, U, R, { versione: 1, prezzo: '2' })
      expect(tx.scaglioneRigaAddebito.deleteMany).not.toHaveBeenCalled()
      expect(tx.scaglioneRigaAddebito.createMany).not.toHaveBeenCalled()
      expect(tx.scadenzaRigaAddebito.deleteMany).not.toHaveBeenCalled()
    })

    it('audit con i nomi dei campi cambiati', async () => {
      await service.modifica(T, U, R, { versione: 1, prezzo: '2', appunti: 'segreto' })
      const meta = tx.activityLog.create.mock.calls[0][0].data.metadata
      expect(meta.campi).toEqual(['prezzo', 'appunti'])
      expect(JSON.stringify(meta)).not.toContain('segreto')
    })

    it('riga di un’altra azienda o di un contratto eliminato: 404', async () => {
      tx.rigaAddebito.findFirst.mockResolvedValue(null)
      const e = await errore(service.modifica(T, U, R, { versione: 1, prezzo: '2' }))
      expect(e.getStatus()).toBe(404)
    })
  })

  describe('elimina', () => {
    it('cancella con la versione e scrive l’audit', async () => {
      tx.rigaAddebito.findFirst.mockImplementation(async ({ select }: any) =>
        select
          ? { elencoId: E, tipo: 'CER', unitaMisura: 'KG', elenco: { contrattoId: C } }
          : rigaDb()
      )
      await service.elimina(T, U, R, 1)
      expect(tx.rigaAddebito.deleteMany).toHaveBeenCalledWith({
        where: { id: R, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('RIGA_ADDEBITO_ELIMINATA')
    })
  })

  describe('proposta', () => {
    const addebito = (extra: Record<string, unknown> = {}) => ({
      id: A,
      codice: '00001',
      descrizione: 'Nolo cassone',
      unitaMisura: 'NR',
      tipo: 'F',
      attivo: true,
      tipoProvvigione: 'SCONTATO',
      codiceIva: { id: I, codice: '22', descrizione: 'IVA 22' },
      categoria: null,
      centroRicavo: null,
      listini: [
        { numero: 1, prezzo: new Prisma.Decimal('10'), sconto: '5', provvigione: '3' },
        { numero: 2, prezzo: null, sconto: '7', provvigione: '4' },
      ],
      ...extra,
    })

    it('senza listino del cliente e con altri listini vuoti: il listino 1, con la provvigione del listino', async () => {
      tx.addebito.findFirst.mockResolvedValue(addebito({ listini: [addebito().listini[0]] }))
      const p = await service.proposta(T, C, { addebitoId: A })
      expect(p).toMatchObject({
        descrizione: 'Nolo cassone',
        unitaMisura: 'NR',
        tipo: 'F',
        prezzo: '10.00',
        sconto: '5',
        provvigione: '3',
        tipoProvvigione: 'SCONTATO',
      })
    })

    it('listino del cliente senza prezzo: nessun prezzo e nessuno sconto proposti (Q9)', async () => {
      tx.cliente.findFirst.mockResolvedValue({
        listino: 2,
        provvigionePredefinita: null,
        tipoProvvigionePredefinita: null,
      })
      tx.addebito.findFirst.mockResolvedValue(addebito())
      const p = await service.proposta(T, C, { addebitoId: A })
      expect(p.prezzo).toBeNull()
      expect(p.sconto).toBeNull()
    })

    it('la provvigione "0" del cliente NON sostituisce quella del listino; quella positiva sì (R57)', async () => {
      tx.addebito.findFirst.mockResolvedValue(addebito())
      tx.cliente.findFirst.mockResolvedValue({
        listino: 1,
        provvigionePredefinita: '0',
        tipoProvvigionePredefinita: 'LORDO',
      })
      expect(await service.proposta(T, C, { addebitoId: A })).toMatchObject({
        provvigione: '3',
        tipoProvvigione: 'SCONTATO',
      })
      tx.cliente.findFirst.mockResolvedValue({
        listino: 1,
        provvigionePredefinita: '6+2',
        tipoProvvigionePredefinita: 'LORDO',
      })
      expect(await service.proposta(T, C, { addebitoId: A })).toMatchObject({
        provvigione: '6+2',
        tipoProvvigione: 'LORDO',
      })
    })

    it('provvigione del cliente non valida: ignorata, senza errore (R23)', async () => {
      tx.addebito.findFirst.mockResolvedValue(addebito())
      tx.cliente.findFirst.mockResolvedValue({
        listino: 1,
        provvigionePredefinita: '1+2+3+4',
        tipoProvvigionePredefinita: 'LORDO',
      })
      expect((await service.proposta(T, C, { addebitoId: A })).provvigione).toBe('3')
    })

    it('da un CER: descrizione del catalogo, tipo CER e tipologia dal CER', async () => {
      const p = await service.proposta(T, C, { cerCode: '200121' })
      expect(p).toMatchObject({
        tipo: 'CER',
        tipologiaRifiuto: 'URBANO_PERICOLOSO',
        descrizione: 'Rifiuti urbani indifferenziati',
        prezzo: null,
      })
    })

    it('CER fuori catalogo: 400; addebito disattivato: 400; nessun parametro o entrambi: 400', async () => {
      expect((await errore(service.proposta(T, C, { cerCode: '200399' }))).getStatus()).toBe(400)
      tx.addebito.findFirst.mockResolvedValue(addebito({ attivo: false }))
      expect((await errore(service.proposta(T, C, { addebitoId: A }))).getStatus()).toBe(400)
      expect((await errore(service.proposta(T, C, {}))).getStatus()).toBe(400)
      expect(
        (await errore(service.proposta(T, C, { addebitoId: A, cerCode: '200301' }))).getStatus()
      ).toBe(400)
    })

    it('contratto eliminato o di un’altra azienda: 404', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      expect((await errore(service.proposta(T, C, { cerCode: '200301' }))).getStatus()).toBe(404)
    })
  })

  describe('codificheRentri', () => {
    it('restituisce external_id come codice e il nome come descrizione', async () => {
      expect(await service.codificheRentri('stati-fisici')).toEqual([
        { codice: '2', descrizione: 'Liquido' },
      ])
      expect(tx.rentriCodificaSemplice.findMany.mock.calls[0][0].where).toEqual({
        tabella: 'stati-fisici',
        presenteInRentri: true,
      })
    })
  })

  describe('vista', () => {
    it('segna le scadenze non fatturabili nel contratto', async () => {
      const r = rigaDb({
        tipo: 'F',
        cerCode: null,
        tipoQuantita: null,
        addebito: { id: A, codice: '00001', descrizione: 'Nolo' },
        addebitoId: A,
        scadenze: [
          { ordine: 1, giorno: 1, mese: 6, anno: null },
          { ordine: 2, giorno: 1, mese: 6, anno: 2025 },
        ],
        elenco: {
          codice: '001',
          contratto: {
            id: C,
            numero: 'CC-1',
            dataInizio: new Date('2026-01-01T00:00:00Z'),
            dataFine: new Date('2026-12-31T00:00:00Z'),
          },
        },
      })
      tx.rigaAddebito.findMany.mockResolvedValue([r])
      const [v] = await service.list(T, E)
      expect(v.scadenze.map(s => s.fatturabileNelContratto)).toEqual([true, false])
      expect(v).toMatchObject({
        famiglia: 'FISSO',
        prezzo: '1.00',
        etichettaTipo: expect.any(String),
      })
    })
  })
})
