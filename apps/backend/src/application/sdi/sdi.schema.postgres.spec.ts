/**
 * Schema SDI (4.5a, T2) contro un Postgres reale: `configurazioni_sdi`, `trasmissioni_sdi`,
 * `notifiche_sdi`, `eventi_sdi_ricevuti`.
 *
 * Le scritture di prova si fanno col ruolo applicativo `wasteflow_app` dentro il contesto
 * dell'azienda (RLS e privilegi); il proprietario prepara i dati e legge lo stato finale.
 */
import { createHash, randomUUID } from 'node:crypto'
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

const QUATTRO_TABELLE = [
  'configurazioni_sdi',
  'trasmissioni_sdi',
  'notifiche_sdi',
  'eventi_sdi_ricevuti',
]

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('SDI: schema (Postgres reale, ruolo wasteflow_app)', () => {
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

  async function scenario(): Promise<Scenario> {
    const tenant = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Sdi SRL', country: 'IT' },
    })
    tenantCreati.push(tenant.id)
    const c = await creaContrattoConElenco(owner, tenant.id)
    const documentoId = await creaDocumentoMinimoPerLegame(owner, tenant.id, c)
    return { t: tenant.id, documentoId }
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  function inserisciConfigurazione(
    tx: Tx,
    t: string,
    over: { invioAttivo?: boolean; verificata?: boolean; token?: string; provider?: string } = {}
  ) {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO configurazioni_sdi
         (tenant_id, provider, webhook_token_sha256, invio_attivo, verificata_il, updated_at)
       VALUES ($1::uuid, $2, $3, $4::boolean, $5::timestamp, now())
       RETURNING id::text AS id`,
      t,
      over.provider ?? 'fake',
      over.token ?? sha(randomUUID()),
      over.invioAttivo ?? false,
      over.verificata ? new Date().toISOString() : null
    )
  }

  function inserisciTrasmissione(
    tx: Tx,
    s: Scenario,
    over: {
      stato?: string
      idProvider?: string | null
      errore?: string | null
      documentoId?: string
    } = {}
  ) {
    const stato = over.stato ?? 'DA_INVIARE'
    const dopoInvio = !['DA_INVIARE', 'IN_INVIO', 'INCERTA', 'ERRORE_INVIO'].includes(stato)
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO trasmissioni_sdi
         (tenant_id, documento_id, provider, ambiente, nome_file, xml_sha256, stato, id_provider,
          ultimo_errore_codice, updated_at)
       VALUES ($1::uuid, $2::uuid, 'fake', 'SANDBOX', 'IT01234567890_00001.xml', $3,
          $4::stato_trasmissione_sdi, $5, $6, now())
       RETURNING id::text AS id`,
      s.t,
      over.documentoId ?? s.documentoId,
      sha('xml'),
      stato,
      over.idProvider === undefined ? (dopoInvio ? 'prov-1' : null) : over.idProvider,
      over.errore === undefined ? (stato === 'ERRORE_INVIO' ? 'E1' : null) : over.errore
    )
  }

  /** Porta una trasmissione al `stato` indicato con il proprietario (le transizioni sono provate a parte). */
  const imposta = (id: string, stato: string, idProvider = 'prov-1') =>
    owner.$executeRawUnsafe(
      `UPDATE trasmissioni_sdi SET stato = $2::stato_trasmissione_sdi, id_provider = $3, updated_at = now()
       WHERE id = $1::uuid`,
      id,
      stato,
      idProvider
    )

  const trasmissioneViva = async (s: Scenario, stato = 'DA_INVIARE') =>
    (await comeApp(s.t, tx => inserisciTrasmissione(tx, s, { stato })))[0].id

  function inserisciNotifica(tx: Tx, s: Scenario, trasmissioneId: string, chiave: string) {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO notifiche_sdi (tenant_id, trasmissione_id, tipo, fonte, chiave_dedup)
       VALUES ($1::uuid, $2::uuid, 'RC', 'WEBHOOK', $3) RETURNING id::text AS id`,
      s.t,
      trasmissioneId,
      chiave
    )
  }

  afterAll(async () => {
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
  })

  describe('RLS', () => {
    it('le quattro tabelle hanno RLS, FORCE e le due policy standard', async () => {
      const righe = await owner.$queryRawUnsafe<
        { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
      >(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relname = ANY($1::text[]) AND relkind = 'r' ORDER BY relname`,
        QUATTRO_TABELLE
      )
      expect(righe).toHaveLength(4)
      for (const r of righe) {
        expect(r.relrowsecurity).toBe(true)
        expect(r.relforcerowsecurity).toBe(true)
      }
      const policy = await owner.$queryRawUnsafe<{ tablename: string; policyname: string }[]>(
        `SELECT tablename, policyname FROM pg_policies WHERE tablename = ANY($1::text[])
         ORDER BY tablename, policyname`,
        QUATTRO_TABELLE
      )
      expect(policy.map(p => `${p.tablename}:${p.policyname}`)).toEqual(
        [...QUATTRO_TABELLE].sort().flatMap(t => [`${t}:isolamento_azienda`, `${t}:sola_lettura`])
      )
    })

    it('senza azienda e con un altra azienda: 0 righe, e scrivere per un altra azienda fallisce', async () => {
      const a = await scenario()
      const b = await scenario()
      await comeApp(a.t, async tx => {
        await inserisciConfigurazione(tx, a.t)
        const [tr] = await inserisciTrasmissione(tx, a)
        await inserisciNotifica(tx, a, tr.id, 'k1')
        await tx.$executeRawUnsafe(
          `INSERT INTO eventi_sdi_ricevuti (tenant_id, provider, id_evento_provider, corpo)
           VALUES ($1::uuid, 'fake', 'ev-1', '{}'::jsonb)`,
          a.t
        )
      })
      for (const tabella of QUATTRO_TABELLE) {
        const conteggio = (tenant: string | null) =>
          app.$transaction(async tx => {
            if (tenant) await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenant}, true)`
            const [r] = await tx.$queryRawUnsafe<{ n: number }[]>(
              `SELECT count(*)::int AS n FROM ${tabella} WHERE tenant_id = $1::uuid`,
              a.t
            )
            return r.n
          })
        expect({ tabella, n: await conteggio(null) }).toEqual({ tabella, n: 0 })
        expect({ tabella, n: await conteggio(b.t) }).toEqual({ tabella, n: 0 })
        expect({ tabella, n: await conteggio(a.t) }).toEqual({ tabella, n: 1 })
      }
      await expect(comeApp(b.t, tx => inserisciConfigurazione(tx, a.t))).rejects.toThrow(
        /row-level security|42501/i
      )
    })
  })

  describe('configurazioni_sdi', () => {
    it('una sola per azienda e token del webhook unico', async () => {
      const a = await scenario()
      const b = await scenario()
      const token = sha('token-condiviso')
      await comeApp(a.t, tx => inserisciConfigurazione(tx, a.t, { token }))
      await expect(comeApp(a.t, tx => inserisciConfigurazione(tx, a.t))).rejects.toThrow(/`23505`/)
      await expect(comeApp(b.t, tx => inserisciConfigurazione(tx, b.t, { token }))).rejects.toThrow(
        /`23505`/
      )
    })

    it('invio_attivo parte spento e non si accende senza una verifica riuscita', async () => {
      const a = await scenario()
      const [riga] = await comeApp(a.t, tx => inserisciConfigurazione(tx, a.t))
      const [letta] = await owner.$queryRawUnsafe<{ invio_attivo: boolean; onboarding: unknown }[]>(
        `SELECT invio_attivo, onboarding FROM configurazioni_sdi WHERE id = $1::uuid`,
        riga.id
      )
      expect(letta.invio_attivo).toBe(false)
      expect(letta.onboarding).toEqual({})
      await expect(
        comeApp(a.t, tx =>
          tx.$executeRawUnsafe(
            `UPDATE configurazioni_sdi SET invio_attivo = true WHERE id = $1::uuid`,
            riga.id
          )
        )
      ).rejects.toThrow(/`23514`/)
      await comeApp(a.t, tx =>
        tx.$executeRawUnsafe(
          `UPDATE configurazioni_sdi SET verificata_il = now(), invio_attivo = true WHERE id = $1::uuid`,
          riga.id
        )
      )
    })

    it('provider e ambiente fuori dall insieme chiuso sono respinti', async () => {
      const a = await scenario()
      await expect(
        comeApp(a.t, tx => inserisciConfigurazione(tx, a.t, { provider: 'altro' }))
      ).rejects.toThrow(/`23514`/)
      const b = await scenario()
      await expect(
        comeApp(b.t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO configurazioni_sdi (tenant_id, provider, ambiente, webhook_token_sha256, updated_at)
             VALUES ($1::uuid, 'fake', 'COLLAUDO', $2, now())`,
            b.t,
            sha(randomUUID())
          )
        )
      ).rejects.toThrow(/`23514`/)
    })
  })

  describe('trasmissioni_sdi', () => {
    it('una seconda trasmissione viva dello stesso documento fallisce (23505)', async () => {
      const s = await scenario()
      await trasmissioneViva(s)
      await expect(trasmissioneViva(s)).rejects.toThrow(/`23505`/)
    })

    it('una SCARTATA o una ERRORE_INVIO non contano come vive: ne e ammessa un altra', async () => {
      const s = await scenario()
      const prima = await trasmissioneViva(s, 'IN_INVIO')
      await imposta(prima, 'INVIATA')
      await imposta(prima, 'SCARTATA')
      const seconda = await trasmissioneViva(s)
      expect(seconda).not.toBe(prima)
      // ... e a sua volta e l unica viva.
      await expect(trasmissioneViva(s)).rejects.toThrow(/`23505`/)
      const s2 = await scenario()
      const e = await trasmissioneViva(s2, 'IN_INVIO')
      await owner.$executeRawUnsafe(
        `UPDATE trasmissioni_sdi SET stato = 'ERRORE_INVIO', ultimo_errore_codice = 'E1' WHERE id = $1::uuid`,
        e
      )
      await trasmissioneViva(s2)
    })

    it('INVIATA e gli stati successivi esigono id_provider; ERRORE_INVIO esige il codice', async () => {
      const s = await scenario()
      await expect(
        comeApp(s.t, tx => inserisciTrasmissione(tx, s, { stato: 'INVIATA', idProvider: null }))
      ).rejects.toThrow(/`23514`/)
      await expect(
        comeApp(s.t, tx => inserisciTrasmissione(tx, s, { stato: 'ERRORE_INVIO', errore: null }))
      ).rejects.toThrow(/`23514`/)
    })

    it('transizioni: fuori macchina respinte, dentro ammesse', async () => {
      const s = await scenario()
      const id = await trasmissioneViva(s)
      const vai = (stato: string, idProvider?: string) =>
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(
            `UPDATE trasmissioni_sdi SET stato = $2::stato_trasmissione_sdi,
               id_provider = COALESCE($3, id_provider), updated_at = now() WHERE id = $1::uuid`,
            id,
            stato,
            idProvider ?? null
          )
        )
      // DA_INVIARE non salta a INVIATA.
      await expect(vai('INVIATA', 'p')).rejects.toThrow(/transizione SDI non ammessa/)
      await vai('IN_INVIO')
      await vai('INVIATA', 'p')
      await vai('CONSEGNATA')
      // Mai indietro.
      await expect(vai('DA_INVIARE')).rejects.toThrow(/transizione SDI non ammessa/)
      await expect(vai('INVIATA')).rejects.toThrow(/transizione SDI non ammessa/)
      // Fra stati successivi all invio e ammesso (lo stato e calcolato dall insieme delle notifiche).
      await vai('ACCETTATA')
      await vai('SCARTATA')
      // SCARTATA e terminale.
      await expect(vai('CONSEGNATA')).rejects.toThrow(/transizione SDI non ammessa/)
    })

    it('INCERTA si risolve in INVIATA o DA_INVIARE', async () => {
      const s = await scenario()
      const a = await trasmissioneViva(s, 'IN_INVIO')
      await owner.$executeRawUnsafe(
        `UPDATE trasmissioni_sdi SET stato = 'INCERTA' WHERE id = $1::uuid`,
        a
      )
      await owner.$executeRawUnsafe(
        `UPDATE trasmissioni_sdi SET stato = 'DA_INVIARE' WHERE id = $1::uuid`,
        a
      )
    })

    it('nome_file, xml_sha256, documento e provider non cambiano mai', async () => {
      const s = await scenario()
      const id = await trasmissioneViva(s)
      for (const colonna of ['nome_file', 'xml_sha256', 'provider', 'ambiente']) {
        const valore =
          colonna === 'xml_sha256'
            ? sha('altro')
            : colonna === 'ambiente'
              ? 'PRODUZIONE'
              : colonna === 'provider'
                ? 'openapi'
                : 'altro.xml'
        await expect(
          comeApp(s.t, tx =>
            tx.$executeRawUnsafe(
              `UPDATE trasmissioni_sdi SET ${colonna} = $2 WHERE id = $1::uuid`,
              id,
              valore
            )
          )
        ).rejects.toThrow(/non cambia documento|`23514`|integrity|23000/i)
      }
      const altro = await scenario()
      await expect(
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(
            `UPDATE trasmissioni_sdi SET documento_id = $2::uuid WHERE id = $1::uuid`,
            id,
            altro.documentoId
          )
        )
      ).rejects.toThrow()
    })

    it('una trasmissione ERRORE_INVIO non si modifica piu', async () => {
      const s = await scenario()
      const id = await trasmissioneViva(s, 'IN_INVIO')
      await owner.$executeRawUnsafe(
        `UPDATE trasmissioni_sdi SET stato = 'ERRORE_INVIO', ultimo_errore_codice = 'E1' WHERE id = $1::uuid`,
        id
      )
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE trasmissioni_sdi SET tentativi = tentativi + 1 WHERE id = $1::uuid`,
          id
        )
      ).rejects.toThrow(/e' chiusa/)
    })

    it('il documento di un altra azienda non si puo agganciare (FK composta)', async () => {
      const a = await scenario()
      const b = await scenario()
      await expect(
        comeApp(a.t, tx => inserisciTrasmissione(tx, a, { documentoId: b.documentoId }))
      ).rejects.toThrow(/`23503`/)
    })

    it('un documento definitivo con trasmissioni non si elimina', async () => {
      const s = await scenario()
      await trasmissioneViva(s)
      await expect(
        owner.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = DEFAULT`)
          await tx.$executeRawUnsafe(
            `DELETE FROM documenti_fattura WHERE id = $1::uuid`,
            s.documentoId
          )
        })
      ).rejects.toThrow()
    })
  })

  describe('notifiche_sdi (solo inserimento)', () => {
    it('INSERT ammesso; UPDATE, DELETE e TRUNCATE negati al ruolo applicativo (42501)', async () => {
      const s = await scenario()
      const tr = await trasmissioneViva(s)
      const [n] = await comeApp(s.t, tx => inserisciNotifica(tx, s, tr, 'k-rc'))
      for (const sql of [
        `UPDATE notifiche_sdi SET tipo = 'NS' WHERE id = '${n.id}'::uuid`,
        `DELETE FROM notifiche_sdi WHERE id = '${n.id}'::uuid`,
        `TRUNCATE notifiche_sdi`,
      ]) {
        await expect(comeApp(s.t, tx => tx.$executeRawUnsafe(sql))).rejects.toThrow(
          /42501|permission denied/i
        )
      }
    })

    it('la stessa notifica due volte (stessa chiave) e un duplicato; chiavi diverse convivono', async () => {
      const s = await scenario()
      const tr = await trasmissioneViva(s)
      await comeApp(s.t, tx => inserisciNotifica(tx, s, tr, 'k1'))
      await expect(comeApp(s.t, tx => inserisciNotifica(tx, s, tr, 'k1'))).rejects.toThrow(
        /`23505`/
      )
      await comeApp(s.t, tx => inserisciNotifica(tx, s, tr, 'k2'))
    })

    it('esito del committente solo per NE; file e sha insieme; tipo nell insieme chiuso', async () => {
      const s = await scenario()
      const tr = await trasmissioneViva(s)
      const prova = (campi: string, valori: string) =>
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO notifiche_sdi (tenant_id, trasmissione_id, fonte, chiave_dedup, ${campi})
             VALUES ($1::uuid, $2::uuid, 'POLLING', $3, ${valori})`,
            s.t,
            tr,
            randomUUID()
          )
        )
      await expect(prova('tipo, esito_committente', `'RC', 'EC01'`)).rejects.toThrow(/`23514`/)
      await prova('tipo, esito_committente', `'NE', 'EC01'`)
      await expect(prova('tipo, esito_committente', `'NE', 'EC09'`)).rejects.toThrow(/`23514`/)
      await expect(prova('tipo, file', `'RC', '\\x01'::bytea`)).rejects.toThrow(/`23514`/)
      await expect(prova('tipo', `'XX'`)).rejects.toThrow(/`23514`/)
    })

    it('una notifica non si aggancia a una trasmissione di un altra azienda (FK composta)', async () => {
      const a = await scenario()
      const b = await scenario()
      const trB = await trasmissioneViva(b)
      await expect(comeApp(a.t, tx => inserisciNotifica(tx, a, trB, 'k'))).rejects.toThrow(
        /`23503`|row-level security|42501/
      )
    })
  })

  describe('eventi_sdi_ricevuti (inbox)', () => {
    const evento = (tx: Tx, t: string, id: string) =>
      tx.$executeRawUnsafe(
        `INSERT INTO eventi_sdi_ricevuti (tenant_id, provider, id_evento_provider, corpo)
         VALUES ($1::uuid, 'fake', $2, '{"a":1}'::jsonb)`,
        t,
        id
      )

    it('lo stesso evento due volte e un unico inserimento (23505)', async () => {
      const s = await scenario()
      await comeApp(s.t, tx => evento(tx, s.t, 'ev-1'))
      await expect(comeApp(s.t, tx => evento(tx, s.t, 'ev-1'))).rejects.toThrow(/`23505`/)
      await comeApp(s.t, tx => evento(tx, s.t, 'ev-2'))
    })

    it('dopo l inserimento cambiano solo elaborato_il ed esito_elaborazione', async () => {
      const s = await scenario()
      await comeApp(s.t, tx => evento(tx, s.t, 'ev-3'))
      await comeApp(s.t, tx =>
        tx.$executeRawUnsafe(
          `UPDATE eventi_sdi_ricevuti SET elaborato_il = now(), esito_elaborazione = 'OK'
           WHERE tenant_id = $1::uuid AND id_evento_provider = 'ev-3'`,
          s.t
        )
      )
      await expect(
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(
            `UPDATE eventi_sdi_ricevuti SET corpo = '{}'::jsonb
             WHERE tenant_id = $1::uuid AND id_evento_provider = 'ev-3'`,
            s.t
          )
        )
      ).rejects.toThrow(/dato grezzo/)
    })
  })

  describe('testata del documento', () => {
    it('nessuna colonna nuova su documenti_fattura (il trigger di immutabilita la renderebbe fissa)', async () => {
      const colonne = await owner.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'documenti_fattura' ORDER BY column_name`
      )
      expect(colonne.map(c => c.column_name)).toEqual(
        [
          'id',
          'tenant_id',
          'elaborazione_id',
          'stato',
          'emesso_il',
          'tipo_documento',
          'registro_iva_id',
          'anno',
          'numero',
          'numero_testo',
          'data_documento',
          'cliente_id',
          'cliente_fatturazione_id',
          'contratto_id',
          'elenco_id',
          'periodo_dal',
          'periodo_al',
          'formato_trasmissione',
          'codice_destinatario',
          'pec_destinatario',
          'esigibilita_iva',
          'totale_imponibile',
          'totale_iva',
          'totale_documento',
          'netto_a_pagare',
          'bollo_dovuto',
          'importo_bollo',
          'fotografia',
          'documento_origine_id',
          'errori',
          'avvisi',
          'escluso_da_definitiva',
          'xml',
          'xml_sha256',
          'xml_generato_il',
          'progressivo_file',
          'definito_da',
          'definito_il',
          'annullato_da',
          'annullato_il',
          'motivo_annullo',
          'versione',
          'created_at',
          'updated_at',
        ].sort()
      )
    })

    it('una trasmissione sul documento definitivo non fa scattare il trigger di immutabilita', async () => {
      const s = await scenario()
      await trasmissioneViva(s)
      const [d] = await owner.$queryRawUnsafe<{ stato: string }[]>(
        `SELECT stato::text AS stato FROM documenti_fattura WHERE id = $1::uuid`,
        s.documentoId
      )
      expect(d.stato).toBe('DEFINITIVO')
    })
  })
})
