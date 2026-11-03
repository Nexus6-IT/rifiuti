/**
 * Schema B del listino (Fase 4 pezzo 2b, Task 19) contro un Postgres reale: `elenchi_addebiti`,
 * `allegati_elenco_addebiti`, `righe_addebito`, `scaglioni_riga_addebito`, `scadenze_riga_addebito`.
 *
 * Le scritture si fanno col ruolo applicativo `wasteflow_app` dentro il contesto dell'azienda (RLS e
 * privilegi) con SQL esplicito: la spec prova i vincoli del database, non il client generato. Il
 * proprietario prepara aziende, clienti e contratti e legge lo stato finale. Pulizia solo per id
 * esatti.
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

const CINQUE_TABELLE = [
  'elenchi_addebiti',
  'allegati_elenco_addebiti',
  'righe_addebito',
  'scaglioni_riga_addebito',
  'scadenze_riga_addebito',
]

describe('Listino, elenchi e righe: schema (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []
  let n = 0

  type Tx = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe' | '$queryRaw'>

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Listino elenchi SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  const codice3 = () => String(++n).padStart(3, '0').slice(-3)
  const codice5 = () => String(++n).padStart(5, '0').slice(-5)

  /** Contratto di un cliente nuovo (il proprietario scrive: nessun contesto). */
  async function contratto(t: string): Promise<string> {
    const c = await creaDittaConRuolo(owner, t, 'CLIENTE', { ragioneSociale: 'Cliente elenchi' })
    const k = await owner.contrattoCliente.create({
      data: {
        tenantId: t,
        clienteId: c.ruoloId,
        numero: `CC-2026-${String(++n).padStart(4, '0')}`,
        descrizione: 'Contratto di prova',
        dataInizio: new Date('2026-01-01'),
      },
    })
    return k.id
  }

  async function codiceIva(t: string): Promise<string> {
    const r = await comeApp(t, tx =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO codici_iva (tenant_id, codice, descrizione, aliquota, updated_at)
         VALUES ($1::uuid, $2, 'IVA di prova', 22, now()) RETURNING id::text AS id`,
        t,
        `I${codice3().slice(-2)}`
      )
    )
    return r[0].id
  }

  async function codifica(t: string, genere = 'CATEGORIA'): Promise<string> {
    const r = await comeApp(t, tx =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO codifiche_addebito (tenant_id, genere, codice, descrizione, updated_at)
         VALUES ($1::uuid, $2::genere_codifica_addebito, $3, 'Codifica di prova', now())
         RETURNING id::text AS id`,
        t,
        genere,
        codice3()
      )
    )
    return r[0].id
  }

  async function addebito(t: string): Promise<string> {
    const g = await codifica(t, 'GRUPPO')
    const r = await comeApp(t, tx =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO addebiti (tenant_id, codice, descrizione, gruppo_id, unita_misura, updated_at)
         VALUES ($1::uuid, $2, 'Addebito di prova', $3::uuid, 'NR', now()) RETURNING id::text AS id`,
        t,
        codice5(),
        g
      )
    )
    return r[0].id
  }

  function inserisciElenco(tx: Tx, t: string, contrattoId: string, codice = codice3(), extra = '') {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO elenchi_addebiti (tenant_id, contratto_id, codice, descrizione, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, 'Elenco di prova', now()) ${extra} RETURNING id::text AS id`,
      t,
      contrattoId,
      codice
    )
  }

  async function elenco(
    t: string,
    contrattoId?: string
  ): Promise<{ id: string; contrattoId: string }> {
    const k = contrattoId ?? (await contratto(t))
    const r = await comeApp(t, tx => inserisciElenco(tx, t, k))
    return { id: r[0].id, contrattoId: k }
  }

  interface DatiRiga {
    tipo?: string
    cerCode?: string | null
    addebitoId?: string | null
    riferimento?: string | null
    tipoQuantita?: string | null
    prezzo?: string | null
    prezzoSpeciale?: boolean
    minimo?: string | null
    condizione?: number | null
    giorno?: number | null
    mese?: number | null
    codiceIvaId: string
    categoriaId?: string | null
    centroRicavoId?: string | null
  }

  function inserisciRiga(tx: Tx, t: string, elencoId: string, d: DatiRiga) {
    const tipo = d.tipo ?? 'CER'
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO righe_addebito
         (tenant_id, elenco_id, tipo, cer_code, addebito_id, riferimento, tipo_quantita, unita_misura,
          prezzo, prezzo_speciale, minimo_fatturabile, condizione, riferimento_giorno,
          riferimento_mese, codice_iva_id, categoria_id, centro_ricavo_id, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7::tipo_quantita_addebito, 'KG',
          $8::numeric, $9, $10::numeric, $11, $12, $13, $14::uuid, $15::uuid, $16::uuid, now())
       RETURNING id::text AS id`,
      t,
      elencoId,
      tipo,
      d.cerCode === undefined ? (tipo === 'CER' ? '20 03 01' : null) : d.cerCode,
      d.addebitoId ?? null,
      d.riferimento ?? null,
      d.tipoQuantita === undefined
        ? tipo === 'CER' || tipo === 'V'
          ? 'PESO_NETTO'
          : null
        : d.tipoQuantita,
      d.prezzoSpeciale ? (d.prezzo ?? null) : (d.prezzo ?? '1.5'),
      d.prezzoSpeciale ?? false,
      d.minimo ?? null,
      d.condizione ?? null,
      d.giorno ?? null,
      d.mese ?? null,
      d.codiceIvaId,
      d.categoriaId ?? null,
      d.centroRicavoId ?? null
    )
  }

  const fascia = (tx: Tx, t: string, rigaId: string, ordine: number, tipoCalcolo = 'A') =>
    tx.$executeRawUnsafe(
      `INSERT INTO scaglioni_riga_addebito (tenant_id, riga_id, ordine, fino_a, prezzo, tipo_calcolo)
       VALUES ($1::uuid, $2::uuid, $3, 100, 0.10, $4)`,
      t,
      rigaId,
      ordine,
      tipoCalcolo
    )

  const scadenza = (tx: Tx, t: string, rigaId: string, ordine: number, giorno = 15, mese = 3) =>
    tx.$executeRawUnsafe(
      `INSERT INTO scadenze_riga_addebito (tenant_id, riga_id, ordine, giorno, mese)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
      t,
      rigaId,
      ordine,
      giorno,
      mese
    )

  const allegato = (tx: Tx, t: string, elencoId: string, posizione: number) =>
    tx.$executeRawUnsafe(
      `INSERT INTO allegati_elenco_addebiti
         (tenant_id, elenco_id, posizione, nome_file, mime_type, dimensione_byte, sha256, contenuto,
          caricato_da)
       VALUES ($1::uuid, $2::uuid, $3, 'a.pdf', 'application/pdf', 4, repeat('a', 64), '\\x25504446',
          gen_random_uuid())`,
      t,
      elencoId,
      posizione
    )

  const conta = (tabella: string, colonna: string, id: string) =>
    owner
      .$queryRawUnsafe<
        { n: number }[]
      >(`SELECT count(*)::int AS n FROM ${tabella} WHERE ${colonna} = $1::uuid`, id)
      .then(r => r[0].n)

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = tenantCreati
      // FK composite NoAction: prima chi cita (le righe cancellano fasce e scadenze a cascata), poi
      // gli elenchi, i contratti, gli addebiti, le codifiche e i codici IVA.
      for (const tabella of [
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

  describe('elenchi_addebiti', () => {
    it('due elenchi con lo stesso codice nello stesso contratto: violazione di unicita; in contratti diversi ammessi', async () => {
      const t = await azienda()
      const k1 = await contratto(t)
      const k2 = await contratto(t)
      await comeApp(t, tx => inserisciElenco(tx, t, k1, '001'))
      await expect(comeApp(t, tx => inserisciElenco(tx, t, k1, '001'))).rejects.toThrow(/`23505`/)
      await expect(comeApp(t, tx => inserisciElenco(tx, t, k2, '001'))).resolves.toHaveLength(1)
    })

    it('codice non ammesso respinto', async () => {
      const t = await azienda()
      const k = await contratto(t)
      await expect(comeApp(t, tx => inserisciElenco(tx, t, k, 'AB-'))).rejects.toThrow(
        /elenchi_addebiti_codice_ammesso/
      )
      await expect(comeApp(t, tx => inserisciElenco(tx, t, k, 'ABCD'))).rejects.toThrow(
        /value too long/
      )
    })

    it('codice 000 respinto dal database (decisione del 3 novembre 2026); 001 e 00A passano', async () => {
      const t = await azienda()
      const k = await contratto(t)
      await expect(comeApp(t, tx => inserisciElenco(tx, t, k, '000'))).rejects.toThrow(
        /elenchi_addebiti_codice_non_000/
      )
      await comeApp(t, tx => inserisciElenco(tx, t, k, '001'))
      await comeApp(t, tx => inserisciElenco(tx, t, k, '00A'))
    })

    it('validita con una sola data respinta, fine prima dell inizio respinta', async () => {
      const t = await azienda()
      const k = await contratto(t)
      const con = (cols: string, vals: string) =>
        comeApp(t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO elenchi_addebiti (tenant_id, contratto_id, codice, descrizione, ${cols}, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, 'x', ${vals}, now())`,
            t,
            k,
            codice3()
          )
        )
      await expect(con('valido_dal', "'2026-01-01'")).rejects.toThrow(
        /elenchi_addebiti_validita_coerente/
      )
      await expect(con('valido_dal, valido_al', "'2026-02-01', '2026-01-01'")).rejects.toThrow(
        /elenchi_addebiti_validita_coerente/
      )
      await expect(con('valido_dal, valido_al', "'2026-01-01', '2026-01-01'")).resolves.toBe(1)
    })

    it('data del documento della PA senza il documento respinta', async () => {
      const t = await azienda()
      const k = await contratto(t)
      await expect(
        comeApp(t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO elenchi_addebiti (tenant_id, contratto_id, codice, descrizione, data_documento_pa, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, 'x', '2026-01-01', now())`,
            t,
            k,
            codice3()
          )
        )
      ).rejects.toThrow(/elenchi_addebiti_documento_pa_coerente/)
    })

    it('FK composita: elenco con il contratto di un altro tenant respinto', async () => {
      const a = await azienda()
      const b = await azienda()
      const contrattoDiB = await contratto(b)
      await expect(comeApp(a, tx => inserisciElenco(tx, a, contrattoDiB))).rejects.toThrow(
        /elenchi_addebiti_contratto_fkey/
      )
    })

    it("cancellare l'elenco cancella righe, fasce, scadenze e allegati", async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const riga = await comeApp(t, tx => inserisciRiga(tx, t, e.id, { codiceIvaId: iva }))
      await comeApp(t, async tx => {
        await fascia(tx, t, riga[0].id, 1)
        await scadenza(tx, t, riga[0].id, 1)
        await allegato(tx, t, e.id, 1)
      })
      expect(await conta('righe_addebito', 'elenco_id', e.id)).toBe(1)
      expect(await conta('scaglioni_riga_addebito', 'riga_id', riga[0].id)).toBe(1)
      expect(await conta('scadenze_riga_addebito', 'riga_id', riga[0].id)).toBe(1)
      expect(await conta('allegati_elenco_addebiti', 'elenco_id', e.id)).toBe(1)
      await comeApp(t, tx =>
        tx.$executeRawUnsafe('DELETE FROM elenchi_addebiti WHERE id = $1::uuid', e.id)
      )
      expect(await conta('righe_addebito', 'elenco_id', e.id)).toBe(0)
      expect(await conta('scaglioni_riga_addebito', 'riga_id', riga[0].id)).toBe(0)
      expect(await conta('scadenze_riga_addebito', 'riga_id', riga[0].id)).toBe(0)
      expect(await conta('allegati_elenco_addebiti', 'elenco_id', e.id)).toBe(0)
    })

    it('allegati: posizione 3 respinta, stessa posizione due volte respinta', async () => {
      const t = await azienda()
      const e = await elenco(t)
      await expect(comeApp(t, tx => allegato(tx, t, e.id, 3))).rejects.toThrow(
        /allegati_elenco_addebiti_valori/
      )
      await comeApp(t, tx => allegato(tx, t, e.id, 1))
      await expect(comeApp(t, tx => allegato(tx, t, e.id, 1))).rejects.toThrow(/`23505`/)
    })
  })

  describe('righe_addebito', () => {
    it('riga CER senza cer_code respinta', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      await expect(
        comeApp(t, tx =>
          inserisciRiga(tx, t, e.id, { tipo: 'CER', cerCode: null, codiceIvaId: iva })
        )
      ).rejects.toThrow(/righe_addebito_cer_coerente/)
    })

    it('riga CER con addebito_id respinta', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const ad = await addebito(t)
      await expect(
        comeApp(t, tx =>
          inserisciRiga(tx, t, e.id, { tipo: 'CER', addebitoId: ad, codiceIvaId: iva })
        )
      ).rejects.toThrow(/righe_addebito_addebito_coerente/)
    })

    it('riga V con cer_code respinta; riga V con addebito ammessa', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const ad = await addebito(t)
      await expect(
        comeApp(t, tx =>
          inserisciRiga(tx, t, e.id, {
            tipo: 'V',
            cerCode: '20 03 01',
            addebitoId: ad,
            codiceIvaId: iva,
          })
        )
      ).rejects.toThrow(/righe_addebito_cer_coerente/)
      await expect(
        comeApp(t, tx =>
          inserisciRiga(tx, t, e.id, { tipo: 'V', addebitoId: ad, codiceIvaId: iva })
        )
      ).resolves.toHaveLength(1)
    })

    it('riga non CER senza addebito respinta', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, e.id, { tipo: 'F', cerCode: null, codiceIvaId: iva }))
      ).rejects.toThrow(/righe_addebito_addebito_coerente/)
    })

    it('tipo "TX" respinto; tipi ammessi (T123, M123, $D, MW) accettati', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const ad = await addebito(t)
      await expect(
        comeApp(t, tx =>
          inserisciRiga(tx, t, e.id, {
            tipo: 'TX',
            cerCode: null,
            addebitoId: ad,
            codiceIvaId: iva,
          })
        )
      ).rejects.toThrow(/righe_addebito_tipo_ammesso/)
      for (const tipo of ['T123', 'M123', '$D', 'MW']) {
        await expect(
          comeApp(t, tx =>
            inserisciRiga(tx, t, e.id, { tipo, cerCode: null, addebitoId: ad, codiceIvaId: iva })
          )
        ).resolves.toHaveLength(1)
      }
    })

    it('prezzo negativo respinto; prezzo assente senza prezzo speciale respinto; con prezzo speciale ammesso', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, e.id, { prezzo: '-0.01', codiceIvaId: iva }))
      ).rejects.toThrow(/righe_addebito_prezzo_ammesso/)
      await expect(
        comeApp(t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO righe_addebito (tenant_id, elenco_id, tipo, cer_code, tipo_quantita, unita_misura,
               prezzo, prezzo_speciale, codice_iva_id, riferimento, updated_at)
             VALUES ($1::uuid, $2::uuid, 'CER', '20 03 01', 'PESO_NETTO', 'KG', NULL, false, $3::uuid, 'X', now())`,
            t,
            e.id,
            iva
          )
        )
      ).rejects.toThrow(/righe_addebito_prezzo_presente/)
      await expect(
        comeApp(t, tx =>
          inserisciRiga(tx, t, e.id, {
            prezzoSpeciale: true,
            prezzo: null,
            riferimento: 'S',
            codiceIvaId: iva,
          })
        )
      ).resolves.toHaveLength(1)
    })

    it('prezzo speciale con minimo respinto', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      await expect(
        comeApp(t, tx =>
          inserisciRiga(tx, t, e.id, {
            prezzoSpeciale: true,
            prezzo: null,
            minimo: '10',
            codiceIvaId: iva,
          })
        )
      ).rejects.toThrow(/righe_addebito_speciale_senza_minimo/)
    })

    it('condizione 10, giorno 32 e mese 13 respinti', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, e.id, { condizione: 10, codiceIvaId: iva }))
      ).rejects.toThrow(/righe_addebito_condizione_ammessa/)
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, e.id, { giorno: 32, codiceIvaId: iva }))
      ).rejects.toThrow(/righe_addebito_riferimento_giorno_ammesso/)
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, e.id, { mese: 13, codiceIvaId: iva }))
      ).rejects.toThrow(/righe_addebito_riferimento_mese_ammesso/)
    })

    it('tipo di quantita mancante su una riga CER respinto', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, e.id, { tipoQuantita: null, codiceIvaId: iva }))
      ).rejects.toThrow(/righe_addebito_tipo_quantita_coerente/)
    })

    it('due righe uguali (stesso CER, riferimento null): respinta la seconda (NULLS NOT DISTINCT)', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      await comeApp(t, tx => inserisciRiga(tx, t, e.id, { codiceIvaId: iva }))
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, e.id, { codiceIvaId: iva }))
      ).rejects.toThrow(/`23505`/)
      // Il riferimento diverso, o lo stesso CER in un altro elenco, e' un'altra riga.
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, e.id, { riferimento: 'A', codiceIvaId: iva }))
      ).resolves.toHaveLength(1)
      const altro = await elenco(t)
      await expect(
        comeApp(t, tx => inserisciRiga(tx, t, altro.id, { codiceIvaId: iva }))
      ).resolves.toHaveLength(1)
    })

    it("FK composita: riga con l'addebito di un altro tenant respinta", async () => {
      const a = await azienda()
      const b = await azienda()
      const e = await elenco(a)
      const iva = await codiceIva(a)
      const addebitoDiB = await addebito(b)
      await expect(
        comeApp(a, tx =>
          inserisciRiga(tx, a, e.id, { tipo: 'V', addebitoId: addebitoDiB, codiceIvaId: iva })
        )
      ).rejects.toThrow(/righe_addebito_addebito_fkey/)
    })

    it('FK composita: codice IVA, categoria e centro di un altro tenant respinti', async () => {
      const a = await azienda()
      const b = await azienda()
      const e = await elenco(a)
      const iva = await codiceIva(a)
      const ivaDiB = await codiceIva(b)
      const categoriaDiB = await codifica(b, 'CATEGORIA')
      const centroDiB = await codifica(b, 'CENTRO_RICAVO')
      await expect(
        comeApp(a, tx => inserisciRiga(tx, a, e.id, { codiceIvaId: ivaDiB }))
      ).rejects.toThrow(/righe_addebito_codice_iva_fkey/)
      await expect(
        comeApp(a, tx =>
          inserisciRiga(tx, a, e.id, { codiceIvaId: iva, categoriaId: categoriaDiB })
        )
      ).rejects.toThrow(/righe_addebito_categoria_fkey/)
      await expect(
        comeApp(a, tx =>
          inserisciRiga(tx, a, e.id, { codiceIvaId: iva, centroRicavoId: centroDiB })
        )
      ).rejects.toThrow(/righe_addebito_centro_ricavo_fkey/)
    })

    it('un addebito, un codice IVA o una codifica usati da una riga non si cancellano (NoAction)', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const ad = await addebito(t)
      const cat = await codifica(t, 'CATEGORIA')
      await comeApp(t, tx =>
        inserisciRiga(tx, t, e.id, {
          tipo: 'V',
          cerCode: null,
          addebitoId: ad,
          codiceIvaId: iva,
          categoriaId: cat,
        })
      )
      await expect(
        owner.$executeRawUnsafe('DELETE FROM addebiti WHERE id = $1::uuid', ad)
      ).rejects.toThrow(/righe_addebito_addebito_fkey/)
      await expect(
        owner.$executeRawUnsafe('DELETE FROM codici_iva WHERE id = $1::uuid', iva)
      ).rejects.toThrow(/righe_addebito_codice_iva_fkey/)
      await expect(
        owner.$executeRawUnsafe('DELETE FROM codifiche_addebito WHERE id = $1::uuid', cat)
      ).rejects.toThrow(/righe_addebito_categoria_fkey/)
    })
  })

  describe('CHECK strutturali della riga (ciascuno respinge il valore errato e accetta quello giusto)', () => {
    let t: string
    let e: string
    let iva: string
    let ad: string

    beforeAll(async () => {
      t = await azienda()
      e = (await elenco(t)).id
      iva = await codiceIva(t)
      ad = await addebito(t)
    })

    /**
     * Inserisce una riga con SQL esplicito. `cols` sovrascrive o aggiunge colonne con un'espressione
     * SQL (solo valori scritti nei test). Il riferimento e' unico per chiamata, quindi l'unico della
     * riga non scatta mai per caso.
     */
    function riga(tipo: string, cols: Record<string, string> = {}) {
      const base: Record<string, string> = {
        tenant_id: `'${t}'::uuid`,
        elenco_id: `'${e}'::uuid`,
        tipo: `'${tipo}'`,
        cer_code: tipo === 'CER' ? `'20 03 01'` : 'NULL',
        addebito_id: tipo === 'CER' ? 'NULL' : `'${ad}'::uuid`,
        riferimento: `'R${++n}'`,
        tipo_quantita: tipo === 'CER' || tipo === 'V' ? `'PESO_NETTO'` : 'NULL',
        unita_misura: `'KG'`,
        prezzo: '1',
        codice_iva_id: `'${iva}'::uuid`,
        updated_at: 'now()',
        ...cols,
      }
      return comeApp(t, tx =>
        tx.$executeRawUnsafe(
          `INSERT INTO righe_addebito (${Object.keys(base).join(', ')})
           VALUES (${Object.values(base).join(', ')})`
        )
      )
    }

    const elementi = (quanti: number) =>
      `ARRAY(SELECT 'x' FROM generate_series(1, ${quanti}))::varchar(20)[]`

    it('riferimento vuoto o con spazio iniziale respinto (aggirerebbe l unico); NULL e "A" ammessi', async () => {
      await expect(riga('CER', { riferimento: `''` })).rejects.toThrow(
        /righe_addebito_riferimento_ammesso/
      )
      await expect(riga('CER', { riferimento: `' A'` })).rejects.toThrow(
        /righe_addebito_riferimento_ammesso/
      )
      await expect(riga('CER', { riferimento: 'NULL', cer_code: `'20 01 01'` })).resolves.toBe(1)
      await expect(riga('CER', { riferimento: `'A'` })).resolves.toBe(1)
    })

    it('unita di misura in minuscolo o con carattere non ammesso respinta; K/M ammessa', async () => {
      await expect(riga('CER', { unita_misura: `'kg'` })).rejects.toThrow(
        /righe_addebito_unita_misura_ammessa/
      )
      await expect(riga('CER', { unita_misura: `'K-G'` })).rejects.toThrow(
        /righe_addebito_unita_misura_ammessa/
      )
      await expect(riga('CER', { unita_misura: `'K/M'` })).resolves.toBe(1)
    })

    it('tipo di quantita: presente su un tipo che non e CER o V respinto, assente su CER respinto, presente su V ammesso', async () => {
      await expect(riga('F', { tipo_quantita: `'UNO'` })).rejects.toThrow(
        /righe_addebito_tipo_quantita_coerente/
      )
      await expect(riga('CER', { tipo_quantita: 'NULL' })).rejects.toThrow(
        /righe_addebito_tipo_quantita_coerente/
      )
      await expect(riga('V', { tipo_quantita: `'VOLUME'`, unita_misura: `'LT'` })).resolves.toBe(1)
      await expect(riga('F')).resolves.toBe(1)
    })

    it('quantita fissa: su un tipo diverso da F respinta, negativa respinta, zero su F ammessa', async () => {
      await expect(riga('CER', { quantita_fissa: '1' })).rejects.toThrow(
        /righe_addebito_quantita_fissa_ammessa/
      )
      await expect(riga('F', { quantita_fissa: '-1' })).rejects.toThrow(
        /righe_addebito_quantita_fissa_ammessa/
      )
      await expect(riga('F', { quantita_fissa: '0' })).resolves.toBe(1)
    })

    it('minimo fatturabile negativo respinto, zero ammesso', async () => {
      await expect(riga('CER', { minimo_fatturabile: '-0.01' })).rejects.toThrow(
        /righe_addebito_minimo_ammesso/
      )
      await expect(riga('CER', { minimo_fatturabile: '0' })).resolves.toBe(1)
    })

    it('stima annua negativa respinta, zero ammessa', async () => {
      await expect(riga('CER', { stima_annua_kg: '-1' })).rejects.toThrow(
        /righe_addebito_stima_annua_ammessa/
      )
      await expect(riga('CER', { stima_annua_kg: '0' })).resolves.toBe(1)
    })

    it('condizioni riferite: cifra 0, lettera sbagliata, senza lettera respinte; 12C ammessa', async () => {
      for (const v of ['0C', '12X', '12']) {
        await expect(riga('CER', { condizioni_riferite: `'${v}'` })).rejects.toThrow(
          /righe_addebito_condizioni_riferite_ammesse/
        )
      }
      await expect(riga('CER', { condizioni_riferite: `'12C'` })).resolves.toBe(1)
    })

    it('periodo delle scadenze inesistente respinto, MP ammesso', async () => {
      await expect(riga('F', { periodo_scadenze: `'ZZ'` })).rejects.toThrow(
        /righe_addebito_periodo_scadenze_ammesso/
      )
      await expect(riga('F', { periodo_scadenze: `'MP'` })).resolves.toBe(1)
    })

    it('periodo extra: una sola data respinta, fine prima dell inizio respinta, stesso giorno ammesso', async () => {
      await expect(riga('F', { periodo_extra_dal: `'2026-01-01'` })).rejects.toThrow(
        /righe_addebito_periodo_extra_coerente/
      )
      await expect(
        riga('F', { periodo_extra_dal: `'2026-02-01'`, periodo_extra_al: `'2026-01-01'` })
      ).rejects.toThrow(/righe_addebito_periodo_extra_coerente/)
      await expect(
        riga('F', { periodo_extra_dal: `'2026-01-01'`, periodo_extra_al: `'2026-01-01'` })
      ).resolves.toBe(1)
    })

    it('proposte: 51 elementi o NULL respinti, 50 ammessi (CER proposti e addebiti proposti)', async () => {
      await expect(riga('V', { cer_proposta: elementi(51) })).rejects.toThrow(
        /righe_addebito_proposte_ammesse/
      )
      await expect(riga('CER', { addebiti_proposti: elementi(51) })).rejects.toThrow(
        /righe_addebito_proposte_ammesse/
      )
      await expect(riga('V', { cer_proposta: 'NULL' })).rejects.toThrow(
        /righe_addebito_proposte_ammesse/
      )
      await expect(riga('CER', { addebiti_proposti: 'NULL' })).rejects.toThrow(
        /righe_addebito_proposte_ammesse/
      )
      await expect(
        riga('V', { cer_proposta: elementi(50), tipo_quantita: `'UNO'`, unita_misura: `'NR'` })
      ).resolves.toBe(1)
      await expect(riga('CER', { addebiti_proposti: elementi(50) })).resolves.toBe(1)
    })
  })

  describe('scaglioni_riga_addebito', () => {
    it('fascia 8 e fascia 0 respinte, fascia 7 ammessa', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const r = (await comeApp(t, tx => inserisciRiga(tx, t, e.id, { codiceIvaId: iva })))[0].id
      await expect(comeApp(t, tx => fascia(tx, t, r, 8))).rejects.toThrow(
        /scaglioni_riga_addebito_ordine_ammesso/
      )
      await expect(comeApp(t, tx => fascia(tx, t, r, 0))).rejects.toThrow(
        /scaglioni_riga_addebito_ordine_ammesso/
      )
      await expect(comeApp(t, tx => fascia(tx, t, r, 7))).resolves.toBe(1)
    })

    it('tipo di calcolo inesistente respinto, tipi del dominio ammessi', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const r = (await comeApp(t, tx => inserisciRiga(tx, t, e.id, { codiceIvaId: iva })))[0].id
      await expect(comeApp(t, tx => fascia(tx, t, r, 1, 'Q'))).rejects.toThrow(
        /scaglioni_riga_addebito_tipo_calcolo_ammesso/
      )
      let ordine = 0
      for (const tipo of ['A', 'B', 'C', 'D', 'E', 'X', 'Y']) {
        await expect(comeApp(t, tx => fascia(tx, t, r, ++ordine, tipo))).resolves.toBe(1)
      }
    })

    it('stessa fascia due volte: violazione di unicita; prezzo e soglia non ammessi respinti', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const r = (await comeApp(t, tx => inserisciRiga(tx, t, e.id, { codiceIvaId: iva })))[0].id
      await comeApp(t, tx => fascia(tx, t, r, 1))
      await expect(comeApp(t, tx => fascia(tx, t, r, 1))).rejects.toThrow(/`23505`/)
      await expect(
        comeApp(t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO scaglioni_riga_addebito (tenant_id, riga_id, ordine, fino_a, prezzo, tipo_calcolo)
             VALUES ($1::uuid, $2::uuid, 2, 0, 1, 'A')`,
            t,
            r
          )
        )
      ).rejects.toThrow(/scaglioni_riga_addebito_fino_a_ammesso/)
      await expect(
        comeApp(t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO scaglioni_riga_addebito (tenant_id, riga_id, ordine, prezzo, tipo_calcolo)
             VALUES ($1::uuid, $2::uuid, 3, -1, 'A')`,
            t,
            r
          )
        )
      ).rejects.toThrow(/scaglioni_riga_addebito_prezzo_ammesso/)
    })

    it('FK composita: fascia con la riga di un altro tenant respinta', async () => {
      const a = await azienda()
      const b = await azienda()
      const eb = await elenco(b)
      const ivab = await codiceIva(b)
      const rigaDiB = (
        await comeApp(b, tx => inserisciRiga(tx, b, eb.id, { codiceIvaId: ivab }))
      )[0].id
      await expect(comeApp(a, tx => fascia(tx, a, rigaDiB, 1))).rejects.toThrow(
        /scaglioni_riga_addebito_riga_fkey/
      )
    })
  })

  describe('scadenze_riga_addebito', () => {
    it('scadenza con mese 13, giorno 32, ordine 13 respinte', async () => {
      const t = await azienda()
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const r = (await comeApp(t, tx => inserisciRiga(tx, t, e.id, { codiceIvaId: iva })))[0].id
      await expect(comeApp(t, tx => scadenza(tx, t, r, 1, 15, 13))).rejects.toThrow(
        /scadenze_riga_addebito_valori/
      )
      await expect(comeApp(t, tx => scadenza(tx, t, r, 1, 32, 1))).rejects.toThrow(
        /scadenze_riga_addebito_valori/
      )
      await expect(comeApp(t, tx => scadenza(tx, t, r, 13, 1, 1))).rejects.toThrow(
        /scadenze_riga_addebito_valori/
      )
      await expect(comeApp(t, tx => scadenza(tx, t, r, 12, 31, 12))).resolves.toBe(1)
    })

    it('stesso ordine due volte: violazione di unicita; FK composita con la riga di un altro tenant', async () => {
      const a = await azienda()
      const b = await azienda()
      const ea = await elenco(a)
      const eb = await elenco(b)
      const ivaA = await codiceIva(a)
      const ivaB = await codiceIva(b)
      const ra = (await comeApp(a, tx => inserisciRiga(tx, a, ea.id, { codiceIvaId: ivaA })))[0].id
      const rb = (await comeApp(b, tx => inserisciRiga(tx, b, eb.id, { codiceIvaId: ivaB })))[0].id
      await comeApp(a, tx => scadenza(tx, a, ra, 1))
      await expect(comeApp(a, tx => scadenza(tx, a, ra, 1))).rejects.toThrow(/`23505`/)
      await expect(comeApp(a, tx => scadenza(tx, a, rb, 2))).rejects.toThrow(
        /scadenze_riga_addebito_riga_fkey/
      )
    })
  })

  describe('RLS e cancellazione del tenant', () => {
    async function popola(t: string) {
      const e = await elenco(t)
      const iva = await codiceIva(t)
      const r = (await comeApp(t, tx => inserisciRiga(tx, t, e.id, { codiceIvaId: iva })))[0].id
      await comeApp(t, async tx => {
        await fascia(tx, t, r, 1)
        await scadenza(tx, t, r, 1)
        await allegato(tx, t, e.id, 1)
      })
      return { e, r }
    }

    it('nel contesto di B le cinque tabelle di A sono vuote e un insert con tenant di A e respinto', async () => {
      const a = await azienda()
      const b = await azienda()
      const { e, r } = await popola(a)
      for (const tabella of CINQUE_TABELLE) {
        const viste = await comeApp(b, tx =>
          tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${tabella}`)
        )
        expect({ tabella, n: viste[0].n }).toEqual({ tabella, n: 0 })
        const proprie = await comeApp(a, tx =>
          tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${tabella}`)
        )
        expect(proprie[0].n).toBeGreaterThan(0)
      }
      await expect(comeApp(b, tx => fascia(tx, a, r, 2))).rejects.toThrow(/row-level security/)
      await expect(comeApp(b, tx => scadenza(tx, a, r, 2))).rejects.toThrow(/row-level security/)
      await expect(comeApp(b, tx => allegato(tx, a, e.id, 2))).rejects.toThrow(/row-level security/)
      await expect(comeApp(b, tx => inserisciElenco(tx, a, e.contrattoId))).rejects.toThrow(
        /row-level security/
      )
    })

    it('senza contesto non si vede e non si scrive nulla', async () => {
      const a = await azienda()
      await popola(a)
      for (const tabella of CINQUE_TABELLE) {
        const viste = await app.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${tabella}`
        )
        expect({ tabella, n: viste[0].n }).toEqual({ tabella, n: 0 })
      }
      // Senza contesto nemmeno una scrittura con il tenant giusto passa.
      const k = await contratto(a)
      await expect(
        app.$executeRawUnsafe(
          `INSERT INTO elenchi_addebiti (tenant_id, contratto_id, codice, descrizione, updated_at)
           VALUES ($1::uuid, $2::uuid, '001', 'x', now())`,
          a,
          k
        )
      ).rejects.toThrow(/row-level security/)
    })

    it('cancellare il tenant cancella le cinque tabelle', async () => {
      const t = await azienda()
      await popola(t)
      // Le FK composite sono NoAction: il controllo e' a fine statement, quindi la cascata del tenant
      // passa in un solo DELETE.
      await owner.tenant.delete({ where: { id: t } })
      tenantCreati.splice(tenantCreati.indexOf(t), 1)
      for (const tabella of CINQUE_TABELLE) {
        const r = await owner.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${tabella} WHERE tenant_id = $1::uuid`,
          t
        )
        expect({ tabella, n: r[0].n }).toEqual({ tabella, n: 0 })
      }
    })
  })

  describe('nomi di vincoli e indici (R38)', () => {
    // Insiemi COMPLETI, scritti a mano, delle tabelle del listino (4.2a e 4.2b): un nome in piu',
    // mancante o diverso fa fallire il confronto. Il controllo sulla lunghezza dei nomi non serve:
    // Postgres tronca a 63 caratteri senza errore, quindi un nome troppo lungo si vede solo qui,
    // perche' diverso da quello atteso.
    const TABELLE_LISTINO = [
      'codici_iva',
      'codifiche_addebito',
      'addebiti',
      'prezzi_listino_addebito',
      ...CINQUE_TABELLE,
    ]
    const indiciAttesi = [
      'addebiti_id_tenant_id_key',
      'addebiti_pkey',
      // Migration 20261103100000: indici sulle colonne delle FK composite verso le codifiche.
      'addebiti_tenant_id_categoria_id_idx',
      'addebiti_tenant_id_categoria_statistica_1_id_idx',
      'addebiti_tenant_id_categoria_statistica_2_id_idx',
      'addebiti_tenant_id_centro_ricavo_id_idx',
      'addebiti_tenant_id_codice_iva_id_idx',
      'addebiti_tenant_id_codice_key',
      'addebiti_tenant_id_gruppo_id_idx',
      'addebiti_tenant_id_idx',
      'allegati_elenco_addebiti_elenco_id_posizione_key',
      'allegati_elenco_addebiti_id_tenant_id_key',
      'allegati_elenco_addebiti_pkey',
      'allegati_elenco_addebiti_tenant_id_idx',
      'codici_iva_id_tenant_id_key',
      'codici_iva_pkey',
      'codici_iva_tenant_id_codice_key',
      'codici_iva_tenant_id_idx',
      'codifiche_addebito_id_tenant_id_key',
      'codifiche_addebito_pkey',
      'codifiche_addebito_tenant_id_genere_codice_key',
      'codifiche_addebito_tenant_id_idx',
      'elenchi_addebiti_contratto_id_codice_key',
      'elenchi_addebiti_id_tenant_id_key',
      // Migration 20261103200000: bersaglio della chiave composta dei legami (4.3).
      'elenchi_addebiti_id_contratto_id_tenant_id_key',
      'elenchi_addebiti_pkey',
      'elenchi_addebiti_tenant_id_contratto_id_idx',
      'prezzi_listino_addebito_addebito_id_numero_key',
      'prezzi_listino_addebito_pkey',
      'prezzi_listino_addebito_tenant_id_idx',
      'righe_addebito_elenco_tipo_cer_addebito_rif_key',
      'righe_addebito_id_tenant_id_key',
      // Migration 20261103200000: bersaglio della chiave composta delle righe dei legami (4.3).
      'righe_addebito_id_elenco_id_tenant_id_key',
      'righe_addebito_pkey',
      'righe_addebito_tenant_id_addebito_id_idx',
      'righe_addebito_tenant_id_categoria_id_idx',
      'righe_addebito_tenant_id_centro_ricavo_id_idx',
      'righe_addebito_tenant_id_codice_iva_id_idx',
      'scadenze_riga_addebito_pkey',
      'scadenze_riga_addebito_riga_id_ordine_key',
      'scadenze_riga_addebito_tenant_id_idx',
      'scaglioni_riga_addebito_pkey',
      'scaglioni_riga_addebito_riga_id_ordine_key',
      'scaglioni_riga_addebito_tenant_id_idx',
    ]
    const fkAttese = [
      'addebiti_categoria_fkey',
      'addebiti_categoria_statistica_1_fkey',
      'addebiti_categoria_statistica_2_fkey',
      'addebiti_centro_ricavo_fkey',
      'addebiti_codice_iva_fkey',
      'addebiti_gruppo_fkey',
      'addebiti_tenant_id_fkey',
      'allegati_elenco_addebiti_elenco_fkey',
      'allegati_elenco_addebiti_tenant_id_fkey',
      'codici_iva_tenant_id_fkey',
      'codifiche_addebito_tenant_id_fkey',
      'elenchi_addebiti_contratto_fkey',
      'elenchi_addebiti_tenant_id_fkey',
      'prezzi_listino_addebito_addebito_fkey',
      'prezzi_listino_addebito_tenant_id_fkey',
      'righe_addebito_addebito_fkey',
      'righe_addebito_categoria_fkey',
      'righe_addebito_centro_ricavo_fkey',
      'righe_addebito_codice_iva_fkey',
      'righe_addebito_elenco_fkey',
      'righe_addebito_tenant_id_fkey',
      'scadenze_riga_addebito_riga_fkey',
      'scadenze_riga_addebito_tenant_id_fkey',
      'scaglioni_riga_addebito_riga_fkey',
      'scaglioni_riga_addebito_tenant_id_fkey',
    ]
    const checkAttesi = [
      'allegati_elenco_addebiti_valori',
      'elenchi_addebiti_codice_ammesso',
      'elenchi_addebiti_codice_non_000',
      'elenchi_addebiti_documento_pa_coerente',
      'elenchi_addebiti_validita_coerente',
      'elenchi_addebiti_versione_positiva',
      'righe_addebito_addebito_coerente',
      'righe_addebito_cer_coerente',
      'righe_addebito_condizione_ammessa',
      'righe_addebito_condizioni_riferite_ammesse',
      'righe_addebito_minimo_ammesso',
      'righe_addebito_periodo_extra_coerente',
      'righe_addebito_periodo_scadenze_ammesso',
      'righe_addebito_prezzo_ammesso',
      'righe_addebito_prezzo_presente',
      'righe_addebito_proposte_ammesse',
      'righe_addebito_quantita_fissa_ammessa',
      'righe_addebito_riferimento_ammesso',
      'righe_addebito_riferimento_giorno_ammesso',
      'righe_addebito_riferimento_mese_ammesso',
      'righe_addebito_speciale_senza_minimo',
      'righe_addebito_stima_annua_ammessa',
      'righe_addebito_tipo_ammesso',
      'righe_addebito_tipo_quantita_coerente',
      'righe_addebito_unita_misura_ammessa',
      'righe_addebito_versione_positiva',
      'scadenze_riga_addebito_valori',
      'scaglioni_riga_addebito_fino_a_ammesso',
      'scaglioni_riga_addebito_ordine_ammesso',
      'scaglioni_riga_addebito_prezzo_ammesso',
      'scaglioni_riga_addebito_tipo_calcolo_ammesso',
    ]

    it('gli indici delle tabelle del listino sono esattamente quelli attesi', async () => {
      const r = await owner.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1::text[])
         ORDER BY 1`,
        TABELLE_LISTINO
      )
      expect(r.map(x => x.indexname)).toEqual([...indiciAttesi].sort())
      // Nessun indice parziale sulle tabelle del listino.
      const parziali = await owner.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND indexdef LIKE '% WHERE %' AND tablename = ANY($1::text[])`,
        TABELLE_LISTINO
      )
      expect(parziali).toEqual([])
    })

    it("l'unico della riga e' NULLS NOT DISTINCT", async () => {
      const r = await owner.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND indexname = 'righe_addebito_elenco_tipo_cer_addebito_rif_key'`
      )
      expect(r[0].indexdef).toContain('NULLS NOT DISTINCT')
    })

    const vincoliDi = (tipo: 'f' | 'c', tabelle: string[]) =>
      owner
        .$queryRawUnsafe<{ conname: string }[]>(
          `SELECT c.conname FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
           WHERE c.contype = $1 AND r.relname = ANY($2::text[]) ORDER BY 1`,
          tipo,
          tabelle
        )
        .then(r => r.map(x => x.conname))

    it('le chiavi esterne delle tabelle del listino sono esattamente quelle attese', async () => {
      expect(await vincoliDi('f', TABELLE_LISTINO)).toEqual([...fkAttese].sort())
    })

    it('i CHECK delle cinque tabelle nuove sono esattamente quelli attesi', async () => {
      expect(await vincoliDi('c', CINQUE_TABELLE)).toEqual([...checkAttesi].sort())
    })
  })
})
