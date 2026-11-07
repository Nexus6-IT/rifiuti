/**
 * Export tramite adattatore contabile (4.4c, Task 29) contro un Postgres reale, COME
 * `wasteflow_app`. Adattatore finto in modalita' FILE. Pulizia solo per id esatti.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=fatt-t29e-${process.pid}&connection_limit=10`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaAdattatoreFinto } from '../../test-support/adattatore-finto'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaDocumentoDiTest,
  creaScenarioFatturazione,
} from '../../test-support/fatturazione-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { assicuraCatalogoCer } from '../../test-support/listino-di-test'
import type { AdattatoreExportContabile } from './adattatori/adattatore-export-contabile'
import { MappatureService } from './adattatori/mappature.service'
import { RegistroAdattatori } from './adattatori/registro-adattatori'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { ExportService } from './export.service'
import { XmlDocumentoService } from './xml-documento.service'

describe('ExportService con adattatore — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ExportService
  let mappature: MappatureService
  const finto = creaAdattatoreFinto()
  const api: AdattatoreExportContabile = {
    ...creaAdattatoreFinto({ codice: 'SOLOAPI', modalita: 'API' }),
    genera: undefined,
  }
  const tenantCreati: string[] = []
  const cerCreati: string[] = []
  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    const registro = new RegistroAdattatori([finto, api])
    mappature = new MappatureService(app, registro)
    servizio = new ExportService(
      app,
      new DocumentiFatturaService(app),
      new XmlDocumentoService(app, new DocumentiFatturaService(app)),
      registro,
      mappature
    )
    cerCreati.push(...(await assicuraCatalogoCer(owner, ['20 03 01'])))
  })
  beforeEach(() => {
    finto.genera.mockClear()
  })
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Export adattatore SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const scenario = await creaScenarioFatturazione(owner, t.id, { legami: 4, registri: 1 })
    const utente = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-t29-${randomUUID()}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `t29-${randomUUID()}@example.com`,
        role: 'ADMIN',
      },
    })
    const [registro] = await owner.registroIva.findMany({ where: { tenantId: t.id } })
    const definitivo = await creaDocumentoDiTest(owner, t.id, {
      stato: 'DEFINITIVO',
      registroIvaId: registro.id,
      anno: 2026,
      legamiIds: [scenario.legamiIds[0]],
    })
    const annullato = await creaDocumentoDiTest(owner, t.id, {
      stato: 'ANNULLATO',
      registroIvaId: registro.id,
      anno: 2026,
      legamiIds: [scenario.legamiIds[1]],
    })
    // L'annullato ha un'aliquota propria (10): il suo codice IVA non deve comparire fra le mancanti.
    await owner.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`)
      await tx.$executeRawUnsafe(
        `UPDATE righe_documento_fattura SET aliquota_iva = 10 WHERE documento_id = $1::uuid`,
        annullato.documentoId
      )
    })
    return {
      tenantId: t.id,
      utenteId: utente.id,
      registroCodice: registro.codice,
      definitivoId: definitivo.documentoId,
      annullatoId: annullato.documentoId,
    }
  }
  type Az = Awaited<ReturnType<typeof azienda>>

  const esporta = (
    a: Az,
    formato: string,
    confermaEmissione?: boolean,
    selezione: Parameters<ExportService['esporta']>[2]['selezione'] = {}
  ) =>
    nel(a.tenantId, () =>
      servizio.esporta(a.tenantId, a.utenteId, {
        formato,
        selezione,
        ...(confermaEmissione !== undefined ? { confermaEmissione } : {}),
      })
    )
  const stato = (id: string) =>
    owner
      .$queryRawUnsafe<
        { emesso_il: Date | null; versione: number }[]
      >(`SELECT emesso_il, versione FROM documenti_fattura WHERE id = $1::uuid`, id)
      .then(r => r[0])
  it('mappature mancanti: 409 MAPPATURE_MANCANTI con l`elenco in details, nessun file, nessun emesso_il', async () => {
    const a = await azienda()
    const prima = await stato(a.definitivoId)
    let errore: any
    try {
      await esporta(a, 'FINTO', true)
    } catch (e) {
      errore = e
    }
    expect(errore?.getStatus?.()).toBe(409)
    const corpo = errore.getResponse()
    expect(corpo.error).toBe('MAPPATURE_MANCANTI')
    // Elenco esatto: la chiave IVA dell'annullato (10) non compare, perche' l'annullato e' saltato.
    const iva = await owner.$queryRawUnsafe<{ a: string }[]>(
      `SELECT DISTINCT aliquota_iva::text AS a FROM righe_documento_fattura WHERE documento_id = $1::uuid`,
      a.definitivoId
    )
    expect(corpo.details.mancanti).toEqual([
      ...iva.map(r => ({
        tipo: 'CODICE_IVA',
        chiaveWasteflow: r.a,
        etichetta: `IVA ${r.a}%`,
      })),
      {
        tipo: 'REGISTRO',
        chiaveWasteflow: a.registroCodice,
        etichetta: `Registro ${a.registroCodice}`,
      },
    ])
    expect(finto.genera).not.toHaveBeenCalled()
    expect(await stato(a.definitivoId)).toEqual(prima)
    expect((await stato(a.definitivoId)).emesso_il).toBeNull()
    const audit = await owner.activityLog.count({ where: { tenantId: a.tenantId } })
    expect(audit).toBe(0)
  })

  async function mappaCompleta(a: Az) {
    const voci = new Map<string, { tipo: any; chiaveWasteflow: string }>()
    // Le chiavi richieste dai documenti della selezione, lette dal servizio stesso.
    let errore: any
    try {
      await esporta(a, 'FINTO', true)
    } catch (e) {
      errore = e
    }
    for (const m of errore.getResponse().details.mancanti)
      voci.set(`${m.tipo}:${m.chiaveWasteflow}`, m)
    await nel(a.tenantId, () =>
      mappature.imposta(
        a.tenantId,
        a.utenteId,
        'FINTO',
        [...voci.values()].map(v => ({
          tipo: v.tipo,
          chiaveWasteflow: v.chiaveWasteflow,
          valore: '07',
          versione: null,
        }))
      )
    )
  }

  it('mancantiPerAdattatore: stesse chiavi del 409 dell`export, senza emettere; dopo la mappatura è vuoto', async () => {
    const a = await azienda()
    const prima = await stato(a.definitivoId)
    const mancanti = await nel(a.tenantId, () =>
      servizio.mancantiPerAdattatore(a.tenantId, 'FINTO', {})
    )
    let errore: any
    try {
      await esporta(a, 'FINTO', true)
    } catch (e) {
      errore = e
    }
    expect(mancanti).toEqual(errore.getResponse().details.mancanti)
    expect(mancanti.length).toBeGreaterThan(0)
    expect(await stato(a.definitivoId)).toEqual(prima)
    // Un'elaborazione di un altro identificativo e un filtro non valido restano errori.
    await expect(
      nel(a.tenantId, () => servizio.mancantiPerAdattatore(a.tenantId, 'NO', {}))
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'ADATTATORE_SCONOSCIUTO' }),
    })
    await expect(
      nel(a.tenantId, () => servizio.mancantiPerAdattatore(a.tenantId, 'FINTO', { anno: 1 }))
    ).rejects.toMatchObject({ response: expect.objectContaining({ error: 'FILTRO_NON_VALIDO' }) })
    await mappaCompleta(a)
    expect(
      await nel(a.tenantId, () => servizio.mancantiPerAdattatore(a.tenantId, 'FINTO', {}))
    ).toEqual([])
    expect(
      await owner.activityLog.count({
        where: { tenantId: a.tenantId, action: 'DOCUMENTI_FATTURA_ESPORTATI' },
      })
    ).toBe(0)
  })

  it('riuscito (FILE): il file dell`adattatore, il definitivo emesso, l`annullato no, audit', async () => {
    const a = await azienda()
    await mappaCompleta(a)
    const r = await esporta(a, 'FINTO', true)
    expect(r.nomeFile).toBe('prova.txt')
    expect(r.contentType).toBe('text/plain')
    expect(r.contenuto.toString('utf8')).toContain('|07')
    expect(r.saltati).toBe(1)
    const def = await stato(a.definitivoId)
    expect(def.emesso_il).not.toBeNull()
    expect(def.versione).toBe(2)
    expect((await stato(a.annullatoId)).emesso_il).toBeNull()
    const emessi = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'DOCUMENTO_FATTURA_EMESSO' },
    })
    expect(emessi).toHaveLength(1)
    expect(emessi[0].metadata).toMatchObject({ documentoId: a.definitivoId, adattatore: 'FINTO' })
    const esportati = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'DOCUMENTI_FATTURA_ESPORTATI' },
    })
    expect(esportati).toHaveLength(1)
    expect(esportati[0].metadata).toEqual({ formato: 'FINTO', documenti: 1, saltati: 1 })
  })

  it('senza confermaEmissione: 400 CONFERMA_EMISSIONE_RICHIESTA e nulla emesso; con documenti gia` emessi non serve', async () => {
    const a = await azienda()
    await mappaCompleta(a)
    await expect(esporta(a, 'FINTO')).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'CONFERMA_EMISSIONE_RICHIESTA' }),
    })
    expect((await stato(a.definitivoId)).emesso_il).toBeNull()
    await esporta(a, 'FINTO', true)
    const emessoIl = (await stato(a.definitivoId)).emesso_il
    const seconda = await esporta(a, 'FINTO')
    expect(seconda.nomeFile).toBe('prova.txt')
    // Gia` emesso: resta la prima data, la versione non sale, nessun secondo audit di emissione.
    expect(await stato(a.definitivoId)).toEqual({ emesso_il: emessoIl, versione: 2 })
    expect(
      await owner.activityLog.count({
        where: { tenantId: a.tenantId, action: 'DOCUMENTO_FATTURA_EMESSO' },
      })
    ).toBe(1)
  })

  it('l`adattatore che lancia un errore: nulla emesso', async () => {
    const a = await azienda()
    await mappaCompleta(a)
    finto.genera.mockImplementationOnce(() => {
      throw new Error('tracciato non valido')
    })
    await expect(esporta(a, 'FINTO', true)).rejects.toThrow('tracciato non valido')
    expect((await stato(a.definitivoId)).emesso_il).toBeNull()
  })

  it('adattatore a sola API: 400 ADATTATORE_NON_A_FILE; codice sconosciuto: 400 ADATTATORE_SCONOSCIUTO', async () => {
    const a = await azienda()
    await expect(esporta(a, 'SOLOAPI', true)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'ADATTATORE_NON_A_FILE' }),
    })
    await expect(esporta(a, 'NONESISTE', true)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'ADATTATORE_SCONOSCIUTO' }),
    })
  })

  it('piu` file dell`adattatore: uno zip con i nomi originali', async () => {
    const a = await azienda()
    await mappaCompleta(a)
    finto.genera.mockImplementationOnce(() => [
      { nome: 'a.txt', contentType: 'text/plain', contenuto: Buffer.from('A') },
      { nome: 'b.txt', contentType: 'text/plain', contenuto: Buffer.from('B') },
    ])
    const r = await esporta(a, 'FINTO', true)
    expect(r.contentType).toBe('application/zip')
    expect(r.nomeFile).toMatch(/^export-FINTO-\d{8}\.zip$/)
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(r.contenuto)
    expect(Object.keys(zip.files).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('annullo concorrente: il documento annullato mentre l`export aspetta il lock non si emette', async () => {
    const a = await azienda()
    let export_: Promise<Awaited<ReturnType<typeof esporta>>> | undefined
    await owner.$transaction(
      async tx => {
        await tx.$executeRawUnsafe(
          `UPDATE documenti_fattura SET stato = 'ANNULLATO', motivo_annullo = 'prova', versione = versione + 1 WHERE id = $1::uuid`,
          a.definitivoId
        )
        // L'export parte mentre l'annullo non e' ancora committato: seleziona il documento come
        // DEFINITIVO e poi aspetta sul FOR UPDATE.
        export_ = esporta(a, 'FINTO', true)
        const inizio = Date.now()
        for (;;) {
          const [r] = await tx.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM pg_stat_activity
             WHERE application_name = $1 AND wait_event_type = 'Lock'`,
            `fatt-t29e-${process.pid}`
          )
          if (r.n > 0) break
          if (Date.now() - inizio > 4000) throw new Error('l`export non e` in attesa del lock')
          await new Promise(res => setTimeout(res, 50))
        }
      },
      { timeout: 10_000 }
    )
    const r = await export_!
    expect(r.saltati).toBe(2)
    expect((await stato(a.definitivoId)).emesso_il).toBeNull()
    expect(
      await owner.activityLog.count({
        where: { tenantId: a.tenantId, action: 'DOCUMENTO_FATTURA_EMESSO' },
      })
    ).toBe(0)
    expect(finto.genera).toHaveBeenCalledTimes(1)
    expect(finto.genera.mock.calls[0][0]).toHaveLength(0)
  })
})
