/**
 * App campo P6, T0: schema di `ricevute_ritiro` e `invii_ricevuta_ritiro` contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS ENABLE+FORCE). Append-only, idempotenza, isolamento, CHECK.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
import {
  creaAziendaCampo,
  creaRitiroCampo,
  type AziendaCampo,
} from '../../test-support/campo-di-test'

const HASH = 'a'.repeat(64)

describe('ricevute_ritiro — schema, Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const creati: string[] = []

  const azienda = async (): Promise<AziendaCampo> => {
    const a = await creaAziendaCampo(owner)
    creati.push(a.t)
    return a
  }
  const nelTenant = <R>(t: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  /** INSERT diretto (colonne minime, override per i CHECK) col client indicato. */
  const sqlInserisci = (
    a: AziendaCampo,
    ritiroId: string,
    extra: {
      uuid?: string
      nome?: string
      firma?: string
      pdf?: string
      hashFirma?: string
      dati?: string
      autista?: string
      utente?: string
    } = {}
  ) =>
    `INSERT INTO ricevute_ritiro (tenant_id, ricevuta_uuid, ritiro_id, autista_id, utente_id,
       firmatario_nome, firmato_il, dati, firma_png, firma_sha256, contenuto_sha256, pdf, pdf_sha256)
     VALUES ('${a.t}', '${extra.uuid ?? crypto.randomUUID()}', '${ritiroId}',
       '${extra.autista ?? a.autista1}', '${extra.utente ?? a.utente1}',
       '${extra.nome ?? 'Mario Rossi'}', now(), '${extra.dati ?? '{}'}'::jsonb,
       ${extra.firma ?? "'\\x89504e47'::bytea"}, '${extra.hashFirma ?? HASH}', '${HASH}',
       ${extra.pdf ?? "'\\x255044462d'::bytea"}, '${HASH}')
     RETURNING id`
  const inserisci = async (a: AziendaCampo, ritiroId: string, extra = {}) => {
    const r = await nelTenant(a.t, () =>
      app.$queryRawUnsafe<{ id: string }[]>(sqlInserisci(a, ritiroId, extra))
    )
    return r[0].id
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    for (const t of creati) {
      try {
        await cancellaAziendeDiProva(owner, t)
      } catch (e) {
        console.error(`pulizia ricevute_ritiro: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it.each(['ricevute_ritiro', 'invii_ricevuta_ritiro'])(
    '%s: RLS ENABLE+FORCE con isolamento_azienda e sola_lettura',
    async tabella => {
      const [t] = await owner.$queryRawUnsafe<{ rls: boolean; forzata: boolean }[]>(
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class
         WHERE relname = '${tabella}' AND relnamespace = 'public'::regnamespace`
      )
      expect(t).toEqual({ rls: true, forzata: true })
      const policy = await owner.$queryRawUnsafe<{ policyname: string }[]>(
        `SELECT policyname FROM pg_policies WHERE tablename = '${tabella}' ORDER BY policyname`
      )
      expect(policy.map(p => p.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
    }
  )

  it('append-only: UPDATE, DELETE e TRUNCATE rifiutati al ruolo applicativo E al proprietario, su entrambe le tabelle', async () => {
    const a = await azienda()
    const r = await creaRitiroCampo(owner, a, a.autista1)
    const id = await inserisci(a, r)
    await nelTenant(a.t, () =>
      app.$executeRawUnsafe(
        `INSERT INTO invii_ricevuta_ritiro (tenant_id, ricevuta_id, esito, destinatario_mascherato)
         VALUES ('${a.t}', '${id}', 'INVIATO', 'm***@ditta.it')`
      )
    )
    for (const tabella of ['ricevute_ritiro', 'invii_ricevuta_ritiro']) {
      const colonna = tabella === 'ricevute_ritiro' ? 'firmatario_nome' : 'esito'
      for (const sql of [
        `UPDATE ${tabella} SET ${colonna} = 'X'`,
        `DELETE FROM ${tabella}`,
        `TRUNCATE ${tabella}`,
      ]) {
        await expect(nelTenant(a.t, () => app.$executeRawUnsafe(sql))).rejects.toThrow(
          /permission denied/i
        )
      }
      await expect(owner.$executeRawUnsafe(`UPDATE ${tabella} SET ${colonna} = 'X'`)).rejects.toThrow(
        /immutabile/
      )
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM ${tabella} WHERE tenant_id = '${a.t}'`)
      ).rejects.toThrow(/non si cancellano/)
      await expect(owner.$executeRawUnsafe(`TRUNCATE ${tabella}`)).rejects.toThrow(
        /non si svuota|violates foreign key|cannot truncate/
      )
    }
  })

  it('unico (azienda, ricevuta_uuid): lo stesso uuid due volte e una violazione; in un’altra azienda e ammesso', async () => {
    const a = await azienda()
    const b = await azienda()
    const ra = await creaRitiroCampo(owner, a, a.autista1)
    const rb = await creaRitiroCampo(owner, b, b.autista1)
    const uuid = crypto.randomUUID()
    await inserisci(a, ra, { uuid })
    await expect(inserisci(a, ra, { uuid })).rejects.toThrow(/23505/)
    await inserisci(b, rb, { uuid })
  })

  it('un altro tenant non vede le ricevute e non puo inserirne per l’azienda altrui', async () => {
    const a = await azienda()
    const b = await azienda()
    const ra = await creaRitiroCampo(owner, a, a.autista1)
    await inserisci(a, ra)
    const visti = await nelTenant(b.t, () =>
      app.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ricevute_ritiro`)
    )
    expect(visti[0].n).toBe(0)
    await expect(
      nelTenant(b.t, () => app.$queryRawUnsafe(sqlInserisci(a, ra)))
    ).rejects.toThrow()
  })

  it('chiavi composte: ritiro, autista e utente devono essere della stessa azienda', async () => {
    const a = await azienda()
    const b = await azienda()
    const ra = await creaRitiroCampo(owner, a, a.autista1)
    const rb = await creaRitiroCampo(owner, b, b.autista1)
    await expect(owner.$queryRawUnsafe(sqlInserisci(a, ra, { autista: b.autista1 }))).rejects.toThrow(
      /ricevute_ritiro_autista_fkey/
    )
    await expect(owner.$queryRawUnsafe(sqlInserisci(a, ra, { utente: b.utente1 }))).rejects.toThrow(
      /ricevute_ritiro_utente_fkey/
    )
    await expect(owner.$queryRawUnsafe(sqlInserisci(a, rb))).rejects.toThrow(
      /ricevute_ritiro_ritiro_fkey/
    )
  })

  it('CHECK: nome, dimensioni di firma e PDF, formato delle impronte, dati oggetto', async () => {
    const a = await azienda()
    const r = await creaRitiroCampo(owner, a, a.autista1)
    const prova = (extra: Parameters<typeof sqlInserisci>[2]) =>
      owner.$queryRawUnsafe(sqlInserisci(a, r, extra))
    await expect(prova({ nome: 'A' })).rejects.toThrow(/ricevute_ritiro_nome_non_vuoto/)
    await expect(prova({ nome: '   ' })).rejects.toThrow(/ricevute_ritiro_nome_non_vuoto/)
    await expect(prova({ firma: "''::bytea" })).rejects.toThrow(/ricevute_ritiro_firma_dimensione/)
    await expect(prova({ firma: "decode(repeat('00', 131073), 'hex')" })).rejects.toThrow(
      /ricevute_ritiro_firma_dimensione/
    )
    await expect(prova({ pdf: "decode(repeat('00', 1048577), 'hex')" })).rejects.toThrow(
      /ricevute_ritiro_pdf_dimensione/
    )
    await expect(prova({ hashFirma: 'ABC' })).rejects.toThrow(/ricevute_ritiro_firma_sha256_formato/)
    await expect(prova({ dati: '[]' })).rejects.toThrow(/ricevute_ritiro_dati_oggetto/)
    await prova({})
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO invii_ricevuta_ritiro (tenant_id, ricevuta_id, esito, destinatario_mascherato)
         SELECT tenant_id, id, 'BOH', 'x' FROM ricevute_ritiro WHERE tenant_id = '${a.t}' LIMIT 1`
      )
    ).rejects.toThrow(/invii_ricevuta_ritiro_esito_ammesso/)
  })

  it('un solo invio per ricevuta', async () => {
    const a = await azienda()
    const r = await creaRitiroCampo(owner, a, a.autista1)
    const id = await inserisci(a, r)
    const invio = () =>
      owner.$executeRawUnsafe(
        `INSERT INTO invii_ricevuta_ritiro (tenant_id, ricevuta_id, esito, destinatario_mascherato)
         VALUES ('${a.t}', '${id}', 'INVIATO', 'm***@ditta.it')`
      )
    await invio()
    await expect(invio()).rejects.toThrow(/23505/)
  })
})
