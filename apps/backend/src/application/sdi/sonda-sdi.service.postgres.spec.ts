/**
 * Sonda SDI (4.5f T1) contro un Postgres reale, COME `wasteflow_app`: avvisi in-app agli ADMIN per
 * INCERTA oltre un'ora, SCARTATA ed ERRORE_INVIO non risolti, una sola volta per trasmissione.
 */
import { PrismaClient } from '@prisma/client'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaContrattoConElenco } from '../../test-support/listino-di-test'
import {
  creaDocumentoMinimoPerLegame,
  pulisciTenantDiTest,
} from '../../test-support/legami-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=sdi-f-sonda-${process.pid}&connection_limit=10`

import { SOGLIA_INCERTA_SDI_MS, SondaSdiService } from './sonda-sdi.service'

const ORE = 3_600_000

describe('SondaSdiService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sonda: SondaSdiService
  const tenantCreati: string[] = []
  const T0 = new Date()

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    sonda = new SondaSdiService(app)
  })
  afterAll(async () => {
    await owner.$executeRawUnsafe(
      `DELETE FROM notifications WHERE tenant_id = ANY($1::uuid[])`,
      tenantCreati
    )
    await owner.$executeRawUnsafe(
      `DELETE FROM notifiche_sdi WHERE tenant_id = ANY($1::uuid[])`,
      tenantCreati
    )
    await owner.$executeRawUnsafe(
      `DELETE FROM trasmissioni_sdi WHERE tenant_id = ANY($1::uuid[])`,
      tenantCreati
    )
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app.$disconnect()
  }, 120_000)

  interface Az {
    t: string
    documentoId: string
    admin: string[]
  }

  async function azienda(ruoli: ('ADMIN' | 'SUPER_ADMIN' | 'OPERATOR')[] = ['ADMIN']): Promise<Az> {
    const tenant = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Sonda SRL', country: 'IT' },
    })
    tenantCreati.push(tenant.id)
    const c = await creaContrattoConElenco(owner, tenant.id)
    const documentoId = await creaDocumentoMinimoPerLegame(owner, tenant.id, c)
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura SET emesso_il = now() WHERE id = $1::uuid`,
      documentoId
    )
    const admin: string[] = []
    for (const [i, role] of ruoli.entries()) {
      const n = partitaIvaUnica()
      const u = await owner.user.create({
        data: {
          tenantId: tenant.id,
          keycloakId: `kc-sonda-${n}-${i}`,
          fiscalCode: `SND${n}${i}`.slice(0, 16),
          firstName: 'Sonda',
          lastName: `U${i}`,
          email: `sonda-${n}-${i}@example.test`,
          role,
        },
      })
      if (role !== 'OPERATOR') admin.push(u.id)
    }
    return { t: tenant.id, documentoId, admin }
  }

  /** Inserisce come app una trasmissione e la porta a `stato`, con `updated_at` a `quando`. */
  async function trasmissione(
    az: Az,
    stato: 'INCERTA' | 'SCARTATA' | 'ERRORE_INVIO' | 'INVIATA',
    quando: Date,
    documentoId = az.documentoId
  ): Promise<string> {
    const [t] = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO trasmissioni_sdi (tenant_id, documento_id, provider, ambiente, nome_file, xml_sha256, updated_at)
       VALUES ($1::uuid, $2::uuid, 'fake', 'PRODUZIONE', 'IT01234567890_00001.xml', repeat('a', 64), now())
       RETURNING id::text AS id`,
      az.t,
      documentoId
    )
    const passi: string[] =
      stato === 'INCERTA'
        ? ['IN_INVIO', 'INCERTA']
        : stato === 'ERRORE_INVIO'
          ? ['IN_INVIO', 'ERRORE_INVIO']
          : ['IN_INVIO', 'INVIATA', ...(stato === 'SCARTATA' ? ['SCARTATA'] : [])]
    for (const p of passi) {
      await owner.$executeRawUnsafe(
        `UPDATE trasmissioni_sdi SET stato = $2::stato_trasmissione_sdi,
           id_provider = CASE WHEN $2 IN ('INVIATA','SCARTATA') THEN 'prov-1' ELSE id_provider END,
           ultimo_errore_codice = CASE WHEN $2 = 'ERRORE_INVIO' THEN 'E1' ELSE NULL END,
           chiusa_il = CASE WHEN $2 = 'ERRORE_INVIO' THEN $3::timestamptz ELSE chiusa_il END,
           updated_at = $3::timestamptz WHERE id = $1::uuid`,
        t.id,
        p,
        quando
      )
    }
    if (stato === 'SCARTATA') {
      await owner.$executeRawUnsafe(
        `INSERT INTO notifiche_sdi (tenant_id, trasmissione_id, tipo, codici_errore, fonte, chiave_dedup)
         VALUES ($1::uuid, $2::uuid, 'NS', ARRAY['00305'], 'WEBHOOK', $3)`,
        az.t,
        t.id,
        `k-${t.id}`
      )
    }
    return t.id
  }

  const avvisi = (az: Az) =>
    owner.$queryRawUnsafe<
      { user_id: string; title: string; message: string; severity: string; related: string }[]
    >(
      `SELECT user_id::text, title, message, severity::text, related_entity_id::text AS related
       FROM notifications WHERE tenant_id = $1::uuid AND related_entity_type = 'TrasmissioneSdi'
       ORDER BY created_at`,
      az.t
    )

  it("INCERTA da piu' di un'ora: un avviso a ogni ADMIN, non agli altri ruoli", async () => {
    const az = await azienda(['ADMIN', 'SUPER_ADMIN', 'OPERATOR'])
    const id = await trasmissione(
      az,
      'INCERTA',
      new Date(T0.getTime() - SOGLIA_INCERTA_SDI_MS - 60_000)
    )
    const esito = await sonda.giroAzienda(az.t, T0)
    expect(esito).toEqual({ problemi: 1, avvisiCreati: 2 })
    const a = await avvisi(az)
    expect(a.map(x => x.user_id).sort()).toEqual([...az.admin].sort())
    expect(a[0]).toMatchObject({ severity: 'WARNING', related: id })
    expect(a[0].title).toBe('Invio allo SDI incerto')
    expect(a[0].message).toContain('IT01234567890_00001.xml')
  }, 60_000)

  it("INCERTA da meno di un'ora: nessun avviso", async () => {
    const az = await azienda()
    await trasmissione(az, 'INCERTA', new Date(T0.getTime() - 30 * 60_000))
    expect(await sonda.giroAzienda(az.t, T0)).toEqual({ problemi: 0, avvisiCreati: 0 })
    expect(await avvisi(az)).toHaveLength(0)
  }, 60_000)

  it('SCARTATA: avviso con i codici di scarto; una seconda esecuzione non ne crea altri', async () => {
    const az = await azienda()
    await trasmissione(az, 'SCARTATA', new Date(T0.getTime() - 5 * 60_000))
    expect((await sonda.giroAzienda(az.t, T0)).avvisiCreati).toBe(1)
    const [a] = await avvisi(az)
    expect(a).toMatchObject({ severity: 'ERROR', title: 'Fattura scartata dallo SDI' })
    expect(a.message).toContain('00305')
    expect(await sonda.giroAzienda(az.t, new Date(T0.getTime() + 10 * ORE))).toEqual({
      problemi: 0,
      avvisiCreati: 0,
    })
    expect(await avvisi(az)).toHaveLength(1)
  }, 60_000)

  it("SCARTATA gia' risolta (documento annullato o nuova trasmissione): nessun avviso", async () => {
    const az = await azienda()
    await trasmissione(az, 'SCARTATA', new Date(T0.getTime() - 10 * 60_000))
    // Nuova trasmissione sullo stesso documento: lo scarto non e' piu' l'ultimo capitolo.
    await trasmissione(az, 'INVIATA', new Date(T0.getTime() - 5 * 60_000))
    expect(await sonda.giroAzienda(az.t, T0)).toEqual({ problemi: 0, avvisiCreati: 0 })
  }, 60_000)

  it("ERRORE_INVIO: avviso se quello immediato manca, nessun doppione se c'e' gia'", async () => {
    const senza = await azienda()
    await trasmissione(senza, 'ERRORE_INVIO', new Date(T0.getTime() - 5 * 60_000))
    expect((await sonda.giroAzienda(senza.t, T0)).avvisiCreati).toBe(1)

    const con = await azienda()
    const quando = new Date(T0.getTime() - 5 * 60_000)
    await trasmissione(con, 'ERRORE_INVIO', quando)
    // Avviso immediato di ElaboraInvioSdiService: stesso titolo, sul documento, dopo la chiusura.
    await owner.$executeRawUnsafe(
      `INSERT INTO notifications (tenant_id, user_id, type, title, message, severity,
         related_entity_id, related_entity_type, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, 'SYSTEM_ERROR', 'Invio allo SDI non riuscito', 'x', 'ERROR',
         $3::uuid, 'DocumentoFattura', $4::timestamptz, $4::timestamptz)`,
      con.t,
      con.admin[0],
      con.documentoId,
      new Date(quando.getTime() + 1000)
    )
    expect((await sonda.giroAzienda(con.t, T0)).avvisiCreati).toBe(0)
  }, 60_000)

  it('un documento annullato non genera avvisi', async () => {
    const az = await azienda()
    await trasmissione(az, 'SCARTATA', new Date(T0.getTime() - 5 * 60_000))
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura SET stato = 'ANNULLATO', motivo_annullo = 'Scarto SDI',
         annullato_il = now(), annullato_da = gen_random_uuid(), versione = versione + 1,
         updated_at = now() WHERE id = $1::uuid`,
      az.documentoId
    )
    expect(await sonda.giroAzienda(az.t, T0)).toEqual({ problemi: 0, avvisiCreati: 0 })
  }, 60_000)

  it('azienda senza ADMIN: nessun avviso e nessun errore', async () => {
    const az = await azienda(['OPERATOR'])
    await trasmissione(az, 'SCARTATA', new Date(T0.getTime() - 5 * 60_000))
    expect(await sonda.giroAzienda(az.t, T0)).toEqual({ problemi: 1, avvisiCreati: 0 })
  }, 60_000)

  it("isolamento fra aziende: gli avvisi di una non toccano l'altra", async () => {
    const a = await azienda()
    const b = await azienda()
    await trasmissione(a, 'SCARTATA', new Date(T0.getTime() - 5 * 60_000))
    await sonda.giroAzienda(a.t, T0)
    expect(await avvisi(b)).toHaveLength(0)
    expect(await sonda.giroAzienda(b.t, T0)).toEqual({ problemi: 0, avvisiCreati: 0 })
  }, 60_000)
})
