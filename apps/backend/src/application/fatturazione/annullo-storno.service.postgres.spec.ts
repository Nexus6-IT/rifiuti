/**
 * Annullo dell'ultimo numero e nota di credito di storno (fase 4.4b1, Task 20, spec §5.5 e §5.6)
 * contro un Postgres reale, collegato COME `wasteflow_app` (RLS FORCE). Il proprietario prepara gli
 * scenari e legge lo stato finale; pulizia solo per id esatti (`pulisciTenantDiTest`). La
 * concorrenza sta in `annullo-storno.concorrenza.postgres.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t20-${process.pid}`
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
  aggiungiRettificaDiTest,
  creaBancoT20,
  type BancoT20,
} from '../../test-support/fatturazione-annullo-di-test'
import { creaRigaT18, type AziendaT18 } from '../../test-support/fatturazione-t18-di-test'
import { esitoHttp as esito } from '../../test-support/fatturazione-t19-di-test'
import { creaLegameDiTest, pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { creaContrattoConElenco, creaRiga } from '../../test-support/listino-di-test'
import { LegamiService } from '../legami-movimento/conferma-legame.service'
import { leggiTestaCatena } from '../legami-movimento/letture-legame'
import { ListaLegamiService } from '../legami-movimento/lista-legami.service'
import { bloccaLegamePerRadice } from '../legami-movimento/lock-legame'
import { PropostaLegameService } from '../legami-movimento/proposta-legame.service'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { ripristinaLegamiDelDocumento } from './annullo-storno.service'

describe('Annullo e storno — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    b.reset()
    b.servizio.orologio = () => new Date('2026-05-01T10:00:00Z')
  })
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  const numerazione = async (az: AziendaT18) => (await b.t19.numerazioni(az.tenantId))[0]
  const nel = <R>(az: AziendaT18, fn: () => Promise<R>) => b.t19.nel(az.tenantId, fn)
  const conteggioStorni = async (az: AziendaT18) =>
    (
      await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM documenti_fattura WHERE tenant_id = $1::uuid AND tipo_documento = 'TD04'`,
        az.tenantId
      )
    )[0].n

  /** Legami della 4.3 per le prove che ripassano da `conferma`. */
  const legamiService = () => new LegamiService(app, new PropostaLegameService(app))

  /** Secondo contratto dello stesso cliente con una riga CER (come `secondoContratto` della 4.3). */
  async function secondoContratto(az: AziendaT18, clienteId: string) {
    const c = await creaContrattoConElenco(owner, az.tenantId, { clienteId })
    const cer = await creaRiga(owner, az.tenantId, c.elencoId, {
      tipo: 'CER',
      cerCode: '20 03 01',
      codiceIvaId: az.listino.iva22Id,
    })
    return { ...c, rigaCerId: cer.id }
  }

  // -------------------------------------------------------------------------------------------
  // Annullo
  // -------------------------------------------------------------------------------------------

  describe('annullo', () => {
    it('dell’ultimo non emesso: ANNULLATO, ultimo_numero − 1, legami CONFERMATO con movimento_vigente_id = movimento fatturato, marcatori tolti, scostamento_gestito_* e scostamento_nota nulli', async () => {
      const az = await b.t19.azienda()
      const alfa = await b.t19.contratto(az, { ragione: 'Alfa SRL' })
      const zeta = await b.t19.contratto(az, { ragione: 'Zeta SRL', fisso: true })
      const [d1, d2] = await b.definitivi(az, 2, { contratti: [alfa, zeta] })
      expect(d2.numero).toBe(2)
      expect((await b.t19.marcatori(az.tenantId)).length).toBe(1)
      // Una gestione dello scostamento ereditata: l'annullo la azzera.
      await owner.$executeRawUnsafe(
        `UPDATE legami_movimento SET scostamento_dopo_fattura = true, scostamento_il = now(),
           scostamento_gestito_il = now(), scostamento_gestito_da = $2::uuid, scostamento_nota = 'prova'
         WHERE id = $1::uuid`,
        d2.legameId,
        az.utenteId
      )
      const prima = (await b.legami([d2.legameId]))[0]

      const dettaglio = await b.annullaCorrente(az, d2.id, '  errore di conferma  ')
      expect(dettaglio).toMatchObject({ id: d2.id, stato: 'ANNULLATO', annullabile: false })

      const doc = await b.documento(d2.id)
      expect(doc).toMatchObject({
        stato: 'ANNULLATO',
        numero: 2,
        annullato_da: az.utenteId,
        motivo_annullo: 'errore di conferma',
        versione: 3,
      })
      expect(doc.annullato_il).not.toBeNull()
      expect(await numerazione(az)).toMatchObject({ ultimo_numero: 1, ultima_data: '2026-04-05' })

      const l = (await b.legami([d2.legameId]))[0]
      expect(l).toMatchObject({
        stato: 'CONFERMATO',
        documento_id: null,
        fatturato_il: null,
        riferimento_fattura: null,
        scostamento_dopo_fattura: false,
        scostamento_il: null,
        scostamento_gestito_il: null,
        scostamento_gestito_da: null,
        scostamento_nota: null,
        movimento_vigente_id: d2.movimentoId,
        versione: prima.versione + 1,
      })
      const righe = await b.righeComplete(d2.id)
      expect(righe.every(r => r.movimento_fatturato_id === null || r.legame_id !== null)).toBe(true)
      expect(righe.find(r => r.legame_id === d2.legameId)?.movimento_fatturato_id).toBe(
        l.movimento_vigente_id
      )
      // Marcatori del solo documento annullato.
      expect(await b.t19.marcatori(az.tenantId)).toEqual([])
      // Il documento 1 e il suo legame non sono toccati.
      expect((await b.documento(d1.id)).stato).toBe('DEFINITIVO')
      expect((await b.legami([d1.legameId]))[0]).toMatchObject({
        stato: 'FATTURATO',
        documento_id: d1.id,
      })
      await b.t19.verificaSerie(az.tenantId)
    })

    it('legame con due righe MOVIMENTO (CER e V): ripristinato una volta (Q42)', async () => {
      const az = await b.t19.azienda()
      const c = await b.t19.contratto(az, { senzaLegame: true })
      const rigaV = await creaRigaT18(owner, az, c.elencoId, 'V', '5')
      const { creaMovimentoDiTest } = await import('../../test-support/legami-di-test')
      const m = await creaMovimentoDiTest(owner, az.tenantId, {
        movementDate: '2026-03-10',
        quantity: '100',
      })
      const l = await creaLegameDiTest(owner, az.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: m.type,
        stato: 'CONFERMATO',
        clienteId: c.clienteId,
        contrattoId: c.contrattoId,
        elencoId: c.elencoId,
        dataMovimento: '2026-03-10',
        righe: [
          {
            rigaAddebitoId: c.rigaCerId,
            codiceIvaId: az.listino.iva22Id,
            quantita: '100',
            prezzo: '1',
          },
          { rigaAddebitoId: rigaV, codiceIvaId: az.listino.iva22Id, quantita: '100', prezzo: '5' },
        ],
      })
      const [d] = await b.definitivi(az, 1, { contratti: [{ ...c, legameId: l.legameId }] })
      const movimentoRighe = (await b.righeComplete(d.id)).filter(r => r.legame_id === l.legameId)
      expect(movimentoRighe.length).toBe(2)
      const prima = (await b.legami([l.legameId]))[0]

      await b.annullaCorrente(az, d.id)
      const dopo = (await b.legami([l.legameId]))[0]
      expect(dopo).toMatchObject({ stato: 'CONFERMATO', movimento_vigente_id: m.movimentoId })
      expect(dopo.versione).toBe(prima.versione + 1)
    })

    it('annullo dell’ultimo, poi conferma del legame con cambio di elenco (4.3): riuscita, nessun 23503 (Q1)', async () => {
      const az = await b.t19.azienda()
      const c = await b.t19.contratto(az)
      const [d] = await b.definitivi(az, 1, { contratti: [c] })
      expect((await b.righeComplete(d.id)).every(r => r.riga_legame_id === null)).toBe(true)
      await b.annullaCorrente(az, d.id)
      const c2 = await secondoContratto(az, c.clienteId)
      const l = (await b.legami([d.legameId]))[0]
      const vista = await nel(az, () =>
        legamiService().conferma(az.tenantId, az.utenteId, d.legameId, l.versione, {
          contrattoId: c2.contrattoId,
        })
      )
      expect(vista.stato).toBe('CONFERMATO')
      expect((await b.legami([d.legameId]))[0].elenco_id).toBe(c2.elencoId)
    })

    it('annullo di un numero intermedio: 409 ANNULLO_NON_AMMESSO, details.motivo NON_ULTIMO, messaggio «usa la nota di credito di storno», nulla scritto', async () => {
      const az = await b.t19.azienda()
      const [d1] = await b.definitivi(az, 2)
      const prima = await b.documento(d1.id)
      let messaggio = ''
      const r = await esito(
        b.annulla(az, d1.id, { versione: prima.versione }).catch(e => {
          messaggio = (e.getResponse() as { message: string }).message
          throw e
        })
      )
      expect(r).toEqual({
        status: 409,
        codice: 'ANNULLO_NON_AMMESSO',
        details: { motivo: 'NON_ULTIMO' },
      })
      expect(messaggio).toContain('usa la nota di credito di storno')
      expect(await b.documento(d1.id)).toEqual(prima)
      expect((await numerazione(az)).ultimo_numero).toBe(2)
      expect((await b.legami([d1.legameId]))[0].stato).toBe('FATTURATO')
    })

    it('annullo di un emesso: 409 con motivo EMESSO', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura SET emesso_il = now() WHERE id = $1::uuid`,
        d.id
      )
      const r = await esito(b.annulla(az, d.id, { versione: await b.versioneDi(d.id) }))
      expect(r).toEqual({
        status: 409,
        codice: 'ANNULLO_NON_AMMESSO',
        details: { motivo: 'EMESSO' },
      })
      expect((await b.documento(d.id)).stato).toBe('DEFINITIVO')
    })

    it('origine stornata con TD04 datato nell’anno dopo (origine ancora ultima del suo anno, non emessa): annullo 409 con motivo STORNATO, nulla scritto, legami invariati (Q9)', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      b.servizio.orologio = () => new Date('2027-02-01T10:00:00Z')
      const storno = await b.stornaCorrente(az, d.id, {
        dataDocumento: '2027-01-15',
        rifatturabile: false,
      })
      expect(storno).toMatchObject({ tipoDocumento: 'TD04', numeroTesto: '1' })
      expect((await b.documento(storno.id)).anno).toBe(2027)
      const prima = await b.documento(d.id)
      const legamiPrima = await b.legami([d.legameId])
      const numPrima = await b.t19.numerazioni(az.tenantId)

      const r = await esito(b.annulla(az, d.id, { versione: prima.versione }))
      expect(r).toEqual({
        status: 409,
        codice: 'ANNULLO_NON_AMMESSO',
        details: { motivo: 'STORNATO' },
      })
      expect(await b.documento(d.id)).toEqual(prima)
      expect(await b.legami([d.legameId])).toEqual(legamiPrima)
      expect(await b.t19.numerazioni(az.tenantId)).toEqual(numPrima)
      await b.t19.verificaSerie(az.tenantId)
    })

    it.each([
      ['vuoto', ''],
      ['solo spazi', '   '],
      ['201 caratteri', 'x'.repeat(201)],
    ])('motivo %s: 400 MOTIVO_NON_VALIDO, nulla scritto', async (_nome, motivo) => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const r = await esito(b.annulla(az, d.id, { motivo, versione: await b.versioneDi(d.id) }))
      expect(r).toMatchObject({ status: 400, codice: 'MOTIVO_NON_VALIDO' })
      expect((await b.documento(d.id)).stato).toBe('DEFINITIVO')
    })

    it('motivo di 200 caratteri: ammesso', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await b.annullaCorrente(az, d.id, 'y'.repeat(200))
      expect((await b.documento(d.id)).motivo_annullo).toHaveLength(200)
    })

    it('annullo con scostamento: legame CONFERMATO, poi la lista della 4.3 lo mostra DA_RIALLINEARE e «Riallinea» lo porta alla testa', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      // Rettifica dopo la fattura: il legame FATTURATO si riallinea con lo scostamento.
      const testaId = await aggiungiRettificaDiTest(owner, az.tenantId, d.movimentoId)
      const riallinea = () =>
        nel(az, () =>
          app.$transaction(async tx => {
            await bloccaLegamePerRadice(tx, d.movimentoId)
            const testa = await leggiTestaCatena(tx, az.tenantId, d.movimentoId)
            return legamiService().allineaAlVigente(tx, az.tenantId, null, d.legameId, testa!)
          })
        )
      expect((await riallinea()).scostamento).toBe(true)
      expect((await b.legami([d.legameId]))[0]).toMatchObject({
        scostamento_dopo_fattura: true,
        movimento_vigente_id: testaId,
      })

      await b.annullaCorrente(az, d.id)
      expect((await b.legami([d.legameId]))[0]).toMatchObject({
        stato: 'CONFERMATO',
        scostamento_dopo_fattura: false,
        movimento_vigente_id: d.movimentoId,
      })
      const lista = await nel(az, () =>
        new ListaLegamiService(app).lista(az.tenantId, { stato: 'DA_RIALLINEARE' })
      )
      expect(lista.elementi.find(e => e.legameId === d.legameId)).toMatchObject({
        stato: 'DA_RIALLINEARE',
        movimentoId: testaId,
      })

      await riallinea()
      expect((await b.legami([d.legameId]))[0]).toMatchObject({
        stato: 'CONFERMATO',
        movimento_vigente_id: testaId,
      })
    })

    it('numero annullato riusato dalla definitiva successiva', async () => {
      const az = await b.t19.azienda()
      const [, d2] = await b.definitivi(az, 2)
      await b.annullaCorrente(az, d2.id)
      // Un solo legame nuovo, in un periodo che non contiene quelli appena ripristinati.
      await b.t19.contratto(az, { data: '2026-02-10' })
      const e = await b.t19.pronta(az, { periodoDal: '2026-02-01', periodoAl: '2026-02-28' })
      const esitoDef = await b.t19.definitiva(az, e)
      expect(esitoDef.esito).toBe('DEFINITIVA')
      const nuovo = (await b.t19.documenti(e.id))[0]
      expect(nuovo).toMatchObject({ numero: 2, stato: 'DEFINITIVO' })
      // Il documento annullato conserva il suo numero storico: l'unico e' solo sui DEFINITIVI.
      expect(await b.documento(d2.id)).toMatchObject({ stato: 'ANNULLATO', numero: 2 })
      expect((await numerazione(az)).ultimo_numero).toBe(2)
      await b.t19.verificaSerie(az.tenantId)
    })

    it('VERSIONE_SUPERATA, documento inesistente o di un’altra azienda: 409 e 404', async () => {
      const az = await b.t19.azienda()
      const altra = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const v = await b.versioneDi(d.id)
      expect(await esito(b.annulla(az, d.id, { versione: v + 1 }))).toMatchObject({
        status: 409,
        codice: 'VERSIONE_SUPERATA',
      })
      expect(await esito(b.annulla(az, d.id, { versione: 0 }))).toMatchObject({
        status: 400,
        codice: 'VERSIONE_NON_VALIDA',
      })
      expect(
        await esito(b.annulla(az, '00000000-0000-4000-8000-000000000000', { versione: 1 }))
      ).toMatchObject({ status: 404, codice: 'DOCUMENTO_NON_TROVATO' })
      expect(await esito(b.annulla(altra, d.id, { versione: v }))).toMatchObject({
        status: 404,
        codice: 'DOCUMENTO_NON_TROVATO',
      })
      expect((await b.documento(d.id)).stato).toBe('DEFINITIVO')
    })

    it('annullo di un TD04 ultimo e non emesso: 409 ANNULLO_NON_AMMESSO con details.motivo NOTA_DI_CREDITO, nulla scritto (decisione 18)', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const td04 = await b.stornaCorrente(az, d.id)
      expect(td04.numeroTesto).toBe('2')
      const prima = await b.documento(td04.id)
      const num = await b.t19.numerazioni(az.tenantId)
      const r = await esito(b.annulla(az, td04.id, { versione: prima.versione }))
      expect(r).toEqual({
        status: 409,
        codice: 'ANNULLO_NON_AMMESSO',
        details: { motivo: 'NOTA_DI_CREDITO' },
      })
      expect(await b.documento(td04.id)).toEqual(prima)
      expect(await b.t19.numerazioni(az.tenantId)).toEqual(num)
    })

    it('annullo di una bozza o di un annullato: 409 con motivo NON_DEFINITIVO', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await b.annullaCorrente(az, d.id)
      expect(await esito(b.annulla(az, d.id, { versione: await b.versioneDi(d.id) }))).toEqual({
        status: 409,
        codice: 'ANNULLO_NON_AMMESSO',
        details: { motivo: 'NON_DEFINITIVO' },
      })
      const az2 = await b.t19.azienda()
      await b.t19.contratto(az2)
      const e = await b.t19.pronta(az2)
      const bozza = (await b.t19.documenti(e.id))[0]
      expect(bozza.stato).toBe('BOZZA')
      expect(
        await esito(b.annulla(az2, bozza.id, { versione: await b.versioneDi(bozza.id) }))
      ).toEqual({
        status: 409,
        codice: 'ANNULLO_NON_AMMESSO',
        details: { motivo: 'NON_DEFINITIVO' },
      })
      // Nessuna numerazione residua dal tentativo sulla bozza.
      expect((await b.t19.numerazioni(az2.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)
    })

    it('audit senza dati personali: solo id, numero e importi; il motivo non finisce nel log', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await b.annullaCorrente(az, d.id, 'SEGRETO motivo libero')
      const audit = await b.audit(az.tenantId, 'DOCUMENTO_FATTURA_ANNULLATO')
      expect(audit).toHaveLength(1)
      expect(Object.keys(audit[0].metadata).sort()).toEqual(
        ['anno', 'documentoId', 'legami', 'numero', 'registroIvaId', 'totale'].sort()
      )
      expect(JSON.stringify(audit[0].metadata)).not.toContain('SEGRETO')
    })
  })

  // -------------------------------------------------------------------------------------------
  // Storno
  // -------------------------------------------------------------------------------------------

  describe('storno', () => {
    it('TD04 col numero successivo, importi positivi, stesse righe con riga_legame_id NULL e documento_origine_id; l’origine resta DEFINITIVO', async () => {
      const az = await b.t19.azienda()
      const c1 = await b.t19.contratto(az, { ragione: 'Alfa SRL', fisso: true })
      const c2 = await b.t19.contratto(az, { ragione: 'Zeta SRL' })
      const [d1] = await b.definitivi(az, 2, { contratti: [c1, c2] })
      const origine = await b.documento(d1.id)
      const dettaglio = await b.stornaCorrente(az, d1.id, {
        motivo: '  reso totale  ',
        dataDocumento: '2026-04-20',
      })
      expect(dettaglio).toMatchObject({
        stato: 'DEFINITIVO',
        tipoDocumento: 'TD04',
        numeroTesto: '3',
        dataDocumento: '2026-04-20',
        documentoOrigineId: d1.id,
        totaleDocumento: origine.totale_documento,
        annullabile: false,
        motivoNonAnnullabile: 'NOTA_DI_CREDITO',
        stornabile: false,
      })
      const td04 = await b.documento(dettaglio.id)
      expect(td04).toMatchObject({
        numero: 3,
        elaborazione_id: null,
        documento_origine_id: d1.id,
        anno: 2026,
        registro_iva_id: origine.registro_iva_id,
        totale_imponibile: origine.totale_imponibile,
        totale_iva: origine.totale_iva,
        netto_a_pagare: origine.netto_a_pagare,
        definito_da: az.utenteId,
      })
      expect(Number(td04.totale_documento)).toBeGreaterThan(0)
      expect(td04.fotografia).toMatchObject({ motivoStorno: 'reso totale' })

      // Righe: stessi tipi e importi, riga_legame_id NULL sempre.
      const righeO = await b.righeComplete(d1.id)
      const righeS = await b.righeComplete(td04.id)
      expect(righeS.length).toBe(righeO.length)
      expect(
        righeS.map(r => [r.tipo_riga, r.prezzo_totale, r.legame_id, r.movimento_fatturato_id])
      ).toEqual(
        righeO.map(r => [r.tipo_riga, r.prezzo_totale, r.legame_id, r.movimento_fatturato_id])
      )
      expect(righeS.every(r => r.riga_legame_id === null)).toBe(true)
      const fo = await b.figlie(d1.id)
      expect(await b.figlie(td04.id)).toEqual(fo)
      expect(fo.riepiloghi).toBeGreaterThan(0)

      // L'origine non cambia; la serie avanza di uno con la data dello storno.
      expect(await b.documento(d1.id)).toEqual(origine)
      expect(await numerazione(az)).toMatchObject({ ultimo_numero: 3, ultima_data: '2026-04-20' })
      await b.t19.verificaSerie(az.tenantId)
    })

    it('rifatturabile: legami CONFERMATO e marcatori tolti; non rifatturabile: legami FATTURATO, scostamento gestito con nota «storno documento N»', async () => {
      const az = await b.t19.azienda()
      const c1 = await b.t19.contratto(az, { ragione: 'Alfa SRL', fisso: true })
      const c2 = await b.t19.contratto(az, { ragione: 'Zeta SRL', fisso: true })
      const [d1, d2] = await b.definitivi(az, 2, { contratti: [c1, c2] })
      expect((await b.t19.marcatori(az.tenantId)).length).toBe(2)

      // d1: rifatturabile.
      await b.stornaCorrente(az, d1.id, { rifatturabile: true })
      expect((await b.legami([d1.legameId]))[0]).toMatchObject({
        stato: 'CONFERMATO',
        documento_id: null,
        movimento_vigente_id: d1.movimentoId,
      })
      const marcatori = await b.t19.marcatori(az.tenantId)
      expect(marcatori.map(m => m.documento_id)).toEqual([d2.id])

      // d2: non rifatturabile, con uno scostamento aperto.
      await owner.$executeRawUnsafe(
        `UPDATE legami_movimento SET scostamento_dopo_fattura = true, scostamento_il = now()
         WHERE id = $1::uuid`,
        d2.legameId
      )
      await b.stornaCorrente(az, d2.id, { rifatturabile: false })
      const l2 = (await b.legami([d2.legameId]))[0]
      expect(l2).toMatchObject({
        stato: 'FATTURATO',
        documento_id: d2.id,
        scostamento_dopo_fattura: true,
        scostamento_gestito_da: az.utenteId,
        scostamento_nota: 'storno documento 2',
      })
      expect(l2.scostamento_gestito_il).not.toBeNull()
      expect((await b.t19.marcatori(az.tenantId)).map(m => m.documento_id)).toEqual([d2.id])
    })

    it('non rifatturabile senza scostamento: i legami restano FATTURATO e non si segna nulla', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const prima = (await b.legami([d.legameId]))[0]
      await b.stornaCorrente(az, d.id, { rifatturabile: false })
      expect((await b.legami([d.legameId]))[0]).toEqual(prima)
    })

    it('storno rifatturabile, poi conferma del legame con cambio di elenco: riuscita, nessun 23503 (Q1)', async () => {
      const az = await b.t19.azienda()
      const c = await b.t19.contratto(az)
      const [d] = await b.definitivi(az, 1, { contratti: [c] })
      await b.stornaCorrente(az, d.id, { rifatturabile: true })
      const c2 = await secondoContratto(az, c.clienteId)
      const l = (await b.legami([d.legameId]))[0]
      const vista = await nel(az, () =>
        legamiService().conferma(az.tenantId, az.utenteId, d.legameId, l.versione, {
          contrattoId: c2.contrattoId,
        })
      )
      expect(vista.stato).toBe('CONFERMATO')
      expect((await b.legami([d.legameId]))[0].elenco_id).toBe(c2.elencoId)
    })

    it('secondo storno: 409 STORNO_GIA_PRESENTE', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await b.stornaCorrente(az, d.id)
      const r = await esito(b.storna(az, d.id, { versione: await b.versioneDi(d.id) }))
      expect(r).toMatchObject({ status: 409, codice: 'STORNO_GIA_PRESENTE' })
      expect(await conteggioStorni(az)).toBe(1)
      expect((await numerazione(az)).ultimo_numero).toBe(2)
    })

    it('storno con data prima di ultima_data: 409 DATA_ANTERIORE_ULTIMA_FATTURA; con data di domani: 400 DATA_FUTURA; nulla scritto, legami invariati (Review Focus 5)', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const legamiPrima = await b.legami([d.legameId])
      const numPrima = await b.t19.numerazioni(az.tenantId)
      const v = await b.versioneDi(d.id)
      for (const rifatturabile of [true, false]) {
        expect(
          await esito(
            b.storna(az, d.id, { dataDocumento: '2026-04-04', rifatturabile, versione: v })
          )
        ).toMatchObject({ status: 409, codice: 'DATA_ANTERIORE_ULTIMA_FATTURA' })
        expect(
          await esito(
            b.storna(az, d.id, { dataDocumento: '2026-05-02', rifatturabile, versione: v })
          )
        ).toMatchObject({ status: 400, codice: 'DATA_FUTURA' })
      }
      expect(await conteggioStorni(az)).toBe(0)
      expect(await b.legami([d.legameId])).toEqual(legamiPrima)
      expect(await b.t19.numerazioni(az.tenantId)).toEqual(numPrima)
      // Il giorno di oggi (italiano) e' ammesso.
      await b.storna(az, d.id, { dataDocumento: '2026-05-01', versione: v })
    })

    it('data non valida: 400 DATA_NON_VALIDA', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const v = await b.versioneDi(d.id)
      for (const dataDocumento of ['2026-02-30', '20/04/2026', '']) {
        expect(await esito(b.storna(az, d.id, { dataDocumento, versione: v }))).toMatchObject({
          status: 400,
          codice: 'DATA_NON_VALIDA',
        })
      }
    })

    it('difesa sulla data dell’origine: ultima_data della coppia riportata col proprietario prima, origine del 05/04, storno del 03/04: 409 DATA_ANTERIORE_ULTIMA_FATTURA, nulla scritto', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await owner.$executeRawUnsafe(
        `UPDATE numerazioni_fattura SET ultima_data = '2026-04-01' WHERE tenant_id = $1::uuid`,
        az.tenantId
      )
      const legamiPrima = await b.legami([d.legameId])
      const numPrima = await b.t19.numerazioni(az.tenantId)
      const r = await esito(
        b.storna(az, d.id, { dataDocumento: '2026-04-03', versione: await b.versioneDi(d.id) })
      )
      expect(r).toMatchObject({ status: 409, codice: 'DATA_ANTERIORE_ULTIMA_FATTURA' })
      expect(await conteggioStorni(az)).toBe(0)
      expect(await b.legami([d.legameId])).toEqual(legamiPrima)
      expect(await b.t19.numerazioni(az.tenantId)).toEqual(numPrima)
    })

    it('storno di una BOZZA o di un ANNULLATO: 409 STORNO_NON_AMMESSO motivo NON_DEFINITIVO; di un TD04: motivo NOTA_DI_CREDITO; nulla scritto (Q33)', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await b.annullaCorrente(az, d.id)
      const num = await b.t19.numerazioni(az.tenantId)
      expect(await esito(b.storna(az, d.id, { versione: await b.versioneDi(d.id) }))).toEqual({
        status: 409,
        codice: 'STORNO_NON_AMMESSO',
        details: { motivo: 'NON_DEFINITIVO' },
      })

      const az2 = await b.t19.azienda()
      await b.t19.contratto(az2)
      const e = await b.t19.pronta(az2)
      const bozza = (await b.t19.documenti(e.id))[0]
      expect(
        await esito(b.storna(az2, bozza.id, { versione: await b.versioneDi(bozza.id) }))
      ).toEqual({
        status: 409,
        codice: 'STORNO_NON_AMMESSO',
        details: { motivo: 'NON_DEFINITIVO' },
      })
      expect((await b.t19.numerazioni(az2.tenantId)).every(n => n.ultimo_numero === 0)).toBe(true)

      const az3 = await b.t19.azienda()
      const [d3] = await b.definitivi(az3, 1)
      const td04 = await b.stornaCorrente(az3, d3.id)
      const num3 = await b.t19.numerazioni(az3.tenantId)
      expect(
        await esito(b.storna(az3, td04.id, { versione: await b.versioneDi(td04.id) }))
      ).toEqual({
        status: 409,
        codice: 'STORNO_NON_AMMESSO',
        details: { motivo: 'NOTA_DI_CREDITO' },
      })
      expect(await b.t19.numerazioni(az3.tenantId)).toEqual(num3)
      expect(await b.t19.numerazioni(az.tenantId)).toEqual(num)
    })

    it('suffisso dello storno nella serie con definitivi: quello dell’ultimo definitivo (decisione 20)', async () => {
      const az = await b.t19.azienda()
      await owner.$executeRawUnsafe(
        `UPDATE registri_iva SET suffisso_numero = '/A' WHERE id = $1::uuid`,
        az.tab.registroId
      )
      const [d] = await b.definitivi(az, 1)
      expect((await b.documento(d.id)).numero_testo).toBe('1/A')
      // Il suffisso del registro cambia a documenti gia' numerati: la serie non si spezza.
      await owner.$executeRawUnsafe(
        `UPDATE registri_iva SET suffisso_numero = '/Z' WHERE id = $1::uuid`,
        az.tab.registroId
      )
      const td04 = await b.stornaCorrente(az, d.id)
      expect(td04.numeroTesto).toBe('2/A')
    })

    it('VERSIONE_SUPERATA e 404', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const v = await b.versioneDi(d.id)
      expect(await esito(b.storna(az, d.id, { versione: v + 1 }))).toMatchObject({
        status: 409,
        codice: 'VERSIONE_SUPERATA',
      })
      expect(
        await esito(b.storna(az, '00000000-0000-4000-8000-000000000000', { versione: 1 }))
      ).toMatchObject({ status: 404, codice: 'DOCUMENTO_NON_TROVATO' })
      expect(await conteggioStorni(az)).toBe(0)
    })

    it.each([
      ['vuoto', ''],
      ['201 caratteri', 'x'.repeat(201)],
    ])('motivo %s: 400 MOTIVO_NON_VALIDO', async (_n, motivo) => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      expect(
        await esito(b.storna(az, d.id, { motivo, versione: await b.versioneDi(d.id) }))
      ).toMatchObject({ status: 400, codice: 'MOTIVO_NON_VALIDO' })
    })

    it('audit senza dati personali', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await b.stornaCorrente(az, d.id, { motivo: 'SEGRETO motivo libero' })
      const audit = await b.audit(az.tenantId, 'DOCUMENTO_FATTURA_STORNATO')
      expect(audit).toHaveLength(1)
      expect(Object.keys(audit[0].metadata).sort()).toEqual(
        [
          'anno',
          'documentoId',
          'documentoOrigineId',
          'numero',
          'registroIvaId',
          'rifatturabile',
          'totale',
        ].sort()
      )
      expect(JSON.stringify(audit[0].metadata)).not.toContain('SEGRETO')
    })
  })

  // -------------------------------------------------------------------------------------------
  // enable_nestloop (Q39)
  // -------------------------------------------------------------------------------------------

  describe('enable_nestloop', () => {
    it('dopo annullo e storno (rifatturabile e no) current_setting(enable_nestloop) è il valore di prima', async () => {
      const az = await b.t19.azienda()
      const [d1, d2] = await b.definitivi(az, 2)
      const visti: string[] = []
      const originale = DocumentiFatturaService.prototype.dettaglioInTx
      jest
        .spyOn(DocumentiFatturaService.prototype, 'dettaglioInTx')
        .mockImplementation(async function (this: DocumentiFatturaService, tx, ...resto) {
          const [{ v }] = await tx.$queryRaw<
            { v: string }[]
          >`SELECT current_setting('enable_nestloop') AS v`
          visti.push(v)
          return originale.call(this, tx, ...resto)
        })
      const [{ v: base }] = await owner.$queryRawUnsafe<{ v: string }[]>(
        `SELECT current_setting('enable_nestloop') AS v`
      )
      await b.stornaCorrente(az, d1.id, { rifatturabile: true })
      await b.stornaCorrente(az, d2.id, { rifatturabile: false })
      // Annullo del TD04 non ammesso: serve un annullo vero, su un'altra azienda.
      const az2 = await b.t19.azienda()
      const [e1] = await b.definitivi(az2, 1)
      await b.annullaCorrente(az2, e1.id)
      expect(visti).toEqual([base, base, base])
    })

    it('ripristinaLegamiDelDocumento è usabile da solo e lascia il planner com’era', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const r = await nel(az, () =>
        app.$transaction(async tx => {
          const [{ v: prima }] = await tx.$queryRaw<
            { v: string }[]
          >`SELECT current_setting('enable_nestloop') AS v`
          const n = await ripristinaLegamiDelDocumento(tx, az.tenantId, d.id)
          const [{ v: dopo }] = await tx.$queryRaw<
            { v: string }[]
          >`SELECT current_setting('enable_nestloop') AS v`
          return { n, prima, dopo }
        })
      )
      expect(r.n).toBe(1)
      expect(r.dopo).toBe(r.prima)
      expect((await b.legami([d.legameId]))[0].stato).toBe('CONFERMATO')
    })
  })

  it('il contesto del tenant sbagliato non vede il documento (RLS)', async () => {
    const az = await b.t19.azienda()
    const altra = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    const r = await esito(
      TenantContext.run({ tenantId: altra.tenantId }, () =>
        b.servizio.storna(altra.tenantId, altra.utenteId, d.id, {
          motivo: 'x',
          dataDocumento: '2026-04-20',
          rifatturabile: true,
          versione: 1,
        })
      )
    )
    expect(r).toMatchObject({ status: 404, codice: 'DOCUMENTO_NON_TROVATO' })
  })
})
