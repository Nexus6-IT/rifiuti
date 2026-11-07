/**
 * XML del documento, progressivo del file ed emissione (fase 4.4b2, Task 23) contro un Postgres
 * reale, COME `wasteflow_app` (RLS FORCE). I documenti sono DEFINITIVI veri (anteprima +
 * definitiva). Le barriere della concorrenza sono vere: le richieste si fermano DENTRO la loro
 * transazione e il test osserva `pg_stat_activity` (`wait_event_type = 'Lock'`), mai uno sleep.
 * Pulizia solo per id esatti.
 */
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t23-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

import { validaFatturaPA, validaFatturePA } from '../../infrastructure/fatturapa/valida-xsd'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import type { AziendaT18 } from '../../test-support/fatturazione-t18-di-test'
import { esitoHttp as esito } from '../../test-support/fatturazione-t19-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { MappatureService } from './adattatori/mappature.service'
import { RegistroAdattatori } from './adattatori/registro-adattatori'
import { ExportService } from './export.service'
import { XmlDocumentoService } from './xml-documento.service'

const SI = { confermaEmissione: true }
const NO = { confermaEmissione: false }

describe('XmlDocumentoService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  let xml: XmlDocumentoService
  let esportatore: ExportService
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    b.reset()
    b.servizio.orologio = () => new Date('2026-05-01T10:00:00Z')
    const documenti = new DocumentiFatturaService(app)
    xml = new XmlDocumentoService(app, documenti)
    esportatore = new ExportService(
      app,
      documenti,
      xml,
      new RegistroAdattatori([]),
      new MappatureService(app, new RegistroAdattatori([]))
    )
  })
  afterEach(() => jest.restoreAllMocks())
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  const xmlDi = (az: AziendaT18, id: string, c = SI) => xml.xml(az.tenantId, az.utenteId, id, c)
  const zipDi = (az: AziendaT18, ids: string[], c = SI) => xml.zip(az.tenantId, az.utenteId, ids, c)

  async function riga(id: string) {
    const [r] = await owner.$queryRawUnsafe<
      {
        stato: string
        emesso_il: Date | null
        xml: Buffer | null
        xml_sha256: string | null
        xml_generato_il: Date | null
        progressivo_file: string | null
        versione: number
      }[]
    >(
      `SELECT stato::text, emesso_il, xml, xml_sha256, xml_generato_il, progressivo_file,
              versione::int FROM documenti_fattura WHERE id = $1::uuid`,
      id
    )
    return r
  }

  async function contatore(tenantId: string): Promise<number> {
    const r = await owner.$queryRawUnsafe<{ ultimo: number }[]>(
      `SELECT ultimo::int FROM contatori_file_fatturapa WHERE tenant_id = $1::uuid`,
      tenantId
    )
    return r[0]?.ultimo ?? 0
  }

  async function progressiviSalvati(tenantId: string): Promise<string[]> {
    const r = await owner.$queryRawUnsafe<{ p: string }[]>(
      `SELECT progressivo_file AS p FROM documenti_fattura
       WHERE tenant_id = $1::uuid AND progressivo_file IS NOT NULL ORDER BY progressivo_file`,
      tenantId
    )
    return r.map(x => x.p)
  }

  async function partitaIva(id: string): Promise<string> {
    return ((await b.documento(id)).fotografia as { cedente: { partitaIva: string } }).cedente
      .partitaIva
  }

  /** Rompe la fotografia di un DEFINITIVO col proprietario, solo in questa transazione (trigger spento). */
  async function corrompi(id: string): Promise<void> {
    await owner.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`)
      await tx.$executeRawUnsafe(
        `UPDATE documenti_fattura
         SET fotografia = jsonb_set(fotografia, '{cessionario,sede,cap}', '"XXXXX"')
         WHERE id = $1::uuid`,
        id
      )
    })
  }

  // -------------------------------------------------------------------------------------------
  // Un documento
  // -------------------------------------------------------------------------------------------

  it('prima richiesta con conferma: XML valido, emesso_il scritto, progressivo 00001, un audit di emissione', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    const f = await xmlDi(az, d.id)
    expect(f.nomeFile).toBe(`IT${await partitaIva(d.id)}_00001.xml`)
    expect((await validaFatturaPA(f.contenuto.toString('utf8'))).valido).toBe(true)
    const r = await riga(d.id)
    expect(r.emesso_il).not.toBeNull()
    expect(r.progressivo_file).toBe('00001')
    expect(r.xml_sha256).toBe(f.sha256)
    expect(Buffer.compare(Buffer.from(r.xml as Buffer), f.contenuto)).toBe(0)
    expect(r.xml_generato_il).not.toBeNull()
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(1)
    expect(await contatore(az.tenantId)).toBe(1)
  }, 90_000)

  it('senza conferma su un non emesso: 400 CONFERMA_EMISSIONE_RICHIESTA, nulla scritto, contatore fermo', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    expect(await esito(xmlDi(az, d.id, NO))).toEqual({
      status: 400,
      codice: 'CONFERMA_EMISSIONE_RICHIESTA',
    })
    const r = await riga(d.id)
    expect([r.emesso_il, r.xml, r.progressivo_file]).toEqual([null, null, null])
    expect(await contatore(az.tenantId)).toBe(0)
  }, 90_000)

  it('seconda richiesta: stessi byte e stesso sha256, nessun progressivo nuovo, senza conferma, un solo audit', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    const uno = await xmlDi(az, d.id)
    const due = await xmlDi(az, d.id, NO)
    expect(Buffer.compare(uno.contenuto, due.contenuto)).toBe(0)
    expect(due.sha256).toBe(uno.sha256)
    expect(due.nomeFile).toBe(uno.nomeFile)
    expect(await contatore(az.tenantId)).toBe(1)
    expect(await progressiviSalvati(az.tenantId)).toEqual(['00001'])
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(1)
  }, 90_000)

  it('due richieste parallele sullo stesso documento (entrambe oltre la lettura prima della B): stessi byte, un solo progressivo salvato, un solo audit', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    // Barriera: nessuna delle due entra nella B finche' entrambe non hanno finito la A.
    const originale = (
      xml as unknown as { riservaProgressivi: (t: string, n: number) => Promise<number> }
    ).riservaProgressivi.bind(xml)
    let arrivate = 0
    let apri!: () => void
    const cancello = new Promise<void>(r => (apri = r))
    jest
      .spyOn(xml as unknown as { riservaProgressivi: typeof originale }, 'riservaProgressivi')
      .mockImplementation(async (t, n) => {
        const primo = await originale(t, n)
        if (++arrivate === 2) apri()
        await cancello
        return primo
      })
    const [x, y] = await Promise.all([xmlDi(az, d.id), xmlDi(az, d.id)])
    expect(arrivate).toBe(2)
    expect(Buffer.compare(x.contenuto, y.contenuto)).toBe(0)
    expect(x.sha256).toBe(y.sha256)
    expect(x.nomeFile).toBe(y.nomeFile)
    expect(await progressiviSalvati(az.tenantId)).toHaveLength(1)
    expect(await contatore(az.tenantId)).toBe(2) // la seconda A resta inutilizzata
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(1)
    expect((await riga(d.id)).versione).toBe((await b.documento(d.id)).versione)
  }, 90_000)

  it('XML che non passa l’XSD (dato corrotto col proprietario): 422 XML_NON_VALIDO, nulla salvato', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    await corrompi(d.id)
    const e = await esito(xmlDi(az, d.id))
    expect(e).toMatchObject({ status: 422, codice: 'XML_NON_VALIDO' })
    expect(JSON.stringify(e)).not.toContain('XXXXX') // nessun valore dei campi nel messaggio
    const r = await riga(d.id)
    expect([r.emesso_il, r.xml, r.xml_sha256, r.xml_generato_il, r.progressivo_file]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(0)
  }, 90_000)

  it('BOZZA: 409 XML_NON_DISPONIBILE', async () => {
    const az = await b.t19.azienda()
    await b.t19.contratto(az)
    const e = await b.t19.pronta(az)
    const [bozza] = await b.t19.documenti(e.id)
    expect(await esito(xmlDi(az, bozza.id))).toMatchObject({
      status: 409,
      codice: 'XML_NON_DISPONIBILE',
    })
    expect(await contatore(az.tenantId)).toBe(0)
  }, 90_000)

  it('ANNULLATO: 409 XML_NON_DISPONIBILE, nulla scritto, contatore fermo', async () => {
    const az = await b.t19.azienda()
    const [, d2] = await b.definitivi(az, 2)
    await b.annullaCorrente(az, d2.id)
    expect(await esito(xmlDi(az, d2.id))).toMatchObject({
      status: 409,
      codice: 'XML_NON_DISPONIBILE',
    })
    const r = await riga(d2.id)
    expect([r.emesso_il, r.xml, r.progressivo_file]).toEqual([null, null, null])
    expect(await contatore(az.tenantId)).toBe(0)
  }, 90_000)

  it('cliente modificato dopo la definitiva: l’XML usa la fotografia', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    const originale = (
      (await b.documento(d.id)).fotografia as { cessionario: { denominazione: string } }
    ).cessionario.denominazione
    await owner.$executeRawUnsafe(
      `UPDATE ditte SET ragione_sociale = 'NOME CAMBIATO DOPO SRL'
       WHERE id IN (SELECT c.ditta_id FROM clienti c JOIN contratti_cliente k ON k.cliente_id = c.id
                    WHERE k.id = $1::uuid)`,
      d.contrattoId
    )
    const testo = (await xmlDi(az, d.id)).contenuto.toString('utf8')
    expect(testo).toContain(originale)
    expect(testo).not.toContain('NOME CAMBIATO DOPO')
  }, 90_000)

  it('«Segna come emesso», poi AnnulloStornoService.annulla: 409 ANNULLO_NON_AMMESSO con motivo EMESSO', async () => {
    const az = await b.t19.azienda()
    const [, d2] = await b.definitivi(az, 2)
    const v = await b.versioneDi(d2.id)
    const dettaglio = await xml.segnaEmesso(az.tenantId, az.utenteId, d2.id, v)
    expect(dettaglio.emessoIl).not.toBeNull()
    expect(dettaglio.xmlGenerato).toBe(false)
    expect(await esito(b.annullaCorrente(az, d2.id))).toEqual({
      status: 409,
      codice: 'ANNULLO_NON_AMMESSO',
      details: { motivo: 'EMESSO' },
    })
    // Ripetuto: idempotente, versione invariata. Versione vecchia su un non emesso: 409.
    const ancora = await xml.segnaEmesso(az.tenantId, az.utenteId, d2.id, v + 1)
    expect(ancora.emessoIl).toBe(dettaglio.emessoIl)
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(1)
  }, 90_000)

  it('segna come emesso: versione superata 409, bozza e annullato 409 EMISSIONE_NON_AMMESSA', async () => {
    const az = await b.t19.azienda()
    const [d1, d2] = await b.definitivi(az, 2)
    expect(await esito(xml.segnaEmesso(az.tenantId, az.utenteId, d1.id, 99))).toMatchObject({
      status: 409,
      codice: 'VERSIONE_SUPERATA',
    })
    await b.annullaCorrente(az, d2.id)
    expect(
      await esito(xml.segnaEmesso(az.tenantId, az.utenteId, d2.id, await b.versioneDi(d2.id)))
    ).toMatchObject({ status: 409, codice: 'EMISSIONE_NON_AMMESSA' })
    expect((await riga(d1.id)).emesso_il).toBeNull()
  }, 90_000)

  // -------------------------------------------------------------------------------------------
  // Zip
  // -------------------------------------------------------------------------------------------

  async function nomiDelloZip(contenuto: Buffer): Promise<string[]> {
    return Object.keys((await JSZip.loadAsync(contenuto)).files).sort()
  }

  it('zip di 3 documenti: 3 file coi nomi giusti, tutti validi e tutti emessi, 3 audit', async () => {
    const az = await b.t19.azienda()
    const docs = await b.definitivi(az, 3)
    const piva = await partitaIva(docs[0].id)
    const { contenuto, saltati } = await zipDi(
      az,
      docs.map(d => d.id)
    )
    expect(saltati).toBe(0)
    expect(await nomiDelloZip(contenuto)).toEqual(
      ['00001', '00002', '00003'].map(p => `IT${piva}_${p}.xml`)
    )
    const zip = await JSZip.loadAsync(contenuto)
    const testi = await Promise.all(Object.values(zip.files).map(f => f.async('string')))
    expect((await validaFatturePA(testi)).every(e => e.valido)).toBe(true)
    for (const d of docs) expect((await riga(d.id)).emesso_il).not.toBeNull()
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(3)
    expect(await contatore(az.tenantId)).toBe(3)
  }, 90_000)

  it('zip senza conferma con documenti non emessi: 400, nulla emesso, contatore fermo', async () => {
    const az = await b.t19.azienda()
    const docs = await b.definitivi(az, 2)
    expect(
      await esito(
        zipDi(
          az,
          docs.map(d => d.id),
          NO
        )
      )
    ).toEqual({ status: 400, codice: 'CONFERMA_EMISSIONE_RICHIESTA' })
    expect(await contatore(az.tenantId)).toBe(0)
  }, 90_000)

  it('zip con un documento che non passa l’XSD: 422 con la posizione, nessuno dei tre emesso, nessun progressivo salvato', async () => {
    const az = await b.t19.azienda()
    const docs = await b.definitivi(az, 3)
    await corrompi(docs[1].id)
    const e = await esito(
      zipDi(
        az,
        docs.map(d => d.id)
      )
    )
    expect(e).toMatchObject({
      status: 422,
      codice: 'XML_NON_VALIDO',
      details: { indice: 2 },
    })
    for (const d of docs) {
      const r = await riga(d.id)
      expect([r.emesso_il, r.xml, r.progressivo_file]).toEqual([null, null, null])
    }
    expect(await progressiviSalvati(az.tenantId)).toEqual([])
    expect(await contatore(az.tenantId)).toBe(0)
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(0)
  }, 90_000)

  it('zip con 2 DEFINITIVO e 1 ANNULLATO: 2 file, saltati 1', async () => {
    const az = await b.t19.azienda()
    const docs = await b.definitivi(az, 3)
    await b.annullaCorrente(az, docs[2].id)
    const { contenuto, saltati } = await zipDi(
      az,
      docs.map(d => d.id)
    )
    expect(saltati).toBe(1)
    expect(await nomiDelloZip(contenuto)).toHaveLength(2)
    expect((await riga(docs[2].id)).xml).toBeNull()
    expect(await contatore(az.tenantId)).toBe(2)
  }, 90_000)

  it('zip con una BOZZA: 409 XML_NON_DISPONIBILE, nulla emesso', async () => {
    const az = await b.t19.azienda()
    const [d1] = await b.definitivi(az, 1)
    await b.t19.contratto(az, { data: '2026-02-10' })
    const e = await b.t19.pronta(az, { periodoDal: '2026-02-01', periodoAl: '2026-02-28' })
    const [bozza] = await b.t19.documenti(e.id)
    expect(await esito(zipDi(az, [d1.id, bozza.id]))).toMatchObject({
      status: 409,
      codice: 'XML_NON_DISPONIBILE',
    })
    expect((await riga(d1.id)).emesso_il).toBeNull()
  }, 90_000)

  it('due zip paralleli sugli stessi documenti in ordine opposto, sovrapposti da una barriera: stessi byte, un progressivo e un audit per documento, nessun deadlock', async () => {
    const az = await b.t19.azienda()
    const docs = await b.definitivi(az, 3)
    const ids = docs.map(d => d.id)
    // Barriera: nessuno dei due zip entra nelle scritture prima che entrambi abbiano la loro A,
    // quindi le due B (blocco unico) si contendono gli stessi lock di documento.
    const privato = xml as unknown as {
      riservaProgressivi: (t: string, n: number) => Promise<number>
    }
    const originale = privato.riservaProgressivi.bind(xml)
    let arrivate = 0
    let apri!: () => void
    const cancello = new Promise<void>(r => (apri = r))
    jest.spyOn(privato, 'riservaProgressivi').mockImplementation(async (t, n) => {
      const primo = await originale(t, n)
      if (++arrivate === 2) apri()
      await cancello
      return primo
    })
    const [x, y] = await Promise.all([zipDi(az, ids), zipDi(az, [...ids].reverse())])
    expect(arrivate).toBe(2)
    expect(await nomiDelloZip(x.contenuto)).toEqual(await nomiDelloZip(y.contenuto))
    const zx = await JSZip.loadAsync(x.contenuto)
    const zy = await JSZip.loadAsync(y.contenuto)
    for (const nome of Object.keys(zx.files)) {
      expect(await zx.files[nome].async('string')).toBe(await zy.files[nome].async('string'))
    }
    expect(await progressiviSalvati(az.tenantId)).toHaveLength(3)
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(3)
  }, 90_000)

  it('«segna come emesso», poi XML senza conferma: l’XML esce, nessun 400, nessun secondo audit di emissione', async () => {
    const az = await b.t19.azienda()
    const [, d2] = await b.definitivi(az, 2)
    await xml.segnaEmesso(az.tenantId, az.utenteId, d2.id, await b.versioneDi(d2.id))
    const f = await xmlDi(az, d2.id, NO)
    expect((await validaFatturaPA(f.contenuto.toString('utf8'))).valido).toBe(true)
    expect((await riga(d2.id)).progressivo_file).toBe('00001')
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(1)
  }, 90_000)

  it('zip contro XML singolo parallelo sullo stesso documento: stessi byte per quel documento', async () => {
    const az = await b.t19.azienda()
    const docs = await b.definitivi(az, 3)
    const [z, f] = await Promise.all([
      zipDi(
        az,
        docs.map(d => d.id)
      ),
      xmlDi(az, docs[1].id),
    ])
    const zip = await JSZip.loadAsync(z.contenuto)
    expect(await zip.files[f.nomeFile].async('string')).toBe(f.contenuto.toString('utf8'))
    expect(await progressiviSalvati(az.tenantId)).toHaveLength(3)
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(3)
  }, 90_000)

  it('lotto non validabile in blocco (errore senza file): 422, nulla emesso', async () => {
    const az = await b.t19.azienda()
    const docs = await b.definitivi(az, 2)
    const modulo = jest.requireActual('../../infrastructure/fatturapa/valida-xsd')
    jest
      .spyOn(modulo, 'validaFatturePA')
      .mockImplementation(async (...a: unknown[]) =>
        (a[0] as string[]).map(() => ({ valido: false, errori: ['errore generale del lotto'] }))
      )
    const e = await esito(
      zipDi(
        az,
        docs.map(d => d.id)
      )
    )
    expect(e).toMatchObject({ status: 422, codice: 'XML_NON_VALIDO' })
    expect((e as { details?: Record<string, unknown> }).details).not.toHaveProperty('indice')
    for (const d of docs) expect((await riga(d.id)).emesso_il).toBeNull()
    expect(await contatore(az.tenantId)).toBe(0)
  }, 90_000)

  // -------------------------------------------------------------------------------------------
  // ExportService, formato XML_ZIP
  // -------------------------------------------------------------------------------------------

  it('ExportService.esporta con XML_ZIP e confermaEmissione: lo stesso zip, audit dell’export, saltati', async () => {
    const az = await b.t19.azienda()
    const docs = await b.definitivi(az, 3)
    await b.annullaCorrente(az, docs[2].id)
    const esportato = await esportatore.esporta(az.tenantId, az.utenteId, {
      formato: 'XML_ZIP',
      selezione: { documentoIds: docs.map(d => d.id) },
      confermaEmissione: true,
    })
    expect(esportato.saltati).toBe(1)
    expect(esportato.contentType).toBe('application/zip')
    expect(await nomiDelloZip(esportato.contenuto)).toHaveLength(2)
    const [audit] = await b.audit(az.tenantId, 'DOCUMENTI_FATTURA_ESPORTATI')
    expect(audit.metadata).toEqual({ formato: 'XML_ZIP', documenti: 2, saltati: 1 })
    // Senza conferma sui non emessi: 400.
    const az2 = await b.t19.azienda()
    const d2 = await b.definitivi(az2, 1)
    expect(
      await esito(
        esportatore.esporta(az2.tenantId, az2.utenteId, {
          formato: 'XML_ZIP',
          selezione: { documentoIds: d2.map(d => d.id) },
        })
      )
    ).toEqual({ status: 400, codice: 'CONFERMA_EMISSIONE_RICHIESTA' })
  }, 120_000)

  it('ExportService XML_ZIP: oltre 500 id 400 TROPPI_DOCUMENTI; da un’elaborazione le bozze sono escluse', async () => {
    const az = await b.t19.azienda()
    const tanti = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    )
    expect(
      await esito(
        esportatore.esporta(az.tenantId, az.utenteId, {
          formato: 'XML_ZIP',
          selezione: { documentoIds: tanti },
          confermaEmissione: true,
        })
      )
    ).toMatchObject({ status: 400, codice: 'TROPPI_DOCUMENTI', details: { massimo: 500 } })
    await b.t19.contratto(az)
    const e = await b.t19.pronta(az)
    const vuoto = await esportatore.esporta(az.tenantId, az.utenteId, {
      formato: 'XML_ZIP',
      selezione: { elaborazioneId: e.id },
      confermaEmissione: true,
    })
    expect(await nomiDelloZip(vuoto.contenuto)).toEqual([])
  }, 90_000)

  // -------------------------------------------------------------------------------------------
  // Concorrenza: annullo, contatore
  // -------------------------------------------------------------------------------------------

  it('annullo e XML in parallelo (annullo per primo, fermo con tutti i lock): XML 409 XML_NON_DISPONIBILE, ANNULLATO senza emesso_il, mai 500', async () => {
    const az = await b.t19.azienda()
    const [, d2] = await b.definitivi(az, 2)
    const v = await b.versioneDi(d2.id)
    const { esito: esitoAnnullo, risultato } = await b.conOperazioneInPausa(
      () => b.annulla(az, d2.id, { versione: v }),
      async rilascia => {
        let finito = false
        const richiesta = esito(xmlDi(az, d2.id)).finally(() => (finito = true))
        // La B dell'XML aspetta il lock del documento: l'annullo lo tiene.
        await b.t19.attendiLock(1, () => finito)
        expect(finito).toBe(false)
        rilascia()
        return richiesta
      }
    )
    expect(esitoAnnullo.status).toBe('fulfilled')
    expect(risultato).toMatchObject({ status: 409, codice: 'XML_NON_DISPONIBILE' })
    const r = await riga(d2.id)
    expect(r.stato).toBe('ANNULLATO')
    expect([r.emesso_il, r.xml, r.progressivo_file]).toEqual([null, null, null])
  }, 90_000)

  it('annullo e XML in parallelo (XML per primo, fermo col documento bloccato): l’annullo aspetta e risponde 409 ANNULLO_NON_AMMESSO EMESSO, mai 500', async () => {
    const az = await b.t19.azienda()
    const [, d2] = await b.definitivi(az, 2)
    const v = await b.versioneDi(d2.id)
    // Ferma la B dell'XML dentro la transazione, col documento gia' bloccato.
    let rilascia!: () => void
    const cancello = new Promise<void>(r => (rilascia = r))
    let fermo!: () => void
    const eFerma = new Promise<void>(r => (fermo = r))
    const privato = xml as unknown as {
      generaEValida: (...a: unknown[]) => Promise<Buffer[]>
    }
    const originale = privato.generaEValida.bind(xml)
    jest.spyOn(privato, 'generaEValida').mockImplementation(async (...a) => {
      fermo()
      await cancello
      return originale(...a)
    })
    const richiestaXml = xmlDi(az, d2.id).then(
      f => f,
      e => e
    )
    await eFerma
    let finito = false
    const annullo = esito(b.annulla(az, d2.id, { versione: v })).finally(() => (finito = true))
    await b.t19.attendiLock(1, () => finito)
    expect(finito).toBe(false)
    rilascia()
    const f = await richiestaXml
    expect(f).toHaveProperty('nomeFile')
    expect(await annullo).toEqual({
      status: 409,
      codice: 'ANNULLO_NON_AMMESSO',
      details: { motivo: 'EMESSO' },
    })
    const r = await riga(d2.id)
    expect(r.stato).toBe('DEFINITIVO')
    expect(r.emesso_il).not.toBeNull()
  }, 90_000)

  it('contatore di un tenant non bloccato da un altro tenant; lo stesso tenant aspetta il lock del contatore', async () => {
    const a = await b.t19.azienda()
    const c = await b.t19.azienda()
    const [da] = await b.definitivi(a, 1)
    const [dc] = await b.definitivi(c, 1)
    // Il contatore di A esiste e viene tenuto bloccato da una transazione del proprietario.
    await owner.$executeRawUnsafe(
      `INSERT INTO contatori_file_fatturapa (tenant_id, ultimo, updated_at)
       VALUES ($1::uuid, 0, now()) ON CONFLICT DO NOTHING`,
      a.tenantId
    )
    let rilascia!: () => void
    const cancello = new Promise<void>(r => (rilascia = r))
    let preso!: () => void
    const eIlPreso = new Promise<void>(r => (preso = r))
    const tenitore = owner.$transaction(
      async tx => {
        await tx.$queryRawUnsafe(
          `SELECT 1 FROM contatori_file_fatturapa WHERE tenant_id = $1::uuid FOR UPDATE`,
          a.tenantId
        )
        preso()
        await cancello
      },
      { timeout: 60_000 }
    )
    try {
      await eIlPreso
      let finitoA = false
      const richiestaA = xmlDi(a, da.id).finally(() => (finitoA = true))
      await b.t19.attendiLock(1, () => finitoA)
      expect(finitoA).toBe(false)
      // L'altra azienda passa senza aspettare.
      const fc = await xmlDi(c, dc.id)
      expect(fc.nomeFile.endsWith('_00001.xml')).toBe(true)
      expect(finitoA).toBe(false)
      rilascia()
      const fa = await richiestaA
      expect(fa.nomeFile.endsWith('_00001.xml')).toBe(true)
    } finally {
      rilascia()
      await tenitore
    }
  }, 90_000)
})
