/**
 * Schema della fatturazione per periodo (fase 4.4a, Task 6) contro un Postgres reale: le nove
 * tabelle nuove, le colonne additive dei legami, i trigger di immutabilita' dei documenti, la
 * sonda della numerazione, le policy RLS e le fixture di pulizia.
 *
 * Le scritture di prova si fanno col ruolo applicativo `wasteflow_app` dentro il contesto
 * dell'azienda (RLS e privilegi) con SQL esplicito: la spec prova i vincoli del database, non il
 * client generato. Il proprietario prepara i dati di partenza e legge lo stato finale. Pulizia solo
 * per id esatti (`pulisciTenantDiTest`).
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import {
  creaCedenteDiTest,
  creaDocumentoDiTest,
  creaScenarioFatturazione,
  type ScenarioFatturazione,
} from '../../test-support/fatturazione-di-test'
import {
  AVVISI_DOCUMENTO,
  ERRORI_DOCUMENTO,
  ERRORI_GENERALI,
  RAGGRUPPAMENTI,
  STATI_DOCUMENTO,
  STATI_ELABORAZIONE,
  TIPI_MARCATORE,
  TIPI_RIGA_DOCUMENTO,
} from '../../domain/fatturazione/codici'
import { REGIMI_FISCALI } from '../../domain/fatturazione/costanti-fiscali'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

const NOVE_TABELLE = [
  'cedente_fatturazione',
  'numerazioni_fattura',
  'elaborazioni_fatturazione',
  'documenti_fattura',
  'righe_documento_fattura',
  'riepiloghi_iva_documento',
  'rate_documento_fattura',
  'marcatori_addebiti_fatturati',
  'contatori_file_fatturapa',
]

/** Colonne di `waste_movements` su master `8e991f87`: la 4.4 non ne aggiunge (scritte a mano, mai lette a runtime). */
const COLONNE_WASTE_MOVEMENTS_ATTESE = [
  'id',
  'tenant_id',
  'created_at',
  'updated_at',
  'type',
  'cer_code',
  'quantity',
  'unit',
  'movement_date',
  'fir_id',
  'notes',
  'progressive_number',
  'progressive_year',
  'registration_date',
  'causale',
  'waste_description',
  'waste_physical_state',
  'waste_hazard_classes',
  'operation_code',
  'counterpart_name',
  'counterpart_address',
  'recorded_by_user_id',
  'entry_hash',
  'fir_id_ricopia',
  'ricopia_chiave',
  'registro_id',
  'tipo_annotazione',
  'movimento_rettificato_id',
  'movimento_originale_id',
  'motivo_annotazione',
  'hash_versione',
  'causale_azienda_id',
]

describe('Fatturazione per periodo: schema (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []

  type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe' | '$queryRaw'>

  interface Sc extends ScenarioFatturazione {
    t: string
  }

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Fatturazione SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  async function scenario(opz: Parameters<typeof creaScenarioFatturazione>[2] = {}): Promise<Sc> {
    const t = await azienda()
    return { t, ...(await creaScenarioFatturazione(owner, t, opz)) }
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  const conta = (tabella: string, tenantId: string) =>
    owner
      .$queryRawUnsafe<
        { n: number }[]
      >(`SELECT count(*)::int AS n FROM ${tabella} WHERE tenant_id = $1::uuid`, tenantId)
      .then(r => r[0].n)

  interface DatiDocumento {
    stato?: string
    numero?: number | null
    anno?: number
    tipo?: string
    origineId?: string | null
    errori?: string[]
    avvisi?: string[]
    emessoIl?: string | null
    motivo?: string | null
    progressivoFile?: string | null
    data?: string
  }

  /** Inserisce una testata come `wasteflow_app`; senza `over` e' una bozza valida. */
  function inserisciDocumento(tx: Tx, s: Sc, over: DatiDocumento = {}) {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO documenti_fattura
         (tenant_id, stato, tipo_documento, registro_iva_id, anno, numero, data_documento,
          cliente_id, cliente_fatturazione_id, contratto_id, periodo_dal, periodo_al,
          formato_trasmissione, esigibilita_iva, totale_imponibile, totale_iva, totale_documento,
          netto_a_pagare, fotografia, errori, avvisi, documento_origine_id, emesso_il,
          motivo_annullo, progressivo_file, updated_at)
       VALUES ($1::uuid, $2::stato_documento_fattura, $3, $4::uuid, $5::smallint, $6::int,
          $7::date, $8::uuid, $8::uuid, $9::uuid, '2026-01-01', '2026-12-31', 'FPR12',
          'IMMEDIATA', 100, 22, 122, 122, '{}'::jsonb, $10::text[], $11::text[], $12::uuid,
          $13::timestamp, $14, $15, now())
       RETURNING id::text AS id`,
      s.t,
      over.stato ?? 'BOZZA',
      over.tipo ?? 'TD01',
      s.registroIvaId,
      over.anno ?? 2026,
      over.numero === undefined ? null : over.numero,
      over.data ?? '2026-03-15',
      s.clienteId,
      s.contrattoId,
      over.errori ?? [],
      over.avvisi ?? [],
      over.origineId ?? null,
      over.emessoIl ?? null,
      over.motivo ?? null,
      over.progressivoFile ?? null
    )
  }

  /** Una riga `FISSO` (senza legame) su un documento, col proprietario. */
  async function inserisciRigaFissa(
    s: Sc,
    documentoId: string,
    over: { linea?: number; rigaAddebitoId?: string | null; codiceIvaId?: string } = {}
  ): Promise<string> {
    const [r] = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO righe_documento_fattura
         (tenant_id, documento_id, numero_linea, tipo_riga, riga_addebito_id, descrizione,
          prezzo_unitario, importo_lordo, importo_sconto, prezzo_totale, codice_iva_id,
          aliquota_iva, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::int, 'FISSO', $4::uuid, 'Canone di prova', 10, 10, 0, 10,
          $5::uuid, 22, now())
       RETURNING id::text AS id`,
      s.t,
      documentoId,
      over.linea ?? 90,
      over.rigaAddebitoId ?? null,
      over.codiceIvaId ?? s.codiceIvaId
    )
    return r.id
  }

  const inserisciElaborazione = (tx: Tx, t: string, stato: string) =>
    tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO elaborazioni_fatturazione
         (tenant_id, stato, periodo_dal, periodo_al, data_documento, raggruppamento, updated_at)
       VALUES ($1::uuid, $2::stato_elaborazione_fatturazione, '2026-01-01', '2026-03-31',
          '2026-04-01', 'PER_CONTRATTO', now())
       RETURNING id::text AS id`,
      t,
      stato
    )

  const aggiorna = (t: string, id: string, impostazioni: string, ...params: unknown[]) =>
    comeApp(t, tx =>
      tx.$executeRawUnsafe(
        `UPDATE documenti_fattura SET ${impostazioni} WHERE id = $1::uuid`,
        id,
        ...params
      )
    )

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app.$disconnect()
    await sistema.$disconnect()
  })

  describe('vincoli della testata del documento', () => {
    let s: Sc
    beforeAll(async () => {
      s = await scenario()
    })

    it('BOZZA con numero: respinto', async () => {
      await expect(comeApp(s.t, tx => inserisciDocumento(tx, s, { numero: 1 }))).rejects.toThrow(
        /documenti_fattura_numero_se_non_bozza/
      )
    })

    it('DEFINITIVO senza numero: respinto', async () => {
      await expect(
        comeApp(s.t, tx => inserisciDocumento(tx, s, { stato: 'DEFINITIVO' }))
      ).rejects.toThrow(/documenti_fattura_numero_se_non_bozza/)
    })

    it('DEFINITIVO con errori non vuoti: respinto; una BOZZA con errori e avvisi: ammessa', async () => {
      await expect(
        comeApp(s.t, tx =>
          inserisciDocumento(tx, s, {
            stato: 'DEFINITIVO',
            numero: 1,
            errori: ['CONTRATTO_SOSPESO'],
          })
        )
      ).rejects.toThrow(/documenti_fattura_senza_errori_se_non_bozza/)
      const r = await comeApp(s.t, tx =>
        inserisciDocumento(tx, s, {
          errori: ['CONTRATTO_SOSPESO', 'UM_NON_UNIVOCA'],
          avvisi: ['FPA_DA_FIRMARE'],
        })
      )
      expect(r).toHaveLength(1)
    })

    it('ANNULLATO senza motivo: respinto (anche col motivo di soli spazi)', async () => {
      await expect(
        comeApp(s.t, tx => inserisciDocumento(tx, s, { stato: 'ANNULLATO', numero: 1 }))
      ).rejects.toThrow(/documenti_fattura_annullato_con_motivo/)
      await expect(
        comeApp(s.t, tx =>
          inserisciDocumento(tx, s, { stato: 'ANNULLATO', numero: 1, motivo: '   ' })
        )
      ).rejects.toThrow(/documenti_fattura_annullato_con_motivo/)
    })

    it('TD04 senza documento_origine_id: respinto', async () => {
      await expect(comeApp(s.t, tx => inserisciDocumento(tx, s, { tipo: 'TD04' }))).rejects.toThrow(
        /documenti_fattura_storno_con_origine/
      )
    })

    it('emesso_il su BOZZA: respinto', async () => {
      await expect(
        comeApp(s.t, tx => inserisciDocumento(tx, s, { emessoIl: '2026-03-16T10:00:00' }))
      ).rejects.toThrow(/documenti_fattura_emesso_se_non_bozza/)
    })

    it('tipo e formato fuori dall insieme: respinti', async () => {
      await expect(comeApp(s.t, tx => inserisciDocumento(tx, s, { tipo: 'TD99' }))).rejects.toThrow(
        /documenti_fattura_tipo_ammesso/
      )
    })

    it('errore e avviso fuori dall insieme: respinti', async () => {
      await expect(
        comeApp(s.t, tx => inserisciDocumento(tx, s, { errori: ['INVENTATO'] }))
      ).rejects.toThrow(/documenti_fattura_errori_ammessi/)
      await expect(
        comeApp(s.t, tx => inserisciDocumento(tx, s, { avvisi: ['INVENTATO'] }))
      ).rejects.toThrow(/documenti_fattura_avvisi_ammessi/)
    })

    it('due DEFINITIVO con lo stesso (registro, anno, numero): 23505', async () => {
      await comeApp(s.t, tx => inserisciDocumento(tx, s, { stato: 'DEFINITIVO', numero: 7 }))
      await expect(
        comeApp(s.t, tx => inserisciDocumento(tx, s, { stato: 'DEFINITIVO', numero: 7 }))
      ).rejects.toThrow(/`23505`/)
      // Un anno diverso e un numero diverso sono ammessi.
      await comeApp(s.t, tx =>
        inserisciDocumento(tx, s, {
          stato: 'DEFINITIVO',
          numero: 7,
          anno: 2027,
          data: '2027-01-10',
        })
      )
      await comeApp(s.t, tx => inserisciDocumento(tx, s, { stato: 'DEFINITIVO', numero: 8 }))
    })

    it('un ANNULLATO e un DEFINITIVO con lo stesso numero: ammesso (decisione 3)', async () => {
      await comeApp(s.t, tx =>
        inserisciDocumento(tx, s, { stato: 'ANNULLATO', numero: 20, motivo: 'Errore di prova' })
      )
      const r = await comeApp(s.t, tx =>
        inserisciDocumento(tx, s, { stato: 'DEFINITIVO', numero: 20 })
      )
      expect(r).toHaveLength(1)
    })

    it('due TD04 non annullati sullo stesso documento: 23505; col primo annullato: ammesso', async () => {
      const { documentoId: origine } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'DEFINITIVO',
        registroIvaId: s.registroIvaId,
        anno: 2026,
        numero: 31,
      })
      const [primo] = await comeApp(s.t, tx =>
        inserisciDocumento(tx, s, { tipo: 'TD04', origineId: origine })
      )
      await expect(
        comeApp(s.t, tx => inserisciDocumento(tx, s, { tipo: 'TD04', origineId: origine }))
      ).rejects.toThrow(/`23505`/)
      // Una bozza si scarta e la nota si rifa: ma anche una nota ANNULLATA lascia posto.
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura SET stato = 'DEFINITIVO', numero = 32 WHERE id = $1::uuid`,
        primo.id
      )
      await aggiorna(s.t, primo.id, `stato = 'ANNULLATO', motivo_annullo = 'Nota sbagliata'`)
      const secondo = await comeApp(s.t, tx =>
        inserisciDocumento(tx, s, { tipo: 'TD04', origineId: origine })
      )
      expect(secondo).toHaveLength(1)
    })

    it('unico del progressivo_file per azienda; righe, rate e riepiloghi con i loro unici', async () => {
      const { documentoId: a } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'BOZZA',
        registroIvaId: s.registroIvaId,
        anno: 2026,
      })
      const b = await comeApp(s.t, tx => inserisciDocumento(tx, s, { progressivoFile: 'AAAAA' }))
      await expect(
        comeApp(s.t, tx => inserisciDocumento(tx, s, { progressivoFile: 'AAAAA' }))
      ).rejects.toThrow(/`23505`/)
      expect(b).toHaveLength(1)
      await inserisciRigaFissa(s, a, { linea: 1 })
      await expect(inserisciRigaFissa(s, a, { linea: 1 })).rejects.toThrow(/`23505`/)
      const rata = `INSERT INTO rate_documento_fattura
         (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, updated_at)
         VALUES ($1::uuid, $2::uuid, 1, 'MP05', '2026-04-30', 10, now())`
      await owner.$executeRawUnsafe(rata, s.t, a)
      await expect(owner.$executeRawUnsafe(rata, s.t, a)).rejects.toThrow(/`23505`/)
      // NULLS NOT DISTINCT: due riepiloghi senza natura alla stessa aliquota sono lo stesso.
      const riepilogo = `INSERT INTO riepiloghi_iva_documento
         (tenant_id, documento_id, aliquota, natura, imponibile, imposta, esigibilita, updated_at)
         VALUES ($1::uuid, $2::uuid, 22, $3, 10, 2.2, 'IMMEDIATA', now())`
      await owner.$executeRawUnsafe(riepilogo, s.t, a, null)
      await expect(owner.$executeRawUnsafe(riepilogo, s.t, a, null)).rejects.toThrow(/`23505`/)
      await owner.$executeRawUnsafe(riepilogo, s.t, a, 'N4')
    })
  })

  describe('trigger di immutabilita (documenti_fattura_immutabile)', () => {
    let s: Sc
    beforeAll(async () => {
      s = await scenario({ legami: 2 })
    })

    const definitivo = async (numero: number, legamiIds?: string[]) =>
      (
        await creaDocumentoDiTest(owner, s.t, {
          stato: 'DEFINITIVO',
          registroIvaId: s.registroIvaId,
          anno: 2026,
          numero,
          legamiIds,
        })
      ).documentoId

    it('UPDATE del totale di un DEFINITIVO: respinto', async () => {
      const id = await definitivo(101)
      await expect(aggiorna(s.t, id, `totale_documento = 999`)).rejects.toThrow(
        /documento non in bozza immutabile/
      )
    })

    it('colonna non nell elenco delle permesse (fotografia, cliente_id...) cambiata: respinta (fail-closed)', async () => {
      const id = await definitivo(102)
      for (const imposta of [
        `fotografia = '{"x": 1}'::jsonb`,
        `cliente_id = '${s.clienteId}'::uuid, numero_testo = 'X'`,
        `data_documento = '2026-04-01'`,
        `escluso_da_definitiva = true`,
        `numero = 5000`,
        `definito_il = now()`,
        `errori = ARRAY['CONTRATTO_SOSPESO']::text[]`,
      ]) {
        await expect(aggiorna(s.t, id, imposta)).rejects.toThrow(
          /documento non in bozza immutabile/
        )
      }
    })

    it('UPDATE di stato DEFINITIVO -> ANNULLATO con motivo: ammesso', async () => {
      const id = await definitivo(103)
      await aggiorna(
        s.t,
        id,
        `stato = 'ANNULLATO', motivo_annullo = 'Errore', annullato_il = now(), annullato_da = gen_random_uuid(), versione = versione + 1, updated_at = now()`
      )
      const [d] = await owner.$queryRawUnsafe<{ stato: string }[]>(
        `SELECT stato::text FROM documenti_fattura WHERE id = $1::uuid`,
        id
      )
      expect(d.stato).toBe('ANNULLATO')
    })

    it('ANNULLATO -> DEFINITIVO: respinto; DEFINITIVO -> ANNULLATO senza motivo: respinto dal CHECK', async () => {
      const id = await definitivo(104)
      await expect(aggiorna(s.t, id, `stato = 'ANNULLATO'`)).rejects.toThrow(
        /documenti_fattura_annullato_con_motivo/
      )
      await aggiorna(s.t, id, `stato = 'ANNULLATO', motivo_annullo = 'Errore'`)
      await expect(aggiorna(s.t, id, `stato = 'DEFINITIVO'`)).rejects.toThrow(
        /transizione di stato non ammessa/
      )
      await expect(aggiorna(s.t, id, `stato = 'BOZZA'`)).rejects.toThrow(
        /transizione di stato non ammessa/
      )
    })

    it('un documento emesso non si annulla; i dati dell annullo si scrivono solo con l annullo', async () => {
      const id = await definitivo(105)
      await aggiorna(s.t, id, `emesso_il = now()`)
      await expect(
        aggiorna(s.t, id, `stato = 'ANNULLATO', motivo_annullo = 'Troppo tardi'`)
      ).rejects.toThrow(/un documento emesso non si annulla/)
      await expect(aggiorna(s.t, id, `motivo_annullo = 'Nota'`)).rejects.toThrow(
        /i dati dell'annullo si scrivono solo con l'annullo/
      )
    })

    it('emesso_il da null a valore: ammesso; da valore ad altro valore: respinto', async () => {
      const id = await definitivo(106)
      await aggiorna(s.t, id, `emesso_il = '2026-03-16 10:00'`)
      await expect(aggiorna(s.t, id, `emesso_il = '2026-03-17 10:00'`)).rejects.toThrow(
        /emesso_il gia' scritto/
      )
      await expect(aggiorna(s.t, id, `emesso_il = NULL`)).rejects.toThrow(/emesso_il gia' scritto/)
    })

    it('xml e progressivo_file da null a valore: ammesso una volta; seconda scrittura: respinta', async () => {
      const id = await definitivo(107)
      await aggiorna(
        s.t,
        id,
        `xml = '\\x3c783e'::bytea, xml_sha256 = repeat('a', 64), xml_generato_il = now(), progressivo_file = 'AAAAB'`
      )
      await expect(aggiorna(s.t, id, `xml = '\\x3c793e'::bytea`)).rejects.toThrow(
        /xml gia' scritto/
      )
      await expect(aggiorna(s.t, id, `xml_sha256 = repeat('b', 64)`)).rejects.toThrow(
        /xml_sha256 gia' scritto/
      )
      await expect(aggiorna(s.t, id, `xml_generato_il = now() + interval '1 day'`)).rejects.toThrow(
        /xml_generato_il gia' scritto/
      )
      await expect(aggiorna(s.t, id, `progressivo_file = 'AAAAC'`)).rejects.toThrow(
        /progressivo_file gia' scritto/
      )
      await expect(aggiorna(s.t, id, `xml = NULL`)).rejects.toThrow(/xml gia' scritto/)
    })

    it('DELETE di un DEFINITIVO e di un ANNULLATO: respinto', async () => {
      const id = await definitivo(108)
      const del = (doc: string) =>
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(`DELETE FROM documenti_fattura WHERE id = $1::uuid`, doc)
        )
      await expect(del(id)).rejects.toThrow(/un documento non in bozza non si cancella/)
      await aggiorna(s.t, id, `stato = 'ANNULLATO', motivo_annullo = 'Errore'`)
      await expect(del(id)).rejects.toThrow(/un documento non in bozza non si cancella/)
    })

    it('DELETE di una BOZZA con righe, riepiloghi e rate: ammesso (cascata)', async () => {
      const { documentoId } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'BOZZA',
        registroIvaId: s.registroIvaId,
        anno: 2026,
        legamiIds: [s.legamiIds[0]],
      })
      await owner.$executeRawUnsafe(
        `INSERT INTO rate_documento_fattura (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, updated_at)
         VALUES ($1::uuid, $2::uuid, 1, 'MP05', '2026-04-30', 10, now())`,
        s.t,
        documentoId
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO riepiloghi_iva_documento (tenant_id, documento_id, aliquota, imponibile, imposta, esigibilita, updated_at)
         VALUES ($1::uuid, $2::uuid, 22, 100, 22, 'IMMEDIATA', now())`,
        s.t,
        documentoId
      )
      const prima = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM righe_documento_fattura WHERE documento_id = $1::uuid`,
        documentoId
      )
      expect(prima[0].n).toBeGreaterThan(0)
      await comeApp(s.t, tx =>
        tx.$executeRawUnsafe(`DELETE FROM documenti_fattura WHERE id = $1::uuid`, documentoId)
      )
      for (const tabella of [
        'righe_documento_fattura',
        'riepiloghi_iva_documento',
        'rate_documento_fattura',
      ]) {
        const [r] = await owner.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${tabella} WHERE documento_id = $1::uuid`,
          documentoId
        )
        expect(r.n).toBe(0)
      }
    })

    it('UPDATE e DELETE di righe, riepiloghi e rate di un DEFINITIVO: respinti', async () => {
      const id = await definitivo(109, [s.legamiIds[1]])
      await owner.$executeRawUnsafe(
        `INSERT INTO rate_documento_fattura (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, updated_at)
         VALUES ($1::uuid, $2::uuid, 1, 'MP05', '2026-04-30', 10, now())`,
        s.t,
        id
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO riepiloghi_iva_documento (tenant_id, documento_id, aliquota, imponibile, imposta, esigibilita, updated_at)
         VALUES ($1::uuid, $2::uuid, 22, 100, 22, 'IMMEDIATA', now())`,
        s.t,
        id
      )
      const casi: Array<[string, string]> = [
        ['righe_documento_fattura', 'descrizione'],
        ['riepiloghi_iva_documento', 'imponibile'],
        ['rate_documento_fattura', 'importo'],
      ]
      for (const [tabella, colonna] of casi) {
        const valore = colonna === 'descrizione' ? `'Altro'` : '1'
        await expect(
          comeApp(s.t, tx =>
            tx.$executeRawUnsafe(
              `UPDATE ${tabella} SET ${colonna} = ${valore} WHERE documento_id = $1::uuid`,
              id
            )
          )
        ).rejects.toThrow(/sono immutabili/)
        await expect(
          comeApp(s.t, tx =>
            tx.$executeRawUnsafe(`DELETE FROM ${tabella} WHERE documento_id = $1::uuid`, id)
          )
        ).rejects.toThrow(/sono immutabili/)
      }
    })

    it('UPDATE di movimento_fatturato_id su una riga di una BOZZA: ammesso; dopo il passaggio a DEFINITIVO: respinto', async () => {
      const { documentoId } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'BOZZA',
        registroIvaId: s.registroIvaId,
        anno: 2026,
        legamiIds: [s.legamiIds[0]],
      })
      const imposta = () =>
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(
            `UPDATE righe_documento_fattura SET movimento_fatturato_id = gen_random_uuid(), updated_at = now()
             WHERE documento_id = $1::uuid`,
            documentoId
          )
        )
      await expect(imposta()).resolves.toBeGreaterThan(0)
      // La definitiva (proprietario o app: qui il proprietario) porta la bozza a DEFINITIVO.
      await owner.$executeRawUnsafe(
        `UPDATE documenti_fattura SET stato = 'DEFINITIVO', numero = 110, definito_il = now() WHERE id = $1::uuid`,
        documentoId
      )
      await expect(imposta()).rejects.toThrow(/sono immutabili/)
    })

    it('una bozza passa solo a DEFINITIVO, non a ANNULLATO', async () => {
      const { documentoId } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'BOZZA',
        registroIvaId: s.registroIvaId,
        anno: 2026,
      })
      await expect(
        aggiorna(s.t, documentoId, `stato = 'ANNULLATO', numero = 120, motivo_annullo = 'No'`)
      ).rejects.toThrow(/una bozza diventa solo definitiva/)
    })
  })

  describe('legami: colonne e CHECK additivi', () => {
    let s: Sc
    beforeAll(async () => {
      s = await scenario({ legami: 4 })
    })

    const aggiornaLegame = (id: string, imposta: string) =>
      comeApp(s.t, tx =>
        tx.$executeRawUnsafe(
          `UPDATE legami_movimento SET ${imposta}, updated_at = now() WHERE id = $1::uuid`,
          id
        )
      )

    it('FATTURATO senza documento_id: respinto', async () => {
      await expect(
        aggiornaLegame(s.legamiIds[0], `stato = 'FATTURATO', fatturato_il = now()`)
      ).rejects.toThrow(/legami_movimento_documento_se_fatturato/)
    })

    it('CONFERMATO con documento_id: respinto', async () => {
      const { documentoId } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'BOZZA',
        registroIvaId: s.registroIvaId,
        anno: 2026,
      })
      await expect(
        aggiornaLegame(s.legamiIds[0], `documento_id = '${documentoId}'::uuid`)
      ).rejects.toThrow(/legami_movimento_documento_se_fatturato/)
    })

    it('scostamento_gestito_il senza scostamento_dopo_fattura: respinto', async () => {
      await expect(
        aggiornaLegame(s.legamiIds[0], `scostamento_gestito_il = now()`)
      ).rejects.toThrow(/legami_movimento_gestito_se_scostamento/)
    })

    it('IMPORTATO_FATTURATO senza documento: ammesso', async () => {
      await expect(
        aggiornaLegame(s.legamiIds[1], `stato = 'IMPORTATO_FATTURATO', fatturato_il = now()`)
      ).resolves.toBe(1)
    })

    it('un legame FATTURATO da un DEFINITIVO: ammesso, con la presa d atto dello scostamento', async () => {
      const { documentoId } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'DEFINITIVO',
        registroIvaId: s.registroIvaId,
        anno: 2026,
        legamiIds: [s.legamiIds[2]],
      })
      const [l] = await owner.$queryRawUnsafe<{ stato: string; documento_id: string }[]>(
        `SELECT stato::text, documento_id::text FROM legami_movimento WHERE id = $1::uuid`,
        s.legamiIds[2]
      )
      expect(l).toEqual({ stato: 'FATTURATO', documento_id: documentoId })
      await aggiornaLegame(
        s.legamiIds[2],
        `scostamento_dopo_fattura = true, scostamento_il = now(), scostamento_gestito_il = now(), scostamento_gestito_da = gen_random_uuid(), scostamento_nota = 'Presa d''atto'`
      )
    })

    it('un documento citato da un legame non si cancella (NoAction)', async () => {
      const [l] = await owner.$queryRawUnsafe<{ documento_id: string }[]>(
        `SELECT documento_id::text FROM legami_movimento WHERE id = $1::uuid`,
        s.legamiIds[2]
      )
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM documenti_fattura WHERE id = $1::uuid`, l.documento_id)
      ).rejects.toThrow(/non in bozza non si cancella|`23503`/)
    })
  })

  describe('cedente, numerazioni, elaborazioni e marcatori', () => {
    let s: Sc
    beforeAll(async () => {
      s = await scenario()
    })

    it('secondo cedente per lo stesso tenant: 23505; regime fuori elenco (RF03) e socio unico non ammessi', async () => {
      await creaCedenteDiTest(owner, s.t)
      await expect(
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO cedente_fatturazione (tenant_id, regime_fiscale, updated_at) VALUES ($1::uuid, 'RF01', now())`,
            s.t
          )
        )
      ).rejects.toThrow(/`23505`/)
      const altro = await azienda()
      const inserisci = (colonne: string, valori: string) =>
        comeApp(altro, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO cedente_fatturazione (tenant_id, ${colonne}, updated_at) VALUES ($1::uuid, ${valori}, now())`,
            altro
          )
        )
      await expect(inserisci('regime_fiscale', `'RF03'`)).rejects.toThrow(
        /cedente_fatturazione_regime_ammesso/
      )
      await expect(inserisci('regime_fiscale, socio_unico', `'RF01', 'XX'`)).rejects.toThrow(
        /cedente_fatturazione_socio_unico_ammesso/
      )
      await expect(inserisci('regime_fiscale, stato_liquidazione', `'RF01', 'ZZ'`)).rejects.toThrow(
        /cedente_fatturazione_stato_liquidazione_ammesso/
      )
      await expect(inserisci('regime_fiscale', `'RF20'`)).resolves.toBe(1)
      const [r] = await owner.$queryRawUnsafe<{ stato_liquidazione: string }[]>(
        `SELECT stato_liquidazione FROM cedente_fatturazione WHERE tenant_id = $1::uuid`,
        altro
      )
      expect(r.stato_liquidazione).toBe('LN')
    })

    it('numerazioni_fattura: chiave (tenant, registro, anno) e ultimo_numero >= numero_partenza >= 0', async () => {
      const inserisci = (anno: number, ultimo: number, partenza: number) =>
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO numerazioni_fattura (tenant_id, registro_iva_id, anno, ultimo_numero, numero_partenza, data_partenza, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::smallint, $4::int, $5::int, '2026-01-01', now())`,
            s.t,
            s.registroIvaId,
            anno,
            ultimo,
            partenza
          )
        )
      await expect(inserisci(2026, 10, 10)).resolves.toBe(1)
      await expect(inserisci(2026, 11, 10)).rejects.toThrow(/`23505`/)
      await expect(inserisci(2027, 9, 10)).rejects.toThrow(/numerazioni_fattura_numeri_coerenti/)
      await expect(inserisci(2028, 0, -1)).rejects.toThrow(/numerazioni_fattura_numeri_coerenti/)
    })

    it('seconda elaborazione IN_CORSO per lo stesso tenant: 23505; una IN_CORSO e due ANTEPRIMA_PRONTA: ammesse', async () => {
      const t = await azienda()
      await comeApp(t, tx => inserisciElaborazione(tx, t, 'IN_CORSO'))
      await expect(comeApp(t, tx => inserisciElaborazione(tx, t, 'IN_CORSO'))).rejects.toThrow(
        /`23505`/
      )
      await expect(comeApp(t, tx => inserisciElaborazione(tx, t, 'IN_DEFINITIVA'))).rejects.toThrow(
        /`23505`/
      )
      await comeApp(t, tx => inserisciElaborazione(tx, t, 'ANTEPRIMA_PRONTA'))
      await comeApp(t, tx => inserisciElaborazione(tx, t, 'ANTEPRIMA_PRONTA'))
      expect(await conta('elaborazioni_fatturazione', t)).toBe(3)
    })

    it('elaborazione: errori generali fuori dall insieme e periodo rovesciato respinti; esito jsonb ammesso', async () => {
      const t = await azienda()
      await expect(
        comeApp(t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO elaborazioni_fatturazione (tenant_id, stato, periodo_dal, periodo_al, data_documento, raggruppamento, errori_generali, updated_at)
             VALUES ($1::uuid, 'IN_CODA', '2026-01-01', '2026-03-31', '2026-04-01', 'PER_CONTRATTO', ARRAY['INVENTATO']::text[], now())`,
            t
          )
        )
      ).rejects.toThrow(/elaborazioni_fatturazione_errori_ammessi/)
      await expect(
        comeApp(t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO elaborazioni_fatturazione (tenant_id, stato, periodo_dal, periodo_al, data_documento, raggruppamento, updated_at)
             VALUES ($1::uuid, 'IN_CODA', '2026-04-01', '2026-03-31', '2026-04-01', 'PER_CONTRATTO', now())`,
            t
          )
        )
      ).rejects.toThrow(/elaborazioni_fatturazione_periodo_ordinato/)
      const [e] = await comeApp(t, tx => inserisciElaborazione(tx, t, 'ANTEPRIMA_PRONTA'))
      await comeApp(t, tx =>
        tx.$executeRawUnsafe(
          `UPDATE elaborazioni_fatturazione SET esito = '{"codice":"ANTEPRIMA_SUPERATA"}'::jsonb WHERE id = $1::uuid`,
          e.id
        )
      )
    })

    it('marcatori: duplicato 23505, chiave "2026-13-01" respinta, forme ammesse', async () => {
      const { documentoId } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'DEFINITIVO',
        registroIvaId: s.registroIvaId,
        anno: 2026,
        numero: 201,
        legamiIds: s.legamiIds,
      })
      const [riga] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM righe_documento_fattura WHERE documento_id = $1::uuid LIMIT 1`,
        documentoId
      )
      const marca = (tipo: string, chiave: string) =>
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO marcatori_addebiti_fatturati (tenant_id, riga_addebito_id, tipo, chiave_competenza, documento_id, riga_documento_id)
             VALUES ($1::uuid, $2::uuid, $3::tipo_marcatore_addebito, $4, $5::uuid, $6::uuid)`,
            s.t,
            s.rigaAddebitoIds[0],
            tipo,
            chiave,
            documentoId,
            riga.id
          )
        )
      await marca('SCADENZA_FISSO', '2026-03-31')
      await expect(marca('SCADENZA_FISSO', '2026-03-31')).rejects.toThrow(/`23505`/)
      await marca('PERIODO_CANONE', '2026-01-01/2026-03-31')
      await marca('SCADENZA_FISSO', '2026-04-30')
      for (const chiave of [
        '2026-13-01',
        '2026-00-10',
        '2026-01-32',
        '26-01-01',
        '2026-01-01/',
        '2026-01-01/2026-13-01',
        '',
      ]) {
        await expect(marca('CONGUAGLIO', chiave)).rejects.toThrow(
          /marcatori_addebiti_fatturati_chiave_ammessa/
        )
      }
    })

    it('delete di una riga_addebito citata da una riga di documento o da un marcatore: 23503', async () => {
      const t = await azienda()
      const sc = await creaScenarioFatturazione(owner, t, { conFissi: true })
      const s2: Sc = { t, ...sc }
      const fisso = sc.rigaAddebitoIds[1]
      const { documentoId } = await creaDocumentoDiTest(owner, t, {
        stato: 'BOZZA',
        registroIvaId: sc.registroIvaId,
        anno: 2026,
      })
      // Citata da una riga di documento.
      const rigaDoc = await inserisciRigaFissa(s2, documentoId, { rigaAddebitoId: fisso })
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM righe_addebito WHERE id = $1::uuid`, fisso)
      ).rejects.toThrow(/righe_documento_fattura_riga_addebito_fkey/)
      // Citata solo da un marcatore (la riga di documento non cita la riga di listino).
      await owner.$executeRawUnsafe(
        `UPDATE righe_documento_fattura SET riga_addebito_id = NULL WHERE id = $1::uuid`,
        rigaDoc
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO marcatori_addebiti_fatturati (tenant_id, riga_addebito_id, tipo, chiave_competenza, documento_id, riga_documento_id)
         VALUES ($1::uuid, $2::uuid, 'SCADENZA_FISSO', '2026-03-31', $3::uuid, $4::uuid)`,
        t,
        fisso,
        documentoId,
        rigaDoc
      )
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM righe_addebito WHERE id = $1::uuid`, fisso)
      ).rejects.toThrow(/marcatori_addebiti_fatturati_riga_addebito_fkey/)
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM righe_addebito WHERE id = $1::uuid`, fisso)
      ).rejects.toThrow(/`23503`/)
    })

    it('delete di un codice IVA, di un registro IVA, di un cliente e di un contratto citati da un documento: 23503', async () => {
      const t = await azienda()
      const sc = await creaScenarioFatturazione(owner, t)
      const s2: Sc = { t, ...sc }
      const iva = await owner.codiceIva.create({
        data: { tenantId: t, codice: 'Z9', descrizione: 'Solo per il test', aliquota: '10' },
      })
      const { documentoId } = await creaDocumentoDiTest(owner, t, {
        stato: 'BOZZA',
        registroIvaId: sc.registroIvaId,
        anno: 2026,
        legamiIds: [sc.legamiIds[0]],
      })
      await inserisciRigaFissa(s2, documentoId, { codiceIvaId: iva.id })
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM codici_iva WHERE id = $1::uuid`, iva.id)
      ).rejects.toThrow(/righe_documento_fattura_codice_iva_fkey/)
      for (const [tabella, id] of [
        ['registri_iva', sc.registroIvaId],
        ['clienti', sc.clienteId],
        ['contratti_cliente', sc.contrattoId],
        ['elenchi_addebiti', sc.elencoId],
      ] as const) {
        await expect(
          owner.$executeRawUnsafe(`DELETE FROM ${tabella} WHERE id = $1::uuid`, id)
        ).rejects.toThrow(/`23503`/)
      }
    })

    it('spese_accessorie.codice_iva_id e registri_iva.suffisso_numero esistono e la FK e NoAction', async () => {
      const iva = await owner.codiceIva.create({
        data: { tenantId: s.t, codice: 'Y8', descrizione: 'Per la spesa', aliquota: '22' },
      })
      await owner.$executeRawUnsafe(
        `INSERT INTO spese_accessorie (tenant_id, tipo, codice, descrizione, importo, codice_iva_id, updated_at)
         VALUES ($1::uuid, 'INCASSO', 'IVA', 'Spesa con IVA', 2.5, $2::uuid, now())`,
        s.t,
        iva.id
      )
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM codici_iva WHERE id = $1::uuid`, iva.id)
      ).rejects.toThrow(/spese_accessorie_codice_iva_fkey/)
      await owner.$executeRawUnsafe(
        `UPDATE registri_iva SET suffisso_numero = '/A' WHERE id = $1::uuid`,
        s.registroIvaId
      )
    })
  })

  describe('interruttore delle definitive (decisione 13)', () => {
    it('definitive_attive: boolean NOT NULL DEFAULT false', async () => {
      const [c] = await owner.$queryRawUnsafe<
        { data_type: string; is_nullable: string; column_default: string }[]
      >(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'impostazioni_fatturazione'
           AND column_name = 'definitive_attive'`
      )
      expect(c).toEqual({ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' })
    })

    it('uno scenario senza opzioni e una riga di impostazioni nuova sono spenti; un azienda senza riga e spenta', async () => {
      const s = await scenario()
      const spento = async (t: string) => {
        const r = await owner.$queryRawUnsafe<{ definitive_attive: boolean }[]>(
          `SELECT definitive_attive FROM impostazioni_fatturazione WHERE tenant_id = $1::uuid`,
          t
        )
        // Nessuna riga = spento, come il servizio legge il valore (`riga?.definitiveAttive ?? false`).
        return r[0]?.definitive_attive ?? false
      }
      expect(await spento(s.t)).toBe(false)
      const t2 = await azienda()
      expect(await spento(t2)).toBe(false)
      await comeApp(t2, tx =>
        tx.$executeRawUnsafe(
          `INSERT INTO impostazioni_fatturazione (tenant_id, fatturazione_da, updated_at) VALUES ($1::uuid, '2026-01-01', now())`,
          t2
        )
      )
      expect(await spento(t2)).toBe(false)
      const s3 = await scenario({ definitiveAttive: true })
      expect(await spento(s3.t)).toBe(true)
    })
  })

  describe('insiemi chiusi uguali al dominio', () => {
    const quotati = (def: string): string[] =>
      [...def.matchAll(/'([A-Za-z0-9_]+)'/g)].map(m => m[1]).sort()

    const definizione = async (tabella: string, vincolo: string) => {
      const [r] = await owner.$queryRawUnsafe<{ def: string }[]>(
        `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         WHERE t.relname = $1 AND c.conname = $2`,
        tabella,
        vincolo
      )
      expect(r).toBeDefined()
      return r.def
    }

    it('i CHECK errori e avvisi coincidono con ERRORI_DOCUMENTO e AVVISI_DOCUMENTO', async () => {
      const errori = await definizione('documenti_fattura', 'documenti_fattura_errori_ammessi')
      expect(quotati(errori)).toEqual([...ERRORI_DOCUMENTO].sort())
      const avvisi = await definizione('documenti_fattura', 'documenti_fattura_avvisi_ammessi')
      expect(quotati(avvisi)).toEqual([...AVVISI_DOCUMENTO].sort())
      const generali = await definizione(
        'elaborazioni_fatturazione',
        'elaborazioni_fatturazione_errori_ammessi'
      )
      expect(quotati(generali)).toEqual([...ERRORI_GENERALI].sort())
    })

    it('il CHECK del regime coincide con REGIMI_FISCALI', async () => {
      const regime = await definizione(
        'cedente_fatturazione',
        'cedente_fatturazione_regime_ammesso'
      )
      expect(quotati(regime)).toEqual([...REGIMI_FISCALI].sort())
    })

    it('gli enum del database coincidono con i valori del dominio', async () => {
      const valori = async (tipo: string) =>
        (
          await owner.$queryRawUnsafe<{ v: string }[]>(
            `SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = $1 ORDER BY e.enumsortorder`,
            tipo
          )
        ).map(r => r.v)
      expect(await valori('stato_elaborazione_fatturazione')).toEqual([...STATI_ELABORAZIONE])
      expect(await valori('stato_documento_fattura')).toEqual([...STATI_DOCUMENTO])
      expect(await valori('raggruppamento_fatturazione')).toEqual([...RAGGRUPPAMENTI])
      expect(await valori('tipo_riga_documento_fattura')).toEqual([...TIPI_RIGA_DOCUMENTO])
      expect(await valori('tipo_marcatore_addebito')).toEqual([...TIPI_MARCATORE])
    })

    it('nessuna colonna nuova su waste_movements', async () => {
      const colonne = await owner.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'waste_movements'
         ORDER BY ordinal_position`
      )
      expect(colonne.map(c => c.column_name)).toEqual(COLONNE_WASTE_MOVEMENTS_ATTESE)
    })
  })

  describe('sonda della numerazione', () => {
    it('chiamata da wasteflow_app: permesso negato', async () => {
      await expect(
        app.$queryRawUnsafe(`SELECT * FROM fatturazione_violazioni_numerazione()`)
      ).rejects.toThrow(/permission denied|permesso negato|42501/i)
    })

    it('chiamata da wasteflow_sistema: conta mancanti, doppi e fuori intervallo, solo per azienda', async () => {
      const s = await scenario()
      const violazioni = async () => {
        const righe = await sistema.$queryRawUnsafe<{ tenant_id: string; violazioni: number }[]>(
          `SELECT tenant_id::text, violazioni FROM fatturazione_violazioni_numerazione()
           WHERE tenant_id = $1::uuid`,
          s.t
        )
        return righe.length === 0 ? null : righe[0].violazioni
      }
      expect(await violazioni()).toBeNull()
      const num = (ultimo: number, partenza = 0) =>
        owner.$executeRawUnsafe(
          `INSERT INTO numerazioni_fattura (tenant_id, registro_iva_id, anno, ultimo_numero, numero_partenza, updated_at)
           VALUES ($1::uuid, $2::uuid, 2026, $3::int, $4::int, now())
           ON CONFLICT (tenant_id, registro_iva_id, anno) DO UPDATE SET ultimo_numero = EXCLUDED.ultimo_numero, numero_partenza = EXCLUDED.numero_partenza`,
          s.t,
          s.registroIvaId,
          ultimo,
          partenza
        )
      const doc = (numero: number) =>
        creaDocumentoDiTest(owner, s.t, {
          stato: 'DEFINITIVO',
          registroIvaId: s.registroIvaId,
          anno: 2026,
          numero,
        })
      await num(3, 0)
      expect(await violazioni()).toBe(3) // nessun definitivo: tre numeri mancanti
      await doc(1)
      await doc(2)
      expect(await violazioni()).toBe(1) // manca il 3
      await doc(3)
      expect(await violazioni()).toBe(0)
      await doc(5) // fuori intervallo
      expect(await violazioni()).toBe(1)
      await num(5, 0)
      expect(await violazioni()).toBe(1) // ora manca il 4
      await doc(4)
      expect(await violazioni()).toBe(0)
      await num(5, 2) // partenza 2: il 1 e il 2 sono fuori, il 3-5 ci sono
      expect(await violazioni()).toBe(2)
    })
  })

  describe('RLS sulle nove tabelle', () => {
    it('ENABLE, FORCE e le due policy standard', async () => {
      const righe = await owner.$queryRawUnsafe<
        { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
      >(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])
         ORDER BY 1`,
        NOVE_TABELLE
      )
      expect(righe.map(r => r.relname)).toEqual([...NOVE_TABELLE].sort())
      for (const r of righe) expect([r.relrowsecurity, r.relforcerowsecurity]).toEqual([true, true])
      for (const tabella of NOVE_TABELLE) {
        const policy = await owner.$queryRawUnsafe<{ policyname: string }[]>(
          `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`,
          tabella
        )
        expect(policy.map(p => p.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
      }
    })

    it('senza tenant attivo e con un altro tenant 0 righe; col proprio no', async () => {
      const s = await scenario({ legami: 2 })
      await creaCedenteDiTest(owner, s.t)
      await owner.$executeRawUnsafe(
        `INSERT INTO numerazioni_fattura (tenant_id, registro_iva_id, anno, ultimo_numero, updated_at)
         VALUES ($1::uuid, $2::uuid, 2026, 1, now())`,
        s.t,
        s.registroIvaId
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO contatori_file_fatturapa (tenant_id, ultimo, updated_at) VALUES ($1::uuid, 1, now())`,
        s.t
      )
      const e = await inserisciElaborazione(owner, s.t, 'ANTEPRIMA_PRONTA')
      const { documentoId } = await creaDocumentoDiTest(owner, s.t, {
        stato: 'DEFINITIVO',
        registroIvaId: s.registroIvaId,
        anno: 2026,
        numero: 1,
        legamiIds: s.legamiIds,
        elaborazioneId: e[0].id,
      })
      await owner.$executeRawUnsafe(
        `INSERT INTO rate_documento_fattura (tenant_id, documento_id, ordine, modalita, data_scadenza, importo, updated_at)
         VALUES ($1::uuid, $2::uuid, 1, 'MP05', '2026-04-30', 10, now())`,
        s.t,
        documentoId
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO riepiloghi_iva_documento (tenant_id, documento_id, aliquota, imponibile, imposta, esigibilita, updated_at)
         VALUES ($1::uuid, $2::uuid, 22, 100, 22, 'IMMEDIATA', now())`,
        s.t,
        documentoId
      )
      const [riga] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM righe_documento_fattura WHERE documento_id = $1::uuid LIMIT 1`,
        documentoId
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO marcatori_addebiti_fatturati (tenant_id, riga_addebito_id, tipo, chiave_competenza, documento_id, riga_documento_id)
         VALUES ($1::uuid, $2::uuid, 'SCADENZA_FISSO', '2026-03-31', $3::uuid, $4::uuid)`,
        s.t,
        s.rigaAddebitoIds[0],
        documentoId,
        riga.id
      )
      const altro = await azienda()
      const conteggi = async (tx: Tx, t: string) => {
        const out: Record<string, number> = {}
        for (const tabella of NOVE_TABELLE) {
          const [r] = await tx.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM ${tabella} WHERE tenant_id = $1::uuid`,
            t
          )
          out[tabella] = r.n
        }
        return out
      }
      const vuoto = Object.fromEntries(NOVE_TABELLE.map(t => [t, 0]))
      // Senza `app.tenant_id`: fail-closed.
      expect(await conteggi(app, s.t)).toEqual(vuoto)
      // Con un altro tenant attivo.
      expect(await comeApp(altro, tx => conteggi(tx, s.t))).toEqual(vuoto)
      // Col proprio: ogni tabella ha righe.
      const propri = await comeApp(s.t, tx => conteggi(tx, s.t))
      for (const tabella of NOVE_TABELLE) expect(propri[tabella]).toBeGreaterThan(0)
      // Una scrittura per un altro tenant e respinta dalla WITH CHECK.
      await expect(
        comeApp(altro, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO contatori_file_fatturapa (tenant_id, ultimo, updated_at) VALUES ($1::uuid, 1, now())`,
            s.t
          )
        )
      ).rejects.toThrow()
    })
  })

  describe('pulizia delle aziende di test', () => {
    it('pulisciTenantDiTest di un tenant con DEFINITIVO, ANNULLATO, marcatori e legami FATTURATO: nessuna riga rimasta, nessun errore su console', async () => {
      const t = await azienda()
      const sc = await creaScenarioFatturazione(owner, t, { legami: 3, conFissi: true })
      await creaCedenteDiTest(owner, t)
      await owner.$executeRawUnsafe(
        `INSERT INTO numerazioni_fattura (tenant_id, registro_iva_id, anno, ultimo_numero, updated_at)
         VALUES ($1::uuid, $2::uuid, 2026, 2, now())`,
        t,
        sc.registroIvaId
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO contatori_file_fatturapa (tenant_id, ultimo, updated_at) VALUES ($1::uuid, 2, now())`,
        t
      )
      const e = await inserisciElaborazione(owner, t, 'DEFINITIVA')
      const def = await creaDocumentoDiTest(owner, t, {
        stato: 'DEFINITIVO',
        registroIvaId: sc.registroIvaId,
        anno: 2026,
        numero: 1,
        legamiIds: [sc.legamiIds[0], sc.legamiIds[1]],
        elaborazioneId: e[0].id,
      })
      await creaDocumentoDiTest(owner, t, {
        stato: 'ANNULLATO',
        registroIvaId: sc.registroIvaId,
        anno: 2026,
        numero: 2,
        legamiIds: [sc.legamiIds[2]],
      })
      await creaDocumentoDiTest(owner, t, {
        stato: 'BOZZA',
        registroIvaId: sc.registroIvaId,
        anno: 2026,
      })
      const [riga] = await owner.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM righe_documento_fattura WHERE documento_id = $1::uuid LIMIT 1`,
        def.documentoId
      )
      await owner.$executeRawUnsafe(
        `INSERT INTO marcatori_addebiti_fatturati (tenant_id, riga_addebito_id, tipo, chiave_competenza, documento_id, riga_documento_id)
         VALUES ($1::uuid, $2::uuid, 'SCADENZA_FISSO', '2026-03-31', $3::uuid, $4::uuid)`,
        t,
        sc.rigaAddebitoIds[1],
        def.documentoId,
        riga.id
      )
      const [fatturati] = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM legami_movimento WHERE tenant_id = $1::uuid AND stato = 'FATTURATO'`,
        t
      )
      expect(fatturati.n).toBe(2)

      const errori = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        await pulisciTenantDiTest(owner, [t])
        expect(errori).not.toHaveBeenCalled()
      } finally {
        errori.mockRestore()
      }
      for (const tabella of [
        ...NOVE_TABELLE,
        'legami_movimento',
        'righe_legame_movimento',
        'waste_movements',
      ]) {
        expect({ tabella, righe: await conta(tabella, t) }).toEqual({ tabella, righe: 0 })
      }
      expect(await owner.tenant.count({ where: { id: t } })).toBe(0)
    })
  })
})
