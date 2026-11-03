/**
 * Schema dei legami movimento-cliente-prezzo (fase 4.3, Task 3) contro un Postgres reale:
 * `legami_movimento`, `righe_legame_movimento`, `impostazioni_fatturazione` e la colonna
 * `fatturabile` delle causali.
 *
 * Le scritture di prova si fanno col ruolo applicativo `wasteflow_app` dentro il contesto
 * dell'azienda (RLS e privilegi) con SQL esplicito: la spec prova i vincoli del database, non il
 * client generato. Il proprietario prepara i dati di partenza e legge lo stato finale. Pulizia solo
 * per id esatti.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import {
  creaCodiciIvaEcodifiche,
  creaContrattoConElenco,
  creaRiga,
} from '../../test-support/listino-di-test'
import { creaLegameDiTest, creaMovimentoDiTest } from '../../test-support/legami-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

const TRE_TABELLE = ['legami_movimento', 'righe_legame_movimento', 'impostazioni_fatturazione']

describe('Legami movimento: schema (Postgres reale, ruolo wasteflow_app)', () => {
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
    ivaId: string
    clienteId: string
    contrattoId: string
    elencoId: string
    rigaId: string
    movimentoId: string
    registroId: string
  }

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Legami SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  /** Azienda con codice IVA, cliente, contratto, elenco, una riga di listino e un movimento. */
  async function scenario(): Promise<Scenario> {
    const t = await azienda()
    const listino = await creaCodiciIvaEcodifiche(owner, t)
    const c = await creaContrattoConElenco(owner, t)
    const riga = await creaRiga(owner, t, c.elencoId, { codiceIvaId: listino.iva22Id })
    const m = await creaMovimentoDiTest(owner, t)
    return {
      t,
      ivaId: listino.iva22Id,
      clienteId: c.clienteId,
      contrattoId: c.contrattoId,
      elencoId: c.elencoId,
      rigaId: riga.id,
      movimentoId: m.movimentoId,
      registroId: m.registroId,
    }
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  interface DatiLegame {
    movimentoId?: string
    /** Movimento vigente; omesso = lo stesso dell'originale. */
    vigenteId?: string
    verso?: string
    stato?: string
    clienteId?: string | null
    fonteCliente?: string | null
    contrattoId?: string | null
    elencoId?: string | null
    motivi?: string[]
    avvisi?: string[]
    motivoEsclusione?: string | null
    fatturatoIl?: string | null
    scostamento?: boolean
  }

  /** Inserisce una testata di legame come `wasteflow_app`; senza `over` e' un `DA_COLLEGARE` vuoto. */
  function inserisciLegame(tx: Tx, s: Scenario, over: DatiLegame = {}) {
    const m = over.movimentoId ?? s.movimentoId
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO legami_movimento
         (tenant_id, registro_id, verso, movimento_originale_id, movimento_vigente_id, stato,
          data_movimento, cliente_id, fonte_cliente, contratto_id, elenco_id, motivi, avvisi,
          motivo_esclusione, fatturato_il, scostamento_dopo_fattura, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::waste_movement_type, $4::uuid, $15::uuid,
          $5::stato_legame_movimento, '2026-03-01'::date, $6::uuid, $7::fonte_cliente_legame,
          $8::uuid, $9::uuid, $10::text[], $11::text[], $12, $13::timestamp, $14::boolean, now())
       RETURNING id::text AS id`,
      s.t,
      s.registroId,
      over.verso ?? 'CARICO',
      m,
      over.stato ?? 'DA_COLLEGARE',
      over.clienteId === undefined ? null : over.clienteId,
      over.fonteCliente ?? null,
      over.contrattoId === undefined ? null : over.contrattoId,
      over.elencoId === undefined ? null : over.elencoId,
      over.motivi ?? [],
      over.avvisi ?? [],
      over.motivoEsclusione ?? null,
      over.fatturatoIl ?? null,
      over.scostamento ?? false,
      over.vigenteId ?? m
    )
  }

  /** Dati che rendono valido un legame completo (cliente, contratto, elenco dello scenario). */
  const completo = (s: Scenario): DatiLegame => ({
    clienteId: s.clienteId,
    contrattoId: s.contrattoId,
    elencoId: s.elencoId,
  })

  interface DatiRiga {
    elencoId?: string
    rigaAddebitoId?: string
    quantita?: string | null
    quantitaOrigine?: string | null
    prezzoSpeciale?: boolean
    prezzo?: string | null
    prezzoManuale?: boolean
    codiceIvaId?: string
    ordine?: number
  }

  function inserisciRiga(tx: Tx, s: Scenario, legameId: string, over: DatiRiga = {}) {
    const quantita = over.quantita === undefined ? '10' : over.quantita
    const origine =
      over.quantitaOrigine === undefined
        ? quantita === null
          ? null
          : 'DA_MOVIMENTO'
        : over.quantitaOrigine
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO righe_legame_movimento
         (tenant_id, legame_id, elenco_id, riga_addebito_id, ordine, origine, tipo, tipo_quantita,
          unita_misura, quantita, quantita_origine, prezzo_speciale, prezzo, prezzo_manuale,
          codice_iva_id, aliquota_iva, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::int, 'PRINCIPALE'::origine_riga_legame,
          'V', 'PESO_NETTO'::tipo_quantita_addebito, 'KG', $6::numeric,
          $7::origine_quantita_legame, $8::boolean, $9::numeric, $10::boolean, $11::uuid, 22, now())
       RETURNING id::text AS id`,
      s.t,
      legameId,
      over.elencoId ?? s.elencoId,
      over.rigaAddebitoId ?? s.rigaId,
      over.ordine ?? 1,
      quantita,
      origine,
      over.prezzoSpeciale ?? false,
      over.prezzo === undefined ? '1' : over.prezzo,
      over.prezzoManuale ?? false,
      over.codiceIvaId ?? s.ivaId
    )
  }

  const conta = (tabella: string, tenantId: string) =>
    owner
      .$queryRawUnsafe<
        { n: number }[]
      >(`SELECT count(*)::int AS n FROM ${tabella} WHERE tenant_id = $1::uuid`, tenantId)
      .then(r => r[0].n)

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = tenantCreati
      // FK composite NoAction: prima chi cita (legami e, a cascata, le loro righe), poi righe e
      // elenchi del listino, contratti, addebiti, codifiche e codici IVA.
      for (const tabella of [
        'legami_movimento',
        'righe_addebito',
        'elenchi_addebiti',
        'contratti_cliente',
        'addebiti',
        'codifiche_addebito',
        'codici_iva',
      ]) {
        await owner.$executeRawUnsafe(
          `DELETE FROM ${tabella} WHERE tenant_id = ANY($1::uuid[])`,
          in_
        )
      }
      await owner.tenant.deleteMany({ where: { id: { in: in_ } } })
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('flag fatturabile delle causali', () => {
    it('INGRESSO_ESTERNO CARICO e fatturabile; tutte le altre causali di sistema no (decisione 15)', async () => {
      const vere = await owner.$queryRawUnsafe<{ codice: string; verso: string }[]>(
        `SELECT codice, verso::text AS verso FROM causali_registro WHERE fatturabile ORDER BY 1, 2`
      )
      expect(vere).toEqual([{ codice: 'INGRESSO_ESTERNO', verso: 'CARICO' }])
      const [conteggio] = await owner.$queryRawUnsafe<{ spente: number; totale: number }[]>(
        `SELECT count(*) FILTER (WHERE NOT fatturabile)::int AS spente, count(*)::int AS totale
         FROM causali_registro`
      )
      expect(conteggio.totale).toBeGreaterThan(1)
      expect(conteggio.spente).toBe(conteggio.totale - 1)
    })

    it('la colonna di sistema non e nulla e ha default false', async () => {
      const [c] = await owner.$queryRawUnsafe<{ is_nullable: string; column_default: string }[]>(
        `SELECT is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'causali_registro' AND column_name = 'fatturabile'`
      )
      expect(c).toEqual({ is_nullable: 'NO', column_default: 'false' })
    })

    it('causale aziendale PROPRIA con fatturabile NULL respinta; DISATTIVAZIONE con NULL ammessa', async () => {
      const t = await azienda()
      const propria = (fatturabile: string) =>
        comeApp(t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO causali_registro_azienda
               (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, creato_da,
                fatturabile, updated_at)
             VALUES ($1::uuid, 'PROPRIA', 'AZ_FATT', 'CARICO', 'x', 'ESCLUSO', '2026-01-01',
                $2::uuid, ${fatturabile}, now())`,
            t,
            randomUUID()
          )
        )
      await expect(propria('NULL')).rejects.toThrow(/causali_registro_azienda_fatturabile_propria/)
      await expect(propria('true')).resolves.toBe(1)
      await comeApp(t, tx =>
        tx.$executeRawUnsafe(
          `INSERT INTO causali_registro_azienda
             (tenant_id, natura, codice, verso, causale_sistema_codice, creato_da, fatturabile, updated_at)
           VALUES ($1::uuid, 'DISATTIVAZIONE', 'RICLASSIFICAZIONE', 'CARICO', 'RICLASSIFICAZIONE',
             $2::uuid, NULL, now())`,
          t,
          randomUUID()
        )
      )
      const [d] = await owner.$queryRawUnsafe<{ fatturabile: boolean | null }[]>(
        `SELECT fatturabile FROM causali_registro_azienda
         WHERE tenant_id = $1::uuid AND natura = 'DISATTIVAZIONE'`,
        t
      )
      expect(d.fatturabile).toBeNull()
    })
  })

  describe('legami_movimento', () => {
    it('un legame DA_COLLEGARE vuoto e ammesso; secondo legame per la stessa catena: violazione di unicita', async () => {
      const s = await scenario()
      await expect(comeApp(s.t, tx => inserisciLegame(tx, s))).resolves.toHaveLength(1)
      await expect(comeApp(s.t, tx => inserisciLegame(tx, s))).rejects.toThrow(/`23505`/)
    })

    it('CONFERMATO senza elenco respinto; senza cliente respinto; con motivi non vuoti respinto', async () => {
      const s = await scenario()
      const dati = completo(s)
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { ...dati, stato: 'CONFERMATO', elencoId: null }))
      ).rejects.toThrow(/legami_movimento_completo_se_confermato/)
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { stato: 'CONFERMATO' }))
      ).rejects.toThrow(/legami_movimento_completo_se_confermato/)
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, { ...dati, stato: 'CONFERMATO', motivi: ['SENZA_PREZZO'] })
        )
      ).rejects.toThrow(/legami_movimento_completo_se_confermato/)
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, { ...dati, stato: 'CONFERMATO', avvisi: ['PREZZO_MANUALE'] })
        )
      ).resolves.toHaveLength(1)
    })

    it('PROPOSTO senza contratto respinto', async () => {
      const s = await scenario()
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, {
            stato: 'PROPOSTO',
            clienteId: s.clienteId,
            contrattoId: null,
            elencoId: null,
          })
        )
      ).rejects.toThrow(/legami_movimento_completo_se_proposto/)
    })

    it('contratto senza cliente o elenco senza contratto respinti (le FK composte non controllano i NULL)', async () => {
      const s = await scenario()
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { contrattoId: s.contrattoId }))
      ).rejects.toThrow(/legami_movimento_gerarchia_coerente/)
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { clienteId: s.clienteId, elencoId: s.elencoId }))
      ).rejects.toThrow(/legami_movimento_gerarchia_coerente/)
    })

    it('motivo o avviso fuori dall insieme chiuso respinti; i codici dell insieme passano', async () => {
      const s = await scenario()
      await expect(comeApp(s.t, tx => inserisciLegame(tx, s, { motivi: ['FOO'] }))).rejects.toThrow(
        /legami_movimento_motivi_ammessi/
      )
      await expect(comeApp(s.t, tx => inserisciLegame(tx, s, { avvisi: ['FOO'] }))).rejects.toThrow(
        /legami_movimento_avvisi_ammessi/
      )
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, {
            motivi: ['SENZA_CLIENTE', 'SENZA_QUANTITA'],
            avvisi: ['CLIENTE_NON_DA_FIR', 'PREZZO_MANUALE', 'CONTRATTO_ALTRA_SEDE'],
          })
        )
      ).resolves.toHaveLength(1)
    })

    it('stato fatturato senza fatturato_il respinto; fatturato_il con stato non fatturato respinto', async () => {
      const s = await scenario()
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { ...completo(s), stato: 'FATTURATO' }))
      ).rejects.toThrow(/legami_movimento_fatturato_coerente/)
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, {
            ...completo(s),
            stato: 'CONFERMATO',
            fatturatoIl: '2026-04-01T00:00:00',
          })
        )
      ).rejects.toThrow(/legami_movimento_fatturato_coerente/)
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, {
            ...completo(s),
            stato: 'IMPORTATO_FATTURATO',
            fatturatoIl: '2026-04-01T00:00:00',
          })
        )
      ).resolves.toHaveLength(1)
    })

    it('ESCLUSO senza motivo (o con motivo di soli spazi) respinto; con motivo ammesso', async () => {
      const s = await scenario()
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { stato: 'ESCLUSO' }))
      ).rejects.toThrow(/legami_movimento_escluso_con_motivo/)
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { stato: 'ESCLUSO', motivoEsclusione: '   ' }))
      ).rejects.toThrow(/legami_movimento_motivo_esclusione_ammesso/)
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, { stato: 'ESCLUSO', motivoEsclusione: 'Causale non fatturabile' })
        )
      ).resolves.toHaveLength(1)
    })

    it('scostamento_dopo_fattura vero con stato CONFERMATO respinto; con FATTURATO ammesso', async () => {
      const s = await scenario()
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, { ...completo(s), stato: 'CONFERMATO', scostamento: true })
        )
      ).rejects.toThrow(/legami_movimento_scostamento_solo_se_fatturato/)
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, {
            ...completo(s),
            stato: 'FATTURATO',
            fatturatoIl: '2026-04-01T00:00:00',
            scostamento: true,
          })
        )
      ).resolves.toHaveLength(1)
    })

    it('elenco di un altro contratto respinto (FK composta)', async () => {
      const s = await scenario()
      const altro = await creaContrattoConElenco(owner, s.t)
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, {
            clienteId: s.clienteId,
            contrattoId: s.contrattoId,
            elencoId: altro.elencoId,
          })
        )
      ).rejects.toThrow(/legami_movimento_elenco_fkey/)
    })

    it('contratto di un altro cliente respinto (FK composta)', async () => {
      const s = await scenario()
      const altro = await creaContrattoConElenco(owner, s.t)
      await expect(
        comeApp(s.t, tx =>
          inserisciLegame(tx, s, {
            clienteId: s.clienteId,
            contrattoId: altro.contrattoId,
            elencoId: altro.elencoId,
          })
        )
      ).rejects.toThrow(/legami_movimento_contratto_fkey/)
    })

    it('verso diverso da quello del movimento respinto; movimento di un altro tenant respinto', async () => {
      const s = await scenario()
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { verso: 'SCARICO' }))
      ).rejects.toThrow(/legami_movimento_originale_fkey/)
      const altra = await scenario()
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { movimentoId: altra.movimentoId }))
      ).rejects.toThrow(/legami_movimento_originale_fkey/)
    })

    it('un movimento citato da un legame non si elimina (NoAction)', async () => {
      const s = await scenario()
      await comeApp(s.t, tx => inserisciLegame(tx, s))
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM waste_movements WHERE id = $1::uuid`, s.movimentoId)
      ).rejects.toThrow(/`23503`/)
    })

    it('un cliente senza contratti, citato da un legame, non si elimina: lo blocca legami_movimento_cliente_fkey', async () => {
      const s = await scenario()
      const solo = await creaDittaConRuolo(owner, s.t, 'CLIENTE', {
        ragioneSociale: 'Solo cliente',
      })
      await comeApp(s.t, tx => inserisciLegame(tx, s, { clienteId: solo.ruoloId }))
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM clienti WHERE id = $1::uuid`, solo.ruoloId)
      ).rejects.toThrow(/legami_movimento_cliente_fkey/)
    })

    it('un contratto e un elenco citati da un legame non si eliminano (23503, FK del legame)', async () => {
      const s = await scenario()
      await creaLegameDiTest(owner, s.t, {
        movimentoOriginaleId: s.movimentoId,
        registroId: s.registroId,
        verso: 'CARICO',
        stato: 'PROPOSTO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
      })
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM elenchi_addebiti WHERE id = $1::uuid`, s.elencoId)
      ).rejects.toThrow(/legami_movimento_elenco_fkey/)
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM contratti_cliente WHERE id = $1::uuid`, s.contrattoId)
      ).rejects.toThrow(/legami_movimento_(contratto|elenco)_fkey/)
    })

    it('movimento vigente: diverso dall originale ammesso; di un altro verso o di un altro tenant respinto', async () => {
      const s = await scenario()
      const rettifica = await creaMovimentoDiTest(owner, s.t, { movementDate: '2026-03-02' })
      await expect(
        comeApp(s.t, tx => inserisciLegame(tx, s, { vigenteId: rettifica.movimentoId }))
      ).resolves.toHaveLength(1)
      const s2 = await scenario()
      const scarico = await creaMovimentoDiTest(owner, s2.t, { type: 'SCARICO' })
      await expect(
        comeApp(s2.t, tx => inserisciLegame(tx, s2, { vigenteId: scarico.movimentoId }))
      ).rejects.toThrow(/legami_movimento_vigente_fkey/)
      const altra = await scenario()
      const s3 = await scenario()
      await expect(
        comeApp(s3.t, tx => inserisciLegame(tx, s3, { vigenteId: altra.movimentoId }))
      ).rejects.toThrow(/legami_movimento_vigente_fkey/)
    })

    it('il movimento vigente citato da un legame non si elimina (legami_movimento_vigente_fkey)', async () => {
      const s = await scenario()
      const rettifica = await creaMovimentoDiTest(owner, s.t, { movementDate: '2026-03-02' })
      await comeApp(s.t, tx => inserisciLegame(tx, s, { vigenteId: rettifica.movimentoId }))
      await expect(
        owner.$executeRawUnsafe(
          `DELETE FROM waste_movements WHERE id = $1::uuid`,
          rettifica.movimentoId
        )
      ).rejects.toThrow(/legami_movimento_vigente_fkey/)
    })
  })

  describe('righe_legame_movimento', () => {
    async function legameConElenco(s: Scenario): Promise<string> {
      const [l] = await comeApp(s.t, tx =>
        inserisciLegame(tx, s, { ...completo(s), stato: 'PROPOSTO' })
      )
      return l.id
    }

    it('una riga completa e ammessa; prezzo_manuale ha default false', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      const [r] = await comeApp(s.t, tx => inserisciRiga(tx, s, l))
      const [letta] = await owner.$queryRawUnsafe<{ prezzo_manuale: boolean }[]>(
        `SELECT prezzo_manuale FROM righe_legame_movimento WHERE id = $1::uuid`,
        r.id
      )
      expect(letta.prezzo_manuale).toBe(false)
      const [colonna] = await owner.$queryRawUnsafe<
        { is_nullable: string; column_default: string }[]
      >(
        `SELECT is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'righe_legame_movimento' AND column_name = 'prezzo_manuale'`
      )
      expect(colonna).toEqual({ is_nullable: 'NO', column_default: 'false' })
    })

    it('stessa riga di listino due volte nel legame: violazione di unicita', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      await comeApp(s.t, tx => inserisciRiga(tx, s, l, { ordine: 1 }))
      await expect(comeApp(s.t, tx => inserisciRiga(tx, s, l, { ordine: 2 }))).rejects.toThrow(
        /`23505`/
      )
    })

    it('riga con prezzo_speciale e prezzo valorizzato respinta; riga a prezzo speciale senza prezzo ammessa', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      await expect(
        comeApp(s.t, tx => inserisciRiga(tx, s, l, { prezzoSpeciale: true, prezzo: '1' }))
      ).rejects.toThrow(/righe_legame_movimento_speciale_senza_prezzo/)
      await expect(
        comeApp(s.t, tx => inserisciRiga(tx, s, l, { prezzoSpeciale: true, prezzo: null }))
      ).resolves.toHaveLength(1)
    })

    it('riga con prezzo_manuale e prezzo_speciale respinta; con prezzo NULL respinta; a prezzo singolo ammessa', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      await expect(
        comeApp(s.t, tx =>
          inserisciRiga(tx, s, l, { prezzoManuale: true, prezzoSpeciale: true, prezzo: null })
        )
      ).rejects.toThrow(/righe_legame_movimento_prezzo_manuale_ammesso/)
      await expect(
        comeApp(s.t, tx => inserisciRiga(tx, s, l, { prezzoManuale: true, prezzo: null }))
      ).rejects.toThrow(/righe_legame_movimento_prezzo_manuale_ammesso/)
      await expect(
        comeApp(s.t, tx => inserisciRiga(tx, s, l, { prezzoManuale: true, prezzo: '2.5' }))
      ).resolves.toHaveLength(1)
    })

    it('quantita NULL con quantita_origine DA_MOVIMENTO respinta, e viceversa', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      await expect(
        comeApp(s.t, tx =>
          inserisciRiga(tx, s, l, { quantita: null, quantitaOrigine: 'DA_MOVIMENTO' })
        )
      ).rejects.toThrow(/righe_legame_movimento_quantita_coerente/)
      await expect(
        comeApp(s.t, tx => inserisciRiga(tx, s, l, { quantita: '5', quantitaOrigine: null }))
      ).rejects.toThrow(/righe_legame_movimento_quantita_coerente/)
      await expect(
        comeApp(s.t, tx => inserisciRiga(tx, s, l, { quantita: null, quantitaOrigine: null }))
      ).resolves.toHaveLength(1)
    })

    it('quantita manuale zero o negativa respinta; prezzo negativo respinto', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      for (const q of ['0', '-1'])
        await expect(
          comeApp(s.t, tx => inserisciRiga(tx, s, l, { quantita: q, quantitaOrigine: 'MANUALE' }))
        ).rejects.toThrow(/righe_legame_movimento_quantita_manuale_positiva/)
      await expect(comeApp(s.t, tx => inserisciRiga(tx, s, l, { prezzo: '-0.5' }))).rejects.toThrow(
        /righe_legame_movimento_prezzo_non_negativo/
      )
      await expect(
        comeApp(s.t, tx =>
          inserisciRiga(tx, s, l, { quantita: '0.001', quantitaOrigine: 'MANUALE' })
        )
      ).resolves.toHaveLength(1)
    })

    it('riga di un elenco diverso dall elenco del legame respinta', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      const altro = await creaContrattoConElenco(owner, s.t)
      const rigaAltra = await creaRiga(owner, s.t, altro.elencoId, { codiceIvaId: s.ivaId })
      // elenco del legame, ma riga di listino dell'altro elenco
      await expect(
        comeApp(s.t, tx => inserisciRiga(tx, s, l, { rigaAddebitoId: rigaAltra.id }))
      ).rejects.toThrow(/righe_legame_movimento_riga_addebito_fkey/)
      // riga di listino giusta, ma elenco diverso da quello del legame
      await expect(
        comeApp(s.t, tx =>
          inserisciRiga(tx, s, l, { elencoId: altro.elencoId, rigaAddebitoId: rigaAltra.id })
        )
      ).rejects.toThrow(/righe_legame_movimento_legame_fkey/)
    })

    it('eliminare una riga di listino usata fallisce (23503); una non usata si elimina', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      await comeApp(s.t, tx => inserisciRiga(tx, s, l))
      await expect(
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(`DELETE FROM righe_addebito WHERE id = $1::uuid`, s.rigaId)
        )
      ).rejects.toThrow(/righe_legame_movimento_riga_addebito_fkey/)
      const libera = await creaRiga(owner, s.t, s.elencoId, {
        tipo: 'CER',
        codiceIvaId: s.ivaId,
      })
      await expect(
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(`DELETE FROM righe_addebito WHERE id = $1::uuid`, libera.id)
        )
      ).resolves.toBe(1)
    })

    it('eliminare un elenco con una riga usata fallisce anche a cascata (23503)', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      await comeApp(s.t, tx => inserisciRiga(tx, s, l))
      await expect(
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(`DELETE FROM elenchi_addebiti WHERE id = $1::uuid`, s.elencoId)
        )
      ).rejects.toThrow(/`23503`/)
      expect(await conta('righe_addebito', s.t)).toBe(1)
    })

    it('eliminare un codice IVA usato da una riga del legame fallisce (23503)', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      await comeApp(s.t, tx => inserisciRiga(tx, s, l))
      // il codice IVA e citato anche dalla riga di listino: tolgo prima quella dal conto, lasciando
      // solo la riga del legame come ragione del rifiuto
      await owner.$executeRawUnsafe(
        `UPDATE righe_addebito SET codice_iva_id = (SELECT id FROM codici_iva WHERE tenant_id = $1::uuid AND codice = 'N61')
         WHERE tenant_id = $1::uuid`,
        s.t
      )
      await expect(
        comeApp(s.t, tx =>
          tx.$executeRawUnsafe(`DELETE FROM codici_iva WHERE id = $1::uuid`, s.ivaId)
        )
      ).rejects.toThrow(/righe_legame_movimento_codice_iva_fkey/)
    })

    it('cancellare la testata toglie le righe (CASCADE)', async () => {
      const s = await scenario()
      const l = await legameConElenco(s)
      await comeApp(s.t, tx => inserisciRiga(tx, s, l))
      expect(await conta('righe_legame_movimento', s.t)).toBe(1)
      await comeApp(s.t, tx =>
        tx.$executeRawUnsafe(`DELETE FROM legami_movimento WHERE id = $1::uuid`, l)
      )
      expect(await conta('righe_legame_movimento', s.t)).toBe(0)
    })
  })

  describe('impostazioni_fatturazione', () => {
    const imposta = (t: string, data: string | null) =>
      comeApp(t, tx =>
        tx.$executeRawUnsafe(
          `INSERT INTO impostazioni_fatturazione (tenant_id, fatturazione_da, updated_at)
           VALUES ($1::uuid, $2::date, now())`,
          t,
          data
        )
      )

    it('una riga per azienda: la seconda e una violazione di unicita; data vuota ammessa', async () => {
      const t = await azienda()
      await expect(imposta(t, null)).resolves.toBe(1)
      await expect(imposta(t, '2026-01-01')).rejects.toThrow(/`23505`/)
    })

    it('versione parte da 1', async () => {
      const t = await azienda()
      await imposta(t, '2026-01-01')
      const [r] = await owner.$queryRawUnsafe<{ versione: number }[]>(
        `SELECT versione FROM impostazioni_fatturazione WHERE tenant_id = $1::uuid`,
        t
      )
      expect(r.versione).toBe(1)
    })
  })

  describe('RLS, tenant e catalogo', () => {
    it('le tre tabelle hanno ENABLE e FORCE e le due policy standard', async () => {
      const righe = await owner.$queryRawUnsafe<
        { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
      >(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname = ANY($1::text[])
         ORDER BY 1`,
        TRE_TABELLE
      )
      expect(righe.map(r => r.relname)).toEqual([...TRE_TABELLE].sort())
      for (const r of righe) expect([r.relrowsecurity, r.relforcerowsecurity]).toEqual([true, true])
      for (const tabella of TRE_TABELLE) {
        const policy = await owner.$queryRawUnsafe<{ policyname: string }[]>(
          `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`,
          tabella
        )
        expect(policy.map(p => p.policyname)).toEqual(['isolamento_azienda', 'sola_lettura'])
      }
    })

    it('senza tenant attivo e con un altro tenant le tre tabelle sono vuote; col proprio no', async () => {
      const s = await scenario()
      const l = await creaLegameDiTest(owner, s.t, {
        movimentoOriginaleId: s.movimentoId,
        registroId: s.registroId,
        verso: 'CARICO',
        stato: 'PROPOSTO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [{ rigaAddebitoId: s.rigaId, codiceIvaId: s.ivaId, quantita: '10' }],
      })
      await owner.$executeRawUnsafe(
        `INSERT INTO impostazioni_fatturazione (tenant_id, fatturazione_da, updated_at)
         VALUES ($1::uuid, '2026-01-01', now())`,
        s.t
      )
      expect(l.righeIds).toHaveLength(1)
      const altro = await azienda()
      const conteggi = async (tx: Tx) => {
        const out: number[] = []
        for (const tabella of TRE_TABELLE) {
          const [r] = await tx.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM ${tabella} WHERE id IS NOT NULL AND tenant_id = $1::uuid`,
            s.t
          )
          out.push(r.n)
        }
        return out
      }
      expect(await conteggi(app)).toEqual([0, 0, 0])
      expect(await comeApp(altro, conteggi)).toEqual([0, 0, 0])
      expect(await comeApp(s.t, conteggi)).toEqual([1, 1, 1])
      // un altro tenant non puo nemmeno scrivere nel tenant altrui
      await expect(
        comeApp(altro, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO impostazioni_fatturazione (tenant_id, updated_at) VALUES ($1::uuid, now())`,
            s.t
          )
        )
      ).rejects.toThrow(/row-level security/)
    })

    it('cancellare l azienda toglie legami, righe, impostazioni e movimenti (cascata)', async () => {
      const s = await scenario()
      await creaLegameDiTest(owner, s.t, {
        movimentoOriginaleId: s.movimentoId,
        registroId: s.registroId,
        verso: 'CARICO',
        stato: 'PROPOSTO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [{ rigaAddebitoId: s.rigaId, codiceIvaId: s.ivaId, quantita: '10' }],
      })
      await owner.tenant.delete({ where: { id: s.t } })
      for (const tabella of [...TRE_TABELLE, 'waste_movements', 'righe_addebito'])
        expect(await conta(tabella, s.t)).toBe(0)
    })

    it('waste_movements non ha colonne nuove', async () => {
      const colonne = await owner.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'waste_movements' ORDER BY column_name`
      )
      expect(colonne.map(c => c.column_name)).toEqual(
        [
          'causale',
          'causale_azienda_id',
          'cer_code',
          'counterpart_address',
          'counterpart_name',
          'created_at',
          'entry_hash',
          'fir_id',
          'fir_id_ricopia',
          'hash_versione',
          'id',
          'motivo_annotazione',
          'movement_date',
          'movimento_originale_id',
          'movimento_rettificato_id',
          'notes',
          'operation_code',
          'progressive_number',
          'progressive_year',
          'quantity',
          'recorded_by_user_id',
          'registro_id',
          'registration_date',
          'ricopia_chiave',
          'tenant_id',
          'tipo_annotazione',
          'type',
          'unit',
          'updated_at',
          'waste_hazard_classes',
          'waste_physical_state',
          'waste_description',
        ].sort()
      )
    })
  })
})
