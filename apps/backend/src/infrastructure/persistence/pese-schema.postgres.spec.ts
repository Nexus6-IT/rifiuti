/**
 * Pese (Fase 4 pezzo 8a, Task 2a/2b) contro un Postgres reale: vincoli, trigger, privilegi e RLS.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende, registri, FIR e movimenti; le
 * operazioni sotto prova girano COME `wasteflow_app` nel contesto dell'azienda (RLS ENABLE+FORCE
 * e privilegi veri) oppure come proprietario quando si prova che anche lui e' fermato dai trigger.
 * La pulizia cancella SOLO le aziende create qui, per id esatto, col proprietario (la cascata da
 * `tenants` e' l'unica cancellazione ammessa per le tabelle in sola scrittura).
 */
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../database/client-come-ruolo'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'

const HASH = 'a'.repeat(64)

type Valore = string | number | boolean | null

describe('Pese: vincoli, trigger, privilegi e RLS (Postgres reale)', () => {
  const owner = new PrismaClient()
  const app = clientComeRuolo('wasteflow_app', process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev')
  const sistema = clientComeRuolo(
    'wasteflow_sistema',
    process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev'
  )
  const tenantCreati: string[] = []
  let n = 0
  const seme = 5_000_000 + (Date.now() % 4_000_000)

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

  interface Azienda {
    t: string
    user: string
    reg: string
    reg2: string
    strumento: string
    strumento2: string
    fir: string
    fir2: string
    movCarico: string
    movScarico: string
    movAltroRegistro: string
  }

  async function azienda(): Promise<Azienda> {
    n++
    const t = (
      await owner.tenant.create({
        data: {
          partitaIva: partitaIvaValida(seme + n * 13),
          ragioneSociale: 'Pese SRL',
          country: 'IT',
        },
      })
    ).id
    tenantCreati.push(t)
    const user = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-pese-${seme}-${n}`,
          fiscalCode: `PESE${seme}${n}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Pese',
          email: `pese-${seme}-${n}@example.test`,
        },
      })
    ).id
    const reg = (
      await owner.registroRifiuti.create({ data: { tenantId: t, descrizione: 'Registro A' } })
    ).id
    const reg2 = (
      await owner.registroRifiuti.create({
        data: { tenantId: t, descrizione: 'Registro B', codice: 'ALTRO' },
      })
    ).id
    const strumento = await inserisci(owner, 'strumenti_pesa', {
      tenant_id: t,
      descrizione: 'Pesa 1',
      creato_da: user,
      updated_at: new Date().toISOString(),
    })
    const strumento2 = await inserisci(owner, 'strumenti_pesa', {
      tenant_id: t,
      descrizione: 'Pesa 2',
      creato_da: user,
      updated_at: new Date().toISOString(),
    })
    const firBase = {
      tenant_id: t,
      updated_at: new Date().toISOString(),
      producer_user_id: user,
      producer_partita_iva: '12345678903',
      producer_name: 'P',
      producer_address: 'via x',
      carrier_partita_iva: '12345678903',
      carrier_name: 'T',
      carrier_vehicle_plate: 'AB123CD',
      receiver_partita_iva: '12345678903',
      receiver_name: 'D',
      receiver_address: 'via y',
      cer_code: '99 99 03',
      waste_description: 'x',
      waste_category: 'NON_PERICOLOSO',
      quantity: 10,
      transport_date: new Date().toISOString(),
    }
    const fir = await inserisci(owner, 'firs', firBase)
    const fir2 = await inserisci(owner, 'firs', firBase)
    const mov = (type: string, registro: string, num: number) =>
      inserisci(owner, 'waste_movements', {
        tenant_id: t,
        updated_at: new Date().toISOString(),
        type,
        cer_code: '99 99 03',
        quantity: 10,
        movement_date: new Date().toISOString(),
        progressive_number: num,
        progressive_year: 2026,
        causale: type === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'CONFERIMENTO_TRASPORTATORE',
        registro_id: registro,
      })
    return {
      t,
      user,
      reg,
      reg2,
      strumento,
      strumento2,
      fir,
      fir2,
      movCarico: await mov('CARICO', reg, 1),
      movScarico: await mov('SCARICO', reg, 2),
      movAltroRegistro: await mov('CARICO', reg2, 1),
    }
  }

  const accesso = (
    a: Azienda,
    o: { registro?: string; verso?: string; modo?: string; numero?: number } = {}
  ) =>
    inserisci(owner, 'accessi_pesa', {
      tenant_id: a.t,
      registro_id: o.registro ?? a.reg,
      anno: 2026,
      numero: o.numero ?? ++n,
      verso: o.verso ?? 'CARICO',
      modo: o.modo ?? 'DOPPIA',
      aperto_da: a.user,
    })

  const campiPesata = (
    a: Azienda,
    accessoId: string,
    o: Record<string, Valore> = {}
  ): Record<string, Valore> => ({
    tenant_id: a.t,
    accesso_id: accessoId,
    ordine: 1,
    // Dal pezzo 8b `STRUMENTO` richiede una lettura firmata (`pesate_lettura_check`): la pesata di
    // base e' manuale; le prove sulle fonti STRUMENTO/SIMULATA stanno in pese-agenti-schema.
    fonte: 'MANUALE',
    operatore_id: a.user,
    motivo_manuale: 'scontrino',
    strumento_id: a.strumento,
    peso_kg: 1000,
    stabile: true,
    ora_ricezione: new Date().toISOString(),
    chiave_idempotenza: crypto.randomUUID(),
    impronta: HASH,
    ...o,
  })
  const pesata = (a: Azienda, accessoId: string, o: Record<string, Valore> = {}) =>
    inserisci(owner, 'pesate', campiPesata(a, accessoId, o))

  const chiudi = (a: Azienda, accessoId: string) =>
    owner.$executeRawUnsafe(
      `UPDATE accessi_pesa SET stato = 'CHIUSO', chiuso_da = '${a.user}', chiuso_il = now() WHERE id = '${accessoId}'`
    )

  /** Accesso DOPPIA chiuso con due pesate. */
  async function accessoChiuso(a: Azienda, o: { registro?: string; verso?: string } = {}) {
    const id = await accesso(a, o)
    await pesata(a, id, { ordine: 1, peso_kg: 2000 })
    await pesata(a, id, { ordine: 2, peso_kg: 1000 })
    await chiudi(a, id)
    return id
  }

  const collegamento = (a: Azienda, accessoId: string, o: Record<string, Valore>) =>
    inserisci(owner, 'collegamenti_accesso', {
      tenant_id: a.t,
      accesso_id: accessoId,
      registro_id: a.reg,
      verso: 'CARICO',
      creato_da: a.user,
      ...o,
    })

  afterAll(async () => {
    if (tenantCreati.length) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await Promise.all([owner.$disconnect(), app.$disconnect(), sistema.$disconnect()])
  })

  describe('immutabilita e privilegi', () => {
    it('UPDATE di una pesata fallisce anche per il proprietario (trigger) e per wasteflow_app (42501)', async () => {
      const a = await azienda()
      const p = await pesata(a, await accesso(a))
      await expect(
        owner.$executeRawUnsafe(`UPDATE pesate SET peso_kg = 5 WHERE id = '${p}'`)
      ).rejects.toThrow(/riga immutabile/)
      await expect(comeApp(a.t, `UPDATE pesate SET peso_kg = 5 WHERE id = '${p}'`)).rejects.toThrow(
        /42501|permission denied/i
      )
    })

    it('DELETE diretto di pesate, rettifiche e allegati fallisce per wasteflow_app, wasteflow_sistema e proprietario; TRUNCATE anche', async () => {
      const a = await azienda()
      const acc = await accesso(a)
      const p = await pesata(a, acc)
      const all = await inserisci(owner, 'allegati_pesa', {
        tenant_id: a.t,
        nome_file: 's.pdf',
        mime_type: 'application/pdf',
        dimensione_byte: 4,
        sha256: HASH,
        contenuto: '\\x25504446',
        caricato_da: a.user,
      })
      const r = await inserisci(owner, 'rettifiche_peso', {
        tenant_id: a.t,
        pesata_id: p,
        numero: 1,
        peso_precedente_kg: 1000,
        peso_nuovo_kg: 1100,
        motivo: 'errore',
        autore_id: a.user,
        impronta: HASH,
        created_at: new Date().toISOString(),
      })
      const righe: [string, string][] = [
        ['pesate', p],
        ['rettifiche_peso', r],
        ['allegati_pesa', all],
      ]
      for (const [t, id] of righe) {
        await expect(comeApp(a.t, `DELETE FROM ${t} WHERE id = '${id}'`)).rejects.toThrow(
          /42501|permission denied/i
        )
        await expect(
          sistema.$executeRawUnsafe(`DELETE FROM ${t} WHERE id = '${id}'`)
        ).rejects.toThrow(/42501|permission denied/i)
        await expect(
          owner.$executeRawUnsafe(`DELETE FROM ${t} WHERE id = '${id}'`)
        ).rejects.toThrow(/le righe non si cancellano/)
        await expect(owner.$executeRawUnsafe(`TRUNCATE ${t} CASCADE`)).rejects.toThrow(
          /non si svuota/
        )
      }
      expect(
        (
          await owner.$queryRawUnsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM pesate WHERE id = '${p}'`
          )
        )[0].n
      ).toBe(1)
    })
  })

  it("i controlli di pesate e collegamenti leggono lo stato dell'accesso con FOR SHARE", async () => {
    for (const f of ['pesate_controlli', 'collegamenti_accesso_controlli']) {
      const r = await owner.$queryRawUnsafe<{ def: string }[]>(
        `SELECT pg_get_functiondef('${f}'::regproc) AS def`
      )
      expect(r[0].def).toMatch(/FOR SHARE/)
    }
  })

  describe.each([
    ['wasteflow_app', 'app'],
    ['wasteflow_sistema', 'sistema'],
  ])('percorso positivo coi privilegi reali di %s', (_ruolo, quale) => {
    const esegui = (tenantId: string, sql: string) =>
      quale === 'app' ? comeApp(tenantId, sql) : sistema.$executeRawUnsafe(sql)

    it("due pesate, chiusura, collegamento a un FIR e rettifica (FOR SHARE sull'accesso con i soli privilegi applicativi)", async () => {
      const a = await azienda()
      const acc = crypto.randomUUID()
      const ins = (tabella: string, campi: Record<string, Valore>) =>
        `INSERT INTO ${tabella} (${Object.keys(campi).join(', ')}) VALUES (${Object.values(campi).map(lett).join(', ')})`
      await esegui(
        a.t,
        ins('accessi_pesa', {
          id: acc,
          tenant_id: a.t,
          registro_id: a.reg,
          anno: 2026,
          numero: ++n,
          verso: 'CARICO',
          modo: 'DOPPIA',
          aperto_da: a.user,
        })
      )
      const p1 = crypto.randomUUID()
      for (const [id, ordine, peso] of [
        [p1, 1, 2000],
        [crypto.randomUUID(), 2, 1000],
      ] as const) {
        await esegui(a.t, ins('pesate', { ...campiPesata(a, acc, { ordine, peso_kg: peso }), id }))
      }
      await esegui(
        a.t,
        `UPDATE accessi_pesa SET stato = 'CHIUSO', chiuso_da = '${a.user}', chiuso_il = now() WHERE id = '${acc}'`
      )
      await esegui(
        a.t,
        ins('collegamenti_accesso', {
          tenant_id: a.t,
          accesso_id: acc,
          registro_id: a.reg,
          verso: 'CARICO',
          tipo: 'FIR',
          fir_id: a.fir,
          creato_da: a.user,
        })
      )
      await esegui(
        a.t,
        ins('rettifiche_peso', {
          tenant_id: a.t,
          pesata_id: p1,
          numero: 1,
          peso_precedente_kg: 2000,
          peso_nuovo_kg: 2100,
          motivo: 'errore di trascrizione',
          autore_id: a.user,
          impronta: HASH,
          created_at: new Date().toISOString(),
        })
      )
      const r = await owner.$queryRawUnsafe<{ stato: string; p: number; c: number; r: number }[]>(
        `SELECT (SELECT stato::text FROM accessi_pesa WHERE id = '${acc}') AS stato,
                (SELECT count(*)::int FROM pesate WHERE accesso_id = '${acc}') AS p,
                (SELECT count(*)::int FROM collegamenti_accesso WHERE accesso_id = '${acc}') AS c,
                (SELECT count(*)::int FROM rettifiche_peso WHERE pesata_id = '${p1}') AS r`
      )
      expect(r[0]).toEqual({ stato: 'CHIUSO', p: 2, c: 1, r: 1 })
    })
  })

  describe('pesate', () => {
    it('stesso strumento e stesso alibi in due accessi → violazione di pesate_strumento_id_alibi_id_key; alibi uguale su strumenti diversi → ammesso', async () => {
      const a = await azienda()
      await pesata(a, await accesso(a), { alibi_id: 'AL-1' })
      await expect(pesata(a, await accesso(a), { alibi_id: 'AL-1' })).rejects.toThrow(
        /23505[\s\S]*Key \(strumento_id, alibi_id\)/
      )
      await expect(
        pesata(a, await accesso(a), { alibi_id: 'AL-1', strumento_id: a.strumento2 })
      ).resolves.toBeTruthy()
    })

    it('pesata MANUALE senza motivo o senza strumento né descrizione → CHECK', async () => {
      const a = await azienda()
      const base = { fonte: 'MANUALE', operatore_id: a.user, motivo_manuale: 'scontrino' }
      await expect(pesata(a, await accesso(a), { ...base, motivo_manuale: null })).rejects.toThrow(
        /pesate_coerenza_check/
      )
      await expect(
        pesata(a, await accesso(a), { ...base, strumento_id: null, strumento_esterno: null })
      ).rejects.toThrow(/pesate_coerenza_check/)
      await expect(
        pesata(a, await accesso(a), {
          ...base,
          strumento_id: null,
          strumento_esterno: 'Bilancia cliente',
        })
      ).resolves.toBeTruthy()
    })

    it('TARA_ANAGRAFICA come ordine 1 → errore; seconda pesata su accesso SINGOLA → errore; pesata su accesso CHIUSO → errore', async () => {
      const a = await azienda()
      const automezzo = await inserisci(owner, 'automezzi', {
        tenant_id: a.t,
        targa: 'AB123CD',
        creato_da: a.user,
        updated_at: new Date().toISOString(),
      })
      const tara = {
        fonte: 'TARA_ANAGRAFICA',
        strumento_id: null,
        operatore_id: a.user,
        automezzo_id: automezzo,
        tara_aggiornata_il: new Date().toISOString(),
      }
      const accTara = await accesso(a, { modo: 'TARA_ANAGRAFICA' })
      await expect(pesata(a, accTara, { ...tara, ordine: 1 })).rejects.toThrow(
        /prima pesata non puo' essere la tara dichiarata/
      )
      await expect(pesata(a, accTara, { ...tara, ordine: 2 })).rejects.toThrow(
        /manca la prima pesata/
      )
      await pesata(a, accTara, { ordine: 1 })
      await expect(pesata(a, accTara, { ordine: 2 })).rejects.toThrow(
        /la seconda pesata e' la tara/
      )
      await expect(pesata(a, accTara, { ...tara, ordine: 2 })).resolves.toBeTruthy()

      const accDoppia = await accesso(a)
      await pesata(a, accDoppia, { ordine: 1 })
      await expect(pesata(a, accDoppia, { ...tara, ordine: 2 })).rejects.toThrow(
        /non ammette la tara dichiarata/
      )

      const accSingola = await accesso(a, { modo: 'SINGOLA' })
      await pesata(a, accSingola, { ordine: 1 })
      await expect(pesata(a, accSingola, { ordine: 2 })).rejects.toThrow(/ha solo l'ordine 1/)
      await expect(pesata(a, accSingola, { ordine: 2, ...tara })).rejects.toThrow(
        /ha solo l'ordine 1/
      )

      const chiuso = await accessoChiuso(a)
      await expect(pesata(a, chiuso, { ordine: 1 })).rejects.toThrow(/accesso non aperto/)
    })
  })

  describe('accessi', () => {
    it('chiusura di un DOPPIA con una sola pesata → errore; CHIUSO → APERTO → errore; cambio di numero o verso → errore', async () => {
      const a = await azienda()
      const acc = await accesso(a)
      await pesata(a, acc, { ordine: 1 })
      await expect(chiudi(a, acc)).rejects.toThrow(/pesate insufficienti/)
      await expect(
        owner.$executeRawUnsafe(`UPDATE accessi_pesa SET numero = numero + 1 WHERE id = '${acc}'`)
      ).rejects.toThrow(/immutabili/)
      await expect(
        owner.$executeRawUnsafe(`UPDATE accessi_pesa SET verso = 'SCARICO' WHERE id = '${acc}'`)
      ).rejects.toThrow(/immutabili/)
      const chiuso = await accessoChiuso(a)
      await expect(
        owner.$executeRawUnsafe(`UPDATE accessi_pesa SET stato = 'APERTO' WHERE id = '${chiuso}'`)
      ).rejects.toThrow(/transizione di stato non ammessa/)
    })

    it('il database impone il numero di pesate della modalità e la tara come tutto-o-niente', async () => {
      const a = await azienda()
      const singola = await accesso(a, { modo: 'SINGOLA' })
      await expect(chiudi(a, singola)).rejects.toThrow(/pesate insufficienti/)
      await pesata(a, singola, { ordine: 1 })
      await expect(chiudi(a, singola)).resolves.toBeDefined()
      await expect(
        owner.$executeRawUnsafe(`UPDATE automezzi SET tara_kg = 100 WHERE tenant_id = '${a.t}'`)
      ).resolves.toBeDefined() // nessun automezzo in questa azienda: 0 righe
    })
  })

  describe('rettifiche', () => {
    const rettifica = (a: Azienda, pesataId: string, o: Record<string, Valore>) =>
      inserisci(owner, 'rettifiche_peso', {
        tenant_id: a.t,
        pesata_id: pesataId,
        numero: 1,
        peso_precedente_kg: 1000,
        peso_nuovo_kg: 1100,
        motivo: 'errore di trascrizione',
        autore_id: a.user,
        impronta: HASH,
        created_at: new Date().toISOString(),
        ...o,
      })

    it('rettifica con peso_precedente diverso dal valore effettivo → errore; numero 2 senza la 1 → errore; catena corretta ammessa', async () => {
      const a = await azienda()
      const p = await pesata(a, await accesso(a))
      await expect(rettifica(a, p, { peso_precedente_kg: 999 })).rejects.toThrow(/peso precedente/)
      await expect(rettifica(a, p, { numero: 2 })).rejects.toThrow(/numero non consecutivo/)
      await rettifica(a, p, {})
      await expect(
        rettifica(a, p, { numero: 2, peso_precedente_kg: 1000, peso_nuovo_kg: 1200 })
      ).rejects.toThrow(/peso precedente/)
      await expect(
        rettifica(a, p, { numero: 2, peso_precedente_kg: 1100, peso_nuovo_kg: 1200 })
      ).resolves.toBeTruthy()
    })

    it('rettifica di una TARA_ANAGRAFICA → errore', async () => {
      const a = await azienda()
      const automezzo = await inserisci(owner, 'automezzi', {
        tenant_id: a.t,
        targa: 'ZZ999ZZ',
        creato_da: a.user,
        updated_at: new Date().toISOString(),
      })
      const acc = await accesso(a, { modo: 'TARA_ANAGRAFICA' })
      await pesata(a, acc, { ordine: 1 })
      const tara = await pesata(a, acc, {
        ordine: 2,
        fonte: 'TARA_ANAGRAFICA',
        strumento_id: null,
        operatore_id: a.user,
        automezzo_id: automezzo,
        tara_aggiornata_il: new Date().toISOString(),
      })
      await expect(rettifica(a, tara, {})).rejects.toThrow(/tara dichiarata non si rettifica/)
    })
  })

  describe('collegamenti', () => {
    it('collegamento a un movimento SCARICO da un accesso CARICO → violazione FK; a un movimento di un altro registro → violazione FK; movimento coerente ammesso', async () => {
      const a = await azienda()
      const acc = await accessoChiuso(a)
      await expect(
        collegamento(a, acc, { tipo: 'MOVIMENTO', movimento_id: a.movScarico })
      ).rejects.toThrow(/collegamenti_accesso_movimento_fkey/)
      await expect(
        collegamento(a, acc, { tipo: 'MOVIMENTO', movimento_id: a.movAltroRegistro })
      ).rejects.toThrow(/collegamenti_accesso_movimento_fkey/)
      await expect(
        collegamento(a, acc, { tipo: 'MOVIMENTO', movimento_id: a.movCarico })
      ).resolves.toBeTruthy()
    })

    it('collegamento su un accesso APERTO → errore', async () => {
      const a = await azienda()
      await expect(
        collegamento(a, await accesso(a), { tipo: 'FIR', fir_id: a.fir })
      ).rejects.toThrow(/deve essere chiuso/)
    })

    it('due collegamenti FIR attivi per lo stesso accesso → violazione indice; dopo la revoca → ammesso; revoca di una revoca → errore', async () => {
      const a = await azienda()
      const acc = await accessoChiuso(a)
      const c1 = await collegamento(a, acc, { tipo: 'FIR', fir_id: a.fir })
      await expect(collegamento(a, acc, { tipo: 'FIR', fir_id: a.fir2 })).rejects.toThrow(
        /23505[\s\S]*Key \(accesso_id\)/
      )
      const revoca = `UPDATE collegamenti_accesso SET revocato_da = '${a.user}', revocato_il = now(), motivo_revoca = 'errato' WHERE id = '${c1}'`
      await comeApp(a.t, revoca)
      await expect(collegamento(a, acc, { tipo: 'FIR', fir_id: a.fir2 })).resolves.toBeTruthy()
      await expect(owner.$executeRawUnsafe(revoca)).rejects.toThrow(/gia' revocato/)
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE collegamenti_accesso SET fir_id = '${a.fir2}' WHERE id = '${c1}'`
        )
      ).rejects.toThrow(/gia' revocato/)
    })

    it('annullare un accesso con un collegamento attivo → errore', async () => {
      const a = await azienda()
      const acc = await accessoChiuso(a)
      await collegamento(a, acc, { tipo: 'FIR', fir_id: a.fir })
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE accessi_pesa SET stato = 'ANNULLATO', annullato_da = '${a.user}', annullato_il = now(), motivo_annullamento = 'x' WHERE id = '${acc}'`
        )
      ).rejects.toThrow(/collegamento attivo/)
    })
  })

  describe('RLS e cancellazione', () => {
    it('il tenant B non vede né inserisce pesate del tenant A', async () => {
      const a = await azienda()
      const b = await azienda()
      const acc = await accesso(a)
      const p = await pesata(a, acc)
      const viste = await leggiComeApp<{ n: number }>(
        b.t,
        `SELECT count(*)::int AS n FROM pesate WHERE id = '${p}'`
      )
      expect(viste[0].n).toBe(0)
      const proprie = await leggiComeApp<{ n: number }>(
        a.t,
        `SELECT count(*)::int AS n FROM pesate WHERE id = '${p}'`
      )
      expect(proprie[0].n).toBe(1)
      const k = campiPesata(a, acc, { ordine: 2 })
      const sql = `INSERT INTO pesate (${Object.keys(k).join(', ')}) VALUES (${Object.values(k).map(lett).join(', ')})`
      await expect(comeApp(b.t, sql)).rejects.toThrow(/accesso non trovato|row-level security/i)
    })

    it("cancellare l'azienda (proprietario) rimuove accessi, pesate, rettifiche, allegati e collegamenti", async () => {
      const a = await azienda()
      const acc = await accessoChiuso(a)
      const p = (
        await owner.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id::text FROM pesate WHERE accesso_id = '${acc}' LIMIT 1`
        )
      )[0].id
      const all = await inserisci(owner, 'allegati_pesa', {
        tenant_id: a.t,
        nome_file: 's.pdf',
        mime_type: 'application/pdf',
        dimensione_byte: 4,
        sha256: HASH,
        contenuto: '\\x25504446',
        caricato_da: a.user,
      })
      await inserisci(owner, 'rettifiche_peso', {
        tenant_id: a.t,
        pesata_id: p,
        numero: 1,
        peso_precedente_kg: 2000,
        peso_nuovo_kg: 2100,
        motivo: 'errore',
        allegato_id: all,
        autore_id: a.user,
        impronta: HASH,
        created_at: new Date().toISOString(),
      })
      await collegamento(a, acc, { tipo: 'FIR', fir_id: a.fir })
      await inserisci(owner, 'automezzi', {
        tenant_id: a.t,
        targa: 'CC111CC',
        creato_da: a.user,
        updated_at: new Date().toISOString(),
      })
      await owner.tenant.delete({ where: { id: a.t } })
      for (const t of [
        'strumenti_pesa',
        'automezzi',
        'accessi_pesa',
        'pesate',
        'rettifiche_peso',
        'allegati_pesa',
        'collegamenti_accesso',
      ]) {
        const r = await owner.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = '${a.t}'`
        )
        expect({ t, n: r[0].n }).toEqual({ t, n: 0 })
      }
    })
  })
})
