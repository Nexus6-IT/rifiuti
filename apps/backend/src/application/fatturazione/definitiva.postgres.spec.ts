/**
 * Definitiva di un'elaborazione (fase 4.4b1, Task 19, spec §5.4) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS FORCE) dentro il `TenantContext`. Il proprietario prepara gli
 * scenari e legge lo stato finale; pulizia solo per id esatti (`pulisciTenantDiTest`, anche dei
 * DEFINITIVI: il proprietario e' superuser, base 4.4). La coda e' finta (`add` registrato): il job
 * lo esegue il test chiamando `eseguiDefinitiva`, come farebbe il worker.
 *
 * Qui il comportamento (esiti, atomicita', rilancio, doppio clic, marcatori). Concorrenza con la
 * 4.3 e volume stanno in `definitiva.concorrenza.postgres.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t19-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaBancoT19,
  esitoHttp as esito,
  PARAMETRI_T19,
  type BancoT19,
} from '../../test-support/fatturazione-t19-di-test'
import { creaDocumentoDiTest } from '../../test-support/fatturazione-di-test'
import { creaMovimentoDiTest, pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { creaLegameDiTest } from '../../test-support/legami-di-test'
import { eseguiAnteprima } from './anteprima'
import { eseguiDefinitiva } from './definitiva'
import * as lockFatturazione from './lock-fatturazione'
import { insiemiPerDefinitiva } from './lock-fatturazione'
import { ERRORI_GENERALI_BLOCCANTI } from '../../domain/fatturazione/codici'

describe('Definitiva — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT19
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT19({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => b.reset())
  /** Job della definitiva accodati (l'avvio accoda sempre quello dell'anteprima). */
  const jobDefinitiva = () => b.coda.add.mock.calls.filter(c => c[0] === 'definitiva')
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  // -------------------------------------------------------------------------------------------
  // Esito
  // -------------------------------------------------------------------------------------------

  describe('esito', () => {
    it('numeri consecutivi per registro nell’ordine del passo 7, legami FATTURATO con documento e riferimento, marcatori con la riga giusta, elaborazione DEFINITIVA', async () => {
      const az = await b.azienda()
      // Secondo registro, con suffisso della serie.
      const reg2 = await owner.registroIva.create({
        data: { tenantId: az.tenantId, codice: '03', descrizione: 'Altro registro' },
      })
      await owner.$executeRawUnsafe(
        `UPDATE registri_iva SET suffisso_numero = '/B' WHERE id = $1::uuid`,
        reg2.id
      )
      // Registro 01: Alfa (T1-5) -> Beta (T1-1, T1-2: stesso cliente, numero del contratto) -> Zeta.
      const zeta = await b.contratto(az, { ragione: 'Zeta SRL', numero: 'T1-0' })
      const beta2 = await b.contratto(az, { ragione: 'Beta SRL', numero: 'T1-2' })
      const beta1 = await b.contratto(az, { clienteId: beta2.clienteId, numero: 'T1-1' })
      const alfa = await b.contratto(az, { ragione: 'Alfa SRL', numero: 'T1-5', fisso: true })
      const altro = await b.contratto(az, { ragione: 'Omega SRL', registroIvaId: reg2.id })

      const e = await b.pronta(az)
      const esito = await b.definitiva(az, e)
      expect(esito.esito).toBe('DEFINITIVA')
      if (esito.esito !== 'DEFINITIVA') return
      expect(esito.documenti).toBe(5)
      expect(esito.numeri.map(n => [n.registroIvaId, n.da, n.a, n.suffisso]).sort()).toEqual(
        [
          [az.tab.registroId, 1, 4, null],
          [reg2.id, 1, 1, '/B'],
        ].sort()
      )

      const docs = await b.documenti(e.id)
      const per = (c: { contrattoId: string }) => docs.find(d => d.contratto_id === c.contrattoId)!
      expect(docs.every(d => d.stato === 'DEFINITIVO')).toBe(true)
      // Ordine del passo 7 nel registro 01: Alfa, Beta (T1-1 poi T1-2), Zeta.
      expect([alfa, beta1, beta2, zeta].map(c => per(c).numero)).toEqual([1, 2, 3, 4])
      expect([alfa, beta1, beta2, zeta].map(c => per(c).numero_testo)).toEqual(['1', '2', '3', '4'])
      expect(per(altro)).toMatchObject({ numero: 1, numero_testo: '1/B' })
      expect(docs.every(d => d.definito_da === az.utenteId && d.definito_il !== null)).toBe(true)

      // Legami: FATTURATO col documento giusto e «<numero> del gg/mm/aaaa».
      const legami = await b.legamiDi(
        [alfa, beta1, beta2, zeta, altro].map(c => c.legameId as string)
      )
      for (const c of [alfa, beta1, beta2, zeta, altro]) {
        const l = legami.find(x => x.id === c.legameId)!
        expect(l).toMatchObject({
          stato: 'FATTURATO',
          documento_id: per(c).id,
          riferimento_fattura: `${per(c).numero_testo} del 05/04/2026`,
        })
        expect(l.fatturato_il).not.toBeNull()
        expect(l.versione).toBe(2)
      }

      // Marcatore del canone di Alfa, con la riga FISSO del suo documento.
      const marcatori = await b.marcatori(az.tenantId)
      expect(marcatori).toHaveLength(1)
      const righeAlfa = await b.righeDi(per(alfa).id)
      const fisso = righeAlfa.find(r => r.tipo_riga === 'FISSO')!
      expect(marcatori[0]).toMatchObject({
        tipo: 'PERIODO_CANONE',
        chiave_competenza: '2026-03-01/2026-03-31',
        documento_id: per(alfa).id,
        riga_documento_id: fisso.id,
        riga_addebito_id: fisso.riga_addebito_id,
      })

      // Elaborazione, numerazioni, audit.
      expect(await b.leggi(e.id)).toMatchObject({
        stato: 'DEFINITIVA',
        definita_da: az.utenteId,
        esito: null,
        errore_tecnico: null,
      })
      expect((await b.leggi(e.id)).definita_il).not.toBeNull()
      const num = await b.numerazioni(az.tenantId)
      expect(num.map(n => [n.registro_iva_id, n.ultimo_numero, n.ultima_data]).sort()).toEqual(
        [
          [az.tab.registroId, 4, '2026-04-05'],
          [reg2.id, 1, '2026-04-05'],
        ].sort()
      )
      expect(await b.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_DEFINITIVO')).toBe(5)
      expect(await b.conteggioAudit(az.tenantId, 'ELABORAZIONE_FATTURAZIONE_DEFINITIVA')).toBe(1)
      await b.verificaSerie(az.tenantId)
    })

    it('documenti con errori o esclusi: restano BOZZA, i loro legami CONFERMATO e fuori da ogni documento', async () => {
      const az = await b.azienda()
      const buono = await b.contratto(az)
      const escluso = await b.contratto(az)
      const conErrori = await b.contratto(az)
      await owner.$executeRawUnsafe(
        `UPDATE contratti_cliente SET condizione_pagamento_id = NULL WHERE id = $1::uuid`,
        conErrori.contrattoId
      )
      const e = await b.pronta(az)
      const docs0 = await b.documenti(e.id)
      const docEscluso = docs0.find(d => d.contratto_id === escluso.contrattoId)!
      const docErrori = docs0.find(d => d.contratto_id === conErrori.contrattoId)!
      expect(docErrori.errori).toContain('SENZA_CONDIZIONE_PAGAMENTO')
      await b.nel(az.tenantId, () => b.servizio.escludi(az.tenantId, e.id, docEscluso.id, true))

      const esito = await b.definitiva(az, e)
      expect(esito).toMatchObject({ esito: 'DEFINITIVA', documenti: 1 })
      const docs = await b.documenti(e.id)
      expect(docs.filter(d => d.stato === 'DEFINITIVO').map(d => d.contratto_id)).toEqual([
        buono.contrattoId,
      ])
      for (const d of [docEscluso, docErrori]) {
        expect(docs.find(x => x.id === d.id)).toMatchObject({ stato: 'BOZZA', numero: null })
      }
      const legami = await b.legamiDi([escluso.legameId!, conErrori.legameId!, buono.legameId!])
      expect(legami.find(l => l.id === buono.legameId)!.stato).toBe('FATTURATO')
      for (const id of [escluso.legameId, conErrori.legameId]) {
        expect(legami.find(l => l.id === id)).toMatchObject({
          stato: 'CONFERMATO',
          documento_id: null,
          fatturato_il: null,
        })
      }
      const num = await b.numerazioni(az.tenantId)
      expect(num.map(n => n.ultimo_numero)).toEqual([1])
      await b.verificaSerie(az.tenantId)
    })

    it('le esclusioni conservate dal ricalcolo valgono anche nella definitiva: un documento escluso non entra mai', async () => {
      const az = await b.azienda()
      const a = await b.contratto(az)
      const x = await b.contratto(az)
      const e = await b.pronta(az)
      const prima = await b.documenti(e.id)
      const dX = prima.find(d => d.contratto_id === x.contrattoId)!
      await b.nel(az.tenantId, () => b.servizio.escludi(az.tenantId, e.id, dX.id, true))
      // «Ricalcola»: nuova versione, nuove bozze, esclusione conservata (Task 18).
      await b.nel(az.tenantId, () =>
        b.servizio.ricalcola(az.tenantId, az.utenteId, e.id, e.versione)
      )
      const v2 = (await b.leggi(e.id)).versione
      await b.nel(az.tenantId, () => eseguiAnteprima(app, az.tenantId, e.id, v2))
      const dopo = await b.documenti(e.id)
      expect(dopo.find(d => d.contratto_id === x.contrattoId)!.escluso).toBe(true)
      const ricalcolata = await b.leggi(e.id)
      const esito = await b.definitiva(az, {
        id: e.id,
        versione: ricalcolata.versione,
        impronta: ricalcolata.impronta as string,
      })
      expect(esito).toMatchObject({ esito: 'DEFINITIVA', documenti: 1 })
      const docs = await b.documenti(e.id)
      expect(docs.find(d => d.contratto_id === a.contrattoId)!.stato).toBe('DEFINITIVO')
      expect(docs.find(d => d.contratto_id === x.contrattoId)).toMatchObject({
        stato: 'BOZZA',
        numero: null,
        escluso: true,
      })
      expect((await b.legamiDi([x.legameId!]))[0].stato).toBe('CONFERMATO')
    })

    it('righe dei documenti definiti: movimento_fatturato_id = movimento_vigente_id del legame e riga_legame_id NULL (Q1)', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az, { fisso: true })
      const e = await b.pronta(az)
      await b.definitiva(az, e)
      const [doc] = await b.documenti(e.id)
      const [legame] = await b.legamiDi([c.legameId!])
      const righe = await b.righeDi(doc.id)
      const movimento = righe.find(r => r.tipo_riga === 'MOVIMENTO')!
      expect(movimento).toMatchObject({
        legame_id: c.legameId,
        movimento_fatturato_id: legame.movimento_vigente_id,
        riga_legame_id: null,
      })
      // Le righe senza legame (il canone) non hanno movimento fatturato.
      expect(
        righe.filter(r => r.legame_id === null).every(r => r.movimento_fatturato_id === null)
      ).toBe(true)
      expect(righe.every(r => r.riga_legame_id === null)).toBe(true)
    })

    it('fotografia del definitivo: segnalazioni.errori vuoto, avvisi conservati (Q16)', async () => {
      const az = await b.azienda()
      await b.contratto(az)
      const e = await b.pronta(az)
      const [bozza] = await b.documenti(e.id)
      expect(bozza.avvisi.length).toBeGreaterThan(0)
      await b.definitiva(az, e)
      const [doc] = await b.documenti(e.id)
      expect(doc.stato).toBe('DEFINITIVO')
      expect(doc.errori).toEqual([])
      expect(doc.fotografia.segnalazioni.errori).toEqual([])
      expect(doc.fotografia.segnalazioni.avvisi.map(a => a.codice).sort()).toEqual(
        [...bozza.avvisi].sort()
      )
      expect(doc.avvisi.sort()).toEqual([...bozza.avvisi].sort())
    })

    it('tutti esclusi o con errori: chiediDefinitiva risponde 409 NESSUN_DOCUMENTO_DEFINIBILE, numerazioni invariate, ANTEPRIMA_PRONTA, nessun job', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      const [d] = await b.documenti(e.id)
      await b.nel(az.tenantId, () => b.servizio.escludi(az.tenantId, e.id, d.id, true))
      expect(
        await esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione }))
      ).toEqual({ status: 409, codice: 'NESSUN_DOCUMENTO_DEFINIBILE' })
      expect((await b.leggi(e.id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect(await b.numerazioni(az.tenantId)).toEqual([])
      expect(jobDefinitiva()).toHaveLength(0)
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('CONFERMATO')
    })

    it('501 documenti: 400 TROPPI_DOCUMENTI dalla rotta, nulla cambia', async () => {
      const az = await b.azienda()
      await b.contratto(az)
      const e = await b.pronta(az)
      await owner.$executeRawUnsafe(
        `INSERT INTO documenti_fattura
           (tenant_id, elaborazione_id, stato, tipo_documento, registro_iva_id, anno, data_documento,
            cliente_id, cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al,
            formato_trasmissione, esigibilita_iva, totale_imponibile, totale_iva, totale_documento,
            netto_a_pagare, fotografia, updated_at)
         SELECT d.tenant_id, d.elaborazione_id, 'BOZZA', d.tipo_documento, d.registro_iva_id, d.anno,
                d.data_documento, d.cliente_id, d.cliente_fatturazione_id, d.contratto_id,
                d.periodo_dal, d.periodo_al, d.formato_trasmissione, d.esigibilita_iva,
                d.totale_imponibile, d.totale_iva, d.totale_documento, d.netto_a_pagare,
                d.fotografia, now()
         FROM documenti_fattura d CROSS JOIN generate_series(1, 500) g
         WHERE d.elaborazione_id = $1::uuid`,
        e.id
      )
      expect(
        await esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione }))
      ).toEqual({ status: 400, codice: 'TROPPI_DOCUMENTI' })
      expect((await b.leggi(e.id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect(await b.numerazioni(az.tenantId)).toEqual([])
      expect(jobDefinitiva()).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------------------------
  // Interruttore e errori generali (decisioni 13 e 24)
  // -------------------------------------------------------------------------------------------

  describe('interruttore e errori generali', () => {
    it('definitive_attive falsa: 409 DEFINITIVE_NON_ATTIVE, numerazioni, legami e stato invariati, nessun job', async () => {
      const az = await b.azienda({ attive: false })
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      const prima = await b.leggi(e.id)
      expect(
        await esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione }))
      ).toEqual({ status: 409, codice: 'DEFINITIVE_NON_ATTIVE' })
      expect(await b.leggi(e.id)).toEqual(prima)
      expect(await b.numerazioni(az.tenantId)).toEqual([])
      expect((await b.legamiDi([c.legameId!]))[0]).toMatchObject({
        stato: 'CONFERMATO',
        versione: 1,
      })
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA')).toBe(true)
      expect(jobDefinitiva()).toHaveLength(0)
    })

    it('interruttore spento fra chiediDefinitiva e il job: esito DEFINITIVE_NON_ATTIVE, ANTEPRIMA_PRONTA, nessun numero', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      await owner.$executeRawUnsafe(
        `UPDATE impostazioni_fatturazione SET definitive_attive = false WHERE tenant_id = $1::uuid`,
        az.tenantId
      )
      expect(await b.eseguiJob(az, e.id)).toEqual({ esito: 'DEFINITIVE_NON_ATTIVE' })
      expect(await b.leggi(e.id)).toMatchObject({
        stato: 'ANTEPRIMA_PRONTA',
        esito: { codice: 'DEFINITIVE_NON_ATTIVE' },
        errore_tecnico: null,
      })
      expect(await b.numerazioni(az.tenantId)).toEqual([])
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('CONFERMATO')
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA')).toBe(true)
    })

    it('elaborazione con CEDENTE_INCOMPLETO negli errori generali: 409 { error: CEDENTE_INCOMPLETO }, nessun job, stato invariato', async () => {
      const az = await b.azienda()
      await b.contratto(az)
      // L'avvio vuole il cedente completo; si rompe prima dell'anteprima.
      const { id } = await b.nel(az.tenantId, () =>
        b.servizio.avvia(az.tenantId, az.utenteId, {
          ...PARAMETRI_T19,
        })
      )
      await owner.$executeRawUnsafe(
        `UPDATE tenants SET address = NULL WHERE id = $1::uuid`,
        az.tenantId
      )
      await b.nel(az.tenantId, () => eseguiAnteprima(app, az.tenantId, id, 1))
      const e = await b.leggi(id)
      expect(e.errori_generali).toContain('CEDENTE_INCOMPLETO')
      expect(
        await esito(b.chiedi(az, id, { impronta: e.impronta as string, versione: e.versione }))
      ).toEqual({ status: 409, codice: 'CEDENTE_INCOMPLETO' })
      expect((await b.leggi(id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect(jobDefinitiva()).toHaveLength(0)
    })

    it('con DATA_ANTERIORE_ULTIMA_FATTURA negli errori generali: 409 { error: DATA_ANTERIORE_ULTIMA_FATTURA }', async () => {
      const az = await b.azienda()
      await b.contratto(az)
      await owner.$executeRawUnsafe(
        `INSERT INTO numerazioni_fattura (tenant_id, registro_iva_id, anno, ultimo_numero, ultima_data, updated_at)
         VALUES ($1::uuid, $2::uuid, 2026, 0, '2026-04-20', now())`,
        az.tenantId,
        az.tab.registroId
      )
      const e = await b.pronta(az)
      expect((await b.leggi(e.id)).errori_generali).toContain('DATA_ANTERIORE_ULTIMA_FATTURA')
      expect(
        await esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione }))
      ).toMatchObject({ status: 409, codice: 'DATA_ANTERIORE_ULTIMA_FATTURA' })
      expect((await b.leggi(e.id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect(jobDefinitiva()).toHaveLength(0)
    })

    it('gli errori generali bloccanti sono quelli della decisione 24; LEGAMI_SENZA_CONTRATTO non blocca', () => {
      expect([...ERRORI_GENERALI_BLOCCANTI]).toEqual([
        'CEDENTE_INCOMPLETO',
        'DATA_ANTERIORE_ULTIMA_FATTURA',
        'DATA_FUTURA',
      ])
    })

    it('con LEGAMI_SENZA_CONTRATTO: 202 e DEFINITIVA; il legame senza contratto e il movimento restano fuori da ogni documento; il codice resta nel dettaglio', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      // Un legame da collegare (nessun contratto) e un movimento senza legame, nel periodo.
      const m = await creaMovimentoDiTest(owner, az.tenantId, { movementDate: '2026-03-12' })
      const senza = await creaLegameDiTest(owner, az.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: m.type,
        stato: 'DA_COLLEGARE',
        dataMovimento: '2026-03-12',
      })
      await creaMovimentoDiTest(owner, az.tenantId, { movementDate: '2026-03-13' })
      const e = await b.pronta(az)
      expect((await b.leggi(e.id)).errori_generali).toContain('LEGAMI_SENZA_CONTRATTO')
      expect(await esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione }))).toBe(
        'ok'
      )
      expect(await b.eseguiJob(az, e.id)).toMatchObject({ esito: 'DEFINITIVA', documenti: 1 })
      expect((await b.legamiDi([senza.legameId]))[0]).toMatchObject({
        stato: 'DA_COLLEGARE',
        documento_id: null,
      })
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('FATTURATO')
      const dettaglio = await b.nel(az.tenantId, () => b.servizio.dettaglio(az.tenantId, e.id))
      expect(dettaglio.stato).toBe('DEFINITIVA')
      expect(dettaglio.erroriGenerali.map(g => g.codice)).toContain('LEGAMI_SENZA_CONTRATTO')
    })

    it('cedente reso incompleto fra chiediDefinitiva e il job: esito CEDENTE_INCOMPLETO, nessun numero', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      await owner.$executeRawUnsafe(
        `UPDATE tenants SET address = NULL WHERE id = $1::uuid`,
        az.tenantId
      )
      expect(await b.eseguiJob(az, e.id)).toEqual({ esito: 'CEDENTE_INCOMPLETO' })
      expect(await b.leggi(e.id)).toMatchObject({
        stato: 'ANTEPRIMA_PRONTA',
        esito: { codice: 'CEDENTE_INCOMPLETO' },
      })
      expect((await b.numerazioni(az.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('CONFERMATO')
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------------------------
  // Data (Q15)
  // -------------------------------------------------------------------------------------------

  describe('data del documento (Q15)', () => {
    /** Una numerazione con un'ultima data piu' recente: come uno storno fatto dopo l'anteprima. */
    const ultimaDataPiuRecente = (az: { tenantId: string; tab: { registroId: string } }) =>
      owner.$executeRawUnsafe(
        `INSERT INTO numerazioni_fattura (tenant_id, registro_iva_id, anno, ultimo_numero, ultima_data, updated_at)
         VALUES ($1::uuid, $2::uuid, 2026, 0, '2026-04-20', now())
         ON CONFLICT (tenant_id, registro_iva_id, anno) DO UPDATE SET ultima_data = '2026-04-20'`,
        az.tenantId,
        az.tab.registroId
      )

    it('data piu’ recente sullo stesso registro fatta fra l’anteprima e chiediDefinitiva: 409 DATA_ANTERIORE_ULTIMA_FATTURA sincrono con details.ultimaData', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await ultimaDataPiuRecente(az)
      expect(
        await esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione }))
      ).toEqual({
        status: 409,
        codice: 'DATA_ANTERIORE_ULTIMA_FATTURA',
        details: { ultimaData: '2026-04-20' },
      })
      expect((await b.leggi(e.id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect(jobDefinitiva()).toHaveLength(0)
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('CONFERMATO')
    })

    it('lo stesso fatto fra chiediDefinitiva e il job: esito DATA_ANTERIORE_ULTIMA_FATTURA con ultimaData, ANTEPRIMA_PRONTA, nessun numero', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      await ultimaDataPiuRecente(az)
      expect(await b.eseguiJob(az, e.id)).toEqual({
        esito: 'DATA_ANTERIORE_ULTIMA_FATTURA',
        ultimaData: '2026-04-20',
      })
      expect(await b.leggi(e.id)).toMatchObject({
        stato: 'ANTEPRIMA_PRONTA',
        esito: { codice: 'DATA_ANTERIORE_ULTIMA_FATTURA', ultimaData: '2026-04-20' },
      })
      const num = await b.numerazioni(az.tenantId)
      expect(num.map(n => [n.ultimo_numero, n.ultima_data])).toEqual([[0, '2026-04-20']])
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('CONFERMATO')
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA' && d.numero === null)).toBe(
        true
      )
    })
  })

  // -------------------------------------------------------------------------------------------
  // Anteprima superata (Q11)
  // -------------------------------------------------------------------------------------------

  describe('ANTEPRIMA_SUPERATA e differenze (Q11)', () => {
    it('un legame confermato dopo l’anteprima: ANTEPRIMA_SUPERATA con nuovi 1, bozze intatte, nessun numero', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      const bozzePrima = await b.documenti(e.id)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const { creaLegameConfermatoT18 } = await import(
        '../../test-support/fatturazione-t18-di-test'
      )
      await creaLegameConfermatoT18(owner, az, c, { data: '2026-03-15' })
      const esitoJob = await b.eseguiJob(az, e.id)
      expect(esitoJob).toEqual({
        esito: 'ANTEPRIMA_SUPERATA',
        differenze: { nuovi: 1, cambiati: 0, fatturatiDaAltri: 0 },
      })
      expect(await b.leggi(e.id)).toMatchObject({
        stato: 'ANTEPRIMA_PRONTA',
        esito: {
          codice: 'ANTEPRIMA_SUPERATA',
          differenze: { nuovi: 1, cambiati: 0, fatturatiDaAltri: 0 },
        },
        errore_tecnico: null,
      })
      expect(await b.documenti(e.id)).toEqual(bozzePrima)
      expect((await b.numerazioni(az.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('CONFERMATO')
    })

    it('legame delle bozze modificato dopo prontaIl: cambiati 1', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      await owner.$executeRawUnsafe(
        `UPDATE legami_movimento SET versione = versione + 1, updated_at = now() WHERE id = $1::uuid`,
        c.legameId
      )
      expect(await b.eseguiJob(az, e.id)).toEqual({
        esito: 'ANTEPRIMA_SUPERATA',
        differenze: { nuovi: 0, cambiati: 1, fatturatiDaAltri: 0 },
      })
      expect((await b.leggi(e.id)).stato).toBe('ANTEPRIMA_PRONTA')
    })

    it('solo una riga di listino cambiata: ANTEPRIMA_SUPERATA con differenze coerenti, mai errore interno', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      await owner.$executeRawUnsafe(
        `UPDATE righe_addebito SET versione = versione + 1, updated_at = now() WHERE id = $1::uuid`,
        c.rigaCerId
      )
      const x = await b.eseguiJob(az, e.id)
      expect(x.esito).toBe('ANTEPRIMA_SUPERATA')
      if (x.esito !== 'ANTEPRIMA_SUPERATA') return
      expect(x.differenze.nuovi).toBe(0)
      expect(x.differenze.fatturatiDaAltri).toBe(0)
      expect(x.differenze.cambiati).toBeLessThanOrEqual(1)
      expect(await b.leggi(e.id)).toMatchObject({ stato: 'ANTEPRIMA_PRONTA', errore_tecnico: null })
    })

    it('due elaborazioni pronte sugli stessi legami, definitive una dopo l’altra: la seconda ANTEPRIMA_SUPERATA con fatturatiDaAltri', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e1 = await b.pronta(az)
      const e2 = await b.pronta(az)
      expect(await b.definitiva(az, e1)).toMatchObject({ esito: 'DEFINITIVA' })
      expect(await b.definitiva(az, e2)).toEqual({
        esito: 'ANTEPRIMA_SUPERATA',
        differenze: { nuovi: 0, cambiati: 0, fatturatiDaAltri: 1 },
      })
      expect((await b.leggi(e2.id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('FATTURATO')
      expect((await b.numerazioni(az.tenantId)).map(n => n.ultimo_numero)).toEqual([1])
      await b.verificaSerie(az.tenantId)
    })

    it('su legami diversi dello stesso registro: numeri successivi, mai doppioni; la seconda richiesta con la prima in corso riceve ELABORAZIONE_IN_CORSO', async () => {
      const az = await b.azienda()
      const a = await b.contratto(az)
      const x = await b.contratto(az)
      const e1 = await b.pronta(az, { filtri: { contrattoIds: [a.contrattoId] } })
      const e2 = await b.pronta(az, { filtri: { contrattoIds: [x.contrattoId] } })
      await b.chiedi(az, e1.id, { impronta: e1.impronta, versione: e1.versione })
      // La prima e' IN_DEFINITIVA: l'indice unico ferma la seconda richiesta.
      expect(
        await esito(b.chiedi(az, e2.id, { impronta: e2.impronta, versione: e2.versione }))
      ).toEqual({ status: 409, codice: 'ELABORAZIONE_IN_CORSO' })
      expect((await b.leggi(e2.id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect(await b.eseguiJob(az, e1.id)).toMatchObject({ esito: 'DEFINITIVA' })
      expect(await b.definitiva(az, e2)).toMatchObject({ esito: 'DEFINITIVA' })
      const n1 = (await b.documenti(e1.id))[0].numero
      const n2 = (await b.documenti(e2.id))[0].numero
      expect([n1, n2]).toEqual([1, 2])
      await b.verificaSerie(az.tenantId)
    })
  })

  // -------------------------------------------------------------------------------------------
  // Atomicita', rilancio, doppio clic (Q5)
  // -------------------------------------------------------------------------------------------

  describe('atomicità, rilancio e doppio clic', () => {
    it('guasto iniettato dopo riservaNumeri e prima del commit: nessun numero consumato, nessun legame FATTURATO, nessun marcatore, ANTEPRIMA_PRONTA', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az, { fisso: true })
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      jest
        .spyOn(lockFatturazione, 'insiemiPerDefinitiva')
        .mockRejectedValueOnce(new Error('guasto iniettato'))
      await expect(b.eseguiJob(az, e.id)).rejects.toThrow('guasto iniettato')
      expect(await b.leggi(e.id)).toMatchObject({
        stato: 'ANTEPRIMA_PRONTA',
        esito: null,
        errore_tecnico: 'Errore tecnico durante la definitiva',
      })
      expect((await b.numerazioni(az.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)
      expect((await b.legamiDi([c.legameId!]))[0]).toMatchObject({
        stato: 'CONFERMATO',
        versione: 1,
      })
      expect(await b.marcatori(az.tenantId)).toEqual([])
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA' && d.numero === null)).toBe(
        true
      )
    })

    it('guasto all’ultimo passo (l’audit, dopo tutte le scritture): rollback totale', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az, { fisso: true })
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const nome = `t19_guasto_${process.pid}`
      await owner.$executeRawUnsafe(`
        CREATE FUNCTION ${nome}() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN
          IF NEW.tenant_id = '${az.tenantId}'::uuid AND NEW.action = 'DOCUMENTO_FATTURA_DEFINITIVO' THEN
            RAISE EXCEPTION 'guasto in chiusura';
          END IF;
          RETURN NEW;
        END $f$`)
      await owner.$executeRawUnsafe(
        `CREATE TRIGGER ${nome} BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION ${nome}()`
      )
      try {
        await expect(b.eseguiJob(az, e.id)).rejects.toThrow()
      } finally {
        await owner.$executeRawUnsafe(`DROP TRIGGER ${nome} ON activity_logs`)
        await owner.$executeRawUnsafe(`DROP FUNCTION ${nome}()`)
      }
      expect((await b.leggi(e.id)).stato).toBe('ANTEPRIMA_PRONTA')
      expect((await b.numerazioni(az.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)
      expect((await b.legamiDi([c.legameId!]))[0]).toMatchObject({
        stato: 'CONFERMATO',
        documento_id: null,
      })
      expect(await b.marcatori(az.tenantId)).toEqual([])
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA' && d.numero === null)).toBe(
        true
      )
      expect(await b.conteggioAudit(az.tenantId, 'ELABORAZIONE_FATTURAZIONE_DEFINITIVA')).toBe(0)
    })

    it('definitiva fallita, seconda chiediDefinitiva: job «definitiva-<id>-v<n+1>» eseguito, arriva a DEFINITIVA (Q5)', async () => {
      const az = await b.azienda()
      await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const primo = b.ultimoJob(e.id)
      expect(primo.jobId).toBe(`definitiva-${e.id}-v${e.versione + 1}`)
      jest
        .spyOn(lockFatturazione, 'insiemiPerDefinitiva')
        .mockRejectedValueOnce(new Error('guasto iniettato'))
      await expect(b.eseguiJob(az, e.id)).rejects.toThrow()
      const dopo = await b.leggi(e.id)
      expect(dopo.stato).toBe('ANTEPRIMA_PRONTA')

      // Rilancio: la stessa impronta, la versione che l'utente rilegge.
      await b.chiedi(az, e.id, { impronta: dopo.impronta as string, versione: dopo.versione })
      const secondo = b.ultimoJob(e.id)
      expect(secondo.jobId).toBe(`definitiva-${e.id}-v${dopo.versione + 1}`)
      expect(secondo.jobId).not.toBe(primo.jobId)
      expect(secondo.jobId).not.toContain(':')
      expect(b.coda.add).toHaveBeenLastCalledWith(
        'definitiva',
        expect.objectContaining({ tipo: 'definitiva', versione: dopo.versione + 1 }),
        expect.objectContaining({ jobId: secondo.jobId, attempts: 1 })
      )
      expect(await b.eseguiJob(az, e.id)).toMatchObject({ esito: 'DEFINITIVA' })
      expect((await b.leggi(e.id)).stato).toBe('DEFINITIVA')
      await b.verificaSerie(az.tenantId)
    })

    it('se la coda non risponde la definitiva non resta IN_DEFINITIVA: ANTEPRIMA_PRONTA e 503', async () => {
      const az = await b.azienda()
      await b.contratto(az)
      const e = await b.pronta(az)
      b.coda.add.mockRejectedValue(new Error('redis giu'))
      expect(
        await esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione }))
      ).toEqual({ status: 503, codice: 'CODA_NON_DISPONIBILE' })
      expect(await b.leggi(e.id)).toMatchObject({ stato: 'ANTEPRIMA_PRONTA' })
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA')).toBe(true)
    })

    it('doppio clic: due chiediDefinitiva con la stessa versione, un 202 e un 409 ELABORAZIONE_GIA_IN_DEFINITIVA, un solo job; due job lanciati a mano con lo stesso job_id, uno solo arriva a DEFINITIVA', async () => {
      const az = await b.azienda()
      await b.contratto(az)
      const e = await b.pronta(az)
      const risposte = await Promise.all([
        esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })),
        esito(b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })),
      ])
      expect(risposte.filter(r => r === 'ok')).toHaveLength(1)
      expect(risposte.filter(r => r !== 'ok')).toEqual([
        { status: 409, codice: 'ELABORAZIONE_GIA_IN_DEFINITIVA' },
      ])
      expect(jobDefinitiva()).toHaveLength(1)

      const esiti = await Promise.all([b.eseguiJob(az, e.id), b.eseguiJob(az, e.id)])
      expect(esiti.map(x => x.esito).sort()).toEqual(['DEFINITIVA', 'NON_ESEGUITA'])
      expect((await b.leggi(e.id)).stato).toBe('DEFINITIVA')
      expect(await b.numerazioni(az.tenantId)).toMatchObject([{ ultimo_numero: 1 }])
      await b.verificaSerie(az.tenantId)
    })

    it('job con un job_id diverso da quello salvato (o una versione diversa): esce senza scrivere', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const j = b.ultimoJob(e.id)
      const prima = await b.leggi(e.id)
      for (const identita of [
        { versione: j.versione, jobId: `definitiva-${e.id}-v99` },
        { versione: j.versione + 1, jobId: j.jobId },
      ]) {
        expect(
          await b.nel(az.tenantId, () =>
            eseguiDefinitiva(app, az.tenantId, e.id, az.utenteId, identita)
          )
        ).toEqual({ esito: 'NON_ESEGUITA' })
      }
      expect(await b.leggi(e.id)).toEqual(prima)
      expect(prima.stato).toBe('IN_DEFINITIVA')
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA')).toBe(true)
      expect(await b.numerazioni(az.tenantId)).toEqual([])
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('CONFERMATO')
      // Il job vero, poi, parte.
      expect(await b.eseguiJob(az, e.id)).toMatchObject({ esito: 'DEFINITIVA' })
    })

    it('job col tenant sbagliato: non vede né scrive nulla (RLS)', async () => {
      const az = await b.azienda()
      const altra = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      const j = b.ultimoJob(e.id)
      await expect(
        TenantContext.run({ tenantId: altra.tenantId }, () =>
          eseguiDefinitiva(app, altra.tenantId, e.id, altra.utenteId, j)
        )
      ).rejects.toThrow('Elaborazione non trovata')
      expect((await b.leggi(e.id)).stato).toBe('IN_DEFINITIVA')
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA')).toBe(true)
      expect(await b.numerazioni(az.tenantId)).toEqual([])
      expect(await b.numerazioni(altra.tenantId)).toEqual([])
      expect((await b.legamiDi([c.legameId!]))[0].stato).toBe('CONFERMATO')
    })
  })

  // -------------------------------------------------------------------------------------------
  // Marcatori (Q4)
  // -------------------------------------------------------------------------------------------

  describe('marcatori dei canoni (Q4)', () => {
    it('due elaborazioni aperte sullo stesso canone, la prima diventa definitiva: la definitiva della seconda dà ANTEPRIMA_SUPERATA, nessun numero, mai errore interno', async () => {
      const az = await b.azienda()
      // Un canone e nessun movimento: i legami non c'entrano, e' il marcatore a cambiare l'impronta.
      await b.contratto(az, { fisso: true, senzaLegame: true })
      const e1 = await b.pronta(az)
      const e2 = await b.pronta(az)
      expect((await b.documenti(e2.id)).map(d => d.stato)).toEqual(['BOZZA'])
      expect(await b.definitiva(az, e1)).toMatchObject({ esito: 'DEFINITIVA', documenti: 1 })
      expect(await b.marcatori(az.tenantId)).toHaveLength(1)
      const x = await b.definitiva(az, e2)
      expect(x.esito).toBe('ANTEPRIMA_SUPERATA')
      expect(await b.leggi(e2.id)).toMatchObject({
        stato: 'ANTEPRIMA_PRONTA',
        errore_tecnico: null,
      })
      expect((await b.documenti(e2.id)).every(d => d.stato === 'BOZZA' && d.numero === null)).toBe(
        true
      )
      expect((await b.numerazioni(az.tenantId)).map(n => n.ultimo_numero)).toEqual([1])
      expect(await b.marcatori(az.tenantId)).toHaveLength(1)
      await b.verificaSerie(az.tenantId)
    })

    it('marcatore scritto fra anteprima e definitiva: ANTEPRIMA_SUPERATA, nessun numero', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az, { fisso: true, senzaLegame: true })
      const e = await b.pronta(az)
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      // Un canone fatturato da un altro documento, sulla riga F dell'elenco.
      const [fisso] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM righe_addebito WHERE elenco_id = $1::uuid AND tipo = 'F'`,
        c.elencoId
      )
      const { documentoId } = await creaDocumentoDiTest(owner, az.tenantId, {
        stato: 'BOZZA',
        registroIvaId: az.tab.registroId,
        anno: 2026,
      })
      const [r] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO righe_documento_fattura
           (tenant_id, documento_id, numero_linea, tipo_riga, descrizione, quantita, prezzo_unitario,
            importo_lordo, importo_sconto, prezzo_totale, codice_iva_id, aliquota_iva, updated_at)
         VALUES ($1::uuid, $2::uuid, 1, 'FISSO', 'canone', 1, 25, 25, 0, 25, $3::uuid, 22, now())
         RETURNING id::text`,
        az.tenantId,
        documentoId,
        az.listino.iva22Id
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO marcatori_addebiti_fatturati
           (tenant_id, riga_addebito_id, tipo, chiave_competenza, documento_id, riga_documento_id)
         VALUES ($1::uuid, $2::uuid, 'PERIODO_CANONE', '2026-03-01/2026-03-31', $3::uuid, $4::uuid)`,
        az.tenantId,
        fisso.id,
        documentoId,
        r.id
      )
      expect((await b.eseguiJob(az, e.id)).esito).toBe('ANTEPRIMA_SUPERATA')
      expect(await b.leggi(e.id)).toMatchObject({ stato: 'ANTEPRIMA_PRONTA', errore_tecnico: null })
      expect((await b.numerazioni(az.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)
      expect(await b.marcatori(az.tenantId)).toHaveLength(1)
    })

    it('due bozze che portano lo stesso marcatore, iniettate col proprietario nella stessa elaborazione: DOPPIA_FATTURAZIONE, rollback totale, ANTEPRIMA_PRONTA', async () => {
      const az = await b.azienda()
      await b.contratto(az, { fisso: true, senzaLegame: true })
      const e = await b.pronta(az)
      const [originale] = await b.documenti(e.id)
      // Copia della bozza (testata e righe) nella stessa elaborazione: stesso canone, stesso marcatore.
      const [copia] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO documenti_fattura
           (tenant_id, elaborazione_id, stato, tipo_documento, registro_iva_id, anno, data_documento,
            cliente_id, cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al,
            formato_trasmissione, esigibilita_iva, totale_imponibile, totale_iva, totale_documento,
            netto_a_pagare, fotografia, updated_at)
         SELECT d.tenant_id, d.elaborazione_id, 'BOZZA', d.tipo_documento, d.registro_iva_id, d.anno,
                d.data_documento, d.cliente_id, d.cliente_fatturazione_id, d.contratto_id,
                d.periodo_dal, d.periodo_al, d.formato_trasmissione, d.esigibilita_iva,
                d.totale_imponibile, d.totale_iva, d.totale_documento, d.netto_a_pagare,
                d.fotografia, now()
         FROM documenti_fattura d WHERE d.id = $1::uuid RETURNING id::text`,
        originale.id
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO righe_documento_fattura
           (tenant_id, documento_id, numero_linea, tipo_riga, legame_id, riga_addebito_id, descrizione,
            data_movimento, cer_code, numero_fir, quantita, unita_misura, prezzo_unitario, sconto,
            importo_lordo, importo_sconto, prezzo_totale, codice_iva_id, aliquota_iva, natura_iva,
            updated_at)
         SELECT r.tenant_id, $2::uuid, r.numero_linea, r.tipo_riga, r.legame_id, r.riga_addebito_id,
                r.descrizione, r.data_movimento, r.cer_code, r.numero_fir, r.quantita, r.unita_misura,
                r.prezzo_unitario, r.sconto, r.importo_lordo, r.importo_sconto, r.prezzo_totale,
                r.codice_iva_id, r.aliquota_iva, r.natura_iva, now()
         FROM righe_documento_fattura r WHERE r.documento_id = $1::uuid`,
        originale.id,
        copia.id
      )
      await b.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      expect(await b.eseguiJob(az, e.id)).toEqual({ esito: 'DOPPIA_FATTURAZIONE' })
      expect(await b.leggi(e.id)).toMatchObject({
        stato: 'ANTEPRIMA_PRONTA',
        esito: { codice: 'DOPPIA_FATTURAZIONE' },
        errore_tecnico: null,
      })
      expect((await b.documenti(e.id)).every(d => d.stato === 'BOZZA' && d.numero === null)).toBe(
        true
      )
      expect((await b.numerazioni(az.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)
      expect(await b.marcatori(az.tenantId)).toEqual([])
    })
  })

  // -------------------------------------------------------------------------------------------
  // Lock del listino citato (N2 del Task 17)
  // -------------------------------------------------------------------------------------------

  describe('righe di listino citate fuori validità (N2)', () => {
    it('una riga citata dal legame in un elenco fuori validità entra negli insiemi e si blocca FOR SHARE', async () => {
      const az = await b.azienda()
      const c = await b.contratto(az)
      const e = await b.pronta(az)
      const [doc] = await b.documenti(e.id)
      // L'elenco del legame scade prima del periodo: la selezione per validita' non lo prenderebbe.
      await owner.$executeRawUnsafe(
        `UPDATE elenchi_addebiti SET valido_dal = '2026-01-01', valido_al = '2026-01-31' WHERE id = $1::uuid`,
        c.elencoId
      )
      await b.nel(az.tenantId, () =>
        app.$transaction(async tx => {
          const insiemi = await insiemiPerDefinitiva(tx, az.tenantId, [doc.id])
          expect(insiemi.elencoIds).toContain(c.elencoId)
          expect(insiemi.rigaIds).toContain(c.rigaCerId)
          await lockFatturazione.bloccaPerDefinitiva(tx, az.tenantId, insiemi)
          // Un altro processo che prova a modificare la riga si scontra con il lock (NOWAIT).
          await expect(
            owner.$transaction(async o => {
              await o.$queryRawUnsafe(
                `SELECT id FROM righe_addebito WHERE id = $1::uuid FOR NO KEY UPDATE NOWAIT`,
                c.rigaCerId
              )
            })
          ).rejects.toThrow(/lock|55P03|NOWAIT/i)
        })
      )
    })
  })
})
