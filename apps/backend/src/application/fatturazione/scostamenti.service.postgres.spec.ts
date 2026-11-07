/**
 * Scostamenti dopo la fattura e presa d'atto (fase 4.4b1, Task 21, spec §5.7) contro un Postgres
 * reale, collegato COME `wasteflow_app` (RLS FORCE). Il proprietario prepara gli scenari e legge
 * lo stato finale; pulizia solo per id esatti (`pulisciTenantDiTest`). Il volume (200.000
 * movimenti) sta in `scostamenti.volume.postgres.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t21-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import { creaDocumentoDiTest } from '../../test-support/fatturazione-di-test'
import type { AziendaT18 } from '../../test-support/fatturazione-t18-di-test'
import { esitoHttp as esito } from '../../test-support/fatturazione-t19-di-test'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  pulisciTenantDiTest,
} from '../../test-support/legami-di-test'
import { creaRiga } from '../../test-support/listino-di-test'
import { ScostamentiService } from './scostamenti.service'

type Tipo = 'RETTIFICA' | 'ANNULLAMENTO'

describe('Scostamenti e presa d’atto — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  let servizio: ScostamentiService
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    b.reset()
    servizio = new ScostamentiService(app)
  })
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  const nel = <R>(az: AziendaT18, fn: () => Promise<R>) => b.t19.nel(az.tenantId, fn)
  const lista = (
    az: AziendaT18,
    q: { pagina?: number; dimensione?: number; clienteId?: string } = {}
  ) => nel(az, () => servizio.lista(az.tenantId, { pagina: 1, dimensione: 50, ...q }))
  const presaAtto = (az: AziendaT18, legameId: string, nota: string, versione: number) =>
    nel(az, () => servizio.presaAtto(az.tenantId, az.utenteId, legameId, { nota, versione }))

  /**
   * Aggiunge una correzione alla catena del movimento (col proprietario) e porta il legame alla
   * testa segnando lo scostamento, come `allineaAlVigente` su un legame FATTURATO.
   */
  async function correggi(
    az: AziendaT18,
    legameId: string,
    radiceId: string,
    o: {
      tipo?: Tipo
      quantita?: string
      cer?: string
      causale?: string
      /** Testa attuale della catena (default: la radice). */
      precedenteId?: string
    } = {}
  ): Promise<string> {
    const origine = await owner.wasteMovement.findUniqueOrThrow({ where: { id: radiceId } })
    const ultimo = await owner.wasteMovement.aggregate({
      where: { registroId: origine.registroId, progressiveYear: 2026 },
      _max: { progressiveNumber: true },
    })
    const c = await owner.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: origine.registroId,
        progressiveYear: 2026,
        progressiveNumber: (ultimo._max.progressiveNumber ?? 0) + 1,
        type: origine.type,
        movementDate: origine.movementDate,
        causale: o.causale ?? origine.causale,
        cerCode: o.cer ?? origine.cerCode,
        quantity: o.quantita ?? '90',
        unit: 'KG',
        tipoAnnotazione: o.tipo ?? 'RETTIFICA',
        movimentoRettificatoId: o.precedenteId ?? radiceId,
        movimentoOriginaleId: radiceId,
        motivoAnnotazione: 'prova',
      },
    })
    await owner.$executeRawUnsafe(
      `UPDATE legami_movimento SET movimento_vigente_id = $2::uuid, scostamento_dopo_fattura = true,
         scostamento_il = now(), versione = versione + 1 WHERE id = $1::uuid`,
      legameId,
      c.id
    )
    return c.id
  }

  /** Righe MOVIMENTO del documento di un legame, col prezzo unitario. */
  const righeDi = (documentoId: string) =>
    owner.$queryRawUnsafe<
      { numero_linea: number; quantita: string; prezzo_unitario: string; prezzo_totale: string }[]
    >(
      `SELECT numero_linea, quantita::text, prezzo_unitario::text, prezzo_totale::text
       FROM righe_documento_fattura WHERE documento_id = $1::uuid AND tipo_riga = 'MOVIMENTO'
       ORDER BY numero_linea`,
      documentoId
    )

  /**
   * Documento DEFINITIVO costruito a mano per un legame, con righe MOVIMENTO in piu' (testata in
   * BOZZA, figlie, promozione, legame FATTURATO).
   */
  async function fatturaConRighe(
    az: AziendaT18,
    legameId: string,
    o: {
      data?: string
      extra?: { prezzo: string; speciale?: boolean; rigaAddebitoId?: string }[]
    } = {}
  ): Promise<string> {
    const { documentoId } = await creaDocumentoDiTest(owner, az.tenantId, {
      stato: 'BOZZA',
      registroIvaId: az.tab.registroId,
      anno: 2026,
      dataDocumento: o.data,
      legamiIds: [legameId],
    })
    const [base] = await owner.$queryRawUnsafe<
      {
        quantita: string
        movimento_fatturato_id: string
        riga_addebito_id: string
        codice_iva_id: string
        aliquota_iva: string
        data_movimento: string
      }[]
    >(
      `SELECT quantita::text, movimento_fatturato_id::text, riga_addebito_id::text,
              codice_iva_id::text, aliquota_iva::text, data_movimento::text
       FROM righe_documento_fattura WHERE documento_id = $1::uuid ORDER BY numero_linea LIMIT 1`,
      documentoId
    )
    let linea = 1
    for (const e of o.extra ?? []) {
      linea++
      const totale = e.speciale ? '0.00' : (Number(base.quantita) * Number(e.prezzo)).toFixed(2)
      await owner.$executeRawUnsafe(
        `INSERT INTO righe_documento_fattura
           (tenant_id, documento_id, numero_linea, tipo_riga, legame_id, movimento_fatturato_id,
            riga_addebito_id, descrizione, data_movimento, quantita, unita_misura, prezzo_unitario,
            importo_lordo, importo_sconto, prezzo_totale, codice_iva_id, aliquota_iva, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::int, 'MOVIMENTO', $4::uuid, $5::uuid, $6::uuid,
            'Riga V', $7::date, $8::numeric, 'KG', $9::numeric, $10::numeric, 0, $10::numeric,
            $11::uuid, $12::numeric, now())`,
        az.tenantId,
        documentoId,
        linea,
        legameId,
        base.movimento_fatturato_id,
        e.rigaAddebitoId ?? base.riga_addebito_id,
        base.data_movimento,
        base.quantita,
        e.speciale ? '0' : e.prezzo,
        totale,
        base.codice_iva_id,
        base.aliquota_iva
      )
    }
    const [{ n }] = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COALESCE(max(numero), 0)::int + 1 AS n FROM documenti_fattura
       WHERE tenant_id = $1::uuid AND registro_iva_id = $2::uuid AND anno = 2026`,
      az.tenantId,
      az.tab.registroId
    )
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura SET stato = 'DEFINITIVO', numero = $2::int, numero_testo = $2::text,
         definito_il = now(), updated_at = now() WHERE id = $1::uuid`,
      documentoId,
      n
    )
    await owner.$executeRawUnsafe(
      `UPDATE legami_movimento SET stato = 'FATTURATO', fatturato_il = now(), documento_id = $2::uuid,
         riferimento_fattura = $3, updated_at = now() WHERE id = $1::uuid`,
      legameId,
      documentoId,
      String(n)
    )
    return documentoId
  }

  /** Contratto con un legame CONFERMATO la cui riga ha UM, tipo di quantità e origine scelti. */
  async function legameConRiga(
    az: AziendaT18,
    o: {
      quantity?: string
      unit?: string
      quantitaRiga: string
      prezzo: string
      um?: string
      tipoQuantita?: 'PESO_NETTO' | 'UNO'
      origine?: 'DA_MOVIMENTO' | 'MANUALE'
    }
  ) {
    const c = await b.t19.contratto(az, { senzaLegame: true })
    const m = await creaMovimentoDiTest(owner, az.tenantId, {
      movementDate: '2026-03-10',
      quantity: o.quantity ?? '1000',
      unit: o.unit ?? 'KG',
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
          quantita: o.quantitaRiga,
          prezzo: o.prezzo,
        },
      ],
    })
    await owner.$executeRawUnsafe(
      `UPDATE righe_legame_movimento
       SET tipo_quantita = $2::tipo_quantita_addebito, unita_misura = $3,
           quantita_origine = $4::origine_quantita_legame
       WHERE legame_id = $1::uuid`,
      l.legameId,
      o.tipoQuantita ?? 'PESO_NETTO',
      o.um ?? 'KG',
      o.origine ?? 'DA_MOVIMENTO'
    )
    return { ...c, legameId: l.legameId, movimentoId: m.movimentoId }
  }

  const legame = async (id: string) => (await b.legami([id]))[0]

  // -------------------------------------------------------------------------------------------
  // Lista
  // -------------------------------------------------------------------------------------------

  describe('lista', () => {
    it('vuota senza scostamenti', async () => {
      const az = await b.t19.azienda()
      await b.definitivi(az, 1)
      expect(await lista(az)).toEqual({ elementi: [], totale: 0, pagina: 1, dimensione: 50 })
    })

    it('rettifica dopo la definitiva: fatturato dalle righe del documento, attuale dalla testa', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await correggi(az, d.legameId, d.movimentoId, { quantita: '90' })
      const [riga] = await righeDi(d.id)
      const doc = await b.documento(d.id)
      const l = await legame(d.legameId)

      const r = await lista(az)
      expect(r.totale).toBe(1)
      expect(r.elementi).toHaveLength(1)
      const unitario = Number(riga.prezzo_unitario)
      expect(r.elementi[0]).toEqual({
        legameId: d.legameId,
        versioneLegame: l.versione,
        documento: {
          id: d.id,
          numeroTesto: doc.numero_testo,
          dataDocumento: doc.data_documento,
        },
        tipoCorrezione: 'RETTIFICA',
        quantitaFatturata: riga.quantita,
        unitaFatturata: 'KG',
        unitaAttuale: 'KG',
        importoFatturato: riga.prezzo_totale,
        quantitaAttuale: '90.000',
        importoAttuale: (90 * unitario).toFixed(2),
        soloQuantita: false,
      })
    })

    it('annullo del movimento: tipo ANNULLO, attuale 0.00', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await correggi(az, d.legameId, d.movimentoId, { tipo: 'ANNULLAMENTO' })
      const [e] = (await lista(az)).elementi
      expect(e).toMatchObject({
        tipoCorrezione: 'ANNULLO',
        quantitaAttuale: '0.000',
        importoAttuale: '0.00',
        soloQuantita: false,
      })
    })

    it('un solo scostamento per legame con due righe MOVIMENTO (CER e V): importi sommati, quantità del movimento', async () => {
      const az = await b.t19.azienda()
      const c = await b.t19.contratto(az)
      const [{ movimento_originale_id: movimentoId }] = await owner.$queryRawUnsafe<
        { movimento_originale_id: string }[]
      >(`SELECT movimento_originale_id::text FROM legami_movimento WHERE id = $1::uuid`, c.legameId)
      const docId = await fatturaConRighe(az, c.legameId as string, { extra: [{ prezzo: '0.5' }] })
      await correggi(az, c.legameId as string, movimentoId, { quantita: '200' })
      const righe = await righeDi(docId)
      expect(righe).toHaveLength(2)

      const r = await lista(az)
      expect(r.elementi).toHaveLength(1)
      const somma = righe.reduce((a, x) => a + Number(x.prezzo_totale), 0)
      const prezzi = righe.reduce((a, x) => a + Number(x.prezzo_unitario), 0)
      expect(r.elementi[0]).toMatchObject({
        quantitaFatturata: righe[0].quantita,
        importoFatturato: somma.toFixed(2),
        quantitaAttuale: '200.000',
        importoAttuale: (200 * prezzi).toFixed(2),
        soloQuantita: false,
      })
    })

    it('una riga a prezzo singolo e una a prezzo speciale (dalla riga del legame): soloQuantita, importoAttuale null', async () => {
      const az = await b.t19.azienda()
      const c = await b.t19.contratto(az)
      const [{ movimento_originale_id: movimentoId }] = await owner.$queryRawUnsafe<
        { movimento_originale_id: string }[]
      >(`SELECT movimento_originale_id::text FROM legami_movimento WHERE id = $1::uuid`, c.legameId)
      // Seconda riga di listino e seconda riga del legame, a prezzo speciale.
      const v = await creaRiga(owner, az.tenantId, c.elencoId, {
        tipo: 'CER',
        cerCode: '20 03 07',
        codiceIvaId: az.listino.iva22Id,
      })
      await owner.$executeRawUnsafe(
        `INSERT INTO righe_legame_movimento
           (tenant_id, legame_id, elenco_id, riga_addebito_id, ordine, origine, tipo, tipo_quantita,
            unita_misura, quantita, quantita_origine, prezzo_speciale, prezzo, prezzo_manuale,
            codice_iva_id, aliquota_iva, natura_iva, updated_at)
         SELECT tenant_id, legame_id, elenco_id, $2::uuid, 2, origine, tipo, tipo_quantita,
                unita_misura, quantita, quantita_origine, true, NULL, false, codice_iva_id,
                aliquota_iva, natura_iva, now()
         FROM righe_legame_movimento WHERE legame_id = $1::uuid AND ordine = 1`,
        c.legameId,
        v.id
      )
      // `creaDocumentoDiTest` crea una riga MOVIMENTO per ciascuna riga del legame (2).
      await fatturaConRighe(az, c.legameId as string)
      await correggi(az, c.legameId as string, movimentoId, { quantita: '200' })
      const [e] = (await lista(az)).elementi
      expect(e).toMatchObject({
        soloQuantita: true,
        importoAttuale: null,
        quantitaAttuale: '200.000',
      })
    })

    it('C1: riga a 100 euro/tonnellata, 1000 kg fatturati, rettifica a 1200 kg: attuale 120.00; quantità del movimento in kg', async () => {
      const az = await b.t19.azienda()
      const c = await legameConRiga(az, { quantitaRiga: '1', prezzo: '100', um: 'TON' })
      const docId = await fatturaConRighe(az, c.legameId)
      expect((await righeDi(docId))[0]).toMatchObject({
        quantita: '1.000',
        prezzo_totale: '100.00',
      })
      await correggi(az, c.legameId, c.movimentoId, { quantita: '1200' })
      const [e] = (await lista(az)).elementi
      expect(e).toMatchObject({
        quantitaFatturata: '1000.000',
        importoFatturato: '100.00',
        quantitaAttuale: '1200.000',
        importoAttuale: '120.00',
        soloQuantita: false,
        tipoCorrezione: 'RETTIFICA',
      })
    })

    it('C1: riga UNO (viaggio a 50 euro): importo attuale uguale al fatturato', async () => {
      const az = await b.t19.azienda()
      const c = await legameConRiga(az, {
        quantitaRiga: '1',
        prezzo: '50',
        um: 'NR',
        tipoQuantita: 'UNO',
      })
      await fatturaConRighe(az, c.legameId)
      await correggi(az, c.legameId, c.movimentoId, { quantita: '1200' })
      const [e] = (await lista(az)).elementi
      expect(e).toMatchObject({ importoFatturato: '50.00', importoAttuale: '50.00' })
    })

    it('C1: riga MANUALE: importo attuale uguale al fatturato; annullo: resta anche quello', async () => {
      const az = await b.t19.azienda()
      const c = await legameConRiga(az, { quantitaRiga: '3', prezzo: '10', origine: 'MANUALE' })
      await fatturaConRighe(az, c.legameId)
      const t = await correggi(az, c.legameId, c.movimentoId, { quantita: '1200' })
      expect((await lista(az)).elementi[0]).toMatchObject({
        importoFatturato: '30.00',
        importoAttuale: '30.00',
      })
      await correggi(az, c.legameId, c.movimentoId, { tipo: 'ANNULLAMENTO', precedenteId: t })
      expect((await lista(az)).elementi[0]).toMatchObject({
        tipoCorrezione: 'ANNULLO',
        importoAttuale: '30.00',
      })
    })

    it('m1: riga a prezzo singolo con prezzo 0 (omaggio): importo 0.00, non soloQuantita', async () => {
      const az = await b.t19.azienda()
      const c = await legameConRiga(az, { quantitaRiga: '1000', prezzo: '0' })
      await fatturaConRighe(az, c.legameId)
      await correggi(az, c.legameId, c.movimentoId, { quantita: '1200' })
      const [e] = (await lista(az)).elementi
      expect(e).toMatchObject({ soloQuantita: false, importoAttuale: '0.00' })
    })

    it('I2: causale diversa a parità di quantità e CER: CAMBIO_CAUSALE', async () => {
      const az = await b.t19.azienda()
      const c = await legameConRiga(az, { quantitaRiga: '1000', prezzo: '1' })
      await fatturaConRighe(az, c.legameId)
      await correggi(az, c.legameId, c.movimentoId, { quantita: '1000', causale: 'RIENTRO' })
      expect((await lista(az)).elementi[0].tipoCorrezione).toBe('CAMBIO_CAUSALE')
    })

    it('I2: stessa causale e stessa quantità (cambia altro): RETTIFICA', async () => {
      const az = await b.t19.azienda()
      const c = await legameConRiga(az, { quantitaRiga: '1000', prezzo: '1' })
      await fatturaConRighe(az, c.legameId)
      await correggi(az, c.legameId, c.movimentoId, { quantita: '1000' })
      expect((await lista(az)).elementi[0].tipoCorrezione).toBe('RETTIFICA')
    })

    it('cambio di CER: tipo CAMBIO_CER quando la riga fatturata porta il CER', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const [riga] = await owner.$queryRawUnsafe<{ cer_code: string | null }[]>(
        `SELECT cer_code FROM righe_documento_fattura WHERE documento_id = $1::uuid AND tipo_riga = 'MOVIMENTO' LIMIT 1`,
        d.id
      )
      await correggi(az, d.legameId, d.movimentoId, { cer: '20 03 07', quantita: '100' })
      const [e] = (await lista(az)).elementi
      expect(riga.cer_code).not.toBeNull()
      expect(e.tipoCorrezione).toBe('CAMBIO_CER')
    })

    it('solo gli scostamenti non gestiti, ordinati per data del documento', async () => {
      const az = await b.t19.azienda()
      const cs = [
        await b.t19.contratto(az, { ragione: 'Alfa SRL' }),
        await b.t19.contratto(az, { ragione: 'Beta SRL' }),
        await b.t19.contratto(az, { ragione: 'Gamma SRL' }),
        await b.t19.contratto(az, { ragione: 'Delta SRL' }),
      ]
      const date = ['2026-04-20', '2026-04-05', '2026-04-12', '2026-04-01']
      const docs: string[] = []
      const radici: string[] = []
      for (const [i, c] of cs.entries()) {
        const [{ movimento_originale_id: m }] = await owner.$queryRawUnsafe<
          { movimento_originale_id: string }[]
        >(
          `SELECT movimento_originale_id::text FROM legami_movimento WHERE id = $1::uuid`,
          c.legameId
        )
        radici.push(m)
        docs.push(await fatturaConRighe(az, c.legameId as string, { data: date[i] }))
      }
      // I primi tre hanno uno scostamento; il terzo e' gia' gestito; il quarto non ne ha.
      for (const i of [0, 1, 2]) await correggi(az, cs[i].legameId as string, radici[i])
      await owner.$executeRawUnsafe(
        `UPDATE legami_movimento SET scostamento_gestito_il = now(), scostamento_gestito_da = $2::uuid,
           scostamento_nota = 'gia visto' WHERE id = $1::uuid`,
        cs[2].legameId,
        az.utenteId
      )
      const r = await lista(az)
      expect(r.totale).toBe(2)
      expect(r.elementi.map(e => e.documento.id)).toEqual([docs[1], docs[0]])
      expect(r.elementi.map(e => e.documento.dataDocumento)).toEqual(['2026-04-05', '2026-04-20'])
    })

    it('filtro per cliente, paginazione con totale', async () => {
      const az = await b.t19.azienda()
      const cs = [
        await b.t19.contratto(az, { ragione: 'Alfa SRL' }),
        await b.t19.contratto(az, { ragione: 'Beta SRL' }),
        await b.t19.contratto(az, { ragione: 'Gamma SRL' }),
      ]
      for (const [i, c] of cs.entries()) {
        const [{ movimento_originale_id: m }] = await owner.$queryRawUnsafe<
          { movimento_originale_id: string }[]
        >(
          `SELECT movimento_originale_id::text FROM legami_movimento WHERE id = $1::uuid`,
          c.legameId
        )
        await fatturaConRighe(az, c.legameId as string, { data: `2026-04-0${i + 1}` })
        await correggi(az, c.legameId as string, m)
      }
      const p1 = await lista(az, { pagina: 1, dimensione: 2 })
      const p2 = await lista(az, { pagina: 2, dimensione: 2 })
      expect(p1.totale).toBe(3)
      expect(p1.elementi).toHaveLength(2)
      expect(p2.elementi).toHaveLength(1)
      expect(new Set([...p1.elementi, ...p2.elementi].map(e => e.legameId)).size).toBe(3)

      const solo = await lista(az, { clienteId: cs[1].clienteId })
      expect(solo.totale).toBe(1)
      expect(solo.elementi[0].legameId).toBe(cs[1].legameId)
    })

    it('un’altra azienda non vede gli scostamenti', async () => {
      const az1 = await b.t19.azienda()
      const az2 = await b.t19.azienda()
      const [d] = await b.definitivi(az1, 1)
      await correggi(az1, d.legameId, d.movimentoId)
      expect((await lista(az1)).totale).toBe(1)
      expect((await lista(az2)).totale).toBe(0)
    })

    it('paginazione e filtro non validi: 400', async () => {
      const az = await b.t19.azienda()
      for (const q of [{ pagina: 0 }, { dimensione: 101 }, { dimensione: 0 }]) {
        expect(await esito(lista(az, q))).toMatchObject({
          status: 400,
          codice: 'PAGINAZIONE_NON_VALIDA',
        })
      }
      expect(await esito(lista(az, { clienteId: 'non-un-uuid' }))).toMatchObject({
        status: 400,
        codice: 'FILTRO_NON_VALIDO',
      })
    })

    it('storno non rifatturabile con scostamento aperto: lo scostamento esce dalla lista (gestito dal Task 20)', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await correggi(az, d.legameId, d.movimentoId)
      expect((await lista(az)).totale).toBe(1)
      await b.stornaCorrente(az, d.id, { rifatturabile: false })
      expect((await lista(az)).totale).toBe(0)
      expect(await legame(d.legameId)).toMatchObject({
        stato: 'FATTURATO',
        scostamento_nota: `storno documento ${(await b.documento(d.id)).numero_testo}`,
      })
    })
  })

  // -------------------------------------------------------------------------------------------
  // Presa d'atto
  // -------------------------------------------------------------------------------------------

  describe('presa d’atto', () => {
    async function conScostamento() {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      await correggi(az, d.legameId, d.movimentoId)
      return { az, d }
    }

    it('con nota: sparisce dalla lista, colonne gestito_* scritte, versione avanzata, audit', async () => {
      const { az, d } = await conScostamento()
      const prima = await legame(d.legameId)
      await presaAtto(az, d.legameId, '  verificato col cliente  ', prima.versione)

      const dopo = await legame(d.legameId)
      expect(dopo).toMatchObject({
        stato: 'FATTURATO',
        documento_id: d.id,
        scostamento_dopo_fattura: true,
        scostamento_gestito_da: az.utenteId,
        scostamento_nota: 'verificato col cliente',
        versione: prima.versione + 1,
      })
      expect(dopo.scostamento_gestito_il).toBeInstanceOf(Date)
      expect((await lista(az)).totale).toBe(0)

      const audit = await b.audit(az.tenantId, 'SCOSTAMENTO_FATTURA_PRESO_IN_CARICO')
      expect(audit).toHaveLength(1)
      expect(audit[0].metadata).toEqual({ legameId: d.legameId, documentoId: d.id })
    })

    it('nota vuota, di soli spazi o di 201 caratteri: 400 e nessuna scrittura', async () => {
      const { az, d } = await conScostamento()
      const { versione } = await legame(d.legameId)
      for (const nota of ['', '   ', 'x'.repeat(201)]) {
        expect(await esito(presaAtto(az, d.legameId, nota, versione))).toMatchObject({
          status: 400,
          codice: 'NOTA_NON_VALIDA',
        })
      }
      expect((await legame(d.legameId)).scostamento_gestito_il).toBeNull()
      // Il limite e' 200, compreso.
      await presaAtto(az, d.legameId, 'y'.repeat(200), versione)
      expect((await legame(d.legameId)).scostamento_nota).toHaveLength(200)
    })

    it('versione non valida: 400', async () => {
      const { az, d } = await conScostamento()
      for (const v of [0, -1, 1.5, Number.NaN]) {
        expect(await esito(presaAtto(az, d.legameId, 'ok', v))).toMatchObject({
          status: 400,
          codice: 'VERSIONE_NON_VALIDA',
        })
      }
    })

    it('legame senza scostamento: 409 SCOSTAMENTO_NON_APERTO', async () => {
      const az = await b.t19.azienda()
      const [d] = await b.definitivi(az, 1)
      const { versione } = await legame(d.legameId)
      expect(await esito(presaAtto(az, d.legameId, 'ok', versione))).toMatchObject({
        status: 409,
        codice: 'SCOSTAMENTO_NON_APERTO',
      })
      // Nemmeno un legame CONFERMATO.
      const c = await b.t19.contratto(az)
      const l = await legame(c.legameId as string)
      expect(await esito(presaAtto(az, l.id, 'ok', l.versione))).toMatchObject({
        status: 409,
        codice: 'SCOSTAMENTO_NON_APERTO',
      })
    })

    it('già gestito: 409 SCOSTAMENTO_NON_APERTO, la nota non cambia', async () => {
      const { az, d } = await conScostamento()
      const { versione } = await legame(d.legameId)
      await presaAtto(az, d.legameId, 'prima', versione)
      const v2 = (await legame(d.legameId)).versione
      expect(await esito(presaAtto(az, d.legameId, 'seconda', v2))).toMatchObject({
        status: 409,
        codice: 'SCOSTAMENTO_NON_APERTO',
      })
      expect((await legame(d.legameId)).scostamento_nota).toBe('prima')
    })

    it('versione superata: 409 VERSIONE_SUPERATA', async () => {
      const { az, d } = await conScostamento()
      const { versione } = await legame(d.legameId)
      expect(await esito(presaAtto(az, d.legameId, 'ok', versione - 1))).toMatchObject({
        status: 409,
        codice: 'VERSIONE_SUPERATA',
      })
      expect((await legame(d.legameId)).scostamento_gestito_il).toBeNull()
    })

    it('legame inesistente, id non valido o di un’altra azienda: 404', async () => {
      const { az, d } = await conScostamento()
      const altra = await b.t19.azienda()
      const { versione } = await legame(d.legameId)
      for (const [a, id] of [
        [az, '00000000-0000-4000-8000-000000000000'],
        [az, 'non-un-uuid'],
        [altra, d.legameId],
      ] as const) {
        expect(await esito(presaAtto(a, id, 'ok', versione))).toMatchObject({
          status: 404,
          codice: 'LEGAME_MOVIMENTO_NON_TROVATO',
        })
      }
      expect((await legame(d.legameId)).scostamento_gestito_il).toBeNull()
    })

    it('due prese d’atto concorrenti: una sola riesce, l’altra SCOSTAMENTO_NON_APERTO o VERSIONE_SUPERATA', async () => {
      const { az, d } = await conScostamento()
      const { versione } = await legame(d.legameId)
      const esiti = await Promise.all([
        esito(presaAtto(az, d.legameId, 'a', versione)),
        esito(presaAtto(az, d.legameId, 'b', versione)),
      ])
      expect(esiti.filter(e => e === 'ok')).toHaveLength(1)
      const ko = esiti.find(e => e !== 'ok')
      expect(['SCOSTAMENTO_NON_APERTO', 'VERSIONE_SUPERATA']).toContain(
        (ko as { codice: string }).codice
      )
    })

    it('I3: presa d’atto, nuova rettifica: lo scostamento ricompare e la seconda presa d’atto riesce', async () => {
      const { az, d } = await conScostamento()
      const prima = await legame(d.legameId)
      await presaAtto(az, d.legameId, 'prima', prima.versione)
      expect((await lista(az)).totale).toBe(0)

      // Seconda rettifica della stessa catena: la testa attuale e' la prima rettifica.
      const testa = (await legame(d.legameId)).movimento_vigente_id
      await new Promise(r => setTimeout(r, 20))
      await correggi(az, d.legameId, d.movimentoId, { quantita: '70', precedenteId: testa })
      const r = await lista(az)
      expect(r.totale).toBe(1)
      expect(r.elementi[0]).toMatchObject({ legameId: d.legameId, quantitaAttuale: '70.000' })

      const l = await legame(d.legameId)
      await presaAtto(az, d.legameId, 'seconda', l.versione)
      expect((await lista(az)).totale).toBe(0)
      expect((await legame(d.legameId)).scostamento_nota).toBe('seconda')
      // E una presa d'atto ripetuta sulla stessa differenza resta rifiutata.
      expect(
        await esito(presaAtto(az, d.legameId, 'terza', (await legame(d.legameId)).versione))
      ).toMatchObject({ status: 409, codice: 'SCOSTAMENTO_NON_APERTO' })
    })

    it('I3: dopo uno storno non rifatturabile una rettifica successiva riapre lo scostamento', async () => {
      const { az, d } = await conScostamento()
      await b.stornaCorrente(az, d.id, { rifatturabile: false })
      expect((await lista(az)).totale).toBe(0)
      const testa = (await legame(d.legameId)).movimento_vigente_id
      await new Promise(r => setTimeout(r, 20))
      await correggi(az, d.legameId, d.movimentoId, { quantita: '70', precedenteId: testa })
      expect((await lista(az)).totale).toBe(1)
      const l = await legame(d.legameId)
      await presaAtto(az, d.legameId, 'dopo lo storno', l.versione)
      expect((await lista(az)).totale).toBe(0)
    })

    it('m4: legame tenuto da un’altra transazione: 409 OPERAZIONE_CONCORRENTE allo scadere del lock_timeout', async () => {
      const { az, d } = await conScostamento()
      const { versione } = await legame(d.legameId)
      let rilascia!: () => void
      const aperto = new Promise<void>(r => (rilascia = r))
      let pronto!: () => void
      const bloccato = new Promise<void>(r => (pronto = r))
      const tenuta = owner.$transaction(
        async tx => {
          await tx.$queryRawUnsafe(
            `SELECT id FROM legami_movimento WHERE id = $1::uuid FOR UPDATE`,
            d.legameId
          )
          pronto()
          await aperto
        },
        { timeout: 60_000 }
      )
      try {
        await bloccato
        expect(await esito(presaAtto(az, d.legameId, 'ok', versione))).toMatchObject({
          status: 409,
          codice: 'OPERAZIONE_CONCORRENTE',
        })
      } finally {
        rilascia()
        await tenuta
      }
      expect((await legame(d.legameId)).scostamento_gestito_il).toBeNull()
    }, 60_000)

    it('dopo l’annullo del documento lo scostamento non c’è più e la presa d’atto è rifiutata', async () => {
      const { az, d } = await conScostamento()
      await b.annullaCorrente(az, d.id)
      const l = await legame(d.legameId)
      expect(l.scostamento_dopo_fattura).toBe(false)
      expect(await esito(presaAtto(az, d.legameId, 'ok', l.versione))).toMatchObject({
        status: 409,
        codice: 'SCOSTAMENTO_NON_APERTO',
      })
    })
  })
})
