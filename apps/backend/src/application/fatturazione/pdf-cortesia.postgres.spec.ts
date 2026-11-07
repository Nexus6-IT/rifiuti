/**
 * PDF di cortesia (Task 28) contro un Postgres reale, COME `wasteflow_app` (RLS FORCE):
 * documenti veri (anteprima e definitiva), lettura pura (emesso_il, versione e XML non cambiano),
 * altro tenant = 404. Pulizia solo per id esatti.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APPLICAZIONE = `fatt-t28-${process.pid}`
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
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { DocumentiFatturaService } from './documenti-fattura.service'
import { PdfCortesiaService } from './pdf-cortesia'

describe('PdfCortesiaService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let b: BancoT20
  let servizio: PdfCortesiaService
  const tenantCreati: string[] = []

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    b = creaBancoT20({ owner, app, tenantCreati, nomeApplicazione: NOME_APPLICAZIONE })
  })
  beforeEach(() => {
    b.reset()
    b.servizio.orologio = () => new Date('2026-05-01T10:00:00Z')
    servizio = new PdfCortesiaService(app, new DocumentiFatturaService(app))
  })
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  const stato = async (id: string) =>
    (
      await owner.$queryRawUnsafe<
        { emesso_il: Date | null; versione: number; xml: Buffer | null; stato: string }[]
      >(
        `SELECT emesso_il, versione::int, xml, stato::text FROM documenti_fattura WHERE id = $1::uuid`,
        id
      )
    )[0]

  it('GET pdf non cambia emesso_il (ne` versione, ne` XML, ne` audit di emissione)', async () => {
    const az = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    const prima = await stato(d.id)
    const f = await servizio.pdf(az.tenantId, d.id)
    expect(f.contenuto.subarray(0, 5).toString()).toBe('%PDF-')
    expect(f.nomeFile).toMatch(/^[A-Za-z0-9_-]+-\d+-2026\.pdf$/)
    const dopo = await stato(d.id)
    expect(dopo.emesso_il).toBeNull()
    expect(dopo).toEqual(prima)
    expect(await b.t19.conteggioAudit(az.tenantId, 'DOCUMENTO_FATTURA_EMESSO')).toBe(0)
  })

  it('una bozza esce col nome di anteprima', async () => {
    const az = await b.t19.azienda()
    await b.t19.contratto(az)
    const e = await b.t19.pronta(az)
    const bozze = (await b.t19.documenti(e.id)).filter(x => x.stato === 'BOZZA')
    expect(bozze.length).toBeGreaterThan(0)
    const f = await servizio.pdf(az.tenantId, bozze[0].id)
    expect(f.nomeFile).toMatch(/^anteprima-/)
    expect(f.contenuto.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('PDF di un altro tenant: 404 DOCUMENTO_NON_TROVATO', async () => {
    const az = await b.t19.azienda()
    const altra = await b.t19.azienda()
    const [d] = await b.definitivi(az, 1)
    await expect(servizio.pdf(altra.tenantId, d.id)).rejects.toMatchObject({
      status: 404,
      response: { error: 'DOCUMENTO_NON_TROVATO' },
    })
    await expect(servizio.pdf(az.tenantId, 'non-un-uuid')).rejects.toMatchObject({ status: 404 })
  })
})
