/**
 * Export CSV dei documenti (Task 24) contro un Postgres reale, COME `wasteflow_app` dentro il
 * `TenantContext`. Il proprietario prepara le fixture. Pulizia solo per id esatti. Il volume
 * (5.000 documenti, il tetto) misura i tempi e il numero di query: non dipendono dal numero di
 * documenti oltre un blocco di 100.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
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
process.env.DATABASE_URL += `&application_name=fatt-t24-${process.pid}&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaDocumentoDiTest,
  creaScenarioFatturazione,
} from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { assicuraCatalogoCer } from '../../test-support/listino-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { ExportService, TETTO_DOCUMENTI_CSV } from './export.service'

describe('ExportService CSV — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ExportService
  const tenantCreati: string[] = []
  const cerCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    servizio = new ExportService(app, new DocumentiFatturaService(app))
    cerCreati.push(...(await assicuraCatalogoCer(owner, ['20 03 01'])))
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda(opz: { legami?: number; registri?: number } = {}) {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Export SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const scenario = await creaScenarioFatturazione(owner, t.id, {
      legami: opz.legami ?? 4,
      registri: opz.registri ?? 2,
    })
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-exp-${randomUUID()}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `exp-${randomUUID()}@example.com`,
        role: 'ADMIN',
      },
    })
    const registri = (
      await owner.registroIva.findMany({ where: { tenantId: t.id }, orderBy: { codice: 'asc' } })
    ).map(r => r.id)
    return { tenantId: t.id, utenteId: utente.id, scenario, registri }
  }

  const esporta = (
    a: { tenantId: string; utenteId: string },
    selezione: Parameters<ExportService['esporta']>[2]['selezione'] = {},
    formato = 'CSV'
  ) => nel(a.tenantId, () => servizio.esporta(a.tenantId, a.utenteId, { formato, selezione }))

  async function leggiZip(contenuto: Buffer) {
    const zip = await JSZip.loadAsync(contenuto)
    return {
      nomi: Object.keys(zip.files).sort(),
      testate: await zip.file('testate.csv')!.async('string'),
      righe: await zip.file('righe.csv')!.async('string'),
    }
  }
  const linee = (csv: string) => csv.split('\r\n').filter(l => l !== '')

  it('CSV: zip con testate.csv e righe.csv, BOM, separatore ;, ANNULLATO incluso', async () => {
    const a = await azienda()
    const d1 = await creaDocumentoDiTest(owner, a.tenantId, {
      stato: 'DEFINITIVO',
      registroIvaId: a.registri[0],
      anno: 2026,
      legamiIds: [a.scenario.legamiIds[0], a.scenario.legamiIds[1]],
    })
    await creaDocumentoDiTest(owner, a.tenantId, {
      stato: 'ANNULLATO',
      registroIvaId: a.registri[0],
      anno: 2026,
      legamiIds: [a.scenario.legamiIds[2]],
    })
    const r = await esporta(a)
    expect(r.contentType).toBe('application/zip')
    expect(r.nomeFile).toMatch(/^fatture-\d{8}\.zip$/)
    expect(r.saltati).toBe(0)
    const z = await leggiZip(r.contenuto)
    expect(z.nomi).toEqual(['righe.csv', 'testate.csv'])
    expect(z.testate.startsWith('﻿"Numero";')).toBe(true)
    const t = linee(z.testate)
    expect(t).toHaveLength(3)
    expect(t.some(l => l.includes('"DEFINITIVO"'))).toBe(true)
    expect(t.some(l => l.includes('"ANNULLATO"'))).toBe(true)
    const rg = linee(z.righe)
    expect(rg).toHaveLength(1 + 2 + 1)
    expect(rg[1].split(';')[0]).toBe('"1"')
    expect(rg[1].split(';')[1]).toBe('"15/03/2026"')
    expect(d1.documentoId).toBeTruthy()
  })

  it('bozze: escluse senza elaborazioneId, con elaborazioneId nome con ANTEPRIMA', async () => {
    const a = await azienda()
    const [elab] = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO elaborazioni_fatturazione
         (tenant_id, periodo_dal, periodo_al, data_documento, raggruppamento, updated_at)
       VALUES ($1::uuid, '2026-01-01', '2026-12-31', '2026-06-01', 'PER_CONTRATTO', now())
       RETURNING id::text AS id`,
      a.tenantId
    )
    await creaDocumentoDiTest(owner, a.tenantId, {
      stato: 'BOZZA',
      registroIvaId: a.registri[0],
      anno: 2026,
      legamiIds: [a.scenario.legamiIds[0]],
      elaborazioneId: elab.id,
    })
    await creaDocumentoDiTest(owner, a.tenantId, {
      stato: 'DEFINITIVO',
      registroIvaId: a.registri[0],
      anno: 2026,
      legamiIds: [a.scenario.legamiIds[1]],
    })
    const senza = await esporta(a)
    expect(senza.nomeFile).not.toContain('ANTEPRIMA')
    expect(linee((await leggiZip(senza.contenuto)).testate)).toHaveLength(2)
    const con = await esporta(a, { elaborazioneId: elab.id })
    expect(con.nomeFile).toContain('ANTEPRIMA')
    const t = linee((await leggiZip(con.contenuto)).testate)
    expect(t).toHaveLength(2)
    expect(t[1]).toContain('"BOZZA"')
    // le bozze di un'altra elaborazione (id inesistente) non entrano mai
    const altra = await esporta(a, { elaborazioneId: randomUUID() })
    expect(linee((await leggiZip(altra.contenuto)).testate)).toHaveLength(1)
  })

  it('il CSV non cambia i documenti (emesso_il, versione, updated_at)', async () => {
    const a = await azienda()
    const d = await creaDocumentoDiTest(owner, a.tenantId, {
      stato: 'DEFINITIVO',
      registroIvaId: a.registri[0],
      anno: 2026,
      legamiIds: [a.scenario.legamiIds[0]],
    })
    const foto = () =>
      owner.$queryRawUnsafe<unknown[]>(
        `SELECT emesso_il, versione, updated_at, stato::text FROM documenti_fattura WHERE id = $1::uuid`,
        d.documentoId
      )
    const prima = await foto()
    const r = await esporta(a)
    expect(linee((await leggiZip(r.contenuto)).testate)).toHaveLength(2)
    expect(await foto()).toEqual(prima)
  })

  it('selezione per registro, anno, intervallo di numeri e di date, cliente, id', async () => {
    const a = await azienda()
    const crea = (registro: number, anno: number, data: string, i: number) =>
      creaDocumentoDiTest(owner, a.tenantId, {
        stato: 'DEFINITIVO',
        registroIvaId: a.registri[registro],
        anno,
        dataDocumento: data,
        legamiIds: [a.scenario.legamiIds[i]],
      })
    const x1 = await crea(0, 2026, '2026-02-01', 0) // 01/2026 n.1
    const x2 = await crea(0, 2026, '2026-03-01', 1) // 01/2026 n.2
    const x3 = await crea(1, 2026, '2026-04-01', 2) // 02/2026 n.1
    const x4 = await crea(0, 2025, '2025-12-01', 3) // 01/2025 n.1
    const quanti = async (s: Parameters<typeof esporta>[1]) =>
      linee((await leggiZip((await esporta(a, s)).contenuto)).testate).length - 1
    expect(await quanti({})).toBe(4)
    expect(await quanti({ registroIvaId: a.registri[0] })).toBe(3)
    expect(await quanti({ anno: 2026 })).toBe(3)
    expect(await quanti({ registroIvaId: a.registri[0], anno: 2026, numeroDa: 2 })).toBe(1)
    expect(await quanti({ registroIvaId: a.registri[0], anno: 2026, numeroA: 1 })).toBe(1)
    expect(
      await quanti({ registroIvaId: a.registri[0], anno: 2026, numeroDa: 1, numeroA: 2 })
    ).toBe(2)
    expect(await quanti({ dataDa: '2026-03-01' })).toBe(2)
    expect(await quanti({ dataA: '2026-02-01' })).toBe(2)
    expect(await quanti({ dataDa: '2026-02-01', dataA: '2026-03-31' })).toBe(2)
    // un solo cliente nello scenario: tutti e quattro; un cliente qualunque: nessuno
    expect(await quanti({ clienteId: a.scenario.clienteId })).toBe(4)
    expect(await quanti({ clienteId: randomUUID() })).toBe(0)
    expect(await quanti({ documentoIds: [x2.documentoId, x3.documentoId] })).toBe(2)
    expect(await quanti({ documentoIds: [randomUUID()] })).toBe(0)
    expect([x1, x4].length).toBe(2)
  })

  it('selezione non valida o formato sconosciuto: 400', async () => {
    const a = await azienda()
    const codice = async (p: Promise<unknown>) =>
      p.then(
        () => 'ok',
        (e: { getResponse?: () => { error?: string }; getStatus?: () => number }) =>
          `${e.getStatus?.()}:${e.getResponse?.().error}`
      )
    expect(await codice(esporta(a, {}, 'PDF'))).toBe('400:ADATTATORE_SCONOSCIUTO')
    // XML_ZIP lo collega il Task 23
    expect(await codice(esporta(a, {}, 'XML_ZIP'))).toBe('400:ADATTATORE_SCONOSCIUTO')
    expect(await codice(esporta(a, { registroIvaId: 'x' }))).toBe('400:FILTRO_NON_VALIDO')
    expect(await codice(esporta(a, { anno: 1999 }))).toBe('400:FILTRO_NON_VALIDO')
    expect(await codice(esporta(a, { numeroDa: 5, numeroA: 2 }))).toBe('400:FILTRO_NON_VALIDO')
    expect(await codice(esporta(a, { dataDa: '05/11/2026' }))).toBe('400:DATA_NON_VALIDA')
    expect(await codice(esporta(a, { dataDa: '2026-05-01', dataA: '2026-04-01' }))).toBe(
      '400:DATA_NON_VALIDA'
    )
    expect(await codice(esporta(a, { documentoIds: ['no'] }))).toBe('400:FILTRO_NON_VALIDO')
  })

  it('audit dell export: formato e conteggio, senza dati personali', async () => {
    const a = await azienda()
    await creaDocumentoDiTest(owner, a.tenantId, {
      stato: 'DEFINITIVO',
      registroIvaId: a.registri[0],
      anno: 2026,
      legamiIds: [a.scenario.legamiIds[0]],
    })
    await esporta(a)
    const log = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'DOCUMENTI_FATTURA_ESPORTATI' },
    })
    expect(log).toHaveLength(1)
    expect(log[0].userId).toBe(a.utenteId)
    expect(log[0].metadata).toMatchObject({ formato: 'CSV', documenti: 1 })
  })

  it('isolamento fra aziende: un altro tenant non vede i documenti', async () => {
    const a = await azienda()
    const b = await azienda()
    const d = await creaDocumentoDiTest(owner, a.tenantId, {
      stato: 'DEFINITIVO',
      registroIvaId: a.registri[0],
      anno: 2026,
      legamiIds: [a.scenario.legamiIds[0]],
    })
    const r = await esporta(b, { documentoIds: [d.documentoId] })
    expect(linee((await leggiZip(r.contenuto)).testate)).toHaveLength(1)
  })

  it('oltre il tetto: 400 TROPPI_DOCUMENTI senza leggere nulla', async () => {
    const a = await azienda({ legami: 1, registri: 1 })
    const ids = Array.from({ length: TETTO_DOCUMENTI_CSV + 1 }, () => randomUUID())
    await expect(esporta(a, { documentoIds: ids })).rejects.toMatchObject({
      response: { error: 'TROPPI_DOCUMENTI' },
    })
  })

  describe('volume vicino al tetto', () => {
    /** Crea `n` definitivi con 3 righe ciascuno, in SQL a insiemi (proprietario). */
    async function creaVolume(a: Awaited<ReturnType<typeof azienda>>, n: number) {
      const T = a.tenantId
      await owner.$executeRawUnsafe(
        `INSERT INTO documenti_fattura
           (tenant_id, stato, tipo_documento, registro_iva_id, anno, data_documento, cliente_id,
            cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al, formato_trasmissione,
            esigibilita_iva, totale_imponibile, totale_iva, totale_documento, netto_a_pagare,
            fotografia, updated_at)
         SELECT $1::uuid, 'BOZZA', 'TD01', $2::uuid, 2026, DATE '2026-01-01' + (g % 300), $3::uuid,
                $3::uuid, $4::uuid, DATE '2026-01-01', DATE '2026-12-31', 'FPR12', 'IMMEDIATA',
                300, 66, 366, 366,
                jsonb_build_object('cessionario', jsonb_build_object('partitaIva', '01234567890')),
                now()
         FROM generate_series(1, $5::int) g`,
        T,
        a.registri[0],
        a.scenario.clienteId,
        a.scenario.contrattoId,
        n
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO righe_documento_fattura
           (tenant_id, documento_id, numero_linea, tipo_riga, descrizione, quantita, unita_misura,
            prezzo_unitario, importo_lordo, importo_sconto, prezzo_totale, codice_iva_id,
            aliquota_iva, updated_at)
         SELECT d.tenant_id, d.id, l, 'FISSO', 'Canone ' || l, 1, 'N', 100, 100, 0, 100, $2::uuid,
                22, now()
         FROM documenti_fattura d CROSS JOIN generate_series(1, 3) l
         WHERE d.tenant_id = $1::uuid`,
        T,
        a.scenario.codiceIvaId
      )
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura d
            SET stato = 'DEFINITIVO', numero = x.rn, numero_testo = x.rn::text, definito_il = now(),
                updated_at = now()
           FROM (SELECT id, row_number() OVER (ORDER BY id)::int AS rn
                   FROM documenti_fattura WHERE tenant_id = $1::uuid) x
          WHERE d.id = x.id AND d.tenant_id = $1::uuid`,
        T
      )
    }

    it(`${TETTO_DOCUMENTI_CSV} documenti: esporta entro 20 s, righe e testate al completo`, async () => {
      const a = await azienda({ legami: 1, registri: 1 })
      await creaVolume(a, TETTO_DOCUMENTI_CSV)
      const t0 = Date.now()
      const r = await esporta(a, { anno: 2026 })
      const ms = Date.now() - t0
      // eslint-disable-next-line no-console
      console.log(`[T24] export CSV di ${TETTO_DOCUMENTI_CSV} documenti: ${ms} ms`)
      const z = await leggiZip(r.contenuto)
      expect(linee(z.testate)).toHaveLength(TETTO_DOCUMENTI_CSV + 1)
      expect(linee(z.righe)).toHaveLength(TETTO_DOCUMENTI_CSV * 3 + 1)
      expect(ms).toBeLessThan(20_000)

      // una lista di id lunga come il tetto: stessa forma, entro lo stesso tempo
      const ids = (
        await owner.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id::text FROM documenti_fattura WHERE tenant_id = $1::uuid`,
          a.tenantId
        )
      ).map(x => x.id)
      const t1 = Date.now()
      const r2 = await esporta(a, { documentoIds: ids })
      const ms2 = Date.now() - t1
      // eslint-disable-next-line no-console
      console.log(`[T24] export CSV per ${ids.length} id: ${ms2} ms`)
      expect(linee((await leggiZip(r2.contenuto)).testate)).toHaveLength(TETTO_DOCUMENTI_CSV + 1)
      expect(ms2).toBeLessThan(20_000)

      // oltre il tetto per filtro: 400 dopo il conteggio
      await owner.$executeRawUnsafe(
        `INSERT INTO documenti_fattura
           (tenant_id, stato, tipo_documento, registro_iva_id, anno, data_documento, cliente_id,
            cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al, formato_trasmissione,
            esigibilita_iva, totale_imponibile, totale_iva, totale_documento, netto_a_pagare,
            fotografia, updated_at)
         VALUES ($1::uuid, 'BOZZA', 'TD01', $2::uuid, 2026, '2026-02-02', $3::uuid, $3::uuid,
            $4::uuid, '2026-01-01', '2026-12-31', 'FPR12', 'IMMEDIATA', 1, 0, 1, 1, '{}'::jsonb, now())`,
        a.tenantId,
        a.registri[0],
        a.scenario.clienteId,
        a.scenario.contrattoId
      )
      const elab = await owner.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO elaborazioni_fatturazione
           (tenant_id, periodo_dal, periodo_al, data_documento, raggruppamento, updated_at)
         VALUES ($1::uuid, '2026-01-01', '2026-12-31', '2026-06-01', 'PER_CONTRATTO', now())
         RETURNING id::text AS id`,
        a.tenantId
      )
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura SET elaborazione_id = $2::uuid WHERE tenant_id = $1::uuid AND stato = 'BOZZA'`,
        a.tenantId,
        elab[0].id
      )
      // 5000 definitivi + 1 bozza dell'elaborazione = 5001 con l'elaborazione, ma il filtro
      // per elaborazione prende solo la bozza: il tetto si prova con tutti gli id
      const tutti = [...ids, randomUUID()]
      await expect(esporta(a, { documentoIds: tutti })).rejects.toMatchObject({
        response: { error: 'TROPPI_DOCUMENTI' },
      })
    }, 120_000)
  })
})
