/**
 * Agenti di pesa e letture firmate (Fase 4 pezzo 8b, Task B2) contro un Postgres reale: vincoli,
 * trigger, privilegi e RLS di `agenti_pesa`, `letture_pesa` e del legame `pesate.lettura_id`.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende, registri e strumenti; le operazioni
 * sotto prova girano COME `wasteflow_app` (o `wasteflow_sistema`) nel contesto dell'azienda
 * (RLS ENABLE+FORCE e privilegi veri) oppure come proprietario quando si prova che anche lui e'
 * fermato dai trigger. La pulizia cancella SOLO le aziende create qui, per id esatto.
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../database/client-come-ruolo'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'

const HASH = 'a'.repeat(64)
const HASH2 = 'b'.repeat(64)
const CHIAVE_B64 = 'A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg='
const FIRMA = `${'A'.repeat(86)}==`

type Valore = string | number | boolean | null

describe('Pese 4.8b: agenti e letture (Postgres reale)', () => {
  const owner = new PrismaClient()
  const app = clientComeRuolo('wasteflow_app', process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev')
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev'
  )
  const tenantCreati: string[] = []
  let n = 0
  const seme = 6_000_000 + (Date.now() % 3_000_000)

  const lett = (v: Valore) =>
    v === null ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v)

  async function inserisci(
    c: PrismaClient,
    tabella: string,
    campi: Record<string, Valore>
  ): Promise<string> {
    const k = Object.keys(campi)
    const r = await c.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO ${tabella} (${k.join(', ')}) VALUES (${k.map(x => lett(campi[x])).join(', ')}) RETURNING id::text AS id`
    )
    return r[0].id
  }

  /** Esegue `sql` come `wasteflow_app` nel contesto dell'azienda indicata. */
  const comeApp = (tenantId: string, sql: string) =>
    app.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantId}', true)`)
      return tx.$executeRawUnsafe(sql)
    })
  const leggiComeApp = <T>(tenantId: string, sql: string) =>
    app.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantId}', true)`)
      return tx.$queryRawUnsafe<T[]>(sql)
    })
  const inserisciComeApp = (tenantId: string, tabella: string, campi: Record<string, Valore>) =>
    app.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantId}', true)`)
      const k = Object.keys(campi)
      const r = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO ${tabella} (${k.join(', ')}) VALUES (${k.map(x => lett(campi[x])).join(', ')}) RETURNING id::text AS id`
      )
      return r[0].id
    })

  interface Azienda {
    t: string
    user: string
    reg: string
    strumento: string
    strumento2: string
    agente: string
  }

  const ora = () => new Date().toISOString()

  async function agenteAttivo(t: string, user: string, reg: string | null = null) {
    n++
    return inserisci(owner, 'agenti_pesa', {
      tenant_id: t,
      registro_id: reg,
      descrizione: 'PC pesa',
      stato: 'ATTIVO',
      token_sha256: `${n}`.padStart(64, 'c'),
      chiave_pubblica: CHIAVE_B64,
      impronta_chiave: HASH,
      abbinato_il: ora(),
      creato_da: user,
      updated_at: ora(),
    })
  }

  async function azienda(): Promise<Azienda> {
    n++
    const t = (
      await owner.tenant.create({
        data: {
          partitaIva: partitaIvaValida(seme + n * 17),
          ragioneSociale: 'Agenti SRL',
          country: 'IT',
        },
      })
    ).id
    tenantCreati.push(t)
    const user = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-agenti-${seme}-${n}`,
          fiscalCode: `AGNT${seme}${n}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Agenti',
          email: `agenti-${seme}-${n}@example.test`,
        },
      })
    ).id
    const reg = (
      await owner.registroRifiuti.create({ data: { tenantId: t, descrizione: 'Registro A' } })
    ).id
    const strumento = await inserisci(owner, 'strumenti_pesa', {
      tenant_id: t,
      descrizione: 'Pesa 1',
      creato_da: user,
      updated_at: ora(),
    })
    const strumento2 = await inserisci(owner, 'strumenti_pesa', {
      tenant_id: t,
      descrizione: 'Pesa 2',
      creato_da: user,
      updated_at: ora(),
    })
    return { t, user, reg, strumento, strumento2, agente: await agenteAttivo(t, user, reg) }
  }

  let seq = 0
  const campiLettura = (a: Azienda, o: Record<string, Valore> = {}): Record<string, Valore> => ({
    tenant_id: a.t,
    agente_id: a.agente,
    strumento_id: a.strumento,
    chiave_idempotenza: crypto.randomUUID(),
    sequenza: ++seq,
    peso_kg: 12340,
    stabile: true,
    ora_agente: ora(),
    ora_ricezione: ora(),
    driver: 'D800-MP',
    simulata: false,
    payload: '{}',
    firma: FIRMA,
    ...o,
  })
  const lettura = (a: Azienda, o: Record<string, Valore> = {}) =>
    inserisci(owner, 'letture_pesa', campiLettura(a, o))
  const letturaComeApp = (a: Azienda, o: Record<string, Valore> = {}) =>
    inserisciComeApp(a.t, 'letture_pesa', campiLettura(a, o))

  const accesso = (a: Azienda) =>
    inserisci(owner, 'accessi_pesa', {
      tenant_id: a.t,
      registro_id: a.reg,
      anno: 2026,
      numero: ++n,
      verso: 'CARICO',
      modo: 'DOPPIA',
      aperto_da: a.user,
    })

  /** Pesata copiata dalla lettura (come app); `o` sovrascrive espressioni SQL per le prove negative. */
  function pesataDaLettura(
    a: Azienda,
    accessoId: string,
    letturaId: string,
    o: { fonte?: string; peso?: string; stabile?: string } = {}
  ): Promise<number> {
    return comeApp(
      a.t,
      `INSERT INTO pesate (tenant_id, accesso_id, ordine, fonte, strumento_id, alibi_id, peso_kg, stabile,
         ora_strumento, ora_ricezione, operatore_id, firma_agente, lettura_id, chiave_idempotenza, impronta)
       SELECT l.tenant_id, '${accessoId}', 1, ${o.fonte ?? `CASE WHEN l.simulata THEN 'SIMULATA' ELSE 'STRUMENTO' END`}::fonte_pesata,
         l.strumento_id, l.alibi_id, ${o.peso ?? 'l.peso_kg'}, ${o.stabile ?? 'l.stabile'},
         l.ora_strumento, l.ora_ricezione, '${a.user}', l.firma, l.id, gen_random_uuid(), '${HASH}'
       FROM letture_pesa l WHERE l.id = '${letturaId}'`
    )
  }

  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await Promise.all([owner.$disconnect(), app.$disconnect(), sistema.$disconnect()])
  })

  describe('letture_pesa: immutabilita, privilegi, vincoli', () => {
    it('UPDATE e DELETE rifiutati a wasteflow_app e wasteflow_sistema (privilegi) e al proprietario (trigger)', async () => {
      const a = await azienda()
      const l = await lettura(a)
      await expect(
        comeApp(a.t, `UPDATE letture_pesa SET peso_kg = 5 WHERE id = '${l}'`)
      ).rejects.toThrow(/42501|permission denied/i)
      await expect(comeApp(a.t, `DELETE FROM letture_pesa WHERE id = '${l}'`)).rejects.toThrow(
        /42501|permission denied/i
      )
      await expect(
        sistema.$executeRawUnsafe(`UPDATE letture_pesa SET peso_kg = 5 WHERE id = '${l}'`)
      ).rejects.toThrow(/42501|permission denied/i)
      await expect(
        sistema.$executeRawUnsafe(`DELETE FROM letture_pesa WHERE id = '${l}'`)
      ).rejects.toThrow(/42501|permission denied/i)
      await expect(
        owner.$executeRawUnsafe(`UPDATE letture_pesa SET peso_kg = 5 WHERE id = '${l}'`)
      ).rejects.toThrow(/riga immutabile/)
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM letture_pesa WHERE id = '${l}'`)
      ).rejects.toThrow(/non si cancellano/)
    })

    it('TRUNCATE rifiutato a tutti i ruoli (privilegi o trigger)', async () => {
      await expect(app.$executeRawUnsafe('TRUNCATE letture_pesa')).rejects.toThrow(
        /42501|permission denied/i
      )
      await expect(sistema.$executeRawUnsafe('TRUNCATE letture_pesa')).rejects.toThrow(
        /42501|permission denied/i
      )
      // da sola PostgreSQL la ferma gia' per le chiavi esterne; con CASCADE (tutti i BEFORE TRUNCATE scattano prima di svuotare) scatta il trigger
      await expect(owner.$executeRawUnsafe('TRUNCATE letture_pesa')).rejects.toThrow(
        /cannot truncate|non si svuota/
      )
      await expect(owner.$executeRawUnsafe('TRUNCATE letture_pesa CASCADE')).rejects.toThrow(
        /non si svuota/
      )
    })

    it('wasteflow_app legge e inserisce letture nel proprio contesto', async () => {
      const a = await azienda()
      const id = await letturaComeApp(a)
      const r = await leggiComeApp<{ id: string }>(a.t, `SELECT id::text FROM letture_pesa`)
      expect(r.map(x => x.id)).toEqual([id])
    })

    it('una lettura con stabile = false non entra (CHECK)', async () => {
      const a = await azienda()
      await expect(lettura(a, { stabile: false })).rejects.toThrow(/letture_pesa_valori_check/)
    })

    it('peso <= 0, sequenza < 1, alibi vuoto, firma e payload malformati rifiutati (CHECK)', async () => {
      const a = await azienda()
      const casi: Array<Record<string, Valore>> = [
        { peso_kg: 0 },
        { sequenza: 0 },
        { alibi_id: '  ' },
        { firma: 'abc' },
        { payload: 'x' },
        { payload: 'x'.repeat(2049) },
      ]
      for (const o of casi) {
        await expect(lettura(a, o)).rejects.toThrow(/letture_pesa_valori_check/)
      }
    })

    it('simulata incoerente col driver rifiutata, coerente ammessa', async () => {
      const a = await azienda()
      await expect(lettura(a, { driver: 'SIMULATA', simulata: false })).rejects.toThrow(
        /letture_pesa_valori_check/
      )
      await expect(lettura(a, { driver: 'D800-MP', simulata: true })).rejects.toThrow(
        /letture_pesa_valori_check/
      )
      await expect(lettura(a, { driver: 'SIMULATA', simulata: true })).resolves.toEqual(
        expect.any(String)
      )
    })

    it('alibi ripetuto sullo stesso strumento rifiutato, su strumenti diversi ammesso; NULL ripetuti ammessi', async () => {
      const a = await azienda()
      await lettura(a, { alibi_id: 'SIM-1' })
      // il messaggio di Prisma per 23505 cita le colonne, non il nome dell'indice
      await expect(lettura(a, { alibi_id: 'SIM-1' })).rejects.toThrow(
        /\(strumento_id, alibi_id\).*already exists/
      )
      await expect(lettura(a, { alibi_id: 'SIM-1', strumento_id: a.strumento2 })).resolves.toEqual(
        expect.any(String)
      )
      await lettura(a)
      await lettura(a)
    })

    it('chiave di idempotenza e sequenza uniche per agente', async () => {
      const a = await azienda()
      const chiave = crypto.randomUUID()
      await lettura(a, { chiave_idempotenza: chiave, sequenza: 9001 })
      await expect(lettura(a, { chiave_idempotenza: chiave })).rejects.toThrow(
        /\(agente_id, chiave_idempotenza\).*already exists/
      )
      await expect(lettura(a, { sequenza: 9001 })).rejects.toThrow(
        /\(agente_id, sequenza\).*already exists/
      )
      // un altro agente della stessa azienda puo' riusare chiave e sequenza
      const altro = await agenteAttivo(a.t, a.user)
      await expect(
        lettura(a, { agente_id: altro, chiave_idempotenza: chiave, sequenza: 9001 })
      ).resolves.toEqual(expect.any(String))
    })
  })

  describe('pesate con lettura', () => {
    it('una pesata che copia la lettura e ammessa (STRUMENTO, e SIMULATA per una lettura simulata)', async () => {
      const a = await azienda()
      const l = await lettura(a)
      await expect(pesataDaLettura(a, await accesso(a), l)).resolves.toBe(1)
      const ls = await lettura(a, { driver: 'SIMULATA', simulata: true })
      await expect(pesataDaLettura(a, await accesso(a), ls)).resolves.toBe(1)
      const f = await leggiComeApp<{ fonte: string }>(
        a.t,
        `SELECT fonte::text FROM pesate ORDER BY created_at`
      )
      expect(f.map(x => x.fonte)).toEqual(['STRUMENTO', 'SIMULATA'])
    })

    it('un peso diverso dalla lettura e rifiutato dal trigger', async () => {
      const a = await azienda()
      const l = await lettura(a)
      await expect(pesataDaLettura(a, await accesso(a), l, { peso: '12341' })).rejects.toThrow(
        /valori diversi dalla lettura/
      )
    })

    it('una fonte diversa da quella della lettura e rifiutata (STRUMENTO per una simulata)', async () => {
      const a = await azienda()
      const ls = await lettura(a, { driver: 'SIMULATA', simulata: true })
      await expect(
        pesataDaLettura(a, await accesso(a), ls, { fonte: `'STRUMENTO'` })
      ).rejects.toThrow(/valori diversi dalla lettura/)
    })

    it('una pesata STRUMENTO senza lettura_id e rifiutata (CHECK)', async () => {
      const a = await azienda()
      await expect(
        inserisci(owner, 'pesate', {
          tenant_id: a.t,
          accesso_id: await accesso(a),
          ordine: 1,
          fonte: 'STRUMENTO',
          strumento_id: a.strumento,
          peso_kg: 1000,
          stabile: true,
          ora_ricezione: ora(),
          chiave_idempotenza: crypto.randomUUID(),
          impronta: HASH,
        })
      ).rejects.toThrow(/pesate_lettura_check/)
    })

    it('una pesata MANUALE con lettura_id e rifiutata (trigger prima, CHECK come seconda barriera)', async () => {
      const a = await azienda()
      const l = await lettura(a)
      await expect(
        inserisci(owner, 'pesate', {
          tenant_id: a.t,
          accesso_id: await accesso(a),
          ordine: 1,
          fonte: 'MANUALE',
          strumento_id: a.strumento,
          peso_kg: 12340,
          stabile: true,
          ora_ricezione: ora(),
          operatore_id: a.user,
          motivo_manuale: 'scontrino',
          lettura_id: l,
          chiave_idempotenza: crypto.randomUUID(),
          impronta: HASH,
        })
      ).rejects.toThrow(/pesate_lettura_check|valori diversi dalla lettura/)
    })

    it('una lettura diventa al piu una pesata, anche in un altro accesso (unico)', async () => {
      const a = await azienda()
      const l = await lettura(a)
      await pesataDaLettura(a, await accesso(a), l)
      await expect(pesataDaLettura(a, await accesso(a), l)).rejects.toThrow(/23505/)
    })

    it('due utilizzi in parallelo della stessa lettura: ne passa uno solo', async () => {
      const a = await azienda()
      const l = await lettura(a)
      const [acc1, acc2] = [await accesso(a), await accesso(a)]
      const esiti = await Promise.allSettled([
        pesataDaLettura(a, acc1, l),
        pesataDaLettura(a, acc2, l),
      ])
      expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
      expect(esiti.filter(e => e.status === 'rejected')).toHaveLength(1)
    })

    it('la lettura di un altro agente/azienda non e usabile (lettura non trovata nel contesto)', async () => {
      const a = await azienda()
      const b = await azienda()
      const lB = await lettura(b)
      await expect(
        comeApp(
          a.t,
          `INSERT INTO pesate (tenant_id, accesso_id, ordine, fonte, strumento_id, peso_kg, stabile,
             ora_ricezione, operatore_id, firma_agente, lettura_id, chiave_idempotenza, impronta)
           VALUES ('${a.t}', '${await accesso(a)}', 1, 'STRUMENTO', '${a.strumento}', 12340, true, now(),
             '${a.user}', '${FIRMA}', '${lB}', gen_random_uuid(), '${HASH}')`
        )
      ).rejects.toThrow(/lettura non trovata|foreign key/i)
    })
  })

  describe('agenti_pesa: stato e trasformazioni', () => {
    const inAttesa = (a: Azienda, o: Record<string, Valore> = {}) =>
      inserisci(owner, 'agenti_pesa', {
        tenant_id: a.t,
        descrizione: 'PC nuovo',
        creato_da: a.user,
        updated_at: ora(),
        codice_sha256: `${++n}`.padStart(64, 'd'),
        codice_scade_il: new Date(Date.now() + 900_000).toISOString(),
        ...o,
      })
    const aggiorna = (id: string, set: string) =>
      owner.$executeRawUnsafe(`UPDATE agenti_pesa SET ${set} WHERE id = '${id}'`)
    const attiva = (id: string) =>
      aggiorna(
        id,
        `stato = 'ATTIVO', token_sha256 = '${`${++n}`.padStart(64, 'e')}', chiave_pubblica = '${CHIAVE_B64}',
         impronta_chiave = '${HASH2}', abbinato_il = now(), codice_sha256 = NULL, codice_scade_il = NULL`
      )

    it('IN_ATTESA -> ATTIVO con token e chiave e ammesso', async () => {
      const a = await azienda()
      const id = await inAttesa(a)
      await expect(attiva(id)).resolves.toBe(1)
    })

    it('IN_ATTESA con token o chiave e rifiutato (CHECK); ATTIVO senza token pure', async () => {
      const a = await azienda()
      await expect(inAttesa(a, { token_sha256: HASH })).rejects.toThrow(/agenti_pesa_stato_check/)
      await expect(inAttesa(a, { stato: 'ATTIVO' })).rejects.toThrow(/agenti_pesa_stato_check/)
    })

    it('ATTIVO -> IN_ATTESA e rifiutato', async () => {
      const a = await azienda()
      await expect(
        aggiorna(
          a.agente,
          `stato = 'IN_ATTESA', token_sha256 = NULL, chiave_pubblica = NULL, impronta_chiave = NULL, abbinato_il = NULL`
        )
      ).rejects.toThrow(/transizione di stato non ammessa/)
    })

    it('il cambio di chiave_pubblica o token su un ATTIVO e rifiutato', async () => {
      const a = await azienda()
      await expect(aggiorna(a.agente, `chiave_pubblica = '${'B'.repeat(43)}='`)).rejects.toThrow(
        /token, chiave e abbinamento non si modificano/
      )
      await expect(aggiorna(a.agente, `token_sha256 = '${HASH2}'`)).rejects.toThrow(
        /token, chiave e abbinamento non si modificano/
      )
    })

    it('ATTIVO -> REVOCATO richiede motivo, e dopo nulla cambia: REVOCATO -> ATTIVO rifiutato, token resta', async () => {
      const a = await azienda()
      await expect(
        aggiorna(a.agente, `stato = 'REVOCATO', revocato_da = '${a.user}', revocato_il = now()`)
      ).rejects.toThrow(/agenti_pesa_stato_check/)
      await aggiorna(
        a.agente,
        `stato = 'REVOCATO', revocato_da = '${a.user}', revocato_il = now(), motivo_revoca = 'PC sostituito'`
      )
      await expect(aggiorna(a.agente, `stato = 'ATTIVO'`)).rejects.toThrow(
        /un agente revocato non si modifica/
      )
      await expect(aggiorna(a.agente, `ultimo_contatto_il = now()`)).rejects.toThrow(
        /un agente revocato non si modifica/
      )
      const r = await owner.$queryRawUnsafe<{ t: string | null }[]>(
        `SELECT token_sha256 AS t FROM agenti_pesa WHERE id = '${a.agente}'`
      )
      expect(r[0].t).not.toBeNull()
    })

    it('IN_ATTESA -> REVOCATO ammesso (senza token); token scritto alla revoca no', async () => {
      const a = await azienda()
      const id = await inAttesa(a)
      await expect(
        aggiorna(
          id,
          `stato = 'REVOCATO', codice_sha256 = NULL, codice_scade_il = NULL, revocato_da = '${a.user}',
           revocato_il = now(), motivo_revoca = 'non serve'`
        )
      ).resolves.toBe(1)
      const id2 = await inAttesa(a)
      await expect(
        aggiorna(
          id2,
          `stato = 'REVOCATO', codice_sha256 = NULL, codice_scade_il = NULL, revocato_da = '${a.user}',
           revocato_il = now(), motivo_revoca = 'x', token_sha256 = '${HASH2}'`
        )
      ).rejects.toThrow(/token e chiave si scrivono solo all'abbinamento/)
    })

    it('il codice cambia in IN_ATTESA, non su un agente ATTIVO', async () => {
      const a = await azienda()
      const id = await inAttesa(a)
      await expect(
        aggiorna(id, `codice_sha256 = '${HASH2}', codice_scade_il = now() + interval '15 minutes'`)
      ).resolves.toBe(1)
      await expect(
        aggiorna(a.agente, `codice_sha256 = '${HASH2}', codice_scade_il = now()`)
      ).rejects.toThrow(/agenti_pesa_stato_check|il codice di abbinamento cambia solo in attesa/)
    })

    it('azienda e creato_da non si modificano', async () => {
      const a = await azienda()
      const b = await azienda()
      await expect(aggiorna(a.agente, `creato_da = '${b.user}'`)).rejects.toThrow(
        /non si modificano/
      )
    })

    it('un contatto di un agente ATTIVO si registra (colonne operative libere) anche come app', async () => {
      const a = await azienda()
      await expect(
        comeApp(
          a.t,
          `UPDATE agenti_pesa SET ultimo_contatto_il = now(), ultimo_ip = '10.0.0.1', coda_in_attesa = 3,
           ultima_sequenza = 41, updated_at = now() WHERE id = '${a.agente}'`
        )
      ).resolves.toBe(1)
    })

    it('DELETE rifiutato a app, sistema e proprietario; la cascata da tenants invece riesce', async () => {
      const a = await azienda()
      await expect(
        comeApp(a.t, `DELETE FROM agenti_pesa WHERE id = '${a.agente}'`)
      ).rejects.toThrow(/42501|permission denied/i)
      await expect(
        sistema.$executeRawUnsafe(`DELETE FROM agenti_pesa WHERE id = '${a.agente}'`)
      ).rejects.toThrow(/42501|permission denied/i)
      await expect(
        owner.$executeRawUnsafe(`DELETE FROM agenti_pesa WHERE id = '${a.agente}'`)
      ).rejects.toThrow(/non si cancellano/)
    })

    it('uno strumento si assegna a un agente della stessa azienda, non a uno di un altro', async () => {
      const a = await azienda()
      const b = await azienda()
      await expect(
        comeApp(
          a.t,
          `UPDATE strumenti_pesa SET agente_id = '${a.agente}' WHERE id = '${a.strumento}'`
        )
      ).resolves.toBe(1)
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE strumenti_pesa SET agente_id = '${b.agente}' WHERE id = '${a.strumento2}'`
        )
      ).rejects.toThrow(/strumenti_pesa_agente_fkey/)
    })
  })

  describe('isolamento fra aziende e cascata', () => {
    it('col contesto dell’azienda B non si vede nessuna riga di A', async () => {
      const a = await azienda()
      const b = await azienda()
      await lettura(a)
      const agenti = await leggiComeApp<{ id: string }>(b.t, `SELECT id::text FROM agenti_pesa`)
      expect(agenti.map(x => x.id)).toEqual([b.agente])
      expect(await leggiComeApp(b.t, `SELECT id FROM letture_pesa`)).toEqual([])
    })

    it('senza contesto non si vede nulla e non si scrive', async () => {
      const a = await azienda()
      await lettura(a)
      const r = await app.$queryRawUnsafe<unknown[]>(`SELECT id FROM letture_pesa`)
      expect(r).toEqual([])
      await expect(
        app.$executeRawUnsafe(
          `INSERT INTO letture_pesa (tenant_id, agente_id, strumento_id, chiave_idempotenza, sequenza, peso_kg, stabile,
             ora_agente, ora_ricezione, driver, simulata, payload, firma)
           VALUES ('${a.t}', '${a.agente}', '${a.strumento}', gen_random_uuid(), 777, 1, true, now(), now(), 'X1', false, '{}', '${FIRMA}')`
        )
      ).rejects.toThrow(/row-level security|violates/i)
    })

    it('una lettura di B con l’agente di A viola la chiave esterna composta', async () => {
      const a = await azienda()
      const b = await azienda()
      await expect(
        lettura(b, { agente_id: a.agente, tenant_id: b.t, strumento_id: b.strumento })
      ).rejects.toThrow(/letture_pesa_agente_fkey/)
      await expect(lettura(b, { agente_id: b.agente, strumento_id: a.strumento })).rejects.toThrow(
        /letture_pesa_strumento_fkey/
      )
      await expect(
        comeApp(
          b.t,
          `INSERT INTO letture_pesa (tenant_id, agente_id, strumento_id, chiave_idempotenza, sequenza, peso_kg, stabile,
             ora_agente, ora_ricezione, driver, simulata, payload, firma)
           VALUES ('${b.t}', '${a.agente}', '${b.strumento}', gen_random_uuid(), 778, 1, true, now(), now(), 'X1', false, '{}', '${FIRMA}')`
        )
      ).rejects.toThrow(/letture_pesa_agente_fkey/)
    })

    it('cancellando l’azienda col proprietario spariscono agenti, letture e pesate', async () => {
      const a = await azienda()
      const l = await lettura(a)
      await pesataDaLettura(a, await accesso(a), l)
      await owner.tenant.delete({ where: { id: a.t } })
      for (const t of ['agenti_pesa', 'letture_pesa', 'pesate', 'strumenti_pesa']) {
        const r = await owner.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = '${a.t}'`
        )
        expect({ t, n: r[0].n }).toEqual({ t, n: 0 })
      }
    })

    it('tenants.pese_simulazione_ammessa vale false per default', async () => {
      const a = await azienda()
      const r = await owner.$queryRawUnsafe<{ v: boolean }[]>(
        `SELECT pese_simulazione_ammessa AS v FROM tenants WHERE id = '${a.t}'`
      )
      expect(r[0].v).toBe(false)
    })
  })
})
