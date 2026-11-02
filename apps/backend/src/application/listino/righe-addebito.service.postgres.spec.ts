/**
 * Righe di addebito (4.2b, Task 21) contro un Postgres reale, collegato COME `wasteflow_app`.
 * Il proprietario prepara aziende, contratti e addebiti e legge lo stato finale. Pulizia solo per id
 * esatti creati (aziende e voci RENTRI di prova).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  assicuraCodificheRentri,
  creaAddebito,
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
} from '../../test-support/listino-di-test'
import { RigheAddebitoService } from './righe-addebito.service'

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

const attendi = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('RigheAddebitoService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: RigheAddebitoService
  const tenantCreati: string[] = []
  const rentriCreati: string[] = []
  let rentri: { statoFisico: string; operazione: string }
  let n = 0

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new RigheAddebitoService(app)
    const r = await assicuraCodificheRentri(owner)
    rentri = r
    rentriCreati.push(...r.creati)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = { in: tenantCreati }
      // Righe, fasce, scadenze ed elenchi vanno a cascata col contratto; le FK NoAction verso
      // addebiti e codici IVA chiedono di cancellare prima i contratti.
      await owner.contrattoCliente.updateMany({
        where: { tenantId: in_ },
        data: { contrattoPrincipaleId: null },
      })
      await owner.contrattoCliente.deleteMany({ where: { tenantId: in_ } })
      await owner.addebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codificaAddebito.deleteMany({ where: { tenantId: in_ } })
      await owner.codiceIva.deleteMany({ where: { tenantId: in_ } })
      await owner.activityLog.deleteMany({ where: { tenantId: in_ } })
      await owner.user.deleteMany({ where: { tenantId: in_ } })
      await owner.tenant.deleteMany({ where: { id: in_ } })
    }
    if (rentriCreati.length > 0) {
      await owner.rentriCodificaSemplice.deleteMany({ where: { id: { in: rentriCreati } } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Righe SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-righe-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `righe-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const listino = await creaCodiciIvaEcodifiche(owner, t.id)
    return { tenantId: t.id, utenteId: utente.id, listino }
  }

  /** Azienda con codici, un contratto `ATTIVO` e il suo primo elenco `001`. */
  async function scenario(opzioni: Parameters<typeof creaContrattoConElenco>[2] = {}) {
    const a = await azienda()
    const c = await creaContrattoConElenco(owner, a.tenantId, opzioni)
    return { ...a, ...c }
  }

  type Scenario = Awaited<ReturnType<typeof scenario>>
  const crea = (s: Scenario, corpo: Record<string, unknown>, elencoId = s.elencoId) =>
    service.crea(s.tenantId, s.utenteId, elencoId, { codiceIvaId: s.listino.iva22Id, ...corpo })

  /** Elenco in più nello stesso contratto. */
  const altroElenco = (s: Scenario, codice: string) =>
    owner.elencoAddebiti.create({
      data: { tenantId: s.tenantId, contrattoId: s.contrattoId, codice, descrizione: `E${codice}` },
    })

  const tabellaValida = [
    { ordine: 1, finoA: '100', prezzo: '1', tipoCalcolo: 'A' },
    { ordine: 7, finoA: null, prezzo: '0.5', tipoCalcolo: 'A' },
  ]

  describe('una creazione completa e la sua lettura per ogni famiglia', () => {
    it('CER: forma del catalogo, tipologia proposta, stato fisico, operazione e addebiti proposti', async () => {
      const s = await scenario()
      const v = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const r = await crea(s, {
        tipo: 'CER',
        cerCode: '200301',
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'kg',
        prezzo: '0,15',
        riferimento: '',
        statoFisico: rentri.statoFisico,
        operazione: rentri.operazione,
        addebitiProposti: [String(Number(v.codice))],
        stimaAnnuaKg: 1000,
        appunti: 'nota libera',
      })
      expect(r).toMatchObject({
        tipo: 'CER',
        famiglia: 'CER',
        cerCode: '20 03 01',
        addebito: null,
        riferimento: null,
        tipologiaRifiuto: 'URBANO',
        unitaMisura: 'KG',
        prezzo: '0.15',
        statoFisico: rentri.statoFisico,
        operazione: rentri.operazione,
        addebitiProposti: [v.codice],
        stimaAnnuaKg: '1000.00',
        versione: 1,
        codiceIva: { id: s.listino.iva22Id, codice: '22' },
      })
      const letta = await service.getById(s.tenantId, r.id)
      expect(letta).toEqual(r)
      expect(await service.list(s.tenantId, s.elencoId)).toEqual([r])
    })

    it('CER pericoloso senza asterisco: si salva quello del catalogo e la tipologia segue', async () => {
      const s = await scenario()
      const r = await crea(s, {
        tipo: 'CER',
        cerCode: '200121',
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'KG',
        prezzo: '1',
      })
      expect(r).toMatchObject({ cerCode: '20 01 21*', tipologiaRifiuto: 'URBANO_PERICOLOSO' })
    })

    it('V con prezzo speciale: fasce, "si applica a" e CER proposti', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const r = await crea(s, {
        tipo: 'V',
        addebitoId: a.id,
        tipoQuantita: 'VOLUME',
        unitaMisura: 'MC',
        prezzoSpeciale: true,
        applicaA: 'DOCUMENTO',
        scaglioni: tabellaValida,
        cerProposta: ['200301/*', '20 01 21'],
        minimoPerCategoria: false,
      })
      expect(r).toMatchObject({
        tipo: 'V',
        famiglia: 'VARIABILE',
        prezzo: null,
        prezzoSpeciale: true,
        applicaA: 'DOCUMENTO',
        cerProposta: ['20 03 01/*', '20 01 21'],
        addebito: { id: a.id, codice: a.codice },
      })
      expect(r.scaglioni).toEqual([
        {
          ordine: 1,
          finoA: '100',
          prezzo: '1.00',
          sconto: null,
          provvigione: null,
          tipoCalcolo: 'A',
        },
        {
          ordine: 7,
          finoA: null,
          prezzo: '0.50',
          sconto: null,
          provvigione: null,
          tipoCalcolo: 'A',
        },
      ])
      expect(await service.getById(s.tenantId, r.id)).toEqual(r)
    })

    it('F con scadenze: quantità fissa, periodo e scadenze con la fatturabilità nel contratto', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'F' })
      const r = await crea(s, {
        tipo: 'F',
        addebitoId: a.id,
        unitaMisura: 'NR',
        quantitaFissa: '2',
        prezzo: '50',
        periodoScadenze: 'MP',
        scadenze: [
          { ordine: 1, giorno: 1, mese: 3, anno: null },
          { ordine: 2, giorno: 1, mese: 9, anno: 2020 },
        ],
      })
      expect(r).toMatchObject({ tipo: 'F', famiglia: 'FISSO', quantitaFissa: '2', prezzo: '50.00' })
      expect(r.scadenze).toEqual([
        { ordine: 1, giorno: 1, mese: 3, anno: null, fatturabileNelContratto: true },
        // il contratto di prova comincia il 01/01/2026: una data del 2020 non e' fatturabile
        { ordine: 2, giorno: 1, mese: 9, anno: 2020, fatturabileNelContratto: false },
      ])
    })

    it.each([
      ['TS', 'KG', {}],
      ['NM', 'NR', {}],
      ['MF', 'EUR', {}],
      ['$A', 'EUR', {}],
    ])('%s: creata e riletta', async (tipo, um, extra) => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo, unitaMisura: um })
      const r = await crea(s, { tipo, addebitoId: a.id, unitaMisura: um, prezzo: '10', ...extra })
      expect(r).toMatchObject({ tipo, addebito: { id: a.id } })
      expect(await service.getById(s.tenantId, r.id)).toEqual(r)
    })
  })

  describe('proposta dall’archivio (D6, D7, Q9)', () => {
    it('col listino e la provvigione del cliente; solo se il listino ha un prezzo', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, {
        tipo: 'F',
        unitaMisura: 'NR',
        prezzo1: '10',
        codiceIvaId: s.listino.iva22Id,
        categoriaId: s.listino.categoriaId,
      })
      await owner.prezzoListinoAddebito.updateMany({
        where: { addebitoId: a.id, numero: 2 },
        data: { prezzo: '20', sconto: '5', provvigione: '3' },
      })
      // senza listino: il 1 è l'unico... ma il 2 ha un prezzo, quindi nessuna proposta
      let p = await service.proposta(s.tenantId, s.contrattoId, { addebitoId: a.id })
      expect(p).toMatchObject({ prezzo: null, sconto: null, unitaMisura: 'NR', tipo: 'F' })
      expect(p.codiceIva).toMatchObject({ codice: '22' })
      expect(p.categoria).toMatchObject({ id: s.listino.categoriaId })

      await owner.cliente.update({
        where: { id: s.clienteId },
        data: { listino: 2, provvigionePredefinita: '6+2', tipoProvvigionePredefinita: 'LORDO' },
      })
      p = await service.proposta(s.tenantId, s.contrattoId, { addebitoId: a.id })
      expect(p).toMatchObject({
        prezzo: '20.00',
        sconto: '5',
        provvigione: '6+2',
        tipoProvvigione: 'LORDO',
      })

      await owner.cliente.update({ where: { id: s.clienteId }, data: { listino: 3 } })
      p = await service.proposta(s.tenantId, s.contrattoId, { addebitoId: a.id })
      expect(p.prezzo).toBeNull() // il listino 3 non ha prezzo (Q9)
      expect(p.provvigione).toBe('6+2')
    })

    it('da un CER: descrizione del catalogo e tipologia', async () => {
      const s = await scenario()
      const p = await service.proposta(s.tenantId, s.contrattoId, { cerCode: '200121' })
      expect(p).toMatchObject({ tipo: 'CER', tipologiaRifiuto: 'URBANO_PERICOLOSO' })
      expect(p.descrizione).toBeTruthy()
    })

    it('contratto di un’altra azienda: 404', async () => {
      const s = await scenario()
      const altra = await azienda()
      expect(
        (await errore(service.proposta(altra.tenantId, s.contrattoId, { cerCode: '200301' })))
          .status
      ).toBe(404)
    })
  })

  describe('400 con `errori` per campo (R36)', () => {
    it('CER fuori catalogo o di capitolo', async () => {
      const s = await scenario()
      const base = { tipo: 'CER', tipoQuantita: 'PESO_NETTO', unitaMisura: 'KG', prezzo: '1' }
      const fuori = await errore(crea(s, { ...base, cerCode: '999999' }))
      expect(fuori.getStatus()).toBe(400)
      expect(fuori.getResponse()).toMatchObject({
        error: 'RIGA_ADDEBITO_NON_VALIDA',
        errori: [{ campo: 'cerCode', messaggio: expect.stringContaining('catalogo') }],
      })
      const capitolo = await errore(crea(s, { ...base, cerCode: '200000' }))
      expect(capitolo.getResponse().errori[0].campo).toBe('cerCode')
    })

    it('addebito disattivato e codice IVA di un’altra azienda', async () => {
      const s = await scenario()
      const altra = await azienda()
      const spento = await creaAddebito(owner, s.tenantId, { tipo: 'V', attivo: false })
      const e1 = await errore(
        crea(s, {
          tipo: 'V',
          addebitoId: spento.id,
          tipoQuantita: 'UNO',
          unitaMisura: 'NR',
          prezzo: '1',
        })
      )
      expect(e1.getResponse().errori).toEqual([expect.objectContaining({ campo: 'addebitoId' })])
      const v = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const e2 = await errore(
        crea(s, {
          tipo: 'V',
          addebitoId: v.id,
          tipoQuantita: 'UNO',
          unitaMisura: 'NR',
          prezzo: '1',
          codiceIvaId: altra.listino.iva22Id,
        })
      )
      expect(e2.getResponse().errori).toEqual([expect.objectContaining({ campo: 'codiceIvaId' })])
      expect(await owner.rigaAddebito.count({ where: { tenantId: s.tenantId } })).toBe(0)
    })

    it('stato fisico fuori dalle codifiche RENTRI, addebito proposto non V, categoria del genere sbagliato', async () => {
      const s = await scenario()
      const t = await creaAddebito(owner, s.tenantId, { tipo: 'F' })
      const e = await errore(
        crea(s, {
          tipo: 'CER',
          cerCode: '200301',
          tipoQuantita: 'PESO_NETTO',
          unitaMisura: 'KG',
          prezzo: '1',
          statoFisico: 'zzz',
          addebitiProposti: [t.codice],
          categoriaId: s.listino.centroId,
        })
      )
      expect(
        e
          .getResponse()
          .errori.map((x: any) => x.campo)
          .sort()
      ).toEqual(['addebitiProposti', 'categoriaId', 'statoFisico'])
    })

    it('errori del dominio: famiglia, prezzo mancante e D17 sul contratto allegato', async () => {
      const principale = await scenario()
      const allegato = await creaContrattoConElenco(owner, principale.tenantId, {
        contrattoPrincipaleId: principale.contrattoId,
        clienteId: principale.clienteId,
      })
      const cer = await errore(
        service.crea(principale.tenantId, principale.utenteId, allegato.elencoId, {
          codiceIvaId: principale.listino.iva22Id,
          tipo: 'CER',
          cerCode: '200301',
          tipoQuantita: 'PESO_NETTO',
          unitaMisura: 'KG',
          prezzo: '1',
        })
      )
      expect(cer.getResponse().errori).toEqual([
        { campo: 'tipo', messaggio: 'In un contratto allegato non si inseriscono righe CER.' },
      ])
      const v = await creaAddebito(owner, principale.tenantId, { tipo: 'V' })
      const vv = await errore(
        service.crea(principale.tenantId, principale.utenteId, allegato.elencoId, {
          codiceIvaId: principale.listino.iva22Id,
          tipo: 'V',
          addebitoId: v.id,
          tipoQuantita: 'UNO',
          unitaMisura: 'NR',
          prezzo: '1',
        })
      )
      expect(vv.getResponse().errori).toEqual([
        {
          campo: 'tipo',
          messaggio: 'In un contratto allegato si inseriscono solo addebiti di tipo T.',
        },
      ])
      const t = await creaAddebito(owner, principale.tenantId, { tipo: 'TS' })
      const ok = await service.crea(principale.tenantId, principale.utenteId, allegato.elencoId, {
        codiceIvaId: principale.listino.iva22Id,
        tipo: 'TS',
        addebitoId: t.id,
        unitaMisura: 'KG',
        prezzo: '1',
      })
      expect(ok.tipo).toBe('TS')
    })
  })

  describe('409 delle regole fra righe (D11) e duplicato (R43)', () => {
    it('stessa riga nello stesso elenco: RIGA_ADDEBITO_DUPLICATA; riferimento diverso o altro elenco no', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const corpo = {
        tipo: 'V',
        addebitoId: a.id,
        tipoQuantita: 'UNO',
        unitaMisura: 'NR',
        prezzo: '1',
      }
      await crea(s, corpo)
      const e = await errore(crea(s, corpo))
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'RIGA_ADDEBITO_DUPLICATA' })
      expect(await crea(s, { ...corpo, riferimento: 'A1' })).toMatchObject({ riferimento: 'A1' })
      const e2 = await altroElenco(s, '002')
      expect(await crea(s, corpo, e2.id)).toMatchObject({ elencoId: e2.id })
    })

    it('due creazioni identiche in parallelo: una riga sola (indice unico + lock dell’elenco)', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const corpo = {
        tipo: 'V',
        addebitoId: a.id,
        tipoQuantita: 'UNO',
        unitaMisura: 'NR',
        prezzo: '1',
      }
      const esiti = await Promise.allSettled([crea(s, corpo), crea(s, corpo)])
      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutato.reason.getResponse()).toMatchObject({ error: 'RIGA_ADDEBITO_DUPLICATA' })
      expect(await owner.rigaAddebito.count({ where: { elencoId: s.elencoId } })).toBe(1)
    })

    it('minimo fatturabile: una MF/MW per contratto (anche in un altro elenco), ogni M### una volta', async () => {
      const s = await scenario()
      const e2 = await altroElenco(s, '002')
      const mf = await creaAddebito(owner, s.tenantId, { tipo: 'MF', unitaMisura: 'EUR' })
      const mw = await creaAddebito(owner, s.tenantId, { tipo: 'MW', unitaMisura: 'EUR' })
      const corpo = (tipo: string, id: string) => ({
        tipo,
        addebitoId: id,
        unitaMisura: 'EUR',
        prezzo: '30',
      })
      await crea(s, corpo('MF', mf.id))
      const e = await errore(crea(s, corpo('MW', mw.id), e2.id))
      expect(e.getResponse()).toMatchObject({
        error: 'MINIMO_GIA_PRESENTE',
        message: 'Nel contratto c’è già un addebito di minimo fatturabile.',
      })
      const m1 = await creaAddebito(owner, s.tenantId, { tipo: 'M001', unitaMisura: 'EUR' })
      await crea(s, corpo('M001', m1.id))
      const m1bis = await creaAddebito(owner, s.tenantId, { tipo: 'M001', unitaMisura: 'EUR' })
      expect((await errore(crea(s, corpo('M001', m1bis.id), e2.id))).getResponse().error).toBe(
        'MINIMO_GIA_PRESENTE'
      )
      const m2 = await creaAddebito(owner, s.tenantId, { tipo: 'M002', unitaMisura: 'EUR' })
      expect(await crea(s, corpo('M002', m2.id), e2.id)).toMatchObject({ tipo: 'M002' })
    })

    it('acconto, detrazione o anticipo: uno solo per contratto', async () => {
      const s = await scenario()
      const e2 = await altroElenco(s, '002')
      const a = await creaAddebito(owner, s.tenantId, { tipo: '$A', unitaMisura: 'EUR' })
      const r = await creaAddebito(owner, s.tenantId, { tipo: '$R', unitaMisura: 'EUR' })
      await crea(s, { tipo: '$A', addebitoId: a.id, unitaMisura: 'EUR', prezzo: '100' })
      const e = await errore(
        crea(s, { tipo: '$R', addebitoId: r.id, unitaMisura: 'EUR', prezzo: '100' }, e2.id)
      )
      expect(e.getResponse()).toMatchObject({ error: 'ACCONTO_GIA_PRESENTE' })
    })

    it('detrazione a scalare ($D con #): una per cliente, anche in un altro contratto', async () => {
      const s = await scenario()
      const altro = await creaContrattoConElenco(owner, s.tenantId, { clienteId: s.clienteId })
      const d = await creaAddebito(owner, s.tenantId, { tipo: '$D', unitaMisura: '#' })
      const corpo = { tipo: '$D', addebitoId: d.id, unitaMisura: '#', prezzo: '1' }
      await crea(s, corpo)
      const e = await errore(crea(s, corpo, altro.elencoId))
      expect(e.getResponse()).toMatchObject({
        error: 'DETRAZIONE_GIA_PRESENTE',
        message: 'Il cliente ha già una detrazione a scalare in un altro contratto.',
      })
      // un altro cliente non e' toccato
      const diverso = await creaContrattoConElenco(owner, s.tenantId)
      expect(await crea(s, corpo, diverso.elencoId)).toMatchObject({ tipo: '$D' })
    })

    it('una condizione definita da una sola riga; le condizioni riferite devono trovare i condizionati', async () => {
      const s = await scenario()
      const a1 = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const a2 = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const a3 = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const base = { tipo: 'V', tipoQuantita: 'PESO_NETTO', unitaMisura: 'KG', prezzo: '1' }
      await crea(s, { ...base, addebitoId: a1.id, condizione: 1 })
      const dup = await errore(crea(s, { ...base, addebitoId: a2.id, condizione: 1 }))
      expect(dup.getResponse()).toMatchObject({
        error: 'CONDIZIONE_GIA_DEFINITA',
        message: 'La condizione 1 è già definita da un altro addebito di questo elenco.',
      })
      // riferita ma senza condizionato (la 2 non esiste, e la 1 ha un'altra unita' di misura)
      const senza = await errore(
        crea(s, {
          ...base,
          addebitoId: a3.id,
          prezzoSpeciale: true,
          prezzo: null,
          applicaA: 'DOCUMENTO',
          condizioniRiferite: '2C',
          scaglioni: [
            { ordine: 1, finoA: '10', prezzo: '1', tipoCalcolo: 'X' },
            { ordine: 7, finoA: null, prezzo: '1', tipoCalcolo: 'A' },
          ],
        })
      )
      expect(senza.getStatus()).toBe(400)
      expect(senza.getResponse().errori).toEqual(
        expect.arrayContaining([
          {
            campo: 'condizioniRiferite',
            messaggio:
              'Le condizioni indicate non trovano addebiti condizionati con la stessa unità di misura in questo elenco.',
          },
        ])
      )
    })
  })

  describe('modifica', () => {
    async function conFasce() {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const r = await crea(s, {
        tipo: 'V',
        addebitoId: a.id,
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'KG',
        prezzoSpeciale: true,
        applicaA: 'DOCUMENTO',
        scaglioni: tabellaValida,
      })
      return { s, a, r }
    }

    it('fasce non inviate: invariate (R37); inviate: sostituite in blocco', async () => {
      const { s, r } = await conFasce()
      const prima = await service.modifica(s.tenantId, s.utenteId, r.id, {
        versione: 1,
        descrizione: 'Nuova',
      })
      expect(prima).toMatchObject({ descrizione: 'Nuova', versione: 2 })
      expect(prima.scaglioni).toEqual(r.scaglioni)
      const ids = (
        await owner.scaglioneRigaAddebito.findMany({
          where: { rigaId: r.id },
          select: { id: true },
        })
      ).map(x => x.id)
      const dopo = await service.modifica(s.tenantId, s.utenteId, r.id, {
        versione: 2,
        scaglioni: [
          { ordine: 1, finoA: 50, prezzo: 2, tipoCalcolo: 'A' },
          { ordine: 7, finoA: null, prezzo: 1, tipoCalcolo: 'A' },
        ],
      })
      expect(dopo.versione).toBe(3)
      expect(dopo.scaglioni.map(x => [x.ordine, x.finoA, x.prezzo])).toEqual([
        [1, '50', '2.00'],
        [7, null, '1.00'],
      ])
      const nuoviIds = (
        await owner.scaglioneRigaAddebito.findMany({
          where: { rigaId: r.id },
          select: { id: true },
        })
      ).map(x => x.id)
      expect(nuoviIds.some(i => ids.includes(i))).toBe(false)
    })

    it('prezzo speciale spento senza inviare le fasce: si svuotano; inviate non vuote: 400', async () => {
      const { s, r } = await conFasce()
      const e = await errore(
        service.modifica(s.tenantId, s.utenteId, r.id, {
          versione: 1,
          prezzoSpeciale: false,
          prezzo: '3',
          scaglioni: tabellaValida,
        })
      )
      expect(e.getStatus()).toBe(400)
      const ok = await service.modifica(s.tenantId, s.utenteId, r.id, {
        versione: 1,
        prezzoSpeciale: false,
        prezzo: '3',
      })
      expect(ok).toMatchObject({
        prezzoSpeciale: false,
        scaglioni: [],
        applicaA: null,
        prezzo: '3.00',
      })
      expect(await owner.scaglioneRigaAddebito.count({ where: { rigaId: r.id } })).toBe(0)
    })

    it('due modifiche con la stessa versione: una 409 e le fasce sono quelle della prima', async () => {
      const { s, r } = await conFasce()
      const fasce = (prezzo: number) => [
        { ordine: 1, finoA: 10, prezzo, tipoCalcolo: 'A' },
        { ordine: 7, finoA: null, prezzo, tipoCalcolo: 'A' },
      ]
      const esiti = await Promise.allSettled([
        service.modifica(s.tenantId, s.utenteId, r.id, { versione: 1, scaglioni: fasce(3) }),
        service.modifica(s.tenantId, s.utenteId, r.id, { versione: 1, scaglioni: fasce(4) }),
      ])
      const riusciti = esiti.filter(e => e.status === 'fulfilled') as PromiseFulfilledResult<any>[]
      expect(riusciti).toHaveLength(1)
      const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutato.reason.getResponse()).toMatchObject({
        error: 'RIGA_ADDEBITO_MODIFICATA_NEL_FRATTEMPO',
      })
      const vincente = riusciti[0].value.scaglioni[0].prezzo
      const finale = await owner.scaglioneRigaAddebito.findMany({
        where: { rigaId: r.id },
        orderBy: { ordine: 'asc' },
      })
      expect(finale).toHaveLength(2)
      expect(finale.map(f => f.prezzo.toFixed(2))).toEqual([vincente, vincente])
    })

    it('stesso CER rimandato: la tipologia scelta a mano resta; CER cambiato: si ripropone', async () => {
      const s = await scenario()
      const r = await crea(s, {
        tipo: 'CER',
        cerCode: '200301',
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'KG',
        prezzo: '1',
        tipologiaRifiuto: 'SPECIALE',
      })
      expect(r.tipologiaRifiuto).toBe('SPECIALE')
      const stesso = await service.modifica(s.tenantId, s.utenteId, r.id, {
        versione: 1,
        cerCode: '20 03 01',
        prezzo: '2',
      })
      expect(stesso.tipologiaRifiuto).toBe('SPECIALE')
      const cambiato = await service.modifica(s.tenantId, s.utenteId, r.id, {
        versione: 2,
        cerCode: '200121',
      })
      expect(cambiato).toMatchObject({
        cerCode: '20 01 21*',
        tipologiaRifiuto: 'URBANO_PERICOLOSO',
      })
    })

    it('nessun cambiamento reale: versione invariata e nessun audit', async () => {
      const s = await scenario()
      const r = await crea(s, {
        tipo: 'CER',
        cerCode: '200301',
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'KG',
        prezzo: '1',
      })
      const dopo = await service.modifica(s.tenantId, s.utenteId, r.id, {
        versione: 1,
        prezzo: '1.000',
        cerCode: '200301',
      })
      expect(dopo.versione).toBe(1)
      expect(
        await owner.activityLog.count({
          where: { tenantId: s.tenantId, action: 'RIGA_ADDEBITO_MODIFICATA' },
        })
      ).toBe(0)
    })

    it('un duplicato creato modificando il riferimento: 409', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const corpo = {
        tipo: 'V',
        addebitoId: a.id,
        tipoQuantita: 'UNO',
        unitaMisura: 'NR',
        prezzo: '1',
      }
      await crea(s, corpo)
      const b = await crea(s, { ...corpo, riferimento: 'X' })
      const e = await errore(
        service.modifica(s.tenantId, s.utenteId, b.id, { versione: 1, riferimento: null })
      )
      expect(e.getResponse()).toMatchObject({ error: 'RIGA_ADDEBITO_DUPLICATA' })
    })
  })

  describe('elimina, contratto annullato e isolamento fra aziende', () => {
    it('elimina con fasce e scadenze a cascata; versione sbagliata 409', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const r = await crea(s, {
        tipo: 'V',
        addebitoId: a.id,
        tipoQuantita: 'PESO_NETTO',
        unitaMisura: 'KG',
        prezzoSpeciale: true,
        applicaA: 'DOCUMENTO',
        scaglioni: tabellaValida,
      })
      expect((await errore(service.elimina(s.tenantId, s.utenteId, r.id, 9))).getStatus()).toBe(409)
      await service.elimina(s.tenantId, s.utenteId, r.id, 1)
      expect(await owner.rigaAddebito.count({ where: { id: r.id } })).toBe(0)
      expect(await owner.scaglioneRigaAddebito.count({ where: { rigaId: r.id } })).toBe(0)
      expect((await errore(service.getById(s.tenantId, r.id))).getStatus()).toBe(404)
      const log = await owner.activityLog.findFirst({
        where: { tenantId: s.tenantId, action: 'RIGA_ADDEBITO_ELIMINATA' },
      })
      expect(log).not.toBeNull()
    })

    it('contratto annullato: crea, modifica ed elimina 409 LISTINO_NON_MODIFICABILE; la lettura resta', async () => {
      const s = await scenario()
      const riga = await creaRiga(owner, s.tenantId, s.elencoId, { codiceIvaId: s.listino.iva22Id })
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { stato: 'ANNULLATO', motivoAnnullo: 'Prova', annullatoIl: new Date() },
      })
      const e1 = await errore(crea(s, { tipo: 'CER', cerCode: '200301' }))
      const e2 = await errore(
        service.modifica(s.tenantId, s.utenteId, riga.id, { versione: 1, prezzo: '3' })
      )
      const e3 = await errore(service.elimina(s.tenantId, s.utenteId, riga.id, 1))
      for (const e of [e1, e2, e3]) {
        expect(e.getStatus()).toBe(409)
        expect(e.getResponse()).toMatchObject({ error: 'LISTINO_NON_MODIFICABILE' })
      }
      expect(await service.getById(s.tenantId, riga.id)).toMatchObject({ id: riga.id })
      expect(await service.list(s.tenantId, s.elencoId)).toHaveLength(1)
    })

    it('contratto eliminato e altra azienda: 404 su tutte le rotte', async () => {
      const s = await scenario()
      const altra = await azienda()
      const riga = await creaRiga(owner, s.tenantId, s.elencoId, { codiceIvaId: s.listino.iva22Id })
      for (const t of [altra.tenantId]) {
        expect((await errore(service.getById(t, riga.id))).getStatus()).toBe(404)
        expect((await errore(service.list(t, s.elencoId))).getStatus()).toBe(404)
        expect(
          (
            await errore(service.modifica(t, altra.utenteId, riga.id, { versione: 1, prezzo: '3' }))
          ).getStatus()
        ).toBe(404)
        expect((await errore(service.elimina(t, altra.utenteId, riga.id, 1))).getStatus()).toBe(404)
        expect(
          (await errore(service.crea(t, altra.utenteId, s.elencoId, { tipo: 'CER' }))).getStatus()
        ).toBe(404)
      }
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { eliminatoIl: new Date() },
      })
      expect((await errore(service.getById(s.tenantId, riga.id))).getStatus()).toBe(404)
      expect((await errore(service.list(s.tenantId, s.elencoId))).getStatus()).toBe(404)
      expect(
        (
          await errore(service.modifica(s.tenantId, s.utenteId, riga.id, { versione: 1 }))
        ).getStatus()
      ).toBe(404)
    })
  })

  describe('riferimenti letti FOR SHARE (R41)', () => {
    it('una disattivazione concorrente dell’addebito aspetta la riga, e la riga aspetta una disattivazione già in corso', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const corpo = {
        tipo: 'V',
        addebitoId: a.id,
        tipoQuantita: 'UNO',
        unitaMisura: 'NR',
        prezzo: '1',
      }
      // Una transazione del proprietario modifica l'addebito (FOR NO KEY UPDATE) e resta aperta.
      let sblocca!: (commit: boolean) => void
      const decisione = new Promise<boolean>(r => (sblocca = r))
      const aperta = owner.$transaction(
        async tx => {
          await tx.addebito.update({ where: { id: a.id }, data: { attivo: false } })
          if (!(await decisione)) throw new Error('rollback voluto')
        },
        { timeout: 30000 }
      )
      await attendi(300)
      let finita = false
      const creazione = crea(s, corpo).finally(() => {
        finita = true
      })
      const esito = creazione.then(
        v => ({ v }),
        e => ({ e })
      )
      await attendi(800)
      // Una lettura senza FOR SHARE avrebbe risposto subito con l'addebito ancora attivo.
      expect(finita).toBe(false)
      sblocca(true) // commit: l'addebito risulta disattivato
      await aperta
      const r = (await esito) as { e?: any }
      expect(r.e?.getStatus()).toBe(400)
      expect(r.e.getResponse().errori).toEqual([expect.objectContaining({ campo: 'addebitoId' })])
    })
  })

  describe('concorrenza "per contratto" e "per cliente" (R40)', () => {
    it('due MW in due elenchi dello stesso contratto: una 409 MINIMO_GIA_PRESENTE', async () => {
      for (let giro = 0; giro < 3; giro++) {
        const s = await scenario()
        const e2 = await altroElenco(s, '002')
        const a1 = await creaAddebito(owner, s.tenantId, { tipo: 'MW', unitaMisura: 'EUR' })
        const a2 = await creaAddebito(owner, s.tenantId, { tipo: 'MW', unitaMisura: 'EUR' })
        const corpo = (id: string) => ({
          tipo: 'MW',
          addebitoId: id,
          unitaMisura: 'EUR',
          prezzo: '30',
        })
        const esiti = await Promise.allSettled([
          crea(s, corpo(a1.id), s.elencoId),
          crea(s, corpo(a2.id), e2.id),
        ])
        expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
        const no = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
        expect(no.reason.getResponse()).toMatchObject({ error: 'MINIMO_GIA_PRESENTE' })
      }
    })

    it('due $D # in due contratti dello stesso cliente: una 409 DETRAZIONE_GIA_PRESENTE', async () => {
      for (let giro = 0; giro < 3; giro++) {
        const s = await scenario()
        const altro = await creaContrattoConElenco(owner, s.tenantId, { clienteId: s.clienteId })
        const d1 = await creaAddebito(owner, s.tenantId, { tipo: '$D', unitaMisura: '#' })
        const d2 = await creaAddebito(owner, s.tenantId, { tipo: '$D', unitaMisura: '#' })
        const corpo = (id: string) => ({
          tipo: '$D',
          addebitoId: id,
          unitaMisura: '#',
          prezzo: '1',
        })
        const esiti = await Promise.allSettled([
          crea(s, corpo(d1.id), s.elencoId),
          crea(s, corpo(d2.id), altro.elencoId),
        ])
        expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
        const no = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
        expect(no.reason.getResponse()).toMatchObject({ error: 'DETRAZIONE_GIA_PRESENTE' })
      }
    })
  })

  describe('audit (D25)', () => {
    it('creata, modificata ed eliminata: id, numero del contratto, codici e campi; mai appunti né note', async () => {
      const s = await scenario()
      const a = await creaAddebito(owner, s.tenantId, { tipo: 'V' })
      const r = await crea(s, {
        tipo: 'V',
        addebitoId: a.id,
        tipoQuantita: 'UNO',
        unitaMisura: 'NR',
        prezzo: '1',
        appunti: 'APPUNTO-RISERVATO',
        notaUsoInterno: 'NOTA-INTERNA',
      })
      await service.modifica(s.tenantId, s.utenteId, r.id, {
        versione: 1,
        prezzo: '2',
        appunti: 'ALTRO-APPUNTO',
        descrizione: 'DESCRIZIONE-LIBERA',
      })
      await service.elimina(s.tenantId, s.utenteId, r.id, 2)
      const log = await owner.activityLog.findMany({
        where: { tenantId: s.tenantId, action: { startsWith: 'RIGA_ADDEBITO_' } },
        orderBy: { createdAt: 'asc' },
      })
      expect(log.map(l => l.action)).toEqual([
        'RIGA_ADDEBITO_CREATA',
        'RIGA_ADDEBITO_MODIFICATA',
        'RIGA_ADDEBITO_ELIMINATA',
      ])
      expect(log[1].metadata).toMatchObject({
        rigaId: r.id,
        codiceElenco: '001',
        codiceAddebito: a.codice,
        tipo: 'V',
        campi: expect.arrayContaining(['prezzo', 'appunti', 'descrizione']),
      })
      const tutto = JSON.stringify(log.map(l => l.metadata))
      expect(tutto).toMatch(/LST-2026-/)
      expect(tutto).not.toMatch(/APPUNTO|NOTA-INTERNA|DESCRIZIONE-LIBERA|ALTRO-APPUNTO/)
    })
  })

  describe('codifiche RENTRI (R42)', () => {
    it('restituisce external_id e nome per tabella', async () => {
      const stati = await service.codificheRentri('stati-fisici')
      expect(stati.find(v => v.codice === rentri.statoFisico)).toBeDefined()
      const attivita = await service.codificheRentri('attivita-rs')
      expect(attivita.find(v => v.codice === rentri.operazione)).toBeDefined()
      for (const v of [...stati, ...attivita]) expect(v.descrizione).toBeTruthy()
    })
  })
})
