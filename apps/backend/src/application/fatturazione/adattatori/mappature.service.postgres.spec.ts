/**
 * Mappature dell'export contabile (4.4c, Task 29) contro un Postgres reale, COME `wasteflow_app`
 * dentro il `TenantContext`. Il proprietario prepara le fixture e legge lo stato finale. Pulizia
 * solo per id esatti.
 */
import { randomUUID } from 'node:crypto'
import { BadRequestException } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=fatt-t29-${process.pid}&connection_limit=10`

import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { creaAdattatoreFinto } from '../../../test-support/adattatore-finto'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { pulisciTenantDiTest } from '../../../test-support/legami-di-test'
import type { DocumentoPerExport } from '../export-csv'
import { MappatureService, MAX_VOCI_MAPPATURE } from './mappature.service'
import { RegistroAdattatori } from './registro-adattatori'

function documento(registro: string, aliquote: string[]): DocumentoPerExport {
  return {
    documento: { righe: aliquote.map(a => ({ aliquotaIva: a })) },
    numero: 1,
    anno: 2026,
    registroCodice: registro,
    fotografia: {},
  } as unknown as DocumentoPerExport
}

describe('MappatureService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: MappatureService
  const tenantCreati: string[] = []
  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    servizio = new MappatureService(
      app,
      new RegistroAdattatori([creaAdattatoreFinto(), creaAdattatoreFinto({ codice: 'ALTRO' })])
    )
  })
  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda(): Promise<{ tenantId: string; utenteId: string }> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Mappature SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-map-${randomUUID()}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `map-${randomUUID()}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: u.id }
  }
  const imposta = (
    a: { tenantId: string; utenteId: string },
    voci: Parameters<MappatureService['imposta']>[3],
    adattatore = 'FINTO'
  ) => nel(a.tenantId, () => servizio.imposta(a.tenantId, a.utenteId, adattatore, voci))
  const lista = (a: { tenantId: string }, adattatore = 'FINTO') =>
    nel(a.tenantId, () => servizio.lista(a.tenantId, adattatore))

  describe('schema', () => {
    it('RLS ENABLE + FORCE, due policy, unico, CHECK e indice parziale degli scostamenti', async () => {
      const [t] = await owner.$queryRawUnsafe<{ rls: boolean; forzata: boolean }[]>(
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class
         WHERE oid = 'mappature_export_contabile'::regclass`
      )
      expect(t).toEqual({ rls: true, forzata: true })
      const policy = await owner.$queryRawUnsafe<{ policyname: string }[]>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'mappature_export_contabile' ORDER BY 1`
      )
      expect(policy.map(p => p.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
      const vincoli = await owner.$queryRawUnsafe<{ conname: string }[]>(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'mappature_export_contabile'::regclass ORDER BY 1`
      )
      expect(vincoli.map(v => v.conname)).toEqual([
        'mappature_export_contabile_adattatore_non_vuoto',
        'mappature_export_contabile_chiave_non_vuota',
        'mappature_export_contabile_pkey',
        'mappature_export_contabile_tenant_id_fkey',
        'mappature_export_contabile_tipo_ammesso',
        'mappature_export_contabile_valore_non_vuoto',
        'mappature_export_contabile_versione_positiva',
      ])
      const [privilegi] = await owner.$queryRawUnsafe<{ sistema: boolean; app: boolean }[]>(
        `SELECT has_table_privilege('wasteflow_sistema', 'mappature_export_contabile', 'SELECT,INSERT,UPDATE,DELETE') AS sistema,
                has_table_privilege('wasteflow_app', 'mappature_export_contabile', 'SELECT,INSERT,UPDATE,DELETE') AS app`
      )
      expect(privilegi).toEqual({ sistema: true, app: true })
      const [indice] = await owner.$queryRawUnsafe<{ def: string }[]>(
        `SELECT indexdef AS def FROM pg_indexes WHERE indexname = 'legami_movimento_scostati_idx'`
      )
      expect(indice.def).toMatch(/\(tenant_id, documento_id\)/)
      expect(indice.def).toMatch(/stato = 'FATTURATO'/)
      expect(indice.def).not.toMatch(/scostamento_gestito_il/)
    })

    it('il database rifiuta un tipo fuori dall`elenco e un valore vuoto', async () => {
      const a = await azienda()
      await expect(
        nel(a.tenantId, () =>
          app.$executeRawUnsafe(
            `INSERT INTO mappature_export_contabile (tenant_id, adattatore, tipo, chiave_wasteflow, valore, updated_at)
             VALUES ($1::uuid, 'FINTO', 'ALTRO_TIPO', 'x', 'v', now())`,
            a.tenantId
          )
        )
      ).rejects.toThrow(/tipo_ammesso/)
      await expect(
        nel(a.tenantId, () =>
          app.$executeRawUnsafe(
            `INSERT INTO mappature_export_contabile (tenant_id, adattatore, tipo, chiave_wasteflow, valore, updated_at)
             VALUES ($1::uuid, 'FINTO', 'CLIENTE', 'x', '  ', now())`,
            a.tenantId
          )
        )
      ).rejects.toThrow(/valore_non_vuoto/)
    })
  })

  it('imposta e lista: le voci tornano ordinate per tipo e chiave, con versione 1', async () => {
    const a = await azienda()
    const r = await imposta(a, [
      { tipo: 'REGISTRO', chiaveWasteflow: 'B', valore: ' 02 ' },
      { tipo: 'CODICE_IVA', chiaveWasteflow: '22.00', valore: '10' },
      { tipo: 'CODICE_IVA', chiaveWasteflow: '10.00', valore: '20' },
    ])
    expect(r).toEqual([
      { tipo: 'CODICE_IVA', chiaveWasteflow: '10.00', valore: '20', versione: 1 },
      { tipo: 'CODICE_IVA', chiaveWasteflow: '22.00', valore: '10', versione: 1 },
      { tipo: 'REGISTRO', chiaveWasteflow: 'B', valore: '02', versione: 1 },
    ])
    expect(await lista(a)).toEqual(r)
  })

  it('una voce cambiata sale di versione, una uguale resta com`e`; un altro adattatore non si vede', async () => {
    const a = await azienda()
    await imposta(a, [
      { tipo: 'CLIENTE', chiaveWasteflow: 'c1', valore: 'A' },
      { tipo: 'CLIENTE', chiaveWasteflow: 'c2', valore: 'B' },
    ])
    const r = await imposta(a, [
      { tipo: 'CLIENTE', chiaveWasteflow: 'c1', valore: 'A2' },
      { tipo: 'CLIENTE', chiaveWasteflow: 'c2', valore: 'B' },
    ])
    expect(r.map(v => [v.chiaveWasteflow, v.valore, v.versione])).toEqual([
      ['c1', 'A2', 2],
      ['c2', 'B', 1],
    ])
    expect(await lista(a, 'ALTRO')).toEqual([])
  })

  it('valore null cancella la voce', async () => {
    const a = await azienda()
    await imposta(a, [
      { tipo: 'PAGAMENTO', chiaveWasteflow: 'MP05', valore: 'BB' },
      { tipo: 'PAGAMENTO', chiaveWasteflow: 'MP01', valore: 'CC' },
    ])
    const r = await imposta(a, [{ tipo: 'PAGAMENTO', chiaveWasteflow: 'MP05', valore: null }])
    expect(r.map(v => v.chiaveWasteflow)).toEqual(['MP01'])
    const righe = await owner.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM mappature_export_contabile WHERE tenant_id = $1::uuid`,
      a.tenantId
    )
    expect(righe[0].n).toBe(1)
    // Cancellare una voce che non c'e' non e` un errore.
    await expect(
      imposta(a, [{ tipo: 'PAGAMENTO', chiaveWasteflow: 'NONC', valore: null }])
    ).resolves.toHaveLength(1)
  })

  it('PUT con 501 voci: 400, nulla scritto; con 500 passa', async () => {
    const a = await azienda()
    const voci = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        tipo: 'CLIENTE' as const,
        chiaveWasteflow: `cliente-${i}`,
        valore: `V${i}`,
      }))
    expect(MAX_VOCI_MAPPATURE).toBe(500)
    await expect(imposta(a, voci(501))).rejects.toBeInstanceOf(BadRequestException)
    expect(await lista(a)).toEqual([])
    expect(await imposta(a, voci(500))).toHaveLength(500)
  })

  it('voci non valide: 400 e nulla scritto (tipo, chiave, valore troppo lungo, duplicati)', async () => {
    const a = await azienda()
    const casi: Parameters<MappatureService['imposta']>[3][] = [
      [{ tipo: 'XX' as never, chiaveWasteflow: 'a', valore: 'b' }],
      [{ tipo: 'CLIENTE', chiaveWasteflow: '  ', valore: 'b' }],
      [{ tipo: 'CLIENTE', chiaveWasteflow: 'k'.repeat(101), valore: 'b' }],
      [{ tipo: 'CLIENTE', chiaveWasteflow: 'a', valore: 'v'.repeat(51) }],
      [{ tipo: 'CLIENTE', chiaveWasteflow: 'a', valore: '   ' }],
      [
        { tipo: 'CLIENTE', chiaveWasteflow: 'a', valore: '1' },
        { tipo: 'CLIENTE', chiaveWasteflow: 'a', valore: '2' },
      ],
    ]
    for (const voci of casi) {
      await expect(imposta(a, voci)).rejects.toBeInstanceOf(BadRequestException)
    }
    expect(await lista(a)).toEqual([])
  })

  it('adattatore sconosciuto: 400 ADATTATORE_SCONOSCIUTO su lista, imposta e mancanti', async () => {
    const a = await azienda()
    const atteso = { response: expect.objectContaining({ error: 'ADATTATORE_SCONOSCIUTO' }) }
    await expect(lista(a, 'NO')).rejects.toMatchObject(atteso)
    await expect(imposta(a, [], 'NO')).rejects.toMatchObject(atteso)
    await expect(
      nel(a.tenantId, () => servizio.mancanti(a.tenantId, 'NO', []))
    ).rejects.toMatchObject(atteso)
  })

  it('due aziende: ciascuna vede e scrive solo le proprie voci (RLS)', async () => {
    const a = await azienda()
    const b = await azienda()
    await imposta(a, [{ tipo: 'CLIENTE', chiaveWasteflow: 'k', valore: 'A' }])
    await imposta(b, [{ tipo: 'CLIENTE', chiaveWasteflow: 'k', valore: 'B' }])
    expect((await lista(a))[0].valore).toBe('A')
    expect((await lista(b))[0].valore).toBe('B')
  })

  it('audit MAPPATURE_EXPORT_IMPOSTATE: adattatore e conteggi, mai i valori', async () => {
    const a = await azienda()
    await imposta(a, [
      { tipo: 'CLIENTE', chiaveWasteflow: 'segreto-chiave', valore: 'segreto-valore' },
      { tipo: 'CLIENTE', chiaveWasteflow: 'altra', valore: 'x' },
    ])
    await imposta(a, [{ tipo: 'CLIENTE', chiaveWasteflow: 'altra', valore: null }])
    const log = await owner.activityLog.findMany({
      where: { tenantId: a.tenantId, action: 'MAPPATURE_EXPORT_IMPOSTATE' },
      orderBy: { createdAt: 'asc' },
    })
    expect(log).toHaveLength(2)
    expect(log[0].userId).toBe(a.utenteId)
    expect(log[0].metadata).toEqual({ adattatore: 'FINTO', impostate: 2, cancellate: 0 })
    expect(log[1].metadata).toEqual({ adattatore: 'FINTO', impostate: 0, cancellate: 1 })
    expect(JSON.stringify(log)).not.toContain('segreto')
  })

  describe('mancanti', () => {
    it('elenca solo le chiavi dei documenti scelti che non hanno un valore', async () => {
      const a = await azienda()
      await imposta(a, [
        { tipo: 'REGISTRO', chiaveWasteflow: 'A', valore: '01' },
        { tipo: 'CODICE_IVA', chiaveWasteflow: '22.00', valore: '10' },
        // Voce di una chiave che i documenti scelti non usano: non compare ne' come mancante ne' altrove.
        { tipo: 'CODICE_IVA', chiaveWasteflow: '4.00', valore: '99' },
      ])
      const docs = [documento('A', ['22.00', '10.00']), documento('B', ['22.00'])]
      const m = await nel(a.tenantId, () => servizio.mancanti(a.tenantId, 'FINTO', docs))
      expect(m).toEqual([
        { tipo: 'CODICE_IVA', chiaveWasteflow: '10.00', etichetta: 'IVA 10.00%' },
        { tipo: 'REGISTRO', chiaveWasteflow: 'B', etichetta: 'Registro B' },
      ])
      const nessuna = await nel(a.tenantId, () =>
        servizio.mancanti(a.tenantId, 'FINTO', [documento('A', ['22.00'])])
      )
      expect(nessuna).toEqual([])
    })

    it('le mappature di un altro adattatore o di un`altra azienda non contano', async () => {
      const a = await azienda()
      const b = await azienda()
      await imposta(a, [{ tipo: 'REGISTRO', chiaveWasteflow: 'A', valore: '01' }], 'ALTRO')
      await imposta(b, [{ tipo: 'REGISTRO', chiaveWasteflow: 'A', valore: '01' }])
      const m = await nel(a.tenantId, () =>
        servizio.mancanti(a.tenantId, 'FINTO', [documento('A', [])])
      )
      expect(m).toEqual([{ tipo: 'REGISTRO', chiaveWasteflow: 'A', etichetta: 'Registro A' }])
    })

    it('oltre 100 chiavi richieste (forma con JOIN lineare) il risultato non cambia', async () => {
      const a = await azienda()
      const docs = Array.from({ length: 150 }, (_, i) => documento(`R${i}`, []))
      await imposta(
        a,
        docs.slice(0, 120).map(d => ({
          tipo: 'REGISTRO' as const,
          chiaveWasteflow: d.registroCodice,
          valore: 'v',
        }))
      )
      const m = await nel(a.tenantId, () => servizio.mancanti(a.tenantId, 'FINTO', docs))
      expect(m.map(x => x.chiaveWasteflow).sort()).toEqual(
        docs
          .slice(120)
          .map(d => d.registroCodice)
          .sort()
      )
    })
  })
})
