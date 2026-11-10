/**
 * Ritiri e modelli di stampa (fase 4.7, T1) contro un Postgres reale: RLS, chiavi esterne
 * composte, CHECK, indice unico parziale sul FIR, trigger `firs_ritiro_controlli`, modelli
 * predefiniti per ambito e privilegi.
 *
 * Il proprietario (`wasteflow`) prepara i dati e prova i vincoli che valgono anche per lui;
 * le prove di RLS e di privilegi girano COME `wasteflow_app` nel contesto dell'azienda. La pulizia
 * cancella SOLO le aziende create qui, per id esatto (la cascata da `tenants` porta via il resto).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../database/client-come-ruolo'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'

type Valore = string | number | boolean | null

describe('Ritiri e modelli di stampa: schema (Postgres reale)', () => {
  const owner = new PrismaClient()
  const app = clientComeRuolo('wasteflow_app', process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev')
  const tenantCreati: string[] = []

  interface Azienda {
    t: string
    utente: string
    produttore: string
    produttoreSede: string
    trasportatore: string
    destinatario: string
    destinatarioSede: string
    automezzo: string
  }

  async function azienda(): Promise<Azienda> {
    const t = (
      await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Ritiri SRL', country: 'IT' },
      })
    ).id
    tenantCreati.push(t)
    const sigla = partitaIvaUnica()
    const utente = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-ritiri-${sigla}`,
          fiscalCode: `RIT${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Ritiri',
          email: `ritiri-${sigla}@example.test`,
          role: 'ADMIN',
        },
      })
    ).id
    const p = await creaDittaConRuolo(owner, t, 'PRODUTTORE')
    const tr = await creaDittaConRuolo(owner, t, 'TRASPORTATORE')
    const d = await creaDittaConRuolo(owner, t, 'DESTINATARIO')
    const automezzo = (
      await owner.automezzo.create({ data: { tenantId: t, targa: 'AB123CD', creatoDa: utente } })
    ).id
    return {
      t,
      utente,
      produttore: p.ruoloId,
      produttoreSede: p.sedeId,
      trasportatore: tr.ruoloId,
      destinatario: d.ruoloId,
      destinatarioSede: d.sedeId,
      automezzo,
    }
  }

  const lett = (v: Valore) =>
    v === null ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v)

  /** INSERT di un ritiro col proprietario; `extra` sovrascrive o aggiunge colonne. */
  async function ritiro(a: Azienda, extra: Record<string, Valore> = {}): Promise<string> {
    const campi: Record<string, Valore> = {
      tenant_id: a.t,
      data_prevista: '2026-12-01',
      produttore_id: a.produttore,
      produttore_sede_id: a.produttoreSede,
      trasportatore_id: a.trasportatore,
      destinatario_id: a.destinatario,
      destinatario_sede_id: a.destinatarioSede,
      cer_code: '20 03 01',
      descrizione: 'Rifiuti urbani non differenziati',
      quantita_presunta: 100,
      tipo_operazione: 'DISPOSAL',
      creato_da: a.utente,
      updated_at: '2026-11-10T10:00:00Z',
      ...extra,
    }
    const k = Object.keys(campi)
    const r = await owner.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO ritiri (${k.join(', ')}) VALUES (${k.map(x => lett(campi[x])).join(', ')}) RETURNING id::text AS id`
    )
    return r[0].id
  }

  async function fir(a: Azienda, ritiroId: string | null, status = 'DRAFT'): Promise<string> {
    const x = partitaIvaUnica()
    return (
      await owner.fIR.create({
        data: {
          tenantId: a.t,
          producerUserId: a.utente,
          ritiroId,
          producerPartitaIva: x,
          producerName: 'Produttore',
          producerAddress: 'Via Prova 1',
          carrierPartitaIva: x,
          carrierName: 'Trasportatore',
          carrierVehiclePlate: 'AB123CD',
          receiverPartitaIva: x,
          receiverName: 'Destinatario',
          receiverAddress: 'Via Destinazione 1',
          cerCode: '20 03 01',
          wasteDescription: 'Rifiuto di prova',
          wasteCategory: 'Non pericoloso',
          quantity: 100,
          unit: 'KG',
          status: status as 'DRAFT',
          transportDate: new Date(),
        },
        select: { id: true },
      })
    ).id
  }

  const comeApp = <R>(tenantId: string, fn: (tx: PrismaClient) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantId}', true)`)
      return fn(tx as unknown as PrismaClient)
    })

  afterAll(async () => {
    for (const t of tenantCreati) {
      try {
        await owner.tenant.delete({ where: { id: t } })
      } catch (e) {
        console.error(`pulizia ritiri-migration: azienda ${t} non cancellata`, e)
      }
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('RLS e privilegi', () => {
    it("un'altra azienda non vede i ritiri; il ruolo applicativo scrive solo i propri", async () => {
      const a = await azienda()
      const b = await azienda()
      const id = await ritiro(a)
      const viste = await comeApp(b.t, tx =>
        tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM ritiri`)
      )
      expect(viste).toEqual([])
      const proprie = await comeApp(a.t, tx =>
        tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text AS id FROM ritiri`)
      )
      expect(proprie.map(r => r.id)).toEqual([id])
      await expect(
        comeApp(b.t, tx =>
          tx.$executeRawUnsafe(
            `INSERT INTO ritiri (tenant_id, data_prevista, produttore_id, produttore_sede_id, trasportatore_id, destinatario_id, destinatario_sede_id, cer_code, descrizione, quantita_presunta, tipo_operazione, creato_da, updated_at)
             VALUES ('${a.t}', '2026-12-01', '${a.produttore}', '${a.produttoreSede}', '${a.trasportatore}', '${a.destinatario}', '${a.destinatarioSede}', '20 03 01', 'x', 1, 'DISPOSAL', '${a.utente}', now())`
          )
        )
      ).rejects.toThrow()
    })

    it('RLS ENABLE + FORCE con le due policy', async () => {
      const r = await owner.$queryRawUnsafe<{ rls: boolean; forzata: boolean; policy: string[] }[]>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forzata,
                (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE tablename = 'ritiri') AS policy
           FROM pg_class c WHERE c.relname = 'ritiri' AND c.relkind = 'r'`
      )
      expect(r).toEqual([
        { rls: true, forzata: true, policy: ['isolamento_azienda', 'sola_lettura'] },
      ])
    })

    it('DELETE negato a wasteflow_app', async () => {
      const a = await azienda()
      await ritiro(a)
      await expect(comeApp(a.t, tx => tx.$executeRawUnsafe(`DELETE FROM ritiri`))).rejects.toThrow(
        /permission denied/i
      )
    })
  })

  describe('chiavi esterne composte', () => {
    it('rifiuta un produttore, una sede, un trasportatore, un destinatario o un mezzo di un altro tenant', async () => {
      const a = await azienda()
      const b = await azienda()
      const casi: Record<string, Valore>[] = [
        { produttore_id: b.produttore },
        { produttore_sede_id: b.produttoreSede },
        { trasportatore_id: b.trasportatore },
        { destinatario_id: b.destinatario },
        { destinatario_sede_id: b.destinatarioSede },
        { automezzo_id: b.automezzo },
      ]
      for (const extra of casi) {
        await expect(ritiro(a, extra)).rejects.toThrow(/foreign key|violates/i)
      }
    })

    it('accetta il mezzo dello stesso tenant', async () => {
      const a = await azienda()
      await expect(ritiro(a, { automezzo_id: a.automezzo })).resolves.toEqual(expect.any(String))
    })
  })

  describe('CHECK', () => {
    it('quantita presunta > 0 e ordine giro > 0', async () => {
      const a = await azienda()
      await expect(ritiro(a, { quantita_presunta: 0 })).rejects.toThrow(/ritiri_quantita_positiva/)
      await expect(ritiro(a, { ordine_giro: 0 })).rejects.toThrow(/ritiri_ordine_giro_positivo/)
      await expect(ritiro(a, { ordine_giro: 1 })).resolves.toEqual(expect.any(String))
    })

    it('stato NON_ESEGUITO o ANNULLATO se e solo se il motivo e presente', async () => {
      const a = await azienda()
      await expect(ritiro(a, { stato: 'ANNULLATO' })).rejects.toThrow(/ritiri_motivo_coerente/)
      await expect(ritiro(a, { stato: 'NON_ESEGUITO', motivo: '  ' })).rejects.toThrow(
        /ritiri_motivo_coerente/
      )
      await expect(ritiro(a, { stato: 'PROGRAMMATO', motivo: 'perche' })).rejects.toThrow(
        /ritiri_motivo_coerente/
      )
      await expect(ritiro(a, { stato: 'ANNULLATO', motivo: 'cliente assente' })).resolves.toEqual(
        expect.any(String)
      )
      await expect(ritiro(a, { stato: 'NON_ESEGUITO', motivo: 'mezzo guasto' })).resolves.toEqual(
        expect.any(String)
      )
    })

    it('unico (tenant, chiave di idempotenza, data): la stessa chiave copre date diverse', async () => {
      const a = await azienda()
      const chiave = '11111111-1111-4111-8111-111111111111'
      await ritiro(a, { chiave_idempotenza: chiave, data_prevista: '2026-12-01' })
      await ritiro(a, { chiave_idempotenza: chiave, data_prevista: '2026-12-08' })
      await expect(
        ritiro(a, { chiave_idempotenza: chiave, data_prevista: '2026-12-01' })
      ).rejects.toThrow(/23505|already exists/)
      // Senza chiave i NULL non collidono.
      await ritiro(a)
      await expect(ritiro(a)).resolves.toEqual(expect.any(String))
    })
  })

  describe('origine del FIR (firs.ritiro_id)', () => {
    it('indice parziale: due FIR attivi sullo stesso ritiro danno 23505, un CANCELLED piu uno attivo passano', async () => {
      const a = await azienda()
      const r = await ritiro(a)
      await fir(a, r, 'CANCELLED')
      await fir(a, r, 'DRAFT')
      await expect(fir(a, r, 'DRAFT')).rejects.toMatchObject({ code: 'P2002' })
      // Un altro CANCELLED accanto all'attivo e ammesso.
      await expect(fir(a, r, 'CANCELLED')).resolves.toEqual(expect.any(String))
    })

    it('chiave esterna composta: il ritiro di un altro tenant e rifiutato dalla FK (23503), non dal trigger', async () => {
      const a = await azienda()
      const b = await azienda()
      const rb = await ritiro(b)
      const errore = await fir(a, rb).catch((e: unknown) => e)
      expect(errore).toMatchObject({
        code: 'P2003',
        meta: { field_name: expect.stringMatching(/firs_ritiro_fkey/) },
      })
      expect(String(errore)).not.toMatch(/RITIRO_NON_PROGRAMMATO/)
      // Anche un ritiro inesistente: FK, non trigger.
      const inesistente = fir(a, '00000000-0000-4000-8000-000000000000')
      await expect(inesistente).rejects.toThrow(/firs_ritiro_fkey/)
    })

    it('la FK firs_ritiro_fkey copre (ritiro_id, tenant_id) verso ritiri', async () => {
      const r = await owner.$queryRawUnsafe<{ colonne: string[]; tabella: string }[]>(
        `SELECT (SELECT array_agg(attname::text ORDER BY k.ord) FROM unnest(conkey) WITH ORDINALITY k(n, ord)
                   JOIN pg_attribute at ON at.attrelid = conrelid AND at.attnum = k.n) AS colonne,
                confrelid::regclass::text AS tabella
           FROM pg_constraint WHERE conname = 'firs_ritiro_fkey'`
      )
      expect(r).toEqual([{ colonne: ['ritiro_id', 'tenant_id'], tabella: 'ritiri' }])
    })

    it('trigger: SQLSTATE dedicati WR001 (non programmato) e WR002 (ritiro_id immutabile)', async () => {
      const a = await azienda()
      const annullato = await ritiro(a, { stato: 'ANNULLATO', motivo: 'x' })
      const r1 = await ritiro(a)
      const f = await fir(a, r1)
      await expect(fir(a, annullato)).rejects.toThrow(/code: "WR001"/)
      await expect(
        owner.$executeRawUnsafe(`UPDATE firs SET ritiro_id = NULL WHERE id = '${f}'`)
      ).rejects.toThrow(/WR002/)
    })

    it("trigger: l'annullo gia' commesso prima dell'INSERT del FIR fa fallire l'INSERT", async () => {
      const a = await azienda()
      const r = await ritiro(a)
      await owner.$transaction(async tx => {
        await tx.$queryRawUnsafe(`SELECT id FROM ritiri WHERE id = '${r}' FOR UPDATE`)
        await tx.$executeRawUnsafe(
          `UPDATE ritiri SET stato = 'ANNULLATO', motivo = 'cliente', updated_at = now() WHERE id = '${r}'`
        )
      })
      await expect(fir(a, r)).rejects.toThrow(/RITIRO_NON_PROGRAMMATO/)
    })

    it('INSERT del FIR con ritiro come wasteflow_app: privilegi e RLS del FOR SHARE', async () => {
      const a = await azienda()
      const b = await azienda()
      const r = await ritiro(a)
      const ins = (t: string, ritiroId: string) =>
        comeApp(t, tx =>
          tx.fIR.create({
            data: {
              tenantId: t,
              producerUserId: a.utente,
              ritiroId,
              producerPartitaIva: '12345678903',
              producerName: 'P',
              producerAddress: 'V',
              carrierPartitaIva: '12345678903',
              carrierName: 'T',
              carrierVehiclePlate: 'AB123CD',
              receiverPartitaIva: '12345678903',
              receiverName: 'D',
              receiverAddress: 'V',
              cerCode: '20 03 01',
              wasteDescription: 'x',
              wasteCategory: 'x',
              quantity: 1,
              transportDate: new Date(),
            },
            select: { id: true },
          })
        )
      await expect(ins(a.t, r)).resolves.toEqual({ id: expect.any(String) })
      // Un secondo FIR attivo: indice parziale (23505) anche per il ruolo applicativo.
      await expect(ins(a.t, r)).rejects.toMatchObject({ code: 'P2002' })
      // Dal contesto di un'altra azienda il ritiro non si vede: nessun errore del trigger, ci pensa la FK.
      await expect(ins(b.t, r)).rejects.toThrow()
    })

    it('trigger: INSERT su un ritiro ANNULLATO o NON_ESEGUITO fallisce con RITIRO_NON_PROGRAMMATO', async () => {
      const a = await azienda()
      const annullato = await ritiro(a, { stato: 'ANNULLATO', motivo: 'x' })
      const nonEseguito = await ritiro(a, { stato: 'NON_ESEGUITO', motivo: 'y' })
      await expect(fir(a, annullato)).rejects.toThrow(/RITIRO_NON_PROGRAMMATO/)
      await expect(fir(a, nonEseguito)).rejects.toThrow(/RITIRO_NON_PROGRAMMATO/)
    })

    it('trigger: ritiro_id non si modifica (ne a un altro, ne a NULL, ne da NULL)', async () => {
      const a = await azienda()
      const r1 = await ritiro(a)
      const r2 = await ritiro(a)
      const r3 = await ritiro(a) // senza FIR: l'unico parziale non scatta prima del trigger
      const conOrigine = await fir(a, r1)
      const senza = await fir(a, null)
      await expect(
        owner.$executeRawUnsafe(`UPDATE firs SET ritiro_id = '${r2}' WHERE id = '${conOrigine}'`)
      ).rejects.toThrow(/RITIRO_ID_IMMUTABILE/)
      await expect(
        owner.$executeRawUnsafe(`UPDATE firs SET ritiro_id = NULL WHERE id = '${conOrigine}'`)
      ).rejects.toThrow(/RITIRO_ID_IMMUTABILE/)
      await expect(
        owner.$executeRawUnsafe(`UPDATE firs SET ritiro_id = '${r3}' WHERE id = '${senza}'`)
      ).rejects.toThrow(/RITIRO_ID_IMMUTABILE/)
      // Gli altri UPDATE del FIR non sono toccati.
      await expect(
        owner.$executeRawUnsafe(`UPDATE firs SET waste_notes = 'ok' WHERE id = '${conOrigine}'`)
      ).resolves.toBe(1)
    })

    it('un FIR senza ritiro si inserisce come prima', async () => {
      const a = await azienda()
      await expect(fir(a, null)).resolves.toEqual(expect.any(String))
    })

    it("FOR SHARE del trigger: l'annullo (FOR UPDATE) aspetta l'INSERT del FIR e lo vede", async () => {
      const a = await azienda()
      const r = await ritiro(a)
      // Transazione A: inserisce il FIR (tiene lo share lock sul ritiro) e resta aperta.
      let rilascia!: () => void
      const attesa = new Promise<void>(res => (rilascia = res))
      let aperta!: () => void
      const siApre = new Promise<void>(res => (aperta = res))
      const a1 = owner.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL application_name = 'ritiri-t1-ins'`)
        await tx.fIR.create({
          data: {
            tenantId: a.t,
            producerUserId: a.utente,
            ritiroId: r,
            producerPartitaIva: '12345678903',
            producerName: 'P',
            producerAddress: 'V',
            carrierPartitaIva: '12345678903',
            carrierName: 'T',
            carrierVehiclePlate: 'AB123CD',
            receiverPartitaIva: '12345678903',
            receiverName: 'D',
            receiverAddress: 'V',
            cerCode: '20 03 01',
            wasteDescription: 'x',
            wasteCategory: 'x',
            quantity: 1,
            transportDate: new Date(),
          },
        })
        aperta()
        await attesa
      })
      await siApre
      // Transazione B: FOR UPDATE sul ritiro deve restare in attesa finche A non conclude.
      let bFinita = false
      const b1 = owner.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL application_name = 'ritiri-t1-annulla'`)
        await tx.$queryRawUnsafe(`SELECT id FROM ritiri WHERE id = '${r}' FOR UPDATE`)
        bFinita = true
        const firAttivi = await tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM firs WHERE ritiro_id = '${r}' AND status <> 'CANCELLED'`
        )
        return firAttivi[0].n
      })
      // Barriera: B risulta in attesa di un lock (non fa piu avanzare niente) prima di rilasciare A.
      for (let i = 0; i < 100; i++) {
        const w = await owner.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'ritiri-t1-annulla' AND wait_event_type = 'Lock'`
        )
        if (w[0].n === 1) break
        await new Promise(res => setTimeout(res, 50))
      }
      expect(bFinita).toBe(false)
      rilascia()
      await a1
      expect(await b1).toBe(1)
    })
  })

  describe('modelli di stampa (company_templates)', () => {
    const modello = (t: string, extra: Record<string, Valore> = {}) => {
      const campi: Record<string, Valore> = {
        tenant_id: t,
        name: 'Modello',
        updated_at: '2026-11-10T10:00:00Z',
        ...extra,
      }
      const k = Object.keys(campi)
      return owner.$executeRawUnsafe(
        `INSERT INTO company_templates (${k.join(', ')}) VALUES (${k.map(x => lett(campi[x])).join(', ')})`
      )
    }

    it('default: ambito GENERALE, 1 copia, versione 1', async () => {
      const a = await azienda()
      await modello(a.t)
      const r = await owner.$queryRawUnsafe<{ ambito: string; copie: number; versione: number }[]>(
        `SELECT ambito::text AS ambito, copie, versione FROM company_templates WHERE tenant_id = '${a.t}'`
      )
      expect(r).toEqual([{ ambito: 'GENERALE', copie: 1, versione: 1 }])
    })

    it('copie solo da 1 a 4', async () => {
      const a = await azienda()
      await expect(modello(a.t, { copie: 0 })).rejects.toThrow(/company_templates_copie_ammesse/)
      await expect(modello(a.t, { copie: 5 })).rejects.toThrow(/company_templates_copie_ammesse/)
      await expect(modello(a.t, { copie: 4 })).resolves.toBe(1)
    })

    it('la deduplica della migration lascia un solo predefinito (il piu recente, a parita il maggior id)', async () => {
      const a = await azienda()
      const sql = readFileSync(
        join(__dirname, '../../../prisma/migrations/20261110100000_ritiri_e_modelli/migration.sql'),
        'utf8'
      )
      const dedup = /UPDATE "company_templates" t SET[\s\S]*?\(t\."updated_at", t\."id"\)\);/.exec(
        sql
      )?.[0]
      expect(dedup).toBeDefined()
      const ID = [
        'a0000000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000002',
        'a0000000-0000-4000-8000-000000000003',
      ]
      class Rollback extends Error {}
      let esito: { id: string; is_default: boolean }[] = []
      await owner
        .$transaction(async tx => {
          await tx.$executeRawUnsafe(`DROP INDEX "company_templates_default_ambito_key"`)
          const ins = (id: string, ts: string) =>
            tx.$executeRawUnsafe(
              `INSERT INTO company_templates (id, tenant_id, name, is_default, updated_at) VALUES ('${id}', '${a.t}', 'M', true, '${ts}')`
            )
          await ins(ID[0], '2026-11-01T10:00:00Z')
          await ins(ID[1], '2026-11-02T10:00:00Z')
          await ins(ID[2], '2026-11-02T10:00:00Z')
          await tx.$executeRawUnsafe(dedup as string)
          esito = await tx.$queryRawUnsafe(
            `SELECT id::text AS id, is_default FROM company_templates WHERE tenant_id = '${a.t}' ORDER BY id`
          )
          throw new Rollback()
        })
        .catch((e: unknown) => {
          if (!(e instanceof Rollback)) throw e
        })
      expect(esito).toEqual([
        { id: ID[0], is_default: false },
        { id: ID[1], is_default: false },
        { id: ID[2], is_default: true },
      ])
      // Rollback completo: l'indice e' tornato.
      const idx = await owner.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM pg_indexes WHERE indexname = 'company_templates_default_ambito_key'`
      )
      expect(idx).toHaveLength(1)
    })

    it('un solo modello predefinito per ambito e azienda', async () => {
      const a = await azienda()
      const b = await azienda()
      await modello(a.t, { ambito: 'FIR', is_default: true })
      await expect(modello(a.t, { ambito: 'FIR', is_default: true })).rejects.toThrow(
        /23505|already exists/
      )
      // Altro ambito, non predefinito, altra azienda: ammessi.
      await expect(modello(a.t, { ambito: 'DISTINTA_RITIRI', is_default: true })).resolves.toBe(1)
      await expect(modello(a.t, { ambito: 'FIR', is_default: false })).resolves.toBe(1)
      await expect(modello(b.t, { ambito: 'FIR', is_default: true })).resolves.toBe(1)
    })
  })

  describe('anagrafiche: unico (id, tenant_id)', () => {
    it.each(['produttori', 'trasportatori', 'destinatari'])(
      '%s ha %s_id_tenant_id_key',
      async t => {
        const r = await owner.$queryRawUnsafe<{ indexname: string }[]>(
          `SELECT indexname FROM pg_indexes WHERE tablename = '${t}' AND indexname = '${t}_id_tenant_id_key'`
        )
        expect(r).toHaveLength(1)
      }
    )
  })
})
