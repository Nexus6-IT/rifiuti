import { HttpException } from '@nestjs/common'
import type { PrismaClient } from '@prisma/client'
import { TenantContext } from '../core/context/tenant-context'
import { eseguiAnteprima } from '../application/fatturazione/anteprima'
import { eseguiDefinitiva, type EsitoDefinitiva } from '../application/fatturazione/definitiva'
import { DocumentiFatturaService } from '../application/fatturazione/documenti-fattura.service'
import { ElaborazioniService } from '../application/fatturazione/elaborazioni.service'
import * as lockFatturazione from '../application/fatturazione/lock-fatturazione'
import type { ParametriElaborazione } from '../application/fatturazione/selezione-fatturazione'
import type { PrismaService } from '../infrastructure/persistence/prisma.service'
import {
  creaAziendaT18,
  creaContrattoT18,
  creaLegameConfermatoT18,
  creaRigaT18,
  type AziendaT18,
  type ContrattoT18,
} from './fatturazione-t18-di-test'

/**
 * Banco del Task 19 (definitiva), condiviso dalle due suite Postgres: azienda con le definitive
 * ACCESE (solo per quella azienda), elaborazione pronta, richiesta e job della definitiva, letture
 * dello stato finale col PROPRIETARIO, barriere su `pg_stat_activity`. Le suite lo costruiscono
 * DOPO aver impostato `DATABASE_URL` (ruolo `wasteflow_app` e `application_name`).
 */
export const PARAMETRI_T19: ParametriElaborazione = {
  periodoDal: '2026-03-01',
  periodoAl: '2026-03-31',
  dataDocumento: '2026-04-05',
  raggruppamento: 'PER_CONTRATTO',
  includiArretrati: false,
  filtri: {},
}
export const ADESSO_T19 = '2026-04-10T10:00:00.000Z'

export interface EsitoHttp {
  status: number
  codice?: string
  details?: Record<string, unknown>
}

/** `'ok'` se la promessa riesce, altrimenti stato e codice dell'eccezione HTTP. */
export async function esitoHttp(p: Promise<unknown>): Promise<EsitoHttp | 'ok'> {
  try {
    await p
    return 'ok'
  } catch (e) {
    if (e instanceof HttpException) {
      const r = e.getResponse() as { error?: string; details?: Record<string, unknown> }
      return {
        status: e.getStatus(),
        codice: r.error,
        ...(r.details ? { details: r.details } : {}),
      }
    }
    throw e
  }
}

export interface ElaborazioneT19 {
  id: string
  versione: number
  impronta: string
}

export interface OpzioniBancoT19 {
  owner: PrismaClient
  app: PrismaService
  tenantCreati: string[]
  nomeApplicazione: string
}

let contatore = 0

export function creaBancoT19({ owner, app, tenantCreati, nomeApplicazione }: OpzioniBancoT19) {
  const banco = {
    servizio: undefined as unknown as ElaborazioniService,
    coda: undefined as unknown as { add: jest.Mock },

    /** Da chiamare in `beforeEach`: coda finta nuova e servizio con l'orologio fissato. */
    reset(): void {
      banco.coda = { add: jest.fn().mockResolvedValue(undefined) }
      banco.servizio = new ElaborazioniService(
        app,
        new DocumentiFatturaService(app),
        banco.coda as never
      )
      banco.servizio.orologio = () => new Date(ADESSO_T19)
    },

    nel<R>(tenantId: string, fn: () => Promise<R>): Promise<R> {
      return TenantContext.run({ tenantId }, async () => await fn())
    },

    /** Azienda di test con le definitive ACCESE (`attive: false` le lascia spente). */
    async azienda(o: { cedente?: boolean; attive?: boolean } = {}): Promise<AziendaT18> {
      const az = await creaAziendaT18(owner, tenantCreati, { cedente: o.cedente })
      if (o.attive !== false) {
        await owner.$executeRawUnsafe(
          `UPDATE impostazioni_fatturazione SET definitive_attive = true WHERE tenant_id = $1::uuid`,
          az.tenantId
        )
      }
      return az
    },

    /** Contratto con un legame confermato (e, a richiesta, una `F`, un altro cliente o registro). */
    async contratto(
      az: AziendaT18,
      o: {
        ragione?: string
        numero?: string
        clienteId?: string
        registroIvaId?: string | null
        fisso?: boolean
        senzaLegame?: boolean
        data?: string
      } = {}
    ): Promise<ContrattoT18 & { legameId: string | null }> {
      const c = await creaContrattoT18(owner, az, {
        clienteId: o.clienteId,
        registroIvaId: o.registroIvaId,
      })
      if (o.ragione !== undefined) {
        await owner.$executeRawUnsafe(
          `UPDATE ditte SET ragione_sociale = $2
           WHERE id = (SELECT ditta_id FROM clienti WHERE id = $1::uuid)`,
          c.clienteId,
          o.ragione
        )
      }
      if (o.numero !== undefined) {
        await owner.$executeRawUnsafe(
          `UPDATE contratti_cliente SET numero = $2 WHERE id = $1::uuid`,
          c.contrattoId,
          o.numero
        )
      }
      if (o.fisso) await creaRigaT18(owner, az, c.elencoId, 'F', '25')
      const l = o.senzaLegame
        ? null
        : await creaLegameConfermatoT18(owner, az, c, { data: o.data ?? '2026-03-10' })
      return { ...c, legameId: l?.legameId ?? null }
    },

    /** Avvia l'elaborazione e fa girare l'anteprima: `ANTEPRIMA_PRONTA`. */
    async pronta(az: AziendaT18, p: Partial<ParametriElaborazione> = {}): Promise<ElaborazioneT19> {
      const { id } = await banco.nel(az.tenantId, () =>
        banco.servizio.avvia(az.tenantId, az.utenteId, { ...PARAMETRI_T19, ...p })
      )
      await banco.nel(az.tenantId, () => eseguiAnteprima(app, az.tenantId, id, 1))
      const e = await banco.leggi(id)
      if (e.stato !== 'ANTEPRIMA_PRONTA') throw new Error(`anteprima non pronta: ${e.stato}`)
      return { id, versione: e.versione, impronta: e.impronta as string }
    },

    async leggi(id: string) {
      return (
        await owner.$queryRawUnsafe<
          {
            stato: string
            versione: number
            job_id: string | null
            esito: {
              codice: string
              differenze?: Record<string, number>
              ultimaData?: string
            } | null
            errore_tecnico: string | null
            impronta: string | null
            errori_generali: string[]
            definita_da: string | null
            definita_il: Date | null
          }[]
        >(
          `SELECT stato::text, versione, job_id, esito, errore_tecnico, impronta, errori_generali,
                  definita_da::text, definita_il
           FROM elaborazioni_fatturazione WHERE id = $1::uuid`,
          id
        )
      )[0]
    },

    chiedi(az: AziendaT18, id: string, b: { impronta: string; versione: number }) {
      return banco.nel(az.tenantId, () =>
        banco.servizio.chiediDefinitiva(az.tenantId, az.utenteId, id, b)
      )
    },

    /** Identita' (versione e `job_id`) dell'ultimo job `definitiva` accodato per l'elaborazione. */
    ultimoJob(id: string): { versione: number; jobId: string } {
      const chiamate = banco.coda.add.mock.calls.filter(
        c => c[0] === 'definitiva' && c[1].elaborazioneId === id
      )
      if (chiamate.length === 0) throw new Error('nessun job definitiva accodato')
      const [, dati, opzioni] = chiamate[chiamate.length - 1]
      return { versione: dati.versione as number, jobId: opzioni.jobId as string }
    },

    /** Esegue il job come il worker, con l'identita' dell'ultimo accodato. */
    eseguiJob(az: AziendaT18, id: string): Promise<EsitoDefinitiva> {
      const j = banco.ultimoJob(id)
      return banco.nel(az.tenantId, () => eseguiDefinitiva(app, az.tenantId, id, az.utenteId, j))
    },

    /** Richiesta e job di seguito. */
    async definitiva(az: AziendaT18, e: ElaborazioneT19): Promise<EsitoDefinitiva> {
      await banco.chiedi(az, e.id, { impronta: e.impronta, versione: e.versione })
      return banco.eseguiJob(az, e.id)
    },

    documenti(id: string) {
      return owner.$queryRawUnsafe<
        {
          id: string
          stato: string
          numero: number | null
          numero_testo: string | null
          contratto_id: string
          registro_iva_id: string
          escluso: boolean
          errori: string[]
          avvisi: string[]
          totale_documento: string
          data_documento: string
          definito_da: string | null
          definito_il: Date | null
          fotografia: { segnalazioni: { errori: unknown[]; avvisi: { codice: string }[] } }
        }[]
      >(
        `SELECT id::text, stato::text, numero, numero_testo, contratto_id::text,
                registro_iva_id::text, escluso_da_definitiva AS escluso, errori, avvisi,
                totale_documento::text, data_documento::text, definito_da::text, definito_il,
                fotografia
         FROM documenti_fattura WHERE elaborazione_id = $1::uuid ORDER BY numero, id`,
        id
      )
    },

    righeDi(documentoId: string) {
      return owner.$queryRawUnsafe<
        {
          id: string
          numero_linea: number
          tipo_riga: string
          legame_id: string | null
          riga_legame_id: string | null
          movimento_fatturato_id: string | null
          riga_addebito_id: string | null
        }[]
      >(
        `SELECT id::text, numero_linea, tipo_riga::text, legame_id::text, riga_legame_id::text,
                movimento_fatturato_id::text, riga_addebito_id::text
         FROM righe_documento_fattura WHERE documento_id = $1::uuid ORDER BY numero_linea`,
        documentoId
      )
    },

    legamiDi(ids: string[]) {
      return owner.$queryRawUnsafe<
        {
          id: string
          stato: string
          versione: number
          documento_id: string | null
          riferimento_fattura: string | null
          fatturato_il: Date | null
          movimento_vigente_id: string
          scostamento_dopo_fattura: boolean
        }[]
      >(
        `SELECT id::text, stato::text, versione, documento_id::text, riferimento_fattura,
                fatturato_il, movimento_vigente_id::text, scostamento_dopo_fattura
         FROM legami_movimento WHERE id = ANY($1::uuid[]) ORDER BY id`,
        ids
      )
    },

    numerazioni(tenantId: string) {
      return owner.$queryRawUnsafe<
        {
          registro_iva_id: string
          anno: number
          ultimo_numero: number
          numero_partenza: number
          ultima_data: string | null
          versione: number
        }[]
      >(
        `SELECT registro_iva_id::text, anno::int, ultimo_numero, numero_partenza, ultima_data::text,
                versione
         FROM numerazioni_fattura WHERE tenant_id = $1::uuid ORDER BY registro_iva_id, anno`,
        tenantId
      )
    },

    marcatori(tenantId: string) {
      return owner.$queryRawUnsafe<
        {
          riga_addebito_id: string
          tipo: string
          chiave_competenza: string
          documento_id: string
          riga_documento_id: string
        }[]
      >(
        `SELECT riga_addebito_id::text, tipo::text, chiave_competenza, documento_id::text,
                riga_documento_id::text
         FROM marcatori_addebiti_fatturati WHERE tenant_id = $1::uuid
         ORDER BY riga_addebito_id, tipo, chiave_competenza`,
        tenantId
      )
    },

    async conteggioAudit(tenantId: string, azione: string): Promise<number> {
      const [r] = await owner.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM activity_logs WHERE tenant_id = $1::uuid AND action = $2`,
        tenantId,
        azione
      )
      return r.n
    },

    /** Invariante: i numeri dei DEFINITIVO di ogni coppia sono `numero_partenza+1 .. ultimo_numero`. */
    async verificaSerie(tenantId: string): Promise<void> {
      const coppie = await banco.numerazioni(tenantId)
      for (const n of coppie) {
        const r = await owner.$queryRawUnsafe<{ numero: number }[]>(
          `SELECT numero FROM documenti_fattura
           WHERE tenant_id = $1::uuid AND registro_iva_id = $2::uuid AND anno = $3::int
             AND stato = 'DEFINITIVO' ORDER BY numero`,
          tenantId,
          n.registro_iva_id,
          n.anno
        )
        const attesi = Array.from(
          { length: n.ultimo_numero - n.numero_partenza },
          (_, i) => n.numero_partenza + 1 + i
        )
        expect(r.map(x => x.numero)).toEqual(attesi)
      }
      const viol = await owner.$queryRawUnsafe<{ violazioni: number }[]>(
        `SELECT violazioni FROM fatturazione_violazioni_numerazione() WHERE tenant_id = $1::uuid`,
        tenantId
      )
      expect(viol.reduce((s, v) => s + v.violazioni, 0)).toBe(0)
    },

    /** Sessioni di QUESTO processo in attesa di un lock. */
    async sessioniInLock(): Promise<number> {
      const [{ k }] = await owner.$queryRawUnsafe<{ k: number }[]>(
        `SELECT count(*)::int AS k FROM pg_stat_activity
         WHERE datname = current_database() AND application_name = $1
           AND wait_event_type = 'Lock'`,
        nomeApplicazione
      )
      return k
    },

    /** Aspetta, col poll della vista e mai con uno sleep come sincronizzazione, `n` sessioni in lock. */
    async attendiLock(n: number, finita: () => boolean = () => false): Promise<void> {
      const scadenza = Date.now() + 30_000
      for (;;) {
        const k = await banco.sessioniInLock()
        if (k >= n) return
        if (finita() || Date.now() > scadenza) {
          throw new Error(`attesa di ${n} sessioni in lock non raggiunta (${k})`)
        }
        await new Promise(r => setTimeout(r, 20))
      }
    },

    /**
     * Esegue il job della definitiva FERMANDOLO dopo che ha preso tutti i lock (dopo
     * `bloccaPerDefinitiva`) e prima di scrivere. `durante` parte con la definitiva ferma e
     * restituisce il suo esito; la definitiva riparte quando `durante` ha finito di sincronizzarsi
     * (chiama `rilascia`) o, in ogni caso, alla fine di `durante`.
     */
    async conDefinitivaInPausa<R>(
      az: AziendaT18,
      id: string,
      durante: (rilascia: () => void) => Promise<R>
    ): Promise<{ esito: EsitoDefinitiva; risultato: R }> {
      let rilascia!: () => void
      const cancello = new Promise<void>(r => (rilascia = r))
      let fermo!: () => void
      const eFerma = new Promise<void>(r => (fermo = r))
      const originale = lockFatturazione.bloccaPerDefinitiva
      const spia = jest
        .spyOn(lockFatturazione, 'bloccaPerDefinitiva')
        .mockImplementation(async (...a: Parameters<typeof originale>) => {
          await originale(...a)
          fermo()
          await cancello
        })
      try {
        const job = banco.eseguiJob(az, id)
        // Se il job fallisce prima di fermarsi non si resta in attesa per sempre.
        const prima = await Promise.race([
          eFerma.then(() => 'ferma' as const),
          job.then(() => 'fine' as const),
        ])
        if (prima === 'fine') throw new Error('la definitiva e finita senza fermarsi')
        let risultato: R
        try {
          risultato = await durante(rilascia)
        } finally {
          rilascia()
        }
        return { esito: await job, risultato }
      } finally {
        spia.mockRestore()
      }
    },

    /**
     * Esegue il job della definitiva FERMANDOLO in chiusura: dopo aver scritto tutto (documenti,
     * legami, marcatori, elaborazione) e prima del commit, con tutti i lock ancora presi. La
     * barriera e' un lock consultivo che il proprietario tiene e che un trigger di prova sull'audit
     * dell'elaborazione (solo di questa azienda) chiede: il job aspetta in `Lock`, mai uno sleep.
     */
    async conDefinitivaInChiusura<R>(
      az: AziendaT18,
      id: string,
      durante: () => Promise<R>
    ): Promise<{ esito: EsitoDefinitiva; risultato: R }> {
      contatore += 1
      const nome = `t19_chiusura_${process.pid}_${contatore}`
      const chiave = 1_900_000 + (process.pid % 1000) * 1000 + contatore
      let rilascia!: () => void
      const barriera = new Promise<void>(r => (rilascia = r))
      let preso!: () => void
      const ePreso = new Promise<void>(r => (preso = r))
      const tenitore = owner.$transaction(
        async tx => {
          await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${chiave})`)
          preso()
          await barriera
        },
        { timeout: 120_000, maxWait: 30_000 }
      )
      tenitore.catch(() => preso())
      await ePreso
      await owner.$executeRawUnsafe(`
        CREATE FUNCTION ${nome}() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN
          IF NEW.tenant_id = '${az.tenantId}'::uuid
             AND NEW.action = 'ELABORAZIONE_FATTURAZIONE_DEFINITIVA' THEN
            PERFORM pg_advisory_xact_lock(${chiave});
          END IF;
          RETURN NEW;
        END $f$`)
      await owner.$executeRawUnsafe(
        `CREATE TRIGGER ${nome} BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION ${nome}()`
      )
      try {
        const job = banco.eseguiJob(az, id)
        let finito = false
        job.then(
          () => (finito = true),
          () => (finito = true)
        )
        await banco.attendiLock(1, () => finito)
        if (finito) throw new Error('la definitiva e finita senza fermarsi')
        let risultato: R
        try {
          risultato = await durante()
        } finally {
          rilascia()
        }
        await tenitore
        return { esito: await job, risultato }
      } finally {
        rilascia()
        await tenitore.catch(() => undefined)
        await owner.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${nome} ON activity_logs`)
        await owner.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${nome}()`)
      }
    },
  }
  return banco
}

export type BancoT19 = ReturnType<typeof creaBancoT19>
