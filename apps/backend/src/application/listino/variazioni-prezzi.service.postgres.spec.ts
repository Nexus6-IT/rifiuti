/**
 * Variazione dei prezzi dei contratti e adeguamento ISTAT (4.2b, Task 24) contro un Postgres
 * reale, collegato COME `wasteflow_app`, dentro il `TenantContext`. Il proprietario prepara le
 * aziende e legge lo stato finale. Pulizia solo per id esatti creati. Le sovrapposizioni si
 * dimostrano con barriere sullo stato di `pg_stat_activity` (mai attese a tempo).
 */
import { Prisma, PrismaClient } from '@prisma/client'
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
// Le barriere su pg_stat_activity guardano solo le connessioni di questo processo (M6).
const NOME_APPLICAZIONE = `variazioni-prezzi-t24-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  annoSolareItaliano,
  formattaDataItaliana,
  giornoItaliano,
} from '../../core/time/anno-italiano'
import { prezzoCalcolato } from '../../domain/listino/importi-riga'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaAddebito,
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
} from '../../test-support/listino-di-test'
import { RigheAddebitoService } from './righe-addebito.service'
import { VariazioniPrezziService } from './variazioni-prezzi.service'

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

describe('VariazioniPrezziService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: VariazioniPrezziService
  let righeService: RigheAddebitoService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new VariazioniPrezziService(app)
    righeService = new RigheAddebitoService(app)
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
      await owner.codificaContratto.deleteMany({ where: { tenantId: in_ } })
      await owner.activityLog.deleteMany({ where: { tenantId: in_ } })
      await owner.user.deleteMany({ where: { tenantId: in_ } })
      await owner.tenant.deleteMany({ where: { id: in_ } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  // ---------------------------------------------------------------------------------------
  // Fixture
  // ---------------------------------------------------------------------------------------

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Prezzi SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-prezzi-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `prezzi-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    const rif = await creaCodiciIvaEcodifiche(owner, t.id)
    return { tenantId: t.id, utenteId: utente.id, rif }
  }

  const giorno = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  async function cliente(tenantId: string, codice: string) {
    const { ruoloId } = await creaDittaConRuolo(owner, tenantId, 'CLIENTE')
    await owner.cliente.update({ where: { id: ruoloId }, data: { codice } })
    return ruoloId
  }

  interface OpzioniContratto {
    codice: string
    inizio?: string
    fine?: string | null
    istat?: boolean
    stato?: 'ATTIVO' | 'ANNULLATO'
    eliminato?: boolean
    tipoId?: string
    categoriaId?: string
  }

  /** Cliente + contratto (+ elenco 001) con le caratteristiche volute. */
  async function contratto(tenantId: string, utenteId: string, o: OpzioniContratto) {
    const clienteId = await cliente(tenantId, o.codice)
    const c = await creaContrattoConElenco(owner, tenantId, {
      clienteId,
      stato: o.stato ?? 'ATTIVO',
    })
    await owner.contrattoCliente.update({
      where: { id: c.contrattoId },
      data: {
        dataInizio: giorno(o.inizio ?? '2026-01-01'),
        dataFine: o.fine ? giorno(o.fine) : null,
        incrementoIstat: o.istat ?? false,
        tipoId: o.tipoId ?? null,
        categoriaId: o.categoriaId ?? null,
        ...(o.eliminato ? { eliminatoIl: new Date(), eliminatoDa: utenteId } : {}),
      },
    })
    return { ...c, clienteId }
  }

  /** Riga a prezzo speciale con tre fasce: 0,10 / 0,08 / 0 (zero e vuoti restano). */
  async function rigaSpeciale(
    tenantId: string,
    elencoId: string,
    iva: string,
    addebitoId: string,
    fasce: string[] = ['0.10', '0.08', '0']
  ) {
    const r = await creaRiga(owner, tenantId, elencoId, {
      addebitoId,
      riferimento: 'S1',
      codiceIvaId: iva,
      prezzo: null,
      altro: { prezzoSpeciale: true, applicaA: 'DOCUMENTO' },
    })
    const ordini = [1, 2, 7]
    for (let i = 0; i < fasce.length; i++) {
      await owner.scaglioneRigaAddebito.create({
        data: {
          tenantId,
          rigaId: r.id,
          ordine: ordini[i],
          finoA: i < fasce.length - 1 ? String((i + 1) * 100) : null,
          prezzo: fasce[i],
          tipoCalcolo: 'A',
        },
      })
    }
    return r.id
  }

  /**
   * Tre clienti, quattro contratti (uno annullato, uno eliminato) e righe di ogni genere:
   * `aV` (V, prezzo 10, categoria e centro), `aCer` (CER, riferimento R1, 5), `aF` (fisso 100,
   * prima scadenza 31/3), `aSp` (speciale), `bV` (20), `bZero` (prezzo 0).
   */
  async function mondo() {
    const a = await azienda()
    const { tenantId, utenteId, rif } = a
    const tipoC = await owner.codificaContratto.create({
      data: { tenantId, genere: 'TIPO', codice: 'T01', descrizione: 'Tipo di prova' },
    })
    const catC = await owner.codificaContratto.create({
      data: { tenantId, genere: 'CATEGORIA', codice: 'C01', descrizione: 'Categoria di prova' },
    })
    const ca = await contratto(tenantId, utenteId, {
      codice: 'CLA',
      inizio: '2026-01-01',
      tipoId: tipoC.id,
      categoriaId: catC.id,
    })
    const cb = await contratto(tenantId, utenteId, {
      codice: 'CLB',
      inizio: '2025-06-01',
      fine: '2025-12-31',
    })
    const cc = await contratto(tenantId, utenteId, {
      codice: 'CLC',
      inizio: '2024-01-01',
      stato: 'ANNULLATO',
    })
    const cd = await contratto(tenantId, utenteId, {
      codice: 'CLD',
      inizio: '2024-01-01',
      eliminato: true,
    })

    const x = await creaAddebito(owner, tenantId, { tipo: 'V', codiceIvaId: rif.iva22Id })
    const y = await creaAddebito(owner, tenantId, { tipo: 'F', codiceIvaId: rif.iva22Id })
    const iva = rif.iva22Id

    const aV = await creaRiga(owner, tenantId, ca.elencoId, {
      addebitoId: x.id,
      codiceIvaId: iva,
      prezzo: '10',
      altro: { categoriaId: rif.categoriaId, centroRicavoId: rif.centroId },
    })
    const aCer = await creaRiga(owner, tenantId, ca.elencoId, {
      tipo: 'CER',
      cerCode: '20 03 01',
      riferimento: 'R1',
      codiceIvaId: iva,
      prezzo: '5',
    })
    const aF = await creaRiga(owner, tenantId, ca.elencoId, {
      tipo: 'F',
      addebitoId: y.id,
      codiceIvaId: iva,
      prezzo: '100',
    })
    await owner.scadenzaRigaAddebito.create({
      data: { tenantId, rigaId: aF.id, ordine: 1, giorno: 31, mese: 3 },
    })
    const aSp = await rigaSpeciale(tenantId, ca.elencoId, iva, x.id)
    const bV = await creaRiga(owner, tenantId, cb.elencoId, {
      addebitoId: x.id,
      codiceIvaId: iva,
      prezzo: '20',
    })
    const bZero = await creaRiga(owner, tenantId, cb.elencoId, {
      addebitoId: x.id,
      riferimento: 'Z',
      codiceIvaId: iva,
      prezzo: '0',
    })
    const annullata = await creaRiga(owner, tenantId, cc.elencoId, {
      addebitoId: x.id,
      codiceIvaId: iva,
      prezzo: '30',
    })
    const eliminata = await creaRiga(owner, tenantId, cd.elencoId, {
      addebitoId: x.id,
      codiceIvaId: iva,
      prezzo: '40',
    })
    return {
      ...a,
      tipoContrattoId: tipoC.id,
      categoriaContrattoId: catC.id,
      ca,
      cb,
      cc,
      cd,
      x: x.id,
      y: y.id,
      id: {
        aV: aV.id,
        aCer: aCer.id,
        aF: aF.id,
        aSp,
        bV: bV.id,
        bZero: bZero.id,
        annullata: annullata.id,
        eliminata: eliminata.id,
      },
    }
  }
  type Mondo = Awaited<ReturnType<typeof mondo>>

  const corpo = (extra: Record<string, unknown> = {}) =>
    ({ tipo: 'AUMENTO_PERCENTUALE', valore: '10', filtri: {}, ...extra }) as any

  const prezzoDi = async (id: string) => {
    const r = await owner.rigaAddebito.findUniqueOrThrow({ where: { id } })
    return r.prezzo === null ? null : prezzoCalcolato(r.prezzo.toFixed())
  }
  const fasceDi = async (rigaId: string) =>
    (
      await owner.scaglioneRigaAddebito.findMany({ where: { rigaId }, orderBy: { ordine: 'asc' } })
    ).map(f => prezzoCalcolato(f.prezzo.toFixed()))
  const versioneDi = async (id: string) =>
    (await owner.rigaAddebito.findUniqueOrThrow({ where: { id } })).versione
  const audit = (tenantId: string, action: string) =>
    owner.activityLog.findMany({ where: { tenantId, action }, orderBy: { createdAt: 'asc' } })

  /** Anteprima + applicazione con l'impronta giusta. */
  async function variaTutto(m: { tenantId: string; utenteId: string }, c: any) {
    const { impronta } = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))
    return nel(m.tenantId, () => service.applica(m.tenantId, m.utenteId, { ...c, impronta }))
  }

  // ---------------------------------------------------------------------------------------
  // Anteprima e filtri (letture: un solo mondo condiviso)
  // ---------------------------------------------------------------------------------------

  describe('anteprima e filtri', () => {
    let m: Mondo
    beforeAll(async () => {
      m = await mondo()
    })

    const ids = async (filtri: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      (
        await nel(m.tenantId, () => service.anteprima(m.tenantId, corpo({ filtri, ...extra })))
      ).righe
        .map(r => r.id)
        .sort()
    const sono = (...nomi: (keyof Mondo['id'])[]) => nomi.map(k => m.id[k]).sort()

    it('senza filtri: tutte le righe con un prezzo, mai annullate né eliminate; forma di R46', async () => {
      const a = await nel(m.tenantId, () => service.anteprima(m.tenantId, corpo()))
      expect(a.righe.map(r => r.id).sort()).toEqual(sono('aV', 'aCer', 'aF', 'aSp', 'bV'))
      expect(a.totale).toBe(5)
      expect(a.errori).toEqual([])
      expect(a.impronta).toMatch(/^[0-9a-f]{64}$/)
      const aV = a.righe.find(r => r.id === m.id.aV)
      expect(aV).toEqual({
        id: m.id.aV,
        cliente: 'CLA',
        contratto: expect.stringMatching(/^LST-/),
        elenco: '001',
        voce: expect.stringMatching(/^\d{5}$/),
        prima: '10.00',
        dopo: '11.00',
        invariata: false,
      })
      expect(a.righe.find(r => r.id === m.id.aCer)).toMatchObject({
        voce: '20 03 01',
        prima: '5.00',
      })
      // Riga speciale: le fasce, separate da " / "; lo zero resta com'e'.
      expect(a.righe.find(r => r.id === m.id.aSp)).toMatchObject({
        prima: '0.10 / 0.08 / 0.00',
        dopo: '0.11 / 0.09 / 0.00',
      })
    })

    const casi: [string, () => Record<string, unknown>, (keyof Mondo['id'])[]][] = [
      ['addebitoId', () => ({ addebitoId: m.x }), ['aV', 'aSp', 'bV']],
      ['cerCode (senza spazi)', () => ({ cerCode: '200301' }), ['aCer']],
      ['clienteId', () => ({ clienteId: m.cb.clienteId }), ['bV']],
      ['riferimento', () => ({ riferimento: 'R1' }), ['aCer']],
      ['prezzoAttuale per valore ("10,00" = 10)', () => ({ prezzoAttuale: '10,00' }), ['aV']],
      ['prezzoAttuale su una fascia', () => ({ prezzoAttuale: '0,1' }), ['aSp']],
      [
        'anchePrezziZero',
        () => ({ anchePrezziZero: true }),
        ['aV', 'aCer', 'aF', 'aSp', 'bV', 'bZero'],
      ],
      ['tipiPrezzo SPECIALE', () => ({ tipiPrezzo: ['SPECIALE'] }), ['aSp']],
      ['tipiPrezzo NORMALE', () => ({ tipiPrezzo: ['NORMALE'] }), ['aV', 'aCer', 'aF', 'bV']],
      ['tipi', () => ({ tipi: ['F'] }), ['aF']],
      ['categorieAddebitoIds', () => ({ categorieAddebitoIds: [m.rif.categoriaId] }), ['aV']],
      ['centriRicavoIds', () => ({ centriRicavoIds: [m.rif.centroId] }), ['aV']],
      [
        'tipiContrattoIds',
        () => ({ tipiContrattoIds: [m.tipoContrattoId] }),
        ['aV', 'aCer', 'aF', 'aSp'],
      ],
      [
        'categorieContrattoIds',
        () => ({ categorieContrattoIds: [m.categoriaContrattoId] }),
        ['aV', 'aCer', 'aF', 'aSp'],
      ],
      ['inizioDal', () => ({ inizioDal: '2026-01-01' }), ['aV', 'aCer', 'aF', 'aSp']],
      ['inizioAl', () => ({ inizioAl: '2025-12-31' }), ['bV']],
      ['fineDal', () => ({ fineDal: '2025-12-01' }), ['bV']],
      ['fineAl', () => ({ fineAl: '2025-12-31' }), ['bV']],
      ['contrattiIds', () => ({ contrattiIds: [m.ca.contrattoId] }), ['aV', 'aCer', 'aF', 'aSp']],
      ['addebitiIds', () => ({ addebitiIds: [m.y] }), ['aF']],
      ['primaScadenzaFissi', () => ({ primaScadenzaFissi: '2026-03-31' }), ['aF']],
      ['primaScadenzaFissi diversa: nessuna', () => ({ primaScadenzaFissi: '2026-04-30' }), []],
    ]

    it.each(casi)('filtro %s', async (_nome, filtri, attese) => {
      expect(await ids(filtri())).toEqual(sono(...attese))
    })

    it('i filtri si combinano in AND (addebito + cliente)', async () => {
      expect(await ids({ addebitoId: m.x, clienteId: m.ca.clienteId })).toEqual(sono('aV', 'aSp'))
    })

    it('un annullato e un eliminato non entrano mai, nemmeno scelti per id', async () => {
      expect(await ids({ contrattiIds: [m.cc.contrattoId, m.cd.contrattoId] })).toEqual([])
      expect(await ids({ clienteId: m.cc.clienteId })).toEqual([])
    })

    it('soloMinimi: solo le righe a prezzo normale con un minimo, minimo arrotondato a due decimali', async () => {
      await owner.rigaAddebito.update({
        where: { id: m.id.aV },
        data: { minimoFatturabile: '50.00' },
      })
      const a = await nel(m.tenantId, () =>
        service.anteprima(m.tenantId, corpo({ soloMinimi: true, valore: '3.3333' }))
      )
      expect(a.righe).toEqual([
        expect.objectContaining({ id: m.id.aV, prima: '50.00', dopo: '51.67' }),
      ])
      await owner.rigaAddebito.update({ where: { id: m.id.aV }, data: { minimoFatturabile: null } })
    })

    it.each([
      ['tipo non ammesso', { tipo: 'RADDOPPIA' }],
      ['valore mancante', { valore: undefined }],
      ['valore zero', { valore: '0' }],
      ['valore non numerico', { valore: 'abc' }],
      ['sostituzione IVA senza codici', { tipo: 'SOSTITUZIONE_IVA', valore: undefined }],
      ['data non reale', { filtri: { inizioDal: '2026-02-31' } }],
      ['intervallo rovesciato', { filtri: { inizioDal: '2026-02-10', inizioAl: '2026-02-01' } }],
      ['tipo di addebito non ammesso', { filtri: { tipi: ['ZZ'] } }],
      ['prezzo attuale non numerico', { filtri: { prezzoAttuale: 'x' } }],
    ])('corpo non valido (%s): 400', async (_n, extra) => {
      const e = await errore(nel(m.tenantId, () => service.anteprima(m.tenantId, corpo(extra))))
      expect(e.status).toBe(400)
    })

    it('il risultato negativo e’ un errore dell’anteprima, con contratto ed elenco', async () => {
      const a = await nel(m.tenantId, () =>
        service.anteprima(m.tenantId, corpo({ tipo: 'DIMINUZIONE_IMPORTO', valore: '7' }))
      )
      // 10 - 7 = 3 (ok), 5 - 7 < 0, 0.10 - 7 < 0 (fasce)...
      expect(a.errori.map(e => e.id)).toEqual(expect.arrayContaining([m.id.aCer, m.id.aSp]))
      expect(a.errori[0].messaggio).toMatch(
        /^Contratto LST-.*, elenco 001: Il nuovo prezzo sarebbe negativo\.$/
      )
    })
  })

  // ---------------------------------------------------------------------------------------
  // Applicazione
  // ---------------------------------------------------------------------------------------

  describe('applicazione', () => {
    it('+10% su tutto: righe e fasce, zero invariati, annullato/eliminato intatti, versione + 1 e un audit', async () => {
      const m = await mondo()
      const esito = await variaTutto(m, corpo())
      expect(esito).toEqual({ aggiornati: 5 })
      expect(await prezzoDi(m.id.aV)).toBe('11.00')
      expect(await prezzoDi(m.id.aCer)).toBe('5.50')
      expect(await prezzoDi(m.id.aF)).toBe('110.00')
      expect(await prezzoDi(m.id.bV)).toBe('22.00')
      expect(await fasceDi(m.id.aSp)).toEqual(['0.11', '0.09', '0.00'])
      // Mai toccate: prezzo zero, contratto annullato, contratto eliminato.
      expect(await prezzoDi(m.id.bZero)).toBe('0.00')
      expect(await prezzoDi(m.id.annullata)).toBe('30.00')
      expect(await prezzoDi(m.id.eliminata)).toBe('40.00')
      for (const k of ['aV', 'aCer', 'aF', 'aSp', 'bV'] as const) {
        expect(await versioneDi(m.id[k])).toBe(2)
      }
      for (const k of ['bZero', 'annullata', 'eliminata'] as const) {
        expect(await versioneDi(m.id[k])).toBe(1)
      }
      const log = await audit(m.tenantId, 'PREZZI_VARIATI')
      expect(log).toHaveLength(1)
      expect(log[0].metadata).toMatchObject({
        tipo: 'AUMENTO_PERCENTUALE',
        valore: '10',
        soloMinimi: false,
        righe: 5,
        contratti: 2,
        fasce: 2,
      })
      // Niente dati personali nell'audit (D25).
      expect(JSON.stringify(log[0].metadata)).not.toMatch(/CLA|CLB|Ditta di test/)
    })

    it('soloMinimi aggiorna minimo_fatturabile e lascia il prezzo', async () => {
      const m = await mondo()
      await owner.rigaAddebito.update({
        where: { id: m.id.aV },
        data: { minimoFatturabile: '50.00' },
      })
      expect(await variaTutto(m, corpo({ soloMinimi: true }))).toEqual({ aggiornati: 1 })
      const r = await owner.rigaAddebito.findUniqueOrThrow({ where: { id: m.id.aV } })
      expect(r.minimoFatturabile?.toFixed(2)).toBe('55.00')
      expect(await prezzoDi(m.id.aV)).toBe('10.00')
      expect(r.versione).toBe(2)
      expect(await versioneDi(m.id.aCer)).toBe(1)
    })

    it('I1: prezzo zero con anchePrezziZero e percentuale: riga invariata, non scritta', async () => {
      const m = await mondo()
      const c = corpo({ filtri: { anchePrezziZero: true, clienteId: m.cb.clienteId } })
      const a = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))
      expect(a.totale).toBe(1)
      expect(a.invariate).toBe(1)
      expect(a.righe.find(r => r.id === m.id.bZero)).toMatchObject({
        invariata: true,
        dopo: '0.00',
      })
      expect(await variaTutto(m, c)).toEqual({ aggiornati: 1 })
      expect(await versioneDi(m.id.bZero)).toBe(1)
      expect(await versioneDi(m.id.bV)).toBe(2)
    })

    it('I1: soloMinimi con un importo sotto il centesimo: invariata, non scritta', async () => {
      const m = await mondo()
      await owner.rigaAddebito.update({
        where: { id: m.id.aV },
        data: { minimoFatturabile: '50.00' },
      })
      const c = corpo({ tipo: 'AUMENTO_IMPORTO', valore: '0,004', soloMinimi: true })
      const a = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))
      expect(a).toMatchObject({ totale: 0, invariate: 1 })
      expect(await variaTutto(m, c)).toEqual({ aggiornati: 0 })
      expect(await versioneDi(m.id.aV)).toBe(1)
      expect(await audit(m.tenantId, 'PREZZI_VARIATI')).toHaveLength(1)
    })

    it('I1: una riga speciale con alcune fasce invariate scrive solo le fasce che cambiano', async () => {
      const m = await mondo()
      await owner.scaglioneRigaAddebito.updateMany({
        where: { rigaId: m.id.aSp, ordine: 2 },
        data: { prezzo: '5' },
      })
      const c = corpo({ valore: '3', filtri: { addebitoId: m.x } })
      expect(await variaTutto(m, c)).toEqual({ aggiornati: 3 })
      // 0.10 + 3% = 0.103 -> 0.10 (invariata); 5 + 3% = 5.15.
      expect(await fasceDi(m.id.aSp)).toEqual(['0.10', '5.15', '0.00'])
      expect(await versioneDi(m.id.aSp)).toBe(2)
      const [log] = await audit(m.tenantId, 'PREZZI_VARIATI')
      expect(log.metadata).toMatchObject({ righe: 3, fasce: 1, invariate: 0 })
      expect((log.metadata as { impronta: string }).impronta).toMatch(/^[0-9a-f]{64}$/)
    })

    it('aumento d’importo: fino a 6 decimali; diminuzione che porta a zero ammessa', async () => {
      const m = await mondo()
      await variaTutto(
        m,
        corpo({ tipo: 'AUMENTO_IMPORTO', valore: '0,000001', filtri: { addebitoId: m.x } })
      )
      expect(await fasceDi(m.id.aSp)).toEqual(['0.100001', '0.080001', '0.00'])
      expect(await prezzoDi(m.id.aV)).toBe('10.000001')
    })

    it('sostituzione IVA: codice nuovo sulle righe, prezzi e fasce invariati, versione + 1', async () => {
      const m = await mondo()
      const c = {
        tipo: 'SOSTITUZIONE_IVA',
        daCodiceIvaId: m.rif.iva22Id,
        aCodiceIvaId: m.rif.ivaN61Id,
        filtri: { addebitoId: m.x },
      }
      const a = await nel(m.tenantId, () => service.anteprima(m.tenantId, c as any))
      // La sostituzione guarda solo il codice IVA: anche la riga a prezzo zero cambia.
      expect(a.righe.map(r => [r.prima, r.dopo])).toEqual(Array(4).fill(['22', 'N61']))
      expect(await variaTutto(m, c)).toEqual({ aggiornati: 4 })
      for (const k of ['aV', 'aSp', 'bV', 'bZero'] as const) {
        const r = await owner.rigaAddebito.findUniqueOrThrow({ where: { id: m.id[k] } })
        expect(r.codiceIvaId).toBe(m.rif.ivaN61Id)
        expect(r.versione).toBe(2)
      }
      expect(await prezzoDi(m.id.aV)).toBe('10.00')
      expect(await fasceDi(m.id.aSp)).toEqual(['0.10', '0.08', '0.00'])
      // Gli altri codici IVA, e annullati/eliminati, restano.
      expect(
        (await owner.rigaAddebito.findUniqueOrThrow({ where: { id: m.id.aCer } })).codiceIvaId
      ).toBe(m.rif.iva22Id)
      expect(
        (await owner.rigaAddebito.findUniqueOrThrow({ where: { id: m.id.annullata } })).codiceIvaId
      ).toBe(m.rif.iva22Id)
    })

    it('sostituzione IVA con codice disattivato: 400', async () => {
      const m = await mondo()
      await owner.codiceIva.update({ where: { id: m.rif.ivaN61Id }, data: { attivo: false } })
      const e = await errore(
        nel(m.tenantId, () =>
          service.anteprima(m.tenantId, {
            tipo: 'SOSTITUZIONE_IVA',
            daCodiceIvaId: m.rif.iva22Id,
            aCodiceIvaId: m.rif.ivaN61Id,
            filtri: {},
          } as any)
        )
      )
      expect(e.status).toBe(400)
    })

    it('soloMinimi con la sostituzione IVA: 400', async () => {
      const m = await mondo()
      const e = await errore(
        nel(m.tenantId, () =>
          service.anteprima(m.tenantId, {
            tipo: 'SOSTITUZIONE_IVA',
            daCodiceIvaId: m.rif.iva22Id,
            aCodiceIvaId: m.rif.ivaN61Id,
            soloMinimi: true,
            filtri: {},
          } as any)
        )
      )
      expect(e.status).toBe(400)
    })

    it('negativo: l’applicazione è 400 e non scrive nulla', async () => {
      const m = await mondo()
      const c = corpo({ tipo: 'DIMINUZIONE_IMPORTO', valore: '7' })
      const { impronta, errori } = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))
      expect(errori.length).toBeGreaterThan(0)
      const e = await errore(
        nel(m.tenantId, () => service.applica(m.tenantId, m.utenteId, { ...c, impronta }))
      )
      expect(e.status).toBe(400)
      expect(e.getResponse()).toMatchObject({ error: 'VARIAZIONE_CON_ERRORI' })
      expect(await prezzoDi(m.id.aV)).toBe('10.00')
      expect(await fasceDi(m.id.aSp)).toEqual(['0.10', '0.08', '0.00'])
      expect(await audit(m.tenantId, 'PREZZI_VARIATI')).toHaveLength(0)
    })

    it('impronta superata (una riga modificata dopo l’anteprima): 409 e nulla scritto', async () => {
      const m = await mondo()
      const c = corpo()
      const { impronta } = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))
      await owner.rigaAddebito.update({
        where: { id: m.id.bV },
        data: { versione: { increment: 1 } },
      })
      const e = await errore(
        nel(m.tenantId, () => service.applica(m.tenantId, m.utenteId, { ...c, impronta }))
      )
      expect(e.status).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'VARIAZIONE_SUPERATA' })
      expect(await prezzoDi(m.id.aV)).toBe('10.00')
      expect(await prezzoDi(m.id.bV)).toBe('20.00')
      expect(await audit(m.tenantId, 'PREZZI_VARIATI')).toHaveLength(0)
    })

    it('un’impronta presa con un corpo diverso non vale per un altro (parametri nell’impronta)', async () => {
      const m = await mondo()
      const { impronta } = await nel(m.tenantId, () => service.anteprima(m.tenantId, corpo()))
      const e = await errore(
        nel(m.tenantId, () =>
          service.applica(m.tenantId, m.utenteId, { ...corpo({ valore: '50' }), impronta })
        )
      )
      expect(e.status).toBe(409)
    })

    it('un contratto annullato dopo l’anteprima cambia l’insieme: 409', async () => {
      const m = await mondo()
      const c = corpo()
      const { impronta } = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))
      await owner.contrattoCliente.update({
        where: { id: m.cb.contrattoId },
        data: { stato: 'ANNULLATO', motivoAnnullo: 'Prova', annullatoIl: new Date() },
      })
      const e = await errore(
        nel(m.tenantId, () => service.applica(m.tenantId, m.utenteId, { ...c, impronta }))
      )
      expect(e.status).toBe(409)
      expect(await prezzoDi(m.id.bV)).toBe('20.00')
    })

    it('due applicazioni in parallelo con la stessa impronta: una passa, l’altra 409', async () => {
      const m = await mondo()
      const c = corpo({ filtri: { addebitoId: m.x } })
      const { impronta } = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))
      const esiti = await Promise.allSettled([
        nel(m.tenantId, () => service.applica(m.tenantId, m.utenteId, { ...c, impronta })),
        nel(m.tenantId, () => service.applica(m.tenantId, m.utenteId, { ...c, impronta })),
      ])
      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      const rifiutata = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
      expect(rifiutata.reason).toMatchObject({ status: 409 })
      expect(await prezzoDi(m.id.aV)).toBe('11.00')
      expect(await audit(m.tenantId, 'PREZZI_VARIATI')).toHaveLength(1)
    })

    it('isolamento: la variazione non tocca le righe di un’altra azienda', async () => {
      const mia = await mondo()
      const altra = await mondo()
      await variaTutto(mia, corpo())
      expect(await prezzoDi(altra.id.aV)).toBe('10.00')
      expect(await versioneDi(altra.id.aV)).toBe(1)
      expect(await audit(altra.tenantId, 'PREZZI_VARIATI')).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------------------
  // Tetti
  // ---------------------------------------------------------------------------------------

  describe('tetti', () => {
    async function conMolteRighe(quante: number) {
      const a = await azienda()
      const c = await contratto(a.tenantId, a.utenteId, { codice: 'MOL' })
      const x = await creaAddebito(owner, a.tenantId, { tipo: 'V', codiceIvaId: a.rif.iva22Id })
      await owner.rigaAddebito.createMany({
        data: Array.from({ length: quante }, (_, i) => ({
          tenantId: a.tenantId,
          elencoId: c.elencoId,
          tipo: 'V',
          addebitoId: x.id,
          riferimento: `q${i}`,
          tipoQuantita: 'PESO_NETTO' as const,
          unitaMisura: 'KG',
          prezzo: '1',
          codiceIvaId: a.rif.iva22Id,
        })),
      })
      // Niente `ANALYZE`: dopo una scrittura in massa le statistiche del planner sono quelle della
      // tabella vuota finche' l'autovacuum non passa, ed e' il caso reale di una copia appena fatta
      // (M12). Il servizio legge con `id = ANY(uuid[])` una tabella alla volta proprio per non
      // dipendere dal piano scelto: i tempi di questi test lo dimostrano.
      return a
    }

    it('l’anteprima mostra le prime 200 righe e conta tutte', async () => {
      const a = await conMolteRighe(205)
      const r = await nel(a.tenantId, () => service.anteprima(a.tenantId, corpo()))
      expect(r.totale).toBe(205)
      expect(r.righe).toHaveLength(200)
    })

    it('oltre 10.000 righe: 400 "restringi i filtri", anche all’applicazione', async () => {
      const a = await conMolteRighe(10_001)
      const e = await errore(nel(a.tenantId, () => service.anteprima(a.tenantId, corpo())))
      expect(e.status).toBe(400)
      expect(e.getResponse()).toMatchObject({
        error: 'VARIAZIONE_TROPPE_RIGHE',
        message: ['La variazione tocca troppe righe: restringi i filtri.'],
      })
      const e2 = await errore(
        nel(a.tenantId, () =>
          service.applica(a.tenantId, a.utenteId, { ...corpo(), impronta: 'a'.repeat(64) })
        )
      )
      expect(e2.status).toBe(400)
    }, 60_000)

    it('esattamente 10.000 righe: l’anteprima e l’applicazione passano', async () => {
      const a = await conMolteRighe(10_000)
      // Regressione `= ANY(uuid[])` (M12): in produzione Prisma passa al piano generico dopo ~5
      // esecuzioni e, con le statistiche della tabella vuota, il planner scansiona 10.000 righe
      // x 10.000 elementi (32 s). Qui lo si forza su qualunque database, anche uno gia' usato:
      // piano generico per il ruolo applicativo (connessioni nuove) e statistiche che stimano una
      // riga sola (verificato: col vecchio `= ANY` questo test fallisce, 36 s).
      await owner.$executeRaw`ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`
      try {
        await owner.$executeRaw`DELETE FROM pg_statistic
          WHERE starelid IN ('righe_addebito'::regclass, 'scaglioni_riga_addebito'::regclass)`
        await owner.$executeRaw`UPDATE pg_class SET reltuples = 1, relpages = 100000
          WHERE oid IN ('righe_addebito'::regclass, 'scaglioni_riga_addebito'::regclass)`
        await app.$disconnect()
        await app.$connect()
        const t0 = Date.now()
        await eseguiVariazioneCompleta(a)
        expect(Date.now() - t0).toBeLessThan(8_000)
      } finally {
        await owner.$executeRaw`ALTER ROLE wasteflow_app RESET plan_cache_mode`
        // Statistiche vere per le suite che seguono sullo stesso database.
        await owner.$executeRaw`ANALYZE righe_addebito`
        await owner.$executeRaw`ANALYZE scaglioni_riga_addebito`
      }
    }, 90_000)

    async function eseguiVariazioneCompleta(a: Awaited<ReturnType<typeof conMolteRighe>>) {
      const r = await nel(a.tenantId, () => service.anteprima(a.tenantId, corpo()))
      expect(r.totale).toBe(10_000)
      const esito = await nel(a.tenantId, () =>
        service.applica(a.tenantId, a.utenteId, { ...corpo(), impronta: r.impronta })
      )
      expect(esito).toEqual({ aggiornati: 10_000 })
      const nuove = await owner.rigaAddebito.count({
        where: { tenantId: a.tenantId, prezzo: '1.1', versione: 2 },
      })
      expect(nuove).toBe(10_000)
    }
  })

  // ---------------------------------------------------------------------------------------
  // Concorrenza (R46): sovrapposizione dimostrata con barriere su pg_stat_activity
  // ---------------------------------------------------------------------------------------

  describe('concorrenza', () => {
    /** Aspetta una condizione sul database, cedendo il turno: nessuna attesa a tempo. */
    async function finche(condizione: () => Promise<boolean>, cosa: string) {
      const limite = Date.now() + 25_000
      while (!(await condizione())) {
        if (Date.now() > limite) throw new Error(`non si è mai verificato: ${cosa}`)
        await new Promise(r => setImmediate(r))
      }
    }
    /** Backend in attesa di un lock con una query che contiene il frammento. */
    const inAttesa = async (frammento: string) => {
      const r = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
          AND wait_event_type = 'Lock' AND query LIKE ${frammento}`
      return r[0].n
    }

    /** Transazione del proprietario che prende un lock e lo tiene finche' non si rilascia. */
    function trattieni(sql: Prisma.Sql) {
      let rilascia!: () => void
      const attesa = new Promise<void>(r => (rilascia = r))
      let pronto!: () => void
      const preso = new Promise<void>(r => (pronto = r))
      const fine = owner.$transaction(
        async tx => {
          await tx.$queryRaw(sql)
          pronto()
          await attesa
        },
        { timeout: 60_000, maxWait: 10_000 }
      )
      return { preso, rilascia, fine }
    }

    it('riga modificata durante la variazione: la variazione passa, il salvataggio del collega è 409', async () => {
      const m = await mondo()
      const c = corpo({ filtri: { contrattiIds: [m.ca.contrattoId] } })
      const { impronta } = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))

      // Un blocco sulle fasce della riga speciale ferma la variazione DOPO che ha preso i lock
      // delle righe (ordine R46: righe, poi fasce).
      const blocco = trattieni(
        Prisma.sql`SELECT id FROM scaglioni_riga_addebito WHERE riga_id = ${m.id.aSp}::uuid FOR UPDATE`
      )
      await blocco.preso
      const variazione = nel(m.tenantId, () =>
        service.applica(m.tenantId, m.utenteId, { ...c, impronta })
      )
      await finche(
        async () => (await inAttesa('%scaglioni_riga_addebito%FOR NO KEY UPDATE%')) === 1,
        'la variazione attende il lock delle fasce'
      )

      // Il collega salva la riga aV (versione 1): legge, poi aspetta il lock della riga.
      const collega = nel(m.tenantId, () =>
        righeService.modifica(m.tenantId, m.utenteId, m.id.aV, {
          versione: 1,
          appunti: 'del collega',
        })
      )
      const esitoCollega = collega.then(
        () => null,
        (e: unknown) => e
      )
      await finche(
        async () => (await inAttesa('%UPDATE "public"."righe_addebito" SET%')) === 1,
        'il collega attende il lock della riga'
      )

      blocco.rilascia()
      await blocco.fine
      expect(await variazione).toEqual({ aggiornati: 4 })
      const e = (await esitoCollega) as any
      expect(e).not.toBeNull()
      expect(e.status).toBe(409)
      expect(e.getResponse()).toMatchObject({
        error: expect.stringMatching(/MODIFICATA_NEL_FRATTEMPO$/),
      })

      // Vince la variazione: nessuna sovrascrittura silenziosa del collega.
      expect(await prezzoDi(m.id.aV)).toBe('11.00')
      const r = await owner.rigaAddebito.findUniqueOrThrow({ where: { id: m.id.aV } })
      expect(r.appunti).toBeNull()
      expect(r.versione).toBe(2)
    }, 60_000)

    it('55P03 vero: un lock tenuto oltre i 10 s → 409 VARIAZIONE_SUPERATA e nulla scritto', async () => {
      const m = await mondo()
      const c = corpo({ filtri: { contrattiIds: [m.ca.contrattoId] } })
      const { impronta } = await nel(m.tenantId, () => service.anteprima(m.tenantId, c))
      const blocco = trattieni(
        Prisma.sql`SELECT id FROM righe_addebito WHERE id = ${m.id.aCer}::uuid FOR UPDATE`
      )
      await blocco.preso
      const e = await errore(
        nel(m.tenantId, () => service.applica(m.tenantId, m.utenteId, { ...c, impronta }))
      )
      blocco.rilascia()
      await blocco.fine
      expect(e.status).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'VARIAZIONE_SUPERATA' })
      expect(await prezzoDi(m.id.aV)).toBe('10.00')
      expect(await versioneDi(m.id.aV)).toBe(1)
      expect(await audit(m.tenantId, 'PREZZI_VARIATI')).toHaveLength(0)
    }, 60_000)
  })

  // ---------------------------------------------------------------------------------------
  // ISTAT
  // ---------------------------------------------------------------------------------------

  describe('adeguamento ISTAT', () => {
    const annoCorrente = annoSolareItaliano(new Date())

    /** Contratti per mese di inizio; `i1` e `i3` col flag, `i2` senza, `i6` annullato col flag. */
    async function mondoIstat() {
      const a = await azienda()
      const { tenantId, utenteId, rif } = a
      const x = await creaAddebito(owner, tenantId, { tipo: 'V', codiceIvaId: rif.iva22Id })
      const f = await creaAddebito(owner, tenantId, { tipo: 'F', codiceIvaId: rif.iva22Id })
      const riga = async (elencoId: string, prezzo: string, tipo: 'V' | 'F' = 'V') =>
        (
          await creaRiga(owner, tenantId, elencoId, {
            tipo,
            addebitoId: tipo === 'V' ? x.id : f.id,
            codiceIvaId: rif.iva22Id,
            prezzo,
          })
        ).id
      const i1 = await contratto(tenantId, utenteId, {
        codice: 'I01',
        inizio: '2010-03-15',
        istat: true,
      })
      const i2 = await contratto(tenantId, utenteId, {
        codice: 'I02',
        inizio: '2010-03-20',
        istat: false,
      })
      const i3 = await contratto(tenantId, utenteId, {
        codice: 'I03',
        inizio: '2011-05-10',
        istat: true,
      })
      const i4 = await contratto(tenantId, utenteId, {
        codice: 'I04',
        inizio: `${annoCorrente}-01-10`,
        istat: true,
      })
      const i5 = await contratto(tenantId, utenteId, {
        codice: 'I05',
        inizio: `${annoCorrente - 1}-02-10`,
        istat: true,
      })
      const i6 = await contratto(tenantId, utenteId, {
        codice: 'I06',
        inizio: '2010-03-01',
        istat: true,
        stato: 'ANNULLATO',
      })
      const id = {
        i1V: await riga(i1.elencoId, '10'),
        i1F: await riga(i1.elencoId, '200', 'F'),
        i1Sp: await rigaSpeciale(tenantId, i1.elencoId, rif.iva22Id, x.id),
        i2V: await riga(i2.elencoId, '20'),
        i3V: await riga(i3.elencoId, '100'),
        i4V: await riga(i4.elencoId, '7'),
        i5V: await riga(i5.elencoId, '8'),
        i6V: await riga(i6.elencoId, '50'),
      }
      return { ...a, id }
    }
    type MondoIstat = Awaited<ReturnType<typeof mondoIstat>>

    const percentuali = [
      { anno: 2010, mese: 3, percentuale: '3,0' },
      { anno: 2011, mese: 5, percentuale: '2.5' },
    ]
    const istat = (extra: Record<string, unknown> = {}) =>
      ({ percentuali, tipi: ['V'], ...extra }) as any

    describe('mesi', () => {
      it('solo i contratti col flag, non annullati; anno corrente e precedente esclusi', async () => {
        const m = await mondoIstat()
        const mesi = await nel(m.tenantId, () => service.mesiIstat(m.tenantId, false))
        expect(mesi).toEqual([
          { anno: 2010, mese: 3, contratti: 1, ultimaApplicazione: null },
          { anno: 2011, mese: 5, contratti: 1, ultimaApplicazione: null },
        ])
      })

      it('con ancheAnnoPrecedente compare l’anno precedente, mai il corrente', async () => {
        const m = await mondoIstat()
        const mesi = await nel(m.tenantId, () => service.mesiIstat(m.tenantId, true))
        expect(mesi).toEqual([
          { anno: 2010, mese: 3, contratti: 1, ultimaApplicazione: null },
          { anno: 2011, mese: 5, contratti: 1, ultimaApplicazione: null },
          { anno: annoCorrente - 1, mese: 2, contratti: 1, ultimaApplicazione: null },
        ])
      })

      it('M3: ultimaApplicazione è null finché l’ISTAT non è applicato, poi la data italiana', async () => {
        const m = await mondoIstat()
        const prima = await nel(m.tenantId, () => service.mesiIstat(m.tenantId, false))
        expect(prima.map(x => x.ultimaApplicazione)).toEqual([null, null])
        const c = istat({ percentuali: [{ anno: 2010, mese: 3, percentuale: '3' }] })
        const { impronta } = await nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, c))
        await nel(m.tenantId, () =>
          service.applicaIstat(m.tenantId, m.utenteId, { ...c, impronta })
        )
        const oggi = giornoItaliano(new Date())
        const dopo = await nel(m.tenantId, () => service.mesiIstat(m.tenantId, false))
        expect(dopo).toEqual([
          { anno: 2010, mese: 3, contratti: 1, ultimaApplicazione: oggi },
          { anno: 2011, mese: 5, contratti: 1, ultimaApplicazione: null },
        ])
      })

      it('M3: l’ultima applicazione è per azienda', async () => {
        const mia = await mondoIstat()
        const altra = await mondoIstat()
        const { impronta } = await nel(mia.tenantId, () =>
          service.anteprimaIstat(mia.tenantId, istat())
        )
        await nel(mia.tenantId, () =>
          service.applicaIstat(mia.tenantId, mia.utenteId, { ...istat(), impronta })
        )
        const mesi = await nel(altra.tenantId, () => service.mesiIstat(altra.tenantId, false))
        expect(mesi.every(x => x.ultimaApplicazione === null)).toBe(true)
      })

      it('un’altra azienda non compare; un contratto eliminato nemmeno', async () => {
        const m = await mondoIstat()
        const altra = await mondoIstat()
        const eliminato = await contratto(altra.tenantId, altra.utenteId, {
          codice: 'IEL',
          inizio: '2010-03-02',
          istat: true,
          eliminato: true,
        })
        expect(eliminato.contrattoId).toBeTruthy()
        const mesi = await nel(altra.tenantId, () => service.mesiIstat(altra.tenantId, false))
        expect(mesi[0]).toEqual({ anno: 2010, mese: 3, contratti: 1, ultimaApplicazione: null })
        expect(await nel(m.tenantId, () => service.mesiIstat(m.tenantId, false))).toHaveLength(2)
      })
    })

    it('anteprima: solo i contratti col flag, nel mese giusto, per i tipi scelti; ciascuno con la sua percentuale', async () => {
      const m = await mondoIstat()
      const a = await nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, istat()))
      const per = (id: string) => a.righe.find(r => r.id === id)
      expect(a.righe.map(r => r.id).sort()).toEqual([m.id.i1V, m.id.i1Sp, m.id.i3V].sort())
      expect(per(m.id.i1V)).toMatchObject({ prima: '10.00', dopo: '10.30' })
      expect(per(m.id.i3V)).toMatchObject({ prima: '100.00', dopo: '102.50' })
      // Riga speciale al +3%: 0.103 e 0.0824 a due decimali restano 0.10 e 0.08.
      expect(per(m.id.i1Sp)?.dopo).toBe('0.10 / 0.08 / 0.00')
      // Le righe che non cambiano restano visibili, ma non sono "da modificare" (I1).
      expect(per(m.id.i1Sp)?.invariata).toBe(true)
      expect(per(m.id.i1V)?.invariata).toBe(false)
      expect(a.totale).toBe(2)
      expect(a.invariate).toBe(1)
    })

    it('I1: una riga che non cambia non si scrive: versione, aggiornati e audit la ignorano', async () => {
      const m = await mondoIstat()
      const { impronta } = await nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, istat()))
      const esito = await nel(m.tenantId, () =>
        service.applicaIstat(m.tenantId, m.utenteId, { ...istat(), impronta })
      )
      expect(esito).toEqual({ aggiornati: 2 })
      expect(await versioneDi(m.id.i1Sp)).toBe(1)
      expect(await fasceDi(m.id.i1Sp)).toEqual(['0.10', '0.08', '0.00'])
      expect(await versioneDi(m.id.i1V)).toBe(2)
      const [log] = await audit(m.tenantId, 'PREZZI_ISTAT')
      expect(log.metadata).toMatchObject({ righe: 2, contratti: 2, fasce: 0, invariate: 1 })
    })

    it('un contratto senza incremento ISTAT: invariato (e anche annullato, anno corrente, precedente)', async () => {
      const m = await mondoIstat()
      const { impronta } = await nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, istat()))
      await nel(m.tenantId, () =>
        service.applicaIstat(m.tenantId, m.utenteId, { ...istat(), impronta })
      )
      expect(await prezzoDi(m.id.i1V)).toBe('10.30')
      expect(await prezzoDi(m.id.i3V)).toBe('102.50')
      expect(await prezzoDi(m.id.i2V)).toBe('20.00')
      expect(await prezzoDi(m.id.i4V)).toBe('7.00')
      expect(await prezzoDi(m.id.i5V)).toBe('8.00')
      expect(await prezzoDi(m.id.i6V)).toBe('50.00')
      // Il fisso non e' fra i tipi scelti.
      expect(await prezzoDi(m.id.i1F)).toBe('200.00')
      expect(await versioneDi(m.id.i2V)).toBe(1)
      expect(await versioneDi(m.id.i1V)).toBe(2)
    })

    it('le fasce delle righe speciali si adeguano con la percentuale del mese', async () => {
      const m = await mondoIstat()
      const c = istat({ percentuali: [{ anno: 2010, mese: 3, percentuale: '50' }] })
      const { impronta } = await nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, c))
      await nel(m.tenantId, () => service.applicaIstat(m.tenantId, m.utenteId, { ...c, impronta }))
      expect(await fasceDi(m.id.i1Sp)).toEqual(['0.15', '0.12', '0.00'])
      expect(await prezzoDi(m.id.i1V)).toBe('15.00')
      expect(await prezzoDi(m.id.i3V)).toBe('100.00')
    })

    it('applicato due volte per errore: la seconda anteprima mostra i prezzi già aumentati e l’audit distingue le due applicazioni', async () => {
      const m = await mondoIstat()
      const prima = await nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, istat()))
      await nel(m.tenantId, () =>
        service.applicaIstat(m.tenantId, m.utenteId, { ...istat(), impronta: prima.impronta })
      )
      // La vecchia anteprima non vale piu'.
      const rifiutata = await errore(
        nel(m.tenantId, () =>
          service.applicaIstat(m.tenantId, m.utenteId, { ...istat(), impronta: prima.impronta })
        )
      )
      expect(rifiutata.status).toBe(409)

      const seconda = await nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, istat()))
      expect(seconda.righe.find(r => r.id === m.id.i1V)).toMatchObject({
        prima: '10.30',
        dopo: '10.61',
      })
      expect(seconda.impronta).not.toBe(prima.impronta)
      // M3: la seconda anteprima avvisa che il mese è già stato adeguato, senza impedirlo.
      expect(prima.avvisi).toEqual([])
      const d = formattaDataItaliana(new Date())
      expect(seconda.avvisi).toEqual([
        `ISTAT di marzo 2010 già applicato il ${d} a 1 contratto`,
        `ISTAT di maggio 2011 già applicato il ${d} a 1 contratto`,
      ])
      await nel(m.tenantId, () =>
        service.applicaIstat(m.tenantId, m.utenteId, { ...istat(), impronta: seconda.impronta })
      )
      expect(await prezzoDi(m.id.i1V)).toBe('10.61')

      // Un audit per applicazione, con le percentuali e i conteggi.
      const log = await audit(m.tenantId, 'PREZZI_ISTAT')
      expect(log).toHaveLength(2)
      expect(log[0].id).not.toBe(log[1].id)
      expect(log[0].metadata).toMatchObject({
        percentuali: [
          { anno: 2010, mese: 3, percentuale: '3' },
          { anno: 2011, mese: 5, percentuale: '2.5' },
        ],
        tipi: ['V'],
        righe: 2,
        contratti: 2,
        impronta: prima.impronta,
      })
      expect((log[1].metadata as { impronta: string }).impronta).toBe(seconda.impronta)
      expect(log[1].createdAt.getTime()).toBeGreaterThanOrEqual(log[0].createdAt.getTime())
    })

    it('tipi scelti: il fisso si adegua se scelto, la V no', async () => {
      const m = await mondoIstat()
      const c = istat({ tipi: ['F'] })
      const { impronta } = await nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, c))
      await nel(m.tenantId, () => service.applicaIstat(m.tenantId, m.utenteId, { ...c, impronta }))
      expect(await prezzoDi(m.id.i1F)).toBe('206.00')
      expect(await prezzoDi(m.id.i1V)).toBe('10.00')
    })

    it.each([
      [
        'percentuali non decrescenti dai mesi più vecchi ai più recenti',
        {
          percentuali: [
            { anno: 2010, mese: 3, percentuale: '2' },
            { anno: 2011, mese: 5, percentuale: '3' },
          ],
        },
        'Le percentuali devono essere decrescenti dai mesi più vecchi ai più recenti.',
      ],
      [
        'percentuale zero',
        { percentuali: [{ anno: 2010, mese: 3, percentuale: '0' }] },
        'La percentuale deve essere maggiore di 0 e minore di 100.',
      ],
      [
        'percentuale 100',
        { percentuali: [{ anno: 2010, mese: 3, percentuale: '100' }] },
        'La percentuale deve essere maggiore di 0 e minore di 100.',
      ],
      ['nessun tipo', { tipi: [] }, 'Scegli almeno un tipo di addebito.'],
      ['tipo non ammesso', { tipi: ['ZZ'] }, 'Il tipo di addebito non è ammesso.'],
      ['nessuna percentuale', { percentuali: [] }, 'Indica almeno una percentuale.'],
      [
        'anno corrente',
        { percentuali: [{ anno: annoCorrente, mese: 1, percentuale: '2' }] },
        'L’adeguamento ISTAT riguarda i contratti iniziati prima dell’anno in corso.',
      ],
    ])('%s → 400', async (_nome, extra, messaggio) => {
      const m = await mondoIstat()
      const e = await errore(
        nel(m.tenantId, () => service.anteprimaIstat(m.tenantId, istat(extra)))
      )
      expect(e.status).toBe(400)
      expect(e.getResponse().message).toContain(messaggio)
      const e2 = await errore(
        nel(m.tenantId, () =>
          service.applicaIstat(m.tenantId, m.utenteId, {
            ...istat(extra),
            impronta: 'a'.repeat(64),
          })
        )
      )
      expect(e2.status).toBe(400)
      expect(await audit(m.tenantId, 'PREZZI_ISTAT')).toHaveLength(0)
    })

    it('isolamento fra aziende', async () => {
      const mia = await mondoIstat()
      const altra: MondoIstat = await mondoIstat()
      const { impronta } = await nel(mia.tenantId, () =>
        service.anteprimaIstat(mia.tenantId, istat())
      )
      await nel(mia.tenantId, () =>
        service.applicaIstat(mia.tenantId, mia.utenteId, { ...istat(), impronta })
      )
      expect(await prezzoDi(altra.id.i1V)).toBe('10.00')
      expect(await audit(altra.tenantId, 'PREZZI_ISTAT')).toHaveLength(0)
    })
  })
})
