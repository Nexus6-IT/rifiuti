/**
 * Volume dello zip XML (fase 4.4b2, Task 23, Q24): 500 documenti DEFINITIVI (il tetto) in uno
 * zip. Un documento vero si clona 499 volte col proprietario (trigger spenti solo nella
 * transazione di prova); le letture dello zip sono per insieme, la validazione e' a lotto.
 */
import { PrismaClient } from '@prisma/client'
import JSZip from 'jszip'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t23v-${process.pid}`
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APPLICAZIONE}&connection_limit=20`

import { validaFatturePA } from '../../infrastructure/fatturapa/valida-xsd'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaBancoT20, type BancoT20 } from '../../test-support/fatturazione-annullo-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { TETTO_DOCUMENTI_XML_ZIP, XmlDocumentoService } from './xml-documento.service'

describe('XmlDocumentoService, zip da 500 — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => b.reset())
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  async function colonne(tabella: string, escludi: string[]): Promise<string[]> {
    const r = await owner.$queryRawUnsafe<{ c: string }[]>(
      `SELECT column_name AS c FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
      tabella
    )
    return r.map(x => x.c).filter(c => !escludi.includes(c))
  }

  /** Clona `base` in `n` documenti DEFINITIVI numerati di seguito, con righe, riepiloghi e rate. */
  async function clona(tenantId: string, base: string, n: number): Promise<string[]> {
    const cd = await colonne('documenti_fattura', [
      'id',
      'numero',
      'numero_testo',
      'xml',
      'xml_sha256',
      'xml_generato_il',
      'progressivo_file',
      'emesso_il',
    ])
    const lista = (cols: string[], prefisso: string) =>
      cols.map(c => `${prefisso}"${c}"`).join(', ')
    const figlie: Array<[string, string[]]> = []
    for (const t of [
      'righe_documento_fattura',
      'riepiloghi_iva_documento',
      'rate_documento_fattura',
    ]) {
      figlie.push([t, await colonne(t, ['id', 'documento_id'])])
    }
    return owner.$transaction(
      async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`)
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE m_clone ON COMMIT DROP AS
           SELECT g, gen_random_uuid() AS nid FROM generate_series(1, ${n}) g`
        )
        await tx.$executeRawUnsafe(
          `INSERT INTO documenti_fattura (id, numero, numero_testo, ${lista(cd, '')})
           SELECT m.nid, d.numero + m.g, (d.numero + m.g)::text, ${lista(cd, 'd.')}
           FROM documenti_fattura d CROSS JOIN m_clone m
           WHERE d.id = $1::uuid AND d.tenant_id = $2::uuid`,
          base,
          tenantId
        )
        for (const [t, cols] of figlie) {
          await tx.$executeRawUnsafe(
            `INSERT INTO ${t} (id, documento_id, ${lista(cols, '')})
             SELECT gen_random_uuid(), m.nid, ${lista(cols, 'r.')}
             FROM ${t} r CROSS JOIN m_clone m WHERE r.documento_id = $1::uuid`,
            base
          )
        }
        const nuovi = await tx.$queryRawUnsafe<{ nid: string }[]>(
          `SELECT nid::text FROM m_clone ORDER BY g`
        )
        return nuovi.map(x => x.nid)
      },
      { timeout: 120_000 }
    )
  }

  it('500 documenti: zip valido in pochi secondi, un progressivo per documento, seconda richiesta senza scritture', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    const altri = await clona(az.tenantId, d.id, TETTO_DOCUMENTI_XML_ZIP - 1)
    const ids = [d.id, ...altri]
    expect(ids).toHaveLength(500)
    const servizio = new XmlDocumentoService(app, new DocumentiFatturaService(app))

    const t0 = Date.now()
    const { contenuto, saltati } = await servizio.zip(az.tenantId, az.utenteId, ids, {
      confermaEmissione: true,
    })
    const primo = Date.now() - t0
    expect(saltati).toBe(0)
    const zip = await JSZip.loadAsync(contenuto)
    const nomi = Object.keys(zip.files)
    expect(nomi).toHaveLength(500)
    expect(new Set(nomi).size).toBe(500)
    const testi = await Promise.all(nomi.map(n => zip.files[n].async('string')))
    expect((await validaFatturePA(testi)).every(e => e.valido)).toBe(true)
    const [{ n, emessi, progressivi }] = await owner.$queryRawUnsafe<
      { n: number; emessi: number; progressivi: number }[]
    >(
      `SELECT count(*)::int AS n, count(emesso_il)::int AS emessi,
              count(DISTINCT progressivo_file)::int AS progressivi
       FROM documenti_fattura WHERE tenant_id = $1::uuid AND xml IS NOT NULL`,
      az.tenantId
    )
    expect({ n, emessi, progressivi }).toEqual({ n: 500, emessi: 500, progressivi: 500 })

    const t1 = Date.now()
    const ancora = await servizio.zip(az.tenantId, az.utenteId, ids, { confermaEmissione: false })
    const secondo = Date.now() - t1
    expect(Object.keys((await JSZip.loadAsync(ancora.contenuto)).files).sort()).toEqual(
      [...nomi].sort()
    )
    // eslint-disable-next-line no-console
    console.log(`ZIP500 prima richiesta ${primo} ms, seconda ${secondo} ms`)
    expect(primo).toBeLessThan(60_000)
    expect(secondo).toBeLessThan(primo)
  }, 240_000)
})
