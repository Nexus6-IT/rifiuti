/**
 * Letture del legame (fase 4.3, Task 14) contro un Postgres reale, col ruolo `wasteflow_app`
 * dentro il contesto dell'azienda: cliente dal FIR, dati per la proposta (contratti, elenchi,
 * righe, codici IVA) e prove di forma delle query (una per lista, non per riga) e di prestazione
 * sul piano generico di Prisma.
 */
import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import {
  creaFirDiTest,
  creaScenarioProposta,
  pulisciLegamiDiTest,
} from '../../test-support/legami-di-test'
import { creaDittaConRuolo } from '../../test-support/anagrafiche-di-test'
import { creaAddebito, creaContrattoConElenco, creaRiga } from '../../test-support/listino-di-test'
import { clienteDaFir, leggiDatiPerProposta } from './letture-legame'
import { bloccaListinoInCondivisione, bloccaRigheLegame } from './lock-legame'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'

describe('Letture del legame (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<R>) =>
    app.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
        return fn(tx)
      },
      { timeout: 60_000, maxWait: 30_000 }
    )

  async function scenario(opz: Parameters<typeof creaScenarioProposta>[1] = {}) {
    const s = await creaScenarioProposta(owner, opz)
    if (!tenantCreati.includes(s.tenantId)) tenantCreati.push(s.tenantId)
    return s
  }

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await pulisciLegamiDiTest(owner, tenantCreati)
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
          tenantCreati
        )
      }
      await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  describe('clienteDaFir', () => {
    it('FIR -> produttore -> ditta -> cliente attivo, con la sede del produttore', async () => {
      const s = await scenario()
      const r = await nel(s.tenantId, tx => clienteDaFir(tx, s.tenantId, s.firId))
      expect(r).toEqual({ cliente: { id: s.clienteId, attivo: true }, sedeId: s.sedeId })
    })

    it('cliente disattivato: viene restituito con attivo=false (lo decide il dominio)', async () => {
      const s = await scenario()
      await owner.cliente.update({ where: { id: s.clienteId }, data: { attivo: false } })
      const r = await nel(s.tenantId, tx => clienteDaFir(tx, s.tenantId, s.firId))
      expect(r.cliente).toEqual({ id: s.clienteId, attivo: false })
    })

    it('FIR senza producerId: nessun cliente, nessuna sede', async () => {
      const s = await scenario()
      const fir = await creaFirDiTest(owner, s.tenantId, s.utenteId)
      const r = await nel(s.tenantId, tx => clienteDaFir(tx, s.tenantId, fir.id))
      expect(r).toEqual({ cliente: null, sedeId: null })
    })

    it('ditta del produttore non censita come cliente: cliente null ma la sede resta', async () => {
      const s = await scenario()
      const altro = await creaDittaConRuolo(owner, s.tenantId, 'PRODUTTORE')
      const fir = await creaFirDiTest(owner, s.tenantId, s.utenteId, {
        producerId: altro.ruoloId,
        producerSedeId: altro.sedeId,
      })
      const r = await nel(s.tenantId, tx => clienteDaFir(tx, s.tenantId, fir.id))
      expect(r).toEqual({ cliente: null, sedeId: altro.sedeId })
    })

    it('FIR inesistente o di un altro tenant: nessun cliente (tenant sempre nella where)', async () => {
      const a = await scenario()
      const b = await scenario()
      const inesistente = await nel(a.tenantId, tx => clienteDaFir(tx, a.tenantId, randomUUID()))
      expect(inesistente).toEqual({ cliente: null, sedeId: null })
      // Anche col contesto dell'azienda giusta, il FIR dell'altra azienda non si vede.
      const altrui = await nel(a.tenantId, tx => clienteDaFir(tx, a.tenantId, b.firId))
      expect(altrui).toEqual({ cliente: null, sedeId: null })
      // Con tenantId sbagliato nella where ma contesto RLS giusto: ancora nulla.
      const sbagliato = await nel(b.tenantId, tx => clienteDaFir(tx, a.tenantId, b.firId))
      expect(sbagliato).toEqual({ cliente: null, sedeId: null })
    })
  })

  describe('leggiDatiPerProposta', () => {
    const base = (s: { clienteId: string; sedeId: string }, extra = {}) => ({
      cerCode: '20 03 01',
      movementDate: '2026-03-01',
      clienteId: s.clienteId,
      sedeId: s.sedeId,
      ...extra,
    })

    it('contratti del cliente (non eliminati), elenchi, righe e codici IVA', async () => {
      const s = await scenario({ righeV: 2 })
      const dati = await nel(s.tenantId, tx => leggiDatiPerProposta(tx, s.tenantId, base(s)))
      expect(dati.contratti).toEqual([
        {
          id: s.contrattoId,
          clienteId: s.clienteId,
          stato: 'ATTIVO',
          dataInizio: '2026-01-01',
          dataFine: null,
          sedeId: null,
        },
      ])
      expect(dati.elenchi).toEqual([
        {
          id: s.elencoId,
          contrattoId: s.contrattoId,
          validoDal: null,
          validoAl: null,
          predefinito: false,
        },
      ])
      expect(dati.righe.map(r => r.id).sort()).toEqual([s.rigaCerId, ...s.righeVIds].sort())
      const cer = dati.righe.find(r => r.id === s.rigaCerId)!
      expect(cer).toMatchObject({
        tipo: 'CER',
        cerCode: '20 03 01',
        elencoId: s.elencoId,
        unitaMisura: 'KG',
        tipoQuantita: 'PESO_NETTO',
        prezzo: '1.000000',
        prezzoSpeciale: false,
        sconto: null,
        codiceIvaId: s.ivaId,
        riferimento: null,
        addebitoCodice: null,
      })
      const v = dati.righe.find(r => r.id === s.righeVIds[0])!
      expect(v.tipo).toBe('V')
      expect(v.cerProposta).toEqual(['200301'])
      expect(v.addebitoCodice).toMatch(/^\d{5}$/)
      expect(dati.codiciIva).toEqual([
        { id: s.ivaId, codice: '22', aliquota: '22.00', natura: null, attivo: true },
      ])
    })

    it('contratto eliminato o di un altro cliente: non compare (M4)', async () => {
      const s = await scenario()
      const altroCliente = await creaContrattoConElenco(owner, s.tenantId)
      const eliminato = await creaContrattoConElenco(owner, s.tenantId, { clienteId: s.clienteId })
      await owner.contrattoCliente.update({
        where: { id: eliminato.contrattoId },
        data: { eliminatoIl: new Date(), eliminatoDa: s.utenteId },
      })
      const dati = await nel(s.tenantId, tx => leggiDatiPerProposta(tx, s.tenantId, base(s)))
      expect(dati.contratti.map(c => c.id)).toEqual([s.contrattoId])
      expect(dati.elenchi.map(e => e.contrattoId)).toEqual([s.contrattoId])
      expect(altroCliente.contrattoId).not.toBe(s.contrattoId)
    })

    it('le righe CER di un altro CER e quelle di elenchi non validi alla data non si leggono', async () => {
      const s = await scenario()
      const ivaId = s.ivaId
      await creaRiga(owner, s.tenantId, s.elencoId, {
        tipo: 'CER',
        cerCode: '15 01 01',
        codiceIvaId: ivaId,
      })
      const scaduto = await owner.elencoAddebiti.create({
        data: {
          tenantId: s.tenantId,
          contrattoId: s.contrattoId,
          codice: '002',
          descrizione: 'Scaduto',
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-01-31T00:00:00Z'),
        },
      })
      const rigaScaduta = await creaRiga(owner, s.tenantId, scaduto.id, {
        tipo: 'CER',
        cerCode: '20 03 01',
        codiceIvaId: ivaId,
      })
      const dati = await nel(s.tenantId, tx => leggiDatiPerProposta(tx, s.tenantId, base(s)))
      // L'elenco scaduto si vede (il dominio decide ELENCO_SCADUTO / scelta), le sue righe no.
      expect(dati.elenchi.map(e => e.id).sort()).toEqual([s.elencoId, scaduto.id].sort())
      expect(dati.righe.map(r => r.id)).toEqual([s.rigaCerId])
      expect(dati.righe.some(r => r.id === rigaScaduta.id)).toBe(false)
    })

    it('contrattoId ed elencoId indicati restringono la lettura', async () => {
      const s = await scenario()
      const secondo = await creaContrattoConElenco(owner, s.tenantId, { clienteId: s.clienteId })
      const dati = await nel(s.tenantId, tx =>
        leggiDatiPerProposta(tx, s.tenantId, base(s, { contrattoId: secondo.contrattoId }))
      )
      expect(dati.contratti.map(c => c.id)).toEqual([secondo.contrattoId])
      expect(dati.elenchi.map(e => e.id)).toEqual([secondo.elencoId])
      expect(dati.righe).toEqual([])
      const conElenco = await nel(s.tenantId, tx =>
        leggiDatiPerProposta(tx, s.tenantId, base(s, { elencoId: s.elencoId }))
      )
      expect(conElenco.elenchi.map(e => e.id)).toEqual([s.elencoId])
    })

    it('senza cliente: nessun dato (il motivo SENZA_CLIENTE lo decide il dominio)', async () => {
      const s = await scenario()
      const dati = await nel(s.tenantId, tx =>
        leggiDatiPerProposta(tx, s.tenantId, base(s, { clienteId: null }))
      )
      expect(dati).toEqual({ contratti: [], elenchi: [], righe: [], codiciIva: [] })
    })

    it('contratti, elenchi, righe e codici IVA: una query per lista, non per riga', async () => {
      const poche = await scenario({ righeV: 1 })
      const molte = await scenario({ righeV: 40 })
      const conta = async (s: typeof poche) => {
        let n = 0
        await nel(s.tenantId, async tx => {
          const contato = new Proxy(tx, {
            get(t, p, r) {
              const v = Reflect.get(t, p, r)
              if (p === '$queryRaw' || p === '$queryRawUnsafe' || p === '$executeRaw') {
                return (...a: unknown[]) => {
                  n++
                  return (v as (...x: unknown[]) => unknown).apply(t, a)
                }
              }
              return v
            },
          })
          await leggiDatiPerProposta(contato, s.tenantId, base(s))
        })
        return n
      }
      const nPoche = await conta(poche)
      const nMolte = await conta(molte)
      expect(nMolte).toBe(nPoche)
      expect(nMolte).toBeLessThanOrEqual(5)
    })
  })

  describe('liste grandi e piano generico', () => {
    /** Piano generico per il ruolo applicativo e statistiche che stimano una riga sola. */
    async function conPianoGenerico<R>(tabelle: string[], fn: () => Promise<R>): Promise<R> {
      await owner.$executeRaw`ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`
      try {
        for (const t of tabelle) {
          await owner.$executeRawUnsafe(
            `DELETE FROM pg_statistic WHERE starelid = '${t}'::regclass`
          )
          await owner.$executeRawUnsafe(
            `UPDATE pg_class SET reltuples = 1, relpages = 100000 WHERE oid = '${t}'::regclass`
          )
        }
        await app.$disconnect()
        await app.$connect()
        return await fn()
      } finally {
        await owner.$executeRaw`ALTER ROLE wasteflow_app RESET plan_cache_mode`
        for (const t of tabelle) await owner.$executeRawUnsafe(`ANALYZE ${t}`)
        await app.$disconnect()
        await app.$connect()
      }
    }

    it('JOIN unnest con 5000 id di righe e piano generico forzato: lock in meno di 5 s', async () => {
      const s = await scenario()
      const x = await creaAddebito(owner, s.tenantId, { tipo: 'V', codiceIvaId: s.ivaId })
      await owner.rigaAddebito.createMany({
        data: Array.from({ length: 5000 }, (_, i) => ({
          tenantId: s.tenantId,
          elencoId: s.elencoId,
          tipo: 'V',
          addebitoId: x.id,
          riferimento: `q${i}`,
          tipoQuantita: 'PESO_NETTO' as const,
          unitaMisura: 'KG',
          prezzo: '1',
          codiceIvaId: s.ivaId,
        })),
      })
      const ids = (
        await owner.rigaAddebito.findMany({
          where: { tenantId: s.tenantId, elencoId: s.elencoId },
          select: { id: true },
        })
      ).map(r => r.id)
      expect(ids.length).toBeGreaterThanOrEqual(5000)
      const t0 = Date.now()
      await conPianoGenerico(['righe_addebito', 'elenchi_addebiti'], () =>
        nel(s.tenantId, tx =>
          bloccaListinoInCondivisione(tx, s.tenantId, s.contrattoId, [s.elencoId], ids)
        )
      )
      const ms = Date.now() - t0
      console.info(`[T14] bloccaListinoInCondivisione 5000 righe, piano generico: ${ms} ms`)
      expect(ms).toBeLessThan(5_000)
    }, 90_000)

    it('JOIN unnest con 5000 id di legami (500 veri) e piano generico forzato: lock in meno di 5 s', async () => {
      const s = await scenario()
      const registro = s.registroId
      await owner.wasteMovement.createMany({
        data: Array.from({ length: 500 }, (_, i) => ({
          tenantId: s.tenantId,
          registroId: registro,
          progressiveYear: 2027,
          progressiveNumber: i + 1,
          type: 'CARICO' as const,
          movementDate: new Date('2027-03-01T10:00:00Z'),
          registrationDate: new Date('2027-03-01T10:00:00Z'),
          causale: 'INGRESSO_ESTERNO',
          cerCode: '20 03 01',
          quantity: '10',
          unit: 'KG',
          tipoAnnotazione: 'ORDINARIA' as const,
        })),
      })
      await owner.$executeRaw`
        INSERT INTO legami_movimento
          (tenant_id, registro_id, verso, movimento_originale_id, movimento_vigente_id, stato,
           data_movimento, updated_at)
        SELECT m.tenant_id, m.registro_id, m.type, m.id, m.id, 'DA_COLLEGARE'::stato_legame_movimento, '2027-03-01'::date, now()
        FROM waste_movements m
        WHERE m.tenant_id = ${s.tenantId}::uuid AND m.progressive_year = 2027`
      const veri = (
        await owner.legameMovimento.findMany({
          where: { tenantId: s.tenantId },
          select: { id: true },
        })
      ).map(l => l.id)
      expect(veri).toHaveLength(500)
      const ids = [...veri, ...Array.from({ length: 4500 }, () => randomUUID())]
      const t0 = Date.now()
      await conPianoGenerico(['legami_movimento', 'righe_legame_movimento'], () =>
        nel(s.tenantId, tx => bloccaRigheLegame(tx, s.tenantId, ids))
      )
      const ms = Date.now() - t0
      console.info(`[T14] bloccaRigheLegame 5000 id (500 veri), piano generico: ${ms} ms`)
      expect(ms).toBeLessThan(5_000)
    }, 90_000)
  })
})
