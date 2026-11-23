/**
 * App campo P4, T0: schema di `eventi_campo` contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE). Append-only, idempotenza, isolamento fra aziende.
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

describe('eventi_campo — schema, Postgres reale, ruolo wasteflow_app', () => {
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

  /** INSERT diretto di un evento (colonne minime) col client applicativo, nel contesto dell'azienda. */
  async function inserisci(
    a: AziendaCampo,
    ritiroId: string,
    extra: { uuid?: string; esito?: 'APPLICATO' | 'DA_RICONCILIARE'; motivo?: string | null } = {}
  ) {
    const esito = extra.esito ?? 'APPLICATO'
    const motivo = extra.motivo === undefined ? null : extra.motivo
    return nelTenant(a.t, () =>
      app.$executeRawUnsafe(
        `INSERT INTO eventi_campo (tenant_id, evento_uuid, ritiro_id, autista_id, utente_id, tipo,
           versione_vista, rilevato_il, esito, motivo_conflitto)
         VALUES ('${a.t}', '${extra.uuid ?? crypto.randomUUID()}', '${ritiroId}', '${a.autista1}',
           '${a.utente1}', 'RITIRO_ESEGUITO', 1, now(), '${esito}'::esito_evento_campo,
           ${motivo === null ? 'NULL' : `'${motivo}'`})`
      )
    )
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
        console.error(`pulizia eventi_campo: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('RLS ENABLE+FORCE con isolamento_azienda e sola_lettura', async () => {
    const [t] = await owner.$queryRawUnsafe<{ rls: boolean; forzata: boolean }[]>(
      `SELECT relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class
       WHERE relname = 'eventi_campo' AND relnamespace = 'public'::regnamespace`
    )
    expect(t).toEqual({ rls: true, forzata: true })
    const policy = await owner.$queryRawUnsafe<{ policyname: string }[]>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'eventi_campo' ORDER BY policyname`
    )
    expect(policy.map(p => p.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
  })

  it('append-only: UPDATE, DELETE e TRUNCATE rifiutati al ruolo applicativo E al proprietario', async () => {
    const a = await azienda()
    const r = await creaRitiroCampo(owner, a, a.autista1)
    await inserisci(a, r)
    // Ruolo applicativo: niente privilegio.
    for (const sql of [
      `UPDATE eventi_campo SET tipo = 'RITIRO_NON_ESEGUITO'`,
      `DELETE FROM eventi_campo`,
      `TRUNCATE eventi_campo`,
    ]) {
      await expect(nelTenant(a.t, () => app.$executeRawUnsafe(sql))).rejects.toThrow(
        /permission denied/i
      )
    }
    // Proprietario: lo bloccano i trigger.
    await expect(
      owner.$executeRawUnsafe(`UPDATE eventi_campo SET tipo = 'RITIRO_NON_ESEGUITO'`)
    ).rejects.toThrow(/immutabile/)
    await expect(
      owner.$executeRawUnsafe(`DELETE FROM eventi_campo WHERE tenant_id = '${a.t}'`)
    ).rejects.toThrow(/non si cancellano/)
    // Dal P5 `allegati_campo` referenzia `eventi_campo`: Postgres rifiuta il TRUNCATE ancora prima
    // del trigger (e' comunque un rifiuto).
    await expect(owner.$executeRawUnsafe(`TRUNCATE eventi_campo`)).rejects.toThrow(
      /non si svuota|cannot truncate a table referenced/
    )
  })

  it('unico (azienda, evento_uuid): lo stesso uuid due volte e una violazione; in un’altra azienda e ammesso', async () => {
    const a = await azienda()
    const b = await azienda()
    const ra = await creaRitiroCampo(owner, a, a.autista1)
    const rb = await creaRitiroCampo(owner, b, b.autista1)
    const uuid = crypto.randomUUID()
    await inserisci(a, ra, { uuid })
    await expect(inserisci(a, ra, { uuid })).rejects.toThrow(/23505/)
    await inserisci(b, rb, { uuid })
  })

  it('un altro tenant non vede gli eventi e non puo inserirne per l’azienda altrui', async () => {
    const a = await azienda()
    const b = await azienda()
    const ra = await creaRitiroCampo(owner, a, a.autista1)
    await inserisci(a, ra)
    const visti = await nelTenant(b.t, () =>
      app.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM eventi_campo`)
    )
    expect(visti[0].n).toBe(0)
    // WITH CHECK: contesto di B, riga di A.
    await expect(
      nelTenant(b.t, () =>
        app.$executeRawUnsafe(
          `INSERT INTO eventi_campo (tenant_id, evento_uuid, ritiro_id, autista_id, utente_id, tipo,
             versione_vista, rilevato_il, esito)
           VALUES ('${a.t}', '${crypto.randomUUID()}', '${ra}', '${a.autista1}', '${a.utente1}',
             'RITIRO_ESEGUITO', 1, now(), 'APPLICATO')`
        )
      )
    ).rejects.toThrow()
  })

  it('chiavi composte: ritiro, autista e utente devono essere della stessa azienda', async () => {
    const a = await azienda()
    const b = await azienda()
    const ra = await creaRitiroCampo(owner, a, a.autista1)
    const base = (ritiro: string, autista: string, utente: string) =>
      owner.$executeRawUnsafe(
        `INSERT INTO eventi_campo (tenant_id, evento_uuid, ritiro_id, autista_id, utente_id, tipo,
           versione_vista, rilevato_il, esito)
         VALUES ('${a.t}', '${crypto.randomUUID()}', '${ritiro}', '${autista}', '${utente}',
           'RITIRO_ESEGUITO', 1, now(), 'APPLICATO')`
      )
    await expect(base(ra, b.autista1, a.utente1)).rejects.toThrow(/eventi_campo_autista_fkey/)
    await expect(base(ra, a.autista1, b.utente1)).rejects.toThrow(/eventi_campo_utente_fkey/)
    const rb = await creaRitiroCampo(owner, b, b.autista1)
    await expect(base(rb, a.autista1, a.utente1)).rejects.toThrow(/eventi_campo_ritiro_fkey/)
  })

  it('CHECK: esito e motivo coerenti, tipo ammesso, dati oggetto di dimensione limitata', async () => {
    const a = await azienda()
    const r = await creaRitiroCampo(owner, a, a.autista1)
    // DA_RICONCILIARE senza motivo, APPLICATO con motivo.
    await expect(inserisci(a, r, { esito: 'DA_RICONCILIARE', motivo: null })).rejects.toThrow(
      /eventi_campo_conflitto_coerente/
    )
    await expect(inserisci(a, r, { esito: 'APPLICATO', motivo: 'X' })).rejects.toThrow(
      /eventi_campo_conflitto_coerente/
    )
    await inserisci(a, r, { esito: 'DA_RICONCILIARE', motivo: 'RITIRO_ANNULLATO' })
    const ins = (tipo: string, dati: string) =>
      owner.$executeRawUnsafe(
        `INSERT INTO eventi_campo (tenant_id, evento_uuid, ritiro_id, autista_id, utente_id, tipo, dati,
           versione_vista, rilevato_il, esito)
         VALUES ('${a.t}', '${crypto.randomUUID()}', '${r}', '${a.autista1}', '${a.utente1}',
           '${tipo}', '${dati}'::jsonb, 1, now(), 'APPLICATO')`
      )
    await expect(ins('ALTRO', '{}')).rejects.toThrow(/eventi_campo_tipo_ammesso/)
    await expect(ins('RITIRO_ESEGUITO', '[]')).rejects.toThrow(/eventi_campo_dati_oggetto/)
    await expect(ins('RITIRO_ESEGUITO', JSON.stringify({ n: 'x'.repeat(3000) }))).rejects.toThrow(
      /eventi_campo_dati_oggetto/
    )
  })
})
