/**
 * Schema delle causali del registro (Fase 2 pezzo 5, Task 1) contro un Postgres reale.
 *
 * Il catalogo di sistema (`causali_registro`) e le personalizzazioni (`causali_registro_azienda`) si
 * provano con il ruolo applicativo `wasteflow_app` (privilegi e RLS: da superuser non si vedono) e,
 * per i vincoli e il trigger, dal proprietario. Le righe di `causali_registro` NON si modificano mai
 * in modo persistente: i CHECK del catalogo si provano con INSERT che il database respinge (la
 * transazione si annulla da sola) o in una transazione annullata con un errore sentinella.
 *
 * Dati di prova: aziende, registri, causali e movimenti creati qui dal proprietario, rimossi in fondo.
 */
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'

type Verso = 'CARICO' | 'SCARICO'
interface RigaCatalogo {
  codice: string
  verso: Verso
  descrizione: string
  ruolo_mud: string
  codice_rentri: string | null
  operazione: string | null
  ordine: number
  attiva: boolean
}

/** Le 11 causali di oggi (decisione C3 del piano), scritte a mano: il test non le deriva dal codice. */
const CATALOGO_ATTESO: RigaCatalogo[] = [
  ['PRODUZIONE_INTERNA', 'CARICO', 'Produzione interna', 'PRODOTTO', 'DT', null, 10],
  ['INGRESSO_ESTERNO', 'CARICO', 'Ingresso da esterno', 'RICEVUTO_DA_TERZI', 'T*', null, 20],
  ['RICLASSIFICAZIONE', 'CARICO', 'Riclassificazione CER', 'ESCLUSO', null, null, 30],
  ['RECUPERO_PARZIALE', 'CARICO', 'Recupero parziale', 'PRODOTTO', null, null, 40],
  ['ALTRO_CARICO', 'CARICO', 'Altro carico', 'ESCLUSO', null, null, 50],
  [
    'CONFERIMENTO_TRASPORTATORE',
    'SCARICO',
    'Conferimento a trasportatore',
    'AVVIATO',
    'aT',
    null,
    10,
  ],
  ['AVVIO_RECUPERO', 'SCARICO', 'Avvio a recupero (R)', 'AVVIATO', 'aT', 'R', 20],
  ['AVVIO_SMALTIMENTO', 'SCARICO', 'Avvio a smaltimento (D)', 'AVVIATO', 'aT', 'D', 30],
  ['CESSIONE', 'SCARICO', 'Cessione a terzi', 'AVVIATO', 'aT', null, 40],
  ['RICLASSIFICAZIONE', 'SCARICO', 'Riclassificazione CER', 'ESCLUSO', null, null, 50],
  ['ALTRO_SCARICO', 'SCARICO', 'Altro scarico', 'ESCLUSO', null, null, 60],
].map(([codice, verso, descrizione, ruolo_mud, codice_rentri, operazione, ordine]) => ({
  codice: codice as string,
  verso: verso as Verso,
  descrizione: descrizione as string,
  ruolo_mud: ruolo_mud as string,
  codice_rentri: codice_rentri as string | null,
  operazione: operazione as string | null,
  ordine: ordine as number,
  attiva: true,
}))

const ORDINE = (a: RigaCatalogo, b: RigaCatalogo) =>
  a.verso.localeCompare(b.verso) || a.ordine - b.ordine

describe('Causali del registro, schema (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []
  let n = 0
  let numeroMovimento = 0

  type Tx = Pick<
    PrismaClient,
    '$executeRawUnsafe' | '$queryRawUnsafe' | '$executeRaw' | '$queryRaw'
  >
  const SENTINELLA = new Error('rollback voluto')

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `CA${suffisso}`, ragioneSociale: 'Causali SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const registro = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro di prova' },
    })
    return { tenantId: t.id, registroId: registro.id }
  }

  /** Esegue come `wasteflow_app` dentro il contesto dell'azienda (set_config locale alla transazione). */
  const comeApp = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    })

  /** Versione PROPRIA inserita dal proprietario; ritorna l'id. */
  async function propria(
    tx: Tx,
    tenantId: string,
    o: {
      codice?: string
      verso?: Verso
      ruolo?: string
      dal?: string
      al?: string | null
      rentri?: string | null
      operazione?: string | null
      descrizione?: string
    } = {}
  ) {
    const righe = await tx.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, descrizione, ruolo_mud, codice_rentri, operazione,
          valida_dal, valida_al, creato_da, fatturabile, updated_at)
       VALUES ($1::uuid, 'PROPRIA', $2, $3::waste_movement_type, $4, $5::ruolo_mud_causale, $6, $7,
               $8::date, $9::date, $10::uuid, false, now())
       RETURNING id::text AS id`,
      tenantId,
      o.codice ?? 'AZ_PROVA',
      o.verso ?? 'SCARICO',
      o.descrizione ?? 'Causale di prova',
      o.ruolo ?? 'ESCLUSO',
      o.rentri ?? null,
      o.operazione ?? null,
      o.dal ?? '2026-01-01',
      o.al ?? null,
      randomUUID()
    )
    return righe[0].id
  }

  const disattivazione = (tx: Tx, tenantId: string, codice: string, verso: Verso, extra = '') =>
    tx.$executeRawUnsafe(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, causale_sistema_codice, ${extra ? 'descrizione,' : ''} creato_da, updated_at)
       VALUES ($1::uuid, 'DISATTIVAZIONE', $2, $3::waste_movement_type, $2, ${extra ? `'${extra}',` : ''} $4::uuid, now())`,
      tenantId,
      codice,
      verso,
      randomUUID()
    )

  /** Movimento inserito dal proprietario (nessuna logica applicativa: solo vincoli del database). */
  const movimento = (
    tx: Tx,
    a: { tenantId: string; registroId: string },
    o: { type: Verso; causale: string; causaleAziendaId?: string | null; quando?: string }
  ) =>
    tx.$executeRawUnsafe(
      `INSERT INTO waste_movements
         (tenant_id, registro_id, type, movement_date, causale, causale_azienda_id, cer_code,
          quantity, unit, progressive_year, progressive_number, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::waste_movement_type, $4::timestamp, $5, $6::uuid, '99 99 03',
               10, 'KG', 2026, $7, now())`,
      a.tenantId,
      a.registroId,
      o.type,
      o.quando ?? '2026-03-10T10:00:00',
      o.causale,
      o.causaleAziendaId ?? null,
      ++numeroMovimento
    )

  /**
   * La transazione del proprietario deve essere respinta dal database con un errore che combacia.
   * Dopo `fn` lancia comunque una sentinella: se il vincolo sparisse, `fn` riuscirebbe, l'errore
   * sarebbe la sentinella (il test fallisce) e nulla resterebbe scritto, catalogo compreso.
   */
  const respinta = async (fn: (tx: Tx) => Promise<unknown>, atteso: RegExp) => {
    const errore = await owner
      .$transaction(async tx => {
        await fn(tx)
        throw SENTINELLA
      })
      .catch(e => e as Error)
    expect(errore).not.toBe(SENTINELLA)
    expect(String((errore as Error).message)).toMatch(atteso)
  }

  /** Esegue e poi annulla: nulla resta nel database. */
  async function conRollback(fn: (tx: Tx) => Promise<void>) {
    const errore = await owner
      .$transaction(async tx => {
        await fn(tx)
        throw SENTINELLA
      })
      .catch(e => e as Error)
    expect(errore).toBe(SENTINELLA)
  }

  const leggiCatalogo = () =>
    owner.$queryRawUnsafe<RigaCatalogo[]>(
      `SELECT codice, verso::text AS verso, descrizione, ruolo_mud::text AS ruolo_mud, codice_rentri,
              operazione, ordine::int AS ordine, attiva
       FROM causali_registro`
    )

  afterAll(async () => {
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.$disconnect()
    await owner.$disconnect()
  })

  describe('catalogo di sistema', () => {
    it('contiene esattamente le 11 causali di oggi, leggibili senza contesto di azienda', async () => {
      const righe = await app.$queryRawUnsafe<RigaCatalogo[]>(
        `SELECT codice, verso::text AS verso, descrizione, ruolo_mud::text AS ruolo_mud, codice_rentri,
                operazione, ordine::int AS ordine, attiva
         FROM causali_registro`
      )
      expect([...righe].sort(ORDINE)).toEqual([...CATALOGO_ATTESO].sort(ORDINE))
      expect(righe).toHaveLength(11)
    })

    it("l'applicazione non può scrivere: INSERT, UPDATE, DELETE e TRUNCATE danno 42501", async () => {
      for (const sql of [
        `INSERT INTO causali_registro (codice, verso, descrizione, ruolo_mud, ordine) VALUES ('NUOVA', 'CARICO', 'x', 'ESCLUSO', 1)`,
        `UPDATE causali_registro SET descrizione = 'x'`,
        `DELETE FROM causali_registro`,
        `TRUNCATE causali_registro`,
      ]) {
        await expect(app.$executeRawUnsafe(sql)).rejects.toThrow(/42501/)
      }
    })

    it('i CHECK del catalogo respingono codice AZ_, ruolo AVVIATO su CARICO e codice RENTRI TR (transazione annullata)', async () => {
      const insert = (tx: Tx, codice: string, verso: Verso, ruolo: string, rentri: string | null) =>
        tx.$executeRawUnsafe(
          `INSERT INTO causali_registro (codice, verso, descrizione, ruolo_mud, codice_rentri, ordine)
           VALUES ($1, $2::waste_movement_type, 'x', $3::ruolo_mud_causale, $4, 99)`,
          codice,
          verso,
          ruolo,
          rentri
        )
      await respinta(
        tx => insert(tx, 'AZ_QUALCOSA', 'CARICO', 'ESCLUSO', null),
        /causali_registro_codice_formato/
      )
      await respinta(
        tx => insert(tx, 'minuscolo', 'CARICO', 'ESCLUSO', null),
        /causali_registro_codice_formato/
      )
      await respinta(
        tx => insert(tx, 'PROVA_X', 'CARICO', 'AVVIATO', null),
        /causali_registro_ruolo_verso/
      )
      await respinta(
        tx => insert(tx, 'PROVA_X', 'SCARICO', 'PRODOTTO', null),
        /causali_registro_ruolo_verso/
      )
      await respinta(
        tx => insert(tx, 'PROVA_X', 'SCARICO', 'ESCLUSO', 'TR'),
        /causali_registro_codice_rentri_verso/
      )
      await respinta(
        tx => insert(tx, 'PROVA_X', 'SCARICO', 'ESCLUSO', 'T*aT'),
        /causali_registro_codice_rentri_verso/
      )
      await respinta(
        tx => insert(tx, 'PROVA_X', 'SCARICO', 'ESCLUSO', 'DT'),
        /causali_registro_codice_rentri_verso/
      )
      await respinta(
        tx => insert(tx, 'PROVA_X', 'CARICO', 'ESCLUSO', 'aT'),
        /causali_registro_codice_rentri_verso/
      )
      // operazione R/D solo per SCARICO + AVVIATO
      await respinta(
        tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO causali_registro (codice, verso, descrizione, ruolo_mud, operazione, ordine)
             VALUES ('PROVA_X', 'SCARICO', 'x', 'ESCLUSO', 'R', 99)`
          ),
        /causali_registro_operazione_coerente/
      )
      // Una riga valida nella stessa forma passa il CHECK e poi si annulla: nulla resta.
      await conRollback(async tx => {
        await insert(tx, 'PROVA_VALIDA', 'SCARICO', 'AVVIATO', 'aT')
      })
      expect((await leggiCatalogo()).sort(ORDINE)).toEqual([...CATALOGO_ATTESO].sort(ORDINE))
    })
  })

  describe('personalizzazioni: CHECK, unicità e chiavi esterne', () => {
    it('una causale propria respinge codice senza prefisso, ruoli e codici RENTRI incoerenti, operazione su CARICO, validità invertita', async () => {
      const a = await azienda()
      await respinta(
        tx => propria(tx, a.tenantId, { codice: 'PROVA' }),
        /causali_registro_azienda_natura_propria/
      )
      await respinta(
        tx => propria(tx, a.tenantId, { codice: 'AZ_X' }),
        /causali_registro_azienda_natura_propria/
      )
      await respinta(
        tx => propria(tx, a.tenantId, { verso: 'CARICO', ruolo: 'AVVIATO' }),
        /causali_registro_azienda_ruolo_verso/
      )
      await respinta(
        tx => propria(tx, a.tenantId, { verso: 'SCARICO', rentri: 'T*' }),
        /causali_registro_azienda_codice_rentri_verso/
      )
      await respinta(
        tx => propria(tx, a.tenantId, { verso: 'SCARICO', rentri: 'TR' }),
        /causali_registro_azienda_codice_rentri_verso/
      )
      await respinta(
        tx => propria(tx, a.tenantId, { verso: 'CARICO', ruolo: 'PRODOTTO', operazione: 'R' }),
        /causali_registro_azienda_operazione_coerente/
      )
      await respinta(
        tx => propria(tx, a.tenantId, { dal: '2026-05-10', al: '2026-05-09' }),
        /causali_registro_azienda_natura_propria/
      )
      // Controprova: la forma corretta passa.
      await conRollback(async tx => {
        await propria(tx, a.tenantId, {
          verso: 'SCARICO',
          ruolo: 'AVVIATO',
          rentri: 'I',
          operazione: 'D',
        })
      })
    })

    it("la disattivazione con una descrizione è respinta; di un codice di sistema inesistente viola la chiave esterna; la doppia viola l'unicità", async () => {
      const a = await azienda()
      await respinta(
        tx => disattivazione(tx, a.tenantId, 'CESSIONE', 'SCARICO', 'non ammessa'),
        /causali_registro_azienda_natura_disattivazione/
      )
      await respinta(
        tx => disattivazione(tx, a.tenantId, 'NON_ESISTE', 'SCARICO'),
        /causali_registro_azienda_sistema_fkey/
      )
      // CESSIONE esiste solo come SCARICO: come CARICO non c'è.
      await respinta(
        tx => disattivazione(tx, a.tenantId, 'CESSIONE', 'CARICO'),
        /causali_registro_azienda_sistema_fkey/
      )
      await disattivazione(owner, a.tenantId, 'CESSIONE', 'SCARICO')
      await respinta(
        tx => disattivazione(tx, a.tenantId, 'CESSIONE', 'SCARICO'),
        /23505|already exists/
      )
      // RICLASSIFICAZIONE esiste in entrambi i versi: la chiave è (codice, verso).
      await disattivazione(owner, a.tenantId, 'RICLASSIFICAZIONE', 'CARICO')
      await disattivazione(owner, a.tenantId, 'RICLASSIFICAZIONE', 'SCARICO')
    })

    it('una disattivazione senza codice di sistema è respinta (non può diventare bersaglio della chiave esterna dei movimenti)', async () => {
      const a = await azienda()
      await respinta(
        tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO causali_registro_azienda (tenant_id, natura, codice, verso, causale_sistema_codice, creato_da, updated_at)
             VALUES ($1::uuid, 'DISATTIVAZIONE', 'AZ_FINTA', 'SCARICO', NULL, $2::uuid, now())`,
            a.tenantId,
            randomUUID()
          ),
        /causali_registro_azienda_natura_disattivazione/
      )
      // Codice con formato non valido, per qualunque natura.
      await respinta(
        tx => disattivazione(tx, a.tenantId, 'minuscolo', 'SCARICO'),
        /causali_registro_azienda_codice_formato|causali_registro_azienda_sistema_fkey/
      )
    })

    it('una causale di sistema con riferimento non cancellabile finché è disattivata: il catalogo non si tocca (RESTRICT)', async () => {
      const a = await azienda()
      await disattivazione(owner, a.tenantId, 'ALTRO_SCARICO', 'SCARICO')
      await respinta(
        tx =>
          tx.$executeRawUnsafe(
            `DELETE FROM causali_registro WHERE codice = 'ALTRO_SCARICO' AND verso = 'SCARICO'`
          ),
        /causali_registro_azienda_sistema_fkey/
      )
    })
  })

  describe('trigger causali_registro_azienda_controlli', () => {
    it('due versioni sovrapposte sono respinte, contigue ammesse; una sola aperta per causale', async () => {
      const a = await azienda()
      await propria(owner, a.tenantId, { dal: '2026-01-01', al: '2026-06-30' })
      await respinta(tx => propria(tx, a.tenantId, { dal: '2026-06-30' }), /si sovrappongono/)
      await respinta(
        tx => propria(tx, a.tenantId, { dal: '2026-03-01', al: '2026-04-01' }),
        /si sovrappongono/
      )
      await propria(owner, a.tenantId, { dal: '2026-07-01' })
      // Un'altra aperta: la sovrapposizione la ferma prima dell'indice parziale; sul passato non
      // sovrapposto (prima di tutto) l'indice parziale la ferma comunque.
      await respinta(
        tx => propria(tx, a.tenantId, { dal: '2025-01-01', al: null }),
        /si sovrappongono|causali_registro_azienda_una_aperta/
      )
      // Altro verso o altro codice: nessuna interferenza.
      await propria(owner, a.tenantId, { dal: '2026-01-01', verso: 'CARICO', ruolo: 'ESCLUSO' })
      await propria(owner, a.tenantId, { dal: '2026-01-01', codice: 'AZ_ALTRA' })
    })

    it('UPDATE di codice o verso respinto', async () => {
      const a = await azienda()
      const id = await propria(owner, a.tenantId, { verso: 'SCARICO', ruolo: 'ESCLUSO' })
      await respinta(
        tx =>
          tx.$executeRawUnsafe(
            `UPDATE causali_registro_azienda SET codice = 'AZ_ALTRO' WHERE id = $1::uuid`,
            id
          ),
        /non si cambiano/
      )
      await respinta(
        tx =>
          tx.$executeRawUnsafe(
            `UPDATE causali_registro_azienda SET verso = 'CARICO' WHERE id = $1::uuid`,
            id
          ),
        /non si cambiano/
      )
    })

    it('versione non referenziata: ruolo, inizio e fine si possono cambiare', async () => {
      const a = await azienda()
      const id = await propria(owner, a.tenantId, { ruolo: 'ESCLUSO', dal: '2026-01-01' })
      await owner.$executeRawUnsafe(
        `UPDATE causali_registro_azienda SET ruolo_mud = 'AVVIATO', codice_rentri = 'aT', operazione = 'R',
           valida_dal = '2026-02-01', valida_al = '2026-02-28', updated_at = now() WHERE id = $1::uuid`,
        id
      )
      const [r] = await owner.$queryRawUnsafe<{ ruolo_mud: string }[]>(
        `SELECT ruolo_mud::text FROM causali_registro_azienda WHERE id = $1::uuid`,
        id
      )
      expect(r.ruolo_mud).toBe('AVVIATO')
    })

    it("versione referenziata: ruolo e inizio immutabili, la fine non prima dell'ultimo giorno d'uso", async () => {
      const a = await azienda()
      const id = await propria(owner, a.tenantId, { ruolo: 'ESCLUSO', dal: '2026-01-01' })
      await movimento(owner, a, {
        type: 'SCARICO',
        causale: 'AZ_PROVA',
        causaleAziendaId: id,
        quando: '2026-03-10T10:00:00',
      })
      await movimento(owner, a, {
        type: 'SCARICO',
        causale: 'AZ_PROVA',
        causaleAziendaId: id,
        quando: '2026-03-20T10:00:00',
      })

      const aggiorna = (tx: Tx, set: string) =>
        tx.$executeRawUnsafe(
          `UPDATE causali_registro_azienda SET ${set}, updated_at = now() WHERE id = $1::uuid`,
          id
        )

      await respinta(tx => aggiorna(tx, `ruolo_mud = 'AVVIATO'`), /gia' usata/)
      await respinta(tx => aggiorna(tx, `codice_rentri = 'I'`), /gia' usata/)
      await respinta(tx => aggiorna(tx, `valida_dal = '2026-02-01'`), /gia' usata/)
      await respinta(
        tx => aggiorna(tx, `valida_al = '2026-03-19'`),
        /ultimo giorno d'uso \(2026-03-20\)/
      )
      // Descrizione e ordine restano modificabili; la fine uguale all'ultimo giorno d'uso è ammessa.
      await aggiorna(owner, `descrizione = 'Nuova descrizione', ordine = 5`)
      await aggiorna(owner, `valida_al = '2026-03-20'`)
      // Riaprire (valida_al NULL) è ammesso.
      await aggiorna(owner, `valida_al = NULL`)
    })

    it('il giorno di utilizzo è quello italiano: un movimento delle 23:30 UTC del 31/12 conta il 1° gennaio', async () => {
      const a = await azienda()
      const id = await propria(owner, a.tenantId, { dal: '2026-01-01' })
      await movimento(owner, a, {
        type: 'SCARICO',
        causale: 'AZ_PROVA',
        causaleAziendaId: id,
        quando: '2026-12-31T23:30:00',
      })
      await respinta(
        tx =>
          tx.$executeRawUnsafe(
            `UPDATE causali_registro_azienda SET valida_al = '2026-12-31', updated_at = now() WHERE id = $1::uuid`,
            id
          ),
        /ultimo giorno d'uso \(2027-01-01\)/
      )
      await owner.$executeRawUnsafe(
        `UPDATE causali_registro_azienda SET valida_al = '2027-01-01', updated_at = now() WHERE id = $1::uuid`,
        id
      )
    })
  })

  describe('riferimento dal movimento (C6)', () => {
    it('causale diversa dal codice della versione, o tipo diverso dal verso, viola la chiave esterna', async () => {
      const a = await azienda()
      const id = await propria(owner, a.tenantId, { codice: 'AZ_PROVA', verso: 'SCARICO' })
      await respinta(
        tx => movimento(tx, a, { type: 'SCARICO', causale: 'AZ_ALTRA', causaleAziendaId: id }),
        /waste_movements_causale_azienda_fkey/
      )
      await respinta(
        tx => movimento(tx, a, { type: 'CARICO', causale: 'AZ_PROVA', causaleAziendaId: id }),
        /waste_movements_causale_azienda_fkey/
      )
      // Versione di un'altra azienda: stessa coppia id ma tenant diverso.
      const b = await azienda()
      await respinta(
        tx => movimento(tx, b, { type: 'SCARICO', causale: 'AZ_PROVA', causaleAziendaId: id }),
        /waste_movements_causale_azienda_fkey/
      )
      // Controprova: tutto coerente.
      await movimento(owner, a, { type: 'SCARICO', causale: 'AZ_PROVA', causaleAziendaId: id })
    })

    it('CHECK di coerenza: AZ_ senza riferimento respinta, causale di sistema o storica con riferimento respinta', async () => {
      const a = await azienda()
      const id = await propria(owner, a.tenantId)
      await respinta(
        tx => movimento(tx, a, { type: 'SCARICO', causale: 'AZ_PROVA' }),
        /waste_movements_causale_azienda_coerente/
      )
      await respinta(
        tx => movimento(tx, a, { type: 'SCARICO', causale: 'ALTRO_SCARICO', causaleAziendaId: id }),
        /waste_movements_causale_azienda_coerente/
      )
      // Una causale storica fuori catalogo, senza riferimento, resta ammessa (nessuna FK sul catalogo).
      await movimento(owner, a, { type: 'SCARICO', causale: 'CAUSALE_STORICA' })
      await movimento(owner, a, { type: 'SCARICO', causale: 'ALTRO_SCARICO' })
    })

    it('una versione usata non si cancella; senza movimenti sì', async () => {
      const a = await azienda()
      const usata = await propria(owner, a.tenantId, { dal: '2026-01-01', al: '2026-06-30' })
      const libera = await propria(owner, a.tenantId, { dal: '2026-07-01' })
      await movimento(owner, a, { type: 'SCARICO', causale: 'AZ_PROVA', causaleAziendaId: usata })
      await respinta(
        tx =>
          tx.$executeRawUnsafe(`DELETE FROM causali_registro_azienda WHERE id = $1::uuid`, usata),
        /waste_movements_causale_azienda_fkey/
      )
      await owner.$executeRawUnsafe(
        `DELETE FROM causali_registro_azienda WHERE id = $1::uuid`,
        libera
      )
    })

    it("la cancellazione di un'azienda con movimenti e causali in un solo statement riesce", async () => {
      const a = await azienda()
      const id = await propria(owner, a.tenantId)
      await movimento(owner, a, { type: 'SCARICO', causale: 'AZ_PROVA', causaleAziendaId: id })
      await disattivazione(owner, a.tenantId, 'CESSIONE', 'SCARICO')
      // Il tenant porta via con un solo DELETE registri, movimenti e causali: la chiave esterna del
      // movimento verso la causale e' NoAction (controllo a fine statement), non Restrict.
      await owner.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1::uuid`, a.tenantId)
      const [r] = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM causali_registro_azienda WHERE tenant_id = $1::uuid`,
        a.tenantId
      )
      expect(r.n).toBe(0)
    })
  })

  describe('RLS di causali_registro_azienda (ruolo applicativo)', () => {
    it("l'azienda B non vede né modifica né cancella le causali di A; A le vede", async () => {
      const a = await azienda()
      const b = await azienda()
      const id = await propria(owner, a.tenantId, { descrizione: 'Di A' })

      expect(
        await comeApp(b.tenantId, tx =>
          tx.$queryRawUnsafe<unknown[]>(
            `SELECT id FROM causali_registro_azienda WHERE id = $1::uuid`,
            id
          )
        )
      ).toHaveLength(0)
      expect(
        await comeApp(b.tenantId, tx =>
          tx.$executeRawUnsafe(
            `UPDATE causali_registro_azienda SET descrizione = 'rubata', updated_at = now() WHERE id = $1::uuid`,
            id
          )
        )
      ).toBe(0)
      expect(
        await comeApp(b.tenantId, tx =>
          tx.$executeRawUnsafe(`DELETE FROM causali_registro_azienda WHERE id = $1::uuid`, id)
        )
      ).toBe(0)
      const dopo = await comeApp(a.tenantId, tx =>
        tx.$queryRawUnsafe<{ descrizione: string }[]>(
          `SELECT descrizione FROM causali_registro_azienda WHERE id = $1::uuid`,
          id
        )
      )
      expect(dopo).toEqual([{ descrizione: 'Di A' }])
      // Senza contesto di azienda non si vede nulla (fail-closed).
      expect(
        await app.$queryRawUnsafe<unknown[]>(
          `SELECT id FROM causali_registro_azienda WHERE id = $1::uuid`,
          id
        )
      ).toHaveLength(0)
    })

    it("un'azienda non può inserire righe con il tenant_id di un'altra (WITH CHECK); le proprie sì, con il trigger", async () => {
      const a = await azienda()
      const b = await azienda()
      await expect(comeApp(b.tenantId, tx => propria(tx, a.tenantId))).rejects.toThrow(
        /row-level security/i
      )
      const id = await comeApp(b.tenantId, tx =>
        propria(tx, b.tenantId, { dal: '2026-01-01', al: '2026-06-30' })
      )
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
      // Il trigger gira anche col ruolo applicativo (vede le sole righe della sua azienda).
      await expect(
        comeApp(b.tenantId, tx => propria(tx, b.tenantId, { dal: '2026-06-30' }))
      ).rejects.toThrow(/si sovrappongono/)
    })
  })
})
