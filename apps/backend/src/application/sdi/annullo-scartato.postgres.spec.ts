/**
 * Annullo di un documento scartato dallo SDI (4.5d, T1) contro un Postgres reale.
 *
 * Il trigger `documenti_fattura_immutabile` ammette DEFINITIVO -> ANNULLATO su un emesso solo con una
 * trasmissione SCARTATA e nessuna viva; `trasmissioni_sdi_documento_non_annullato` impedisce di inviare
 * un documento annullato e serializza la gara annullo / nuovo invio con il lock della riga del documento.
 */
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { creaContrattoConElenco } from '../../test-support/listino-di-test'
import {
  creaDocumentoMinimoPerLegame,
  pulisciTenantDiTest,
} from '../../test-support/legami-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const attendi = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const ANNULLO = `stato = 'ANNULLATO', motivo_annullo = 'Scarto SDI', annullato_il = now(),
  annullato_da = gen_random_uuid(), versione = versione + 1, updated_at = now()`

describe('SDI 4.5d: annullo di un emesso scartato (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []

  type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe' | '$queryRaw'>
  interface Scenario {
    t: string
    documentoId: string
  }

  /** Documento DEFINITIVO gia' emesso (`emesso_il` valorizzato), con una sola azienda per scenario. */
  async function scenario(): Promise<Scenario> {
    const tenant = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Scarto SRL', country: 'IT' },
    })
    tenantCreati.push(tenant.id)
    const c = await creaContrattoConElenco(owner, tenant.id)
    const documentoId = await creaDocumentoMinimoPerLegame(owner, tenant.id, c)
    await owner.$executeRawUnsafe(
      `UPDATE documenti_fattura SET emesso_il = now() WHERE id = $1::uuid`,
      documentoId
    )
    return { t: tenant.id, documentoId }
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
        return fn(tx)
      },
      { timeout: 15_000 }
    )

  const inserisci = (tx: Tx, s: Scenario, stato = 'DA_INVIARE') =>
    tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO trasmissioni_sdi
         (tenant_id, documento_id, provider, ambiente, nome_file, xml_sha256, stato, id_provider,
          ultimo_errore_codice, updated_at)
       VALUES ($1::uuid, $2::uuid, 'fake', 'SANDBOX', 'IT01234567890_00001.xml', $3,
          $4::stato_trasmissione_sdi, $5, $6, now())
       RETURNING id::text AS id`,
      s.t,
      s.documentoId,
      sha('xml'),
      stato,
      ['DA_INVIARE', 'IN_INVIO', 'INCERTA', 'ERRORE_INVIO'].includes(stato) ? null : 'prov-1',
      stato === 'ERRORE_INVIO' ? 'E1' : null
    )

  /** Una trasmissione portata allo stato finale `stato` (le transizioni intermedie le fa il proprietario). */
  async function trasmissione(s: Scenario, stato: string): Promise<string> {
    const [t] = await comeApp(s.t, tx => inserisci(tx, s))
    if (stato === 'DA_INVIARE') return t.id
    if (stato === 'ERRORE_INVIO') {
      await owner.$executeRawUnsafe(
        `UPDATE trasmissioni_sdi SET stato = 'IN_INVIO', updated_at = now() WHERE id = $1::uuid`,
        t.id
      )
      await owner.$executeRawUnsafe(
        `UPDATE trasmissioni_sdi SET stato = 'ERRORE_INVIO', ultimo_errore_codice = 'E1',
           updated_at = now() WHERE id = $1::uuid`,
        t.id
      )
      return t.id
    }
    for (const passo of ['IN_INVIO', 'INVIATA', ...(stato === 'INVIATA' ? [] : [stato])]) {
      await owner.$executeRawUnsafe(
        `UPDATE trasmissioni_sdi SET stato = $2::stato_trasmissione_sdi, id_provider = 'prov-1',
           updated_at = now() WHERE id = $1::uuid`,
        t.id,
        passo
      )
    }
    return t.id
  }

  const annulla = (s: Scenario) =>
    comeApp(s.t, tx =>
      tx.$executeRawUnsafe(`UPDATE documenti_fattura SET ${ANNULLO} WHERE id = $1::uuid`, s.documentoId)
    )

  const statoDocumento = async (s: Scenario) =>
    (
      await owner.$queryRawUnsafe<{ stato: string }[]>(
        `SELECT stato::text AS stato FROM documenti_fattura WHERE id = $1::uuid`,
        s.documentoId
      )
    )[0].stato

  afterAll(async () => {
    await owner.$executeRawUnsafe(
      `DELETE FROM trasmissioni_sdi WHERE tenant_id = ANY($1::uuid[])`,
      tenantCreati
    )
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('emesso senza alcuna trasmissione: l annullo resta respinto (come prima)', async () => {
    const s = await scenario()
    await expect(annulla(s)).rejects.toThrow(/un documento emesso non si annulla/)
    expect(await statoDocumento(s)).toBe('DEFINITIVO')
  })

  it.each(['DA_INVIARE', 'INVIATA', 'CONSEGNATA', 'ACCETTATA'])(
    'emesso con una trasmissione %s (non scartata): respinto',
    async stato => {
      const s = await scenario()
      await trasmissione(s, stato)
      await expect(annulla(s)).rejects.toThrow(/un documento emesso non si annulla/)
    }
  )

  it('emesso con solo ERRORE_INVIO (mai scartato): respinto', async () => {
    const s = await scenario()
    await trasmissione(s, 'ERRORE_INVIO')
    await expect(annulla(s)).rejects.toThrow(/un documento emesso non si annulla/)
  })

  it('emesso scartato dallo SDI senza trasmissioni vive: ammesso, e i dati di emissione restano', async () => {
    const s = await scenario()
    await trasmissione(s, 'SCARTATA')
    await annulla(s)
    expect(await statoDocumento(s)).toBe('ANNULLATO')
    const [d] = await owner.$queryRawUnsafe<{ emesso: boolean }[]>(
      `SELECT (emesso_il IS NOT NULL) AS emesso FROM documenti_fattura WHERE id = $1::uuid`,
      s.documentoId
    )
    expect(d.emesso).toBe(true)
  })

  it('scartato ma con una nuova trasmissione viva: respinto', async () => {
    const s = await scenario()
    await trasmissione(s, 'SCARTATA')
    await trasmissione(s, 'DA_INVIARE')
    await expect(annulla(s)).rejects.toThrow(/un documento emesso non si annulla/)
    expect(await statoDocumento(s)).toBe('DEFINITIVO')
  })

  it('scartato, poi nuovo invio finito in ERRORE_INVIO (non viva): ammesso', async () => {
    const s = await scenario()
    await trasmissione(s, 'SCARTATA')
    await trasmissione(s, 'ERRORE_INVIO')
    await annulla(s)
    expect(await statoDocumento(s)).toBe('ANNULLATO')
  })

  it('l annullo di uno scartato non puo scrivere i dati di emissione ne altre colonne', async () => {
    const s = await scenario()
    await trasmissione(s, 'SCARTATA')
    await expect(
      comeApp(s.t, tx =>
        tx.$executeRawUnsafe(
          `UPDATE documenti_fattura SET ${ANNULLO}, emesso_il = now() + interval '1 day' WHERE id = $1::uuid`,
          s.documentoId
        )
      )
    ).rejects.toThrow(/emesso_il gia' scritto|l'annullo non scrive i dati di emissione/)
    await expect(
      comeApp(s.t, tx =>
        tx.$executeRawUnsafe(
          `UPDATE documenti_fattura SET ${ANNULLO}, totale_documento = 5 WHERE id = $1::uuid`,
          s.documentoId
        )
      )
    ).rejects.toThrow(/documento non in bozza immutabile/)
  })

  it('un documento annullato non si invia allo SDI', async () => {
    const s = await scenario()
    await trasmissione(s, 'SCARTATA')
    await annulla(s)
    await expect(comeApp(s.t, tx => inserisci(tx, s))).rejects.toThrow(
      /un documento annullato non si invia allo SDI/
    )
  })

  describe('gara annullo contro nuovo invio: ne vince uno solo', () => {
    it('l annullo scrive per primo: l invio, che aspettava il lock, fallisce', async () => {
      const s = await scenario()
      await trasmissione(s, 'SCARTATA')
      let rilascia!: () => void
      const tieni = new Promise<void>(r => (rilascia = r))
      const annullo = comeApp(s.t, async tx => {
        await tx.$executeRawUnsafe(
          `UPDATE documenti_fattura SET ${ANNULLO} WHERE id = $1::uuid`,
          s.documentoId
        )
        await tieni
      })
      await attendi(300)
      const invio = comeApp(s.t, tx => inserisci(tx, s))
      const esitoInvio = invio.then(
        () => 'ok',
        (e: Error) => e.message
      )
      await attendi(500)
      rilascia()
      await annullo
      expect(await esitoInvio).toMatch(/un documento annullato non si invia allo SDI/)
      expect(await statoDocumento(s)).toBe('ANNULLATO')
      const [{ n }] = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM trasmissioni_sdi WHERE documento_id = $1::uuid
          AND stato NOT IN ('ERRORE_INVIO', 'SCARTATA')`,
        s.documentoId
      )
      expect(n).toBe(0)
    })

    it('l invio scrive per primo: l annullo, che aspettava il lock, viene respinto', async () => {
      const s = await scenario()
      await trasmissione(s, 'SCARTATA')
      let rilascia!: () => void
      const tieni = new Promise<void>(r => (rilascia = r))
      const invio = comeApp(s.t, async tx => {
        await inserisci(tx, s)
        await tieni
      })
      await attendi(300)
      const annullo = annulla(s)
      const esitoAnnullo = annullo.then(
        () => 'ok',
        (e: Error) => e.message
      )
      await attendi(500)
      rilascia()
      await invio
      expect(await esitoAnnullo).toMatch(/un documento emesso non si annulla/)
      expect(await statoDocumento(s)).toBe('DEFINITIVO')
      const [{ n }] = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM trasmissioni_sdi WHERE documento_id = $1::uuid
          AND stato NOT IN ('ERRORE_INVIO', 'SCARTATA')`,
        s.documentoId
      )
      expect(n).toBe(1)
    })
  })
})
