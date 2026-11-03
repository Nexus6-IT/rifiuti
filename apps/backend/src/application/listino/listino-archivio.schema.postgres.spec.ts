/**
 * Schema A del listino (Fase 4 pezzo 2a, Task 7) contro un Postgres reale: `codici_iva`,
 * `codifiche_addebito`, `addebiti`, `prezzi_listino_addebito` e le tre colonne del cliente (Q3).
 *
 * Le scritture si fanno col ruolo applicativo `wasteflow_app` dentro il contesto dell'azienda (RLS e
 * privilegi) con SQL esplicito: la spec prova i vincoli del database, non il client generato. Il
 * proprietario prepara le aziende, i clienti e legge lo stato finale. Pulizia solo per id esatti.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

describe('Listino, archivio addebiti: schema (Postgres reale, ruolo wasteflow_app)', () => {
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
        ragioneSociale: 'Listino schema SRL',
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

  async function codiceIva(
    t: string,
    codice = `I${codice3().slice(-2)}`,
    aliquota = '22.00',
    natura: string | null = null
  ): Promise<string> {
    const r = await comeApp(t, tx =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO codici_iva (tenant_id, codice, descrizione, aliquota, natura, updated_at)
         VALUES ($1::uuid, $2, 'IVA di prova', $3::numeric, $4, now()) RETURNING id::text AS id`,
        t,
        codice,
        aliquota,
        natura
      )
    )
    return r[0].id
  }

  async function codifica(t: string, genere = 'GRUPPO', codice = codice3()): Promise<string> {
    const r = await comeApp(t, tx =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO codifiche_addebito (tenant_id, genere, codice, descrizione, updated_at)
         VALUES ($1::uuid, $2::genere_codifica_addebito, $3, 'Codifica di prova', now())
         RETURNING id::text AS id`,
        t,
        genere,
        codice
      )
    )
    return r[0].id
  }

  function inserisciAddebito(
    tx: Tx,
    t: string,
    gruppoId: string,
    codice = codice5(),
    extra: { tipo?: string; um?: string } = {}
  ) {
    return tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO addebiti (tenant_id, codice, descrizione, gruppo_id, unita_misura, tipo, updated_at)
       VALUES ($1::uuid, $2, 'Addebito di prova', $3::uuid, $4, $5, now()) RETURNING id::text AS id`,
      t,
      codice,
      gruppoId,
      extra.um ?? 'NR',
      extra.tipo ?? 'V'
    )
  }

  async function addebito(t: string, gruppoId?: string): Promise<{ id: string; gruppoId: string }> {
    const g = gruppoId ?? (await codifica(t))
    const r = await comeApp(t, tx => inserisciAddebito(tx, t, g))
    return { id: r[0].id, gruppoId: g }
  }

  const prezzo = (tx: Tx, t: string, addebitoId: string, numero: number, valore: string | null) =>
    tx.$executeRawUnsafe(
      `INSERT INTO prezzi_listino_addebito (tenant_id, addebito_id, numero, prezzo)
       VALUES ($1::uuid, $2::uuid, $3, $4::numeric)`,
      t,
      addebitoId,
      numero,
      valore
    )

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const in_ = tenantCreati
      // FK composite NoAction: prima chi cita (prezzi, addebiti), poi le codifiche e i codici IVA.
      await owner.$executeRawUnsafe(
        'DELETE FROM prezzi_listino_addebito WHERE tenant_id = ANY($1::uuid[])',
        in_
      )
      await owner.$executeRawUnsafe('DELETE FROM addebiti WHERE tenant_id = ANY($1::uuid[])', in_)
      await owner.$executeRawUnsafe(
        'DELETE FROM codifiche_addebito WHERE tenant_id = ANY($1::uuid[])',
        in_
      )
      await owner.$executeRawUnsafe('DELETE FROM codici_iva WHERE tenant_id = ANY($1::uuid[])', in_)
      await owner.tenant.deleteMany({ where: { id: { in: in_ } } })
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('codici_iva', () => {
    it('codice IVA con aliquota 0 e senza natura respinto', async () => {
      const t = await azienda()
      await expect(codiceIva(t, 'ES1', '0.00', null)).rejects.toThrow(/codici_iva_natura_coerente/)
    })

    it('codice IVA con natura e aliquota diversa da 0 respinto', async () => {
      const t = await azienda()
      await expect(codiceIva(t, 'A22', '22.00', 'N1')).rejects.toThrow(/codici_iva_natura_coerente/)
    })

    it('aliquota 0 con natura ammessa, aliquota oltre 100 respinta, natura inventata respinta', async () => {
      const t = await azienda()
      await expect(codiceIva(t, 'N61', '0.00', 'N6.1')).resolves.toEqual(expect.any(String))
      await expect(codiceIva(t, 'A10', '100.01', null)).rejects.toThrow(
        /codici_iva_aliquota_ammessa/
      )
      await expect(codiceIva(t, 'X', '0.00', 'N2')).rejects.toThrow(/codici_iva_natura_ammessa/)
    })

    it('codice con carattere non ammesso respinto', async () => {
      const t = await azienda()
      await expect(codiceIva(t, '2%')).rejects.toThrow(/codici_iva_codice_ammesso/)
    })

    it('stesso codice IVA due volte: violazione di unicita', async () => {
      const t = await azienda()
      await codiceIva(t, '22')
      await expect(codiceIva(t, '22')).rejects.toThrow(/`23505`/)
    })
  })

  describe('codifiche_addebito', () => {
    it('stesso codice in generi diversi ammesso; nello stesso genere respinto', async () => {
      const t = await azienda()
      await codifica(t, 'GRUPPO', '001')
      await expect(codifica(t, 'CATEGORIA', '001')).resolves.toEqual(expect.any(String))
      await expect(codifica(t, 'GRUPPO', '001')).rejects.toThrow(/`23505`/)
    })

    it('codice non a tre cifre respinto', async () => {
      const t = await azienda()
      await expect(codifica(t, 'GRUPPO', '1')).rejects.toThrow(/codifiche_addebito_codice_ammesso/)
    })

    it('codice 000 respinto (come negli addebiti, il dominio lo rifiuta)', async () => {
      const t = await azienda()
      await expect(codifica(t, 'GRUPPO', '000')).rejects.toThrow(
        /codifiche_addebito_codice_ammesso/
      )
    })
  })

  describe('addebiti', () => {
    it('addebito con codice 00000 respinto, codice non numerico respinto', async () => {
      const t = await azienda()
      const g = await codifica(t)
      await expect(comeApp(t, tx => inserisciAddebito(tx, t, g, '00000'))).rejects.toThrow(
        /addebiti_codice_ammesso/
      )
      await expect(comeApp(t, tx => inserisciAddebito(tx, t, g, 'AB123'))).rejects.toThrow(
        /addebiti_codice_ammesso/
      )
    })

    it('tipo CER non ammesso, tipo T con unita di misura diversa da KG o TON respinto', async () => {
      const t = await azienda()
      const g = await codifica(t)
      await expect(
        comeApp(t, tx => inserisciAddebito(tx, t, g, codice5(), { tipo: 'CER' }))
      ).rejects.toThrow(/addebiti_tipo_ammesso/)
      await expect(
        comeApp(t, tx => inserisciAddebito(tx, t, g, codice5(), { tipo: 'TS', um: 'NR' }))
      ).rejects.toThrow(/addebiti_tipo_t_unita_misura/)
      await expect(
        comeApp(t, tx => inserisciAddebito(tx, t, g, codice5(), { tipo: 'TS', um: 'KG' }))
      ).resolves.toHaveLength(1)
    })

    it('stesso codice addebito due volte: violazione di unicita', async () => {
      const t = await azienda()
      const g = await codifica(t)
      await comeApp(t, tx => inserisciAddebito(tx, t, g, '00012'))
      await expect(comeApp(t, tx => inserisciAddebito(tx, t, g, '00012'))).rejects.toThrow(
        /`23505`/
      )
    })

    it('FK composita: addebito col gruppo di un altro tenant respinto', async () => {
      const a = await azienda()
      const b = await azienda()
      const gruppoDiB = await codifica(b)
      await expect(comeApp(a, tx => inserisciAddebito(tx, a, gruppoDiB))).rejects.toThrow(
        /addebiti_gruppo_fkey/
      )
    })

    it('FK composita: codice IVA di un altro tenant respinto', async () => {
      const a = await azienda()
      const b = await azienda()
      const g = await codifica(a)
      const ivaDiB = await codiceIva(b, '22')
      await expect(
        comeApp(a, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO addebiti (tenant_id, codice, descrizione, gruppo_id, unita_misura, codice_iva_id, updated_at)
             VALUES ($1::uuid, $2, 'x', $3::uuid, 'NR', $4::uuid, now())`,
            a,
            codice5(),
            g,
            ivaDiB
          )
        )
      ).rejects.toThrow(/addebiti_codice_iva_fkey/)
    })

    it('una codifica usata da un addebito non si cancella (NoAction)', async () => {
      const t = await azienda()
      const { gruppoId } = await addebito(t)
      await expect(
        owner.$executeRawUnsafe('DELETE FROM codifiche_addebito WHERE id = $1::uuid', gruppoId)
      ).rejects.toThrow(/addebiti_gruppo_fkey/)
    })
  })

  describe('prezzi_listino_addebito', () => {
    it('listino 7 e listino 0 respinti', async () => {
      const t = await azienda()
      const a = await addebito(t)
      await expect(comeApp(t, tx => prezzo(tx, t, a.id, 7, '1'))).rejects.toThrow(
        /prezzi_listino_addebito_numero_ammesso/
      )
      await expect(comeApp(t, tx => prezzo(tx, t, a.id, 0, '1'))).rejects.toThrow(
        /prezzi_listino_addebito_numero_ammesso/
      )
    })

    it('prezzo negativo respinto; otto cifre intere e sei decimali ammessi, nove cifre intere respinte', async () => {
      const t = await azienda()
      const a = await addebito(t)
      await expect(comeApp(t, tx => prezzo(tx, t, a.id, 1, '-0.01'))).rejects.toThrow(
        /prezzi_listino_addebito_prezzo_ammesso/
      )
      await expect(
        comeApp(t, tx => prezzo(tx, t, a.id, 1, '99999999.999999'))
      ).resolves.toBeDefined()
      await expect(comeApp(t, tx => prezzo(tx, t, a.id, 2, '100000000'))).rejects.toThrow(
        /numeric field overflow/
      )
    })

    it('due prezzi per lo stesso listino: violazione di unicita', async () => {
      const t = await azienda()
      const a = await addebito(t)
      await comeApp(t, tx => prezzo(tx, t, a.id, 3, '1.5'))
      await expect(comeApp(t, tx => prezzo(tx, t, a.id, 3, '2'))).rejects.toThrow(/`23505`/)
    })

    it("FK composita: prezzo con l'addebito di un altro tenant respinto", async () => {
      const a = await azienda()
      const b = await azienda()
      const addebitoDiB = await addebito(b)
      await expect(comeApp(a, tx => prezzo(tx, a, addebitoDiB.id, 1, '1'))).rejects.toThrow(
        /prezzi_listino_addebito_addebito_fkey/
      )
    })

    it("cancellare l'addebito cancella i suoi listini", async () => {
      const t = await azienda()
      const a = await addebito(t)
      await comeApp(t, async tx => {
        await prezzo(tx, t, a.id, 1, '1')
        await prezzo(tx, t, a.id, 2, '2')
      })
      const prima = await owner.$queryRawUnsafe<{ n: number }[]>(
        'SELECT count(*)::int AS n FROM prezzi_listino_addebito WHERE addebito_id = $1::uuid',
        a.id
      )
      expect(prima[0].n).toBe(2)
      await comeApp(t, tx => tx.$executeRawUnsafe('DELETE FROM addebiti WHERE id = $1::uuid', a.id))
      const dopo = await owner.$queryRawUnsafe<{ n: number }[]>(
        'SELECT count(*)::int AS n FROM prezzi_listino_addebito WHERE addebito_id = $1::uuid',
        a.id
      )
      expect(dopo[0].n).toBe(0)
    })
  })

  describe('clienti: listino e provvigione predefiniti (Q3)', () => {
    const aggiorna = (t: string, id: string, set: string, ...valori: unknown[]) =>
      comeApp(t, tx =>
        tx.$executeRawUnsafe(`UPDATE clienti SET ${set} WHERE id = $1::uuid`, id, ...valori)
      )

    it('cliente esistente invariato: le tre colonne sono nulle', async () => {
      const t = await azienda()
      const c = await creaDittaConRuolo(owner, t, 'CLIENTE', { ragioneSociale: 'Cliente A' })
      const r = await owner.$queryRawUnsafe<
        { listino: number | null; p: string | null; tp: string | null; versione: number }[]
      >(
        `SELECT listino, provvigione_predefinita AS p, tipo_provvigione_predefinita::text AS tp, versione
         FROM clienti WHERE id = $1::uuid`,
        c.ruoloId
      )
      expect(r[0]).toEqual({ listino: null, p: null, tp: null, versione: 1 })
    })

    it('listino 7 e listino 0 respinti, listino 6 ammesso', async () => {
      const t = await azienda()
      const c = await creaDittaConRuolo(owner, t, 'CLIENTE', { ragioneSociale: 'Cliente B' })
      await expect(aggiorna(t, c.ruoloId, 'listino = 7')).rejects.toThrow(/clienti_listino_ammesso/)
      await expect(aggiorna(t, c.ruoloId, 'listino = 0')).rejects.toThrow(/clienti_listino_ammesso/)
      await expect(aggiorna(t, c.ruoloId, 'listino = 6')).resolves.toBe(1)
    })

    it('provvigione senza tipo respinta, tipo senza provvigione respinto, coppia ammessa', async () => {
      const t = await azienda()
      const c = await creaDittaConRuolo(owner, t, 'CLIENTE', { ragioneSociale: 'Cliente C' })
      await expect(aggiorna(t, c.ruoloId, "provvigione_predefinita = '10+5'")).rejects.toThrow(
        /clienti_provvigione_con_tipo/
      )
      await expect(
        aggiorna(t, c.ruoloId, "tipo_provvigione_predefinita = 'LORDO'")
      ).rejects.toThrow(/clienti_provvigione_con_tipo/)
      await expect(
        aggiorna(
          t,
          c.ruoloId,
          "provvigione_predefinita = '10+5', tipo_provvigione_predefinita = 'LORDO'"
        )
      ).resolves.toBe(1)
    })
  })

  describe('RLS e cancellazione del tenant', () => {
    it('nel contesto di B le quattro tabelle di A sono vuote e un insert con tenant di A e respinto', async () => {
      const a = await azienda()
      const b = await azienda()
      const ad = await addebito(a)
      await comeApp(a, tx => prezzo(tx, a, ad.id, 1, '1'))
      await codiceIva(a, '22')

      for (const tabella of [
        'codici_iva',
        'codifiche_addebito',
        'addebiti',
        'prezzi_listino_addebito',
      ]) {
        const viste = await comeApp(b, tx =>
          tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${tabella}`)
        )
        expect({ tabella, n: viste[0].n }).toEqual({ tabella, n: 0 })
        const proprie = await comeApp(a, tx =>
          tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${tabella}`)
        )
        expect(proprie[0].n).toBeGreaterThan(0)
      }

      await expect(
        comeApp(b, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO codici_iva (tenant_id, codice, descrizione, aliquota, updated_at)
             VALUES ($1::uuid, 'ZZ', 'x', 4, now())`,
            a
          )
        )
      ).rejects.toThrow(/row-level security/)
      await expect(
        comeApp(b, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO prezzi_listino_addebito (tenant_id, addebito_id, numero, prezzo)
             VALUES ($1::uuid, $2::uuid, 2, 1)`,
            a,
            ad.id
          )
        )
      ).rejects.toThrow(/row-level security/)
    })

    it('senza contesto non si vede e non si scrive nulla', async () => {
      const a = await azienda()
      await codiceIva(a, '22')
      const viste = await app.$queryRawUnsafe<{ n: number }[]>(
        'SELECT count(*)::int AS n FROM codici_iva'
      )
      expect(viste[0].n).toBe(0)
    })

    it('cancellare il tenant cancella le quattro tabelle', async () => {
      const t = await azienda()
      const ad = await addebito(t)
      await comeApp(t, tx => prezzo(tx, t, ad.id, 1, '1'))
      await codiceIva(t, '22')
      // Le FK composite verso le codifiche e i codici IVA sono NoAction: il controllo e' a fine
      // statement, quindi la cascata del tenant passa in un solo DELETE.
      await owner.tenant.delete({ where: { id: t } })
      tenantCreati.splice(tenantCreati.indexOf(t), 1)
      for (const tabella of [
        'codici_iva',
        'codifiche_addebito',
        'addebiti',
        'prezzi_listino_addebito',
      ]) {
        const r = await owner.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${tabella} WHERE tenant_id = $1::uuid`,
          t
        )
        expect({ tabella, n: r[0].n }).toEqual({ tabella, n: 0 })
      }
    })
  })

  it('gli unici attesi esistono con il nome dello schema e nessun vincolo supera 63 caratteri', async () => {
    // Prisma non riporta il nome del vincolo per le violazioni di unicita': si controllano qui.
    const attesi = [
      'codici_iva_tenant_id_codice_key',
      'codifiche_addebito_tenant_id_genere_codice_key',
      'addebiti_tenant_id_codice_key',
      'prezzi_listino_addebito_addebito_id_numero_key',
    ]
    const r = await owner.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      attesi
    )
    expect(r.map(x => x.indexname).sort()).toEqual([...attesi].sort())
    // Postgres TRONCA a 63 caratteri gli identificatori piu' lunghi: una query sul catalogo non
    // puo' quindi trovare nulla. Il controllo vero e' statico, sui nomi scritti nelle migration
    // della 4.1 e della 4.2 (quelli che il catalogo avrebbe troncato).
    const cartella = join(__dirname, '../../../prisma/migrations')
    const nomi: string[] = []
    for (const m of readdirSync(cartella).filter(d => /^202611022|^202611023|^20261103/.test(d))) {
      const f = join(cartella, m, 'migration.sql')
      if (!existsSync(f)) continue
      const sql = readFileSync(f, 'utf8')
      for (const x of sql.matchAll(/(?:CONSTRAINT|INDEX)\s+"([^"]+)"/g)) nomi.push(x[1])
    }
    expect(nomi.length).toBeGreaterThan(50)
    expect(nomi.filter(n => n.length > 63)).toEqual([])
  })
})
