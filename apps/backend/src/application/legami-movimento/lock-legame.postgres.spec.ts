/**
 * Lock del legame (fase 4.3, Task 14) contro un Postgres reale. Si prova l'ordine dei lock di
 * spec §5: registro (righe del movimento) -> lock consultivo del legame per radice -> contratto
 * FOR SHARE -> elenchi FOR SHARE per id -> righe di listino FOR SHARE per id -> righe del legame
 * FOR UPDATE per id; e che il listino (che scrive FOR UPDATE / FOR NO KEY UPDATE) e il legame si
 * serializzano senza mai incrociarsi.
 *
 * Le barriere guardano `pg_stat_activity` (sessioni di QUESTO processo, `application_name`
 * dedicato, `wait_event_type = 'Lock'`): niente `sleep` come sincronizzazione. Chi tiene un lock
 * lo tiene finche' la barriera non viene rilasciata.
 */
import { randomUUID } from 'node:crypto'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { bloccaContrattoListino } from '../listino/lock-listino'
import { bloccaProgressivo } from '../registro/numerazione-annotazione'
import { chiaveLockGiacenza } from '../registro/chiave-lock-giacenza'
import { creaContrattoConElenco, creaRiga } from '../../test-support/listino-di-test'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  creaScenarioProposta,
  pulisciTenantDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import {
  LOCK_TIMEOUT_AGGANCIO,
  bloccaLegamePerRadice,
  bloccaListinoInCondivisione,
  bloccaRigheLegame,
  impostaTimeoutAggancio,
} from './lock-legame'

const NOME_APPLICAZIONE = `legami-t14-${process.pid}`
const baseUrl =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const urlProprietario = `${baseUrl}&application_name=${NOME_APPLICAZIONE}`

type Tx = Prisma.TransactionClient

describe('Lock del legame (Postgres reale, ruolo wasteflow_app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  )
  const tenantCreati: string[] = []
  const OPZ = { timeout: 60_000, maxWait: 30_000 }

  const nel = <R>(tenantId: string, fn: (tx: Tx) => Promise<R>) =>
    app.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
      return fn(tx)
    }, OPZ)

  async function scenario(righeV = 2): Promise<ScenarioProposta> {
    // L'id si registra appena l'azienda esiste, prima di ogni altro passo che puo' fallire.
    const s = await creaScenarioProposta(owner, {
      righeV,
      onTenantCreato: id => tenantCreati.push(id),
    })
    return s
  }

  /** Sessioni di questo processo ferme su un lock. */
  async function inAttesaDiLock(): Promise<number> {
    const r = await owner.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
        AND wait_event_type = 'Lock'`
    return r[0].n
  }

  /** Attende (senza sleep come sincronizzazione: poll della vista) che almeno `n` sessioni aspettino. */
  async function attendiLock(n: number, finita: () => boolean = () => false): Promise<void> {
    const scadenza = Date.now() + 30_000
    for (;;) {
      if ((await inAttesaDiLock()) >= n) return
      if (finita()) throw new Error('la transazione e` finita senza attendere il lock')
      if (Date.now() > scadenza) throw new Error(`nessuna sessione in attesa di lock (attese ${n})`)
      await new Promise(r => setTimeout(r, 20))
    }
  }

  /**
   * Una transazione che "tiene" i lock presi da `prendi` finche' non si chiama `rilascia`.
   * `pronta` si risolve quando `prendi` e' finita; se `prendi` fallisce, `pronta` si rifiuta.
   */
  function tenitore(
    cliente: 'owner' | 'app',
    tenantId: string,
    prendi: (tx: Tx) => Promise<unknown>
  ) {
    let rilascia!: () => void
    const barriera = new Promise<void>(r => (rilascia = r))
    let segnala!: () => void
    const pronta = new Promise<void>(r => (segnala = r))
    const corpo = async (tx: Tx) => {
      await prendi(tx)
      segnala()
      await barriera
    }
    const fine =
      cliente === 'owner'
        ? owner.$transaction(corpo, OPZ)
        : app.$transaction(async tx => {
            await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
            return corpo(tx)
          }, OPZ)
    // Se `prendi` fallisce l'errore vero emerge subito, senza attese appese.
    const prontaOErrore = Promise.race([pronta, fine])
    return { pronta: prontaOErrore, rilascia, fine }
  }

  /** Esegue `fn` e restituisce un indicatore di "finita" accanto alla promessa. */
  function osserva<R>(p: Promise<R>) {
    const stato = { finita: false }
    const esito = p.finally(() => (stato.finita = true))
    return { stato, esito }
  }

  const statoRiga = async (id: string) =>
    (
      await owner.$queryRaw<{ prezzo: string }[]>`
        SELECT prezzo::text AS prezzo FROM righe_addebito WHERE id = ${id}::uuid`
    )[0].prezzo

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app.$disconnect()
  }, 180_000)

  describe('bloccaListinoInCondivisione', () => {
    it('un FOR UPDATE del listino su una riga tiene in attesa il legame finche` non fa commit; poi procede e legge il valore nuovo', async () => {
      const s = await scenario()
      const t = tenitore('owner', s.tenantId, async tx => {
        await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR UPDATE`
        await tx.$executeRaw`UPDATE righe_addebito SET prezzo = 7 WHERE id = ${s.rigaCerId}::uuid`
      })
      await t.pronta
      const legge = osserva(
        nel(s.tenantId, async tx => {
          await bloccaListinoInCondivisione(
            tx,
            s.tenantId,
            s.contrattoId,
            [s.elencoId],
            [s.rigaCerId]
          )
          const r = await tx.$queryRaw<{ prezzo: string }[]>`
            SELECT prezzo::text AS prezzo FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid`
          return r[0].prezzo
        })
      )
      await attendiLock(1, () => legge.stato.finita)
      expect(legge.stato.finita).toBe(false)
      t.rilascia()
      await t.fine
      expect(Number(await legge.esito)).toBe(7)
    })

    it('viceversa: una modifica del listino (FOR UPDATE sulla stessa riga) aspetta la transazione del legame che tiene FOR SHARE', async () => {
      const s = await scenario()
      const t = tenitore('app', s.tenantId, tx =>
        bloccaListinoInCondivisione(tx, s.tenantId, s.contrattoId, [s.elencoId], [s.rigaCerId])
      )
      await t.pronta
      const scrive = osserva(
        owner.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR UPDATE`
          await tx.$executeRaw`UPDATE righe_addebito SET prezzo = 9 WHERE id = ${s.rigaCerId}::uuid`
        }, OPZ)
      )
      await attendiLock(1, () => scrive.stato.finita)
      expect(scrive.stato.finita).toBe(false)
      expect(Number(await statoRiga(s.rigaCerId))).toBe(1)
      t.rilascia()
      await t.fine
      await scrive.esito
      expect(Number(await statoRiga(s.rigaCerId))).toBe(9)
    })

    it('anche una modifica FOR NO KEY UPDATE del listino (variazione prezzi) aspetta il legame', async () => {
      const s = await scenario()
      const t = tenitore('app', s.tenantId, tx =>
        bloccaListinoInCondivisione(tx, s.tenantId, s.contrattoId, [s.elencoId], [s.rigaCerId])
      )
      await t.pronta
      const scrive = osserva(
        owner.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR NO KEY UPDATE`
        }, OPZ)
      )
      await attendiLock(1, () => scrive.stato.finita)
      t.rilascia()
      await t.fine
      await scrive.esito
    })

    it('due transazioni del legame in parallelo sulle stesse righe: nessuna in attesa', async () => {
      const s = await scenario()
      const prendi = (tx: Tx) =>
        bloccaListinoInCondivisione(
          tx,
          s.tenantId,
          s.contrattoId,
          [s.elencoId],
          [s.rigaCerId, ...s.righeVIds]
        )
      const a = tenitore('app', s.tenantId, prendi)
      const b = tenitore('app', s.tenantId, prendi)
      // Entrambe hanno finito di prendere i lock e li tengono: se una dovesse aspettare l'altra,
      // `pronta` non si risolverebbe e la sessione risulterebbe in attesa di lock.
      await Promise.all([a.pronta, b.pronta])
      expect(await inAttesaDiLock()).toBe(0)
      a.rilascia()
      b.rilascia()
      await Promise.all([a.fine, b.fine])
    })

    it('elenco di un altro contratto o riga inesistente: 404, contratto annullato: 409', async () => {
      const s = await scenario()
      const altro = await owner.elencoAddebiti.create({
        data: {
          tenantId: s.tenantId,
          contrattoId: (
            await owner.contrattoCliente.create({
              data: {
                tenantId: s.tenantId,
                clienteId: s.clienteId,
                numero: `T14-${randomUUID().slice(0, 8)}`,
                descrizione: 'Altro contratto',
                stato: 'ATTIVO',
                dataInizio: new Date('2026-01-01T00:00:00Z'),
              },
            })
          ).id,
          codice: '009',
          descrizione: 'Elenco altrui',
        },
      })
      const falso = (p: Promise<unknown>) =>
        p.then(
          () => null,
          (e: unknown) => e
        )
      const e1 = await falso(
        nel(s.tenantId, tx =>
          bloccaListinoInCondivisione(tx, s.tenantId, s.contrattoId, [altro.id], [])
        )
      )
      expect(e1).toBeInstanceOf(NotFoundException)
      expect((e1 as NotFoundException).getResponse()).toMatchObject({
        error: 'ELENCO_ADDEBITI_NON_TROVATO',
      })
      const e2 = await falso(
        nel(s.tenantId, tx =>
          bloccaListinoInCondivisione(tx, s.tenantId, s.contrattoId, [s.elencoId], [randomUUID()])
        )
      )
      expect(e2).toBeInstanceOf(NotFoundException)
      expect((e2 as NotFoundException).getResponse()).toMatchObject({
        error: 'RIGA_ADDEBITO_NON_TROVATA',
      })
      await owner.contrattoCliente.update({
        where: { id: s.contrattoId },
        data: { stato: 'ANNULLATO', motivoAnnullo: 'x', annullatoIl: new Date() },
      })
      const e3 = await falso(
        nel(s.tenantId, tx => bloccaListinoInCondivisione(tx, s.tenantId, s.contrattoId, [], []))
      )
      expect(e3).toBeInstanceOf(ConflictException)
    })

    it("riga di listino di un altro elenco/contratto: 404 RIGA_ADDEBITO_NON_TROVATA, non una FK piu' tardi", async () => {
      const s = await scenario(0)
      const altro = await creaContrattoConElenco(owner, s.tenantId, { clienteId: s.clienteId })
      const rigaAltrui = await creaRiga(owner, s.tenantId, altro.elencoId, { codiceIvaId: s.ivaId })
      const e = await nel(s.tenantId, tx =>
        bloccaListinoInCondivisione(tx, s.tenantId, s.contrattoId, [s.elencoId], [rigaAltrui.id])
      ).then(
        () => null,
        (x: unknown) => x
      )
      expect(e).toBeInstanceOf(NotFoundException)
      expect((e as NotFoundException).getResponse()).toMatchObject({
        error: 'RIGA_ADDEBITO_NON_TROVATA',
      })
    })

    it('liste vuote o con doppioni: restituisce il contratto e non fallisce', async () => {
      const s = await scenario()
      const c = await nel(s.tenantId, tx =>
        bloccaListinoInCondivisione(
          tx,
          s.tenantId,
          s.contrattoId,
          [s.elencoId, s.elencoId],
          [s.rigaCerId, s.rigaCerId]
        )
      )
      expect(c).toMatchObject({ id: s.contrattoId, clienteId: s.clienteId, stato: 'ATTIVO' })
    })
  })

  describe('ordine dei lock senza deadlock', () => {
    /** Ordine del listino quando scrive (azioni-listino / variazioni): contratto SHARE -> elenchi FOR UPDATE -> righe FOR NO KEY UPDATE. */
    async function scritturaListino(tx: Tx, s: ScenarioProposta, righe: string[]) {
      await bloccaContrattoListino(tx, s.tenantId, s.contrattoId)
      await tx.$queryRaw`SELECT id FROM elenchi_addebiti WHERE id = ${s.elencoId}::uuid FOR UPDATE`
      await tx.$queryRaw`
        SELECT r.id FROM righe_addebito r
        JOIN unnest(${righe}::uuid[]) AS c(id) ON c.id = r.id ORDER BY r.id FOR NO KEY UPDATE OF r`
      await tx.$executeRaw`
        UPDATE righe_addebito r SET prezzo = r.prezzo + 1
        FROM unnest(${righe}::uuid[]) AS c(id) WHERE c.id = r.id`
    }

    it('20 coppie (scrittura di listino, transazione del legame) sugli stessi elenchi e righe: nessun 40P01, tutte concluse', async () => {
      const s = await scenario(6)
      const tutte = [s.rigaCerId, ...s.righeVIds]
      const legame = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: s.movimentoId,
        registroId: s.registroId,
        verso: 'CARICO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId }],
      })
      const lavori: Promise<unknown>[] = []
      for (let i = 0; i < 20; i++) {
        // Le righe in ordine diverso a ogni giro: l'ordine per id dentro i lock lo rimette in fila.
        const ordine = i % 2 === 0 ? tutte : [...tutte].reverse()
        lavori.push(
          nel(s.tenantId, tx => scritturaListino(tx, s, ordine)),
          nel(s.tenantId, async tx => {
            await bloccaLegamePerRadice(tx, s.movimentoId)
            await bloccaListinoInCondivisione(tx, s.tenantId, s.contrattoId, [s.elencoId], ordine)
            await bloccaRigheLegame(tx, s.tenantId, [legame.legameId])
          })
        )
      }
      const esiti = await Promise.allSettled(lavori)
      const errori = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
      expect(errori.map(e => String(e.reason?.message ?? e.reason))).toEqual([])
      expect(esiti).toHaveLength(40)
    }, 120_000)

    it('registro e legame: 20 coppie con la sequenza REALE di correggi-movimento (advisory progressivo e giacenza, INSERT della correzione con FK KEY SHARE) contro un legame sullo stesso movimento: nessun 40P01', async () => {
      // Il registro e' append-only: non prende mai lock di riga sui movimenti. Nessun ordine puo'
      // dare un ciclo, perche' le FK dell'annotazione e l'INSERT del legame prendono entrambe
      // FOR KEY SHARE sul movimento. Il test lo verifica nei due ordini di arrivo (alterna).
      const s = await scenario(0)
      const movimenti = [s.movimentoId]
      for (let i = 1; i < 20; i++) {
        movimenti.push((await creaMovimentoDiTest(owner, s.tenantId)).movimentoId)
      }
      const correggi = (m: string) =>
        nel(s.tenantId, async tx => {
          // correggi-movimento.use-case.ts, passo 3: progressivo, poi giacenza del CER toccato.
          await bloccaProgressivo(tx, s.registroId, 2026)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiaveLockGiacenza(s.registroId, '20 03 01')}))`
          const ultimo = await tx.wasteMovement.aggregate({
            where: { registroId: s.registroId, progressiveYear: 2026 },
            _max: { progressiveNumber: true },
          })
          // Passo 5: INSERT della rettifica (FK rettificato/originale -> FOR KEY SHARE su m).
          await tx.wasteMovement.create({
            data: {
              tenantId: s.tenantId,
              registroId: s.registroId,
              progressiveYear: 2026,
              progressiveNumber: (ultimo._max.progressiveNumber ?? 0) + 1,
              type: 'CARICO',
              movementDate: new Date('2026-03-01T10:00:00Z'),
              registrationDate: new Date('2026-03-01T10:00:00Z'),
              causale: 'INGRESSO_ESTERNO',
              cerCode: '20 03 01',
              quantity: '90',
              unit: 'KG',
              tipoAnnotazione: 'RETTIFICA',
              motivoAnnotazione: 'correzione di prova',
              movimentoRettificatoId: m,
              movimentoOriginaleId: m,
            },
          })
          // Task 21: poi il legame della catena.
          await bloccaLegamePerRadice(tx, m)
        })
      const lega = (m: string) =>
        nel(s.tenantId, async tx => {
          await bloccaLegamePerRadice(tx, m)
          await tx.$executeRaw`
            INSERT INTO legami_movimento
              (tenant_id, registro_id, verso, movimento_originale_id, movimento_vigente_id, stato,
               data_movimento, updated_at)
            VALUES (${s.tenantId}::uuid, ${s.registroId}::uuid, 'CARICO', ${m}::uuid, ${m}::uuid,
                    'DA_COLLEGARE', '2026-03-01'::date, now())`
        })
      const lavori = movimenti.flatMap((m, i) =>
        i % 2 === 0 ? [correggi(m), lega(m)] : [lega(m), correggi(m)]
      )
      const esiti = await Promise.allSettled(lavori)
      expect(
        esiti
          .filter(e => e.status === 'rejected')
          .map(e => String((e as PromiseRejectedResult).reason))
      ).toEqual([])
      const [{ n }] = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM legami_movimento WHERE tenant_id = ${s.tenantId}::uuid`
      expect(n).toBe(20)
    }, 120_000)
  })

  describe('bloccaLegamePerRadice', () => {
    it('due transazioni sulla stessa radice si serializzano, su radici diverse no', async () => {
      const s = await scenario(0)
      const altraRadice = randomUUID()
      const t = tenitore('app', s.tenantId, tx => bloccaLegamePerRadice(tx, s.movimentoId))
      await t.pronta
      // Radice diversa: completa mentre la prima e' ancora tenuta.
      await nel(s.tenantId, tx => bloccaLegamePerRadice(tx, altraRadice))
      // Stessa radice: aspetta.
      const seconda = osserva(nel(s.tenantId, tx => bloccaLegamePerRadice(tx, s.movimentoId)))
      await attendiLock(1, () => seconda.stato.finita)
      expect(seconda.stato.finita).toBe(false)
      t.rilascia()
      await t.fine
      await seconda.esito
    })

    it('con impostaTimeoutAggancio la perdente rinuncia con 55P03 entro il tetto', async () => {
      const s = await scenario(0)
      expect(LOCK_TIMEOUT_AGGANCIO).toBe('2s')
      const t = tenitore('app', s.tenantId, tx => bloccaLegamePerRadice(tx, s.movimentoId))
      await t.pronta
      const t0 = Date.now()
      const errore = await nel(s.tenantId, async tx => {
        await impostaTimeoutAggancio(tx)
        const [{ lock_timeout }] = await tx.$queryRaw<{ lock_timeout: string }[]>`SHOW lock_timeout`
        expect(lock_timeout).toBe('2s')
        await bloccaLegamePerRadice(tx, s.movimentoId)
      }).then(
        () => null,
        (e: { message?: string; meta?: { code?: string }; code?: string }) => e
      )
      const ms = Date.now() - t0
      expect(JSON.stringify(errore) + String(errore?.message)).toMatch(
        /55P03|lock timeout|lock_timeout/i
      )
      expect(ms).toBeGreaterThanOrEqual(1_800)
      expect(ms).toBeLessThan(8_000)
      t.rilascia()
      await t.fine
    }, 30_000)
  })

  describe('KEY SHARE dell INSERT del legame sul movimento', () => {
    it('l INSERT di un legame tiene FOR KEY SHARE sul movimento: un FOR UPDATE del movimento aspetta, un FOR NO KEY UPDATE no', async () => {
      const s = await scenario(0)
      const t = tenitore('owner', s.tenantId, async tx => {
        await tx.$executeRaw`
          INSERT INTO legami_movimento
            (tenant_id, registro_id, verso, movimento_originale_id, movimento_vigente_id, stato,
             data_movimento, updated_at)
          VALUES (${s.tenantId}::uuid, ${s.registroId}::uuid, 'CARICO', ${s.movimentoId}::uuid,
                  ${s.movimentoId}::uuid, 'DA_COLLEGARE', '2026-03-01'::date, now())`
      })
      await t.pronta
      // Aggiornare una colonna non chiave (il registro lo fa) non aspetta.
      await owner.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM waste_movements WHERE id = ${s.movimentoId}::uuid FOR NO KEY UPDATE`
      }, OPZ)
      // Un FOR UPDATE (cancellazione o cambio di chiave) aspetta il legame.
      const registro = osserva(
        owner.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM waste_movements WHERE id = ${s.movimentoId}::uuid FOR UPDATE`
        }, OPZ)
      )
      await attendiLock(1, () => registro.stato.finita)
      expect(registro.stato.finita).toBe(false)
      t.rilascia()
      await t.fine
      await registro.esito
    })
  })

  describe('bloccaRigheLegame', () => {
    it('blocca testata e righe del legame FOR UPDATE: un secondo scrittore aspetta, un lettore no', async () => {
      const s = await scenario(0)
      const l = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: s.movimentoId,
        registroId: s.registroId,
        verso: 'CARICO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId }],
      })
      const t = tenitore('app', s.tenantId, tx => bloccaRigheLegame(tx, s.tenantId, [l.legameId]))
      await t.pronta
      // Lettura semplice: non aspetta.
      const [{ n }] = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM righe_legame_movimento WHERE legame_id = ${l.legameId}::uuid`
      expect(n).toBe(1)
      const seconda = osserva(
        nel(s.tenantId, tx => bloccaRigheLegame(tx, s.tenantId, [l.legameId]))
      )
      await attendiLock(1, () => seconda.stato.finita)
      expect(seconda.stato.finita).toBe(false)
      t.rilascia()
      await t.fine
      await seconda.esito
    })

    it('lista vuota: non fa nulla', async () => {
      const s = await scenario(0)
      await expect(
        nel(s.tenantId, tx => bloccaRigheLegame(tx, s.tenantId, []))
      ).resolves.toBeUndefined()
    })
  })
})
