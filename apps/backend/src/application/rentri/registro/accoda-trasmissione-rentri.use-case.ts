/**
 * Azioni manuali sulla coda di trasmissione del registro a RENTRI (F2-9, D12).
 *
 * REGOLA CHIAVE: non si ritrasmette mai cio' che RENTRI potrebbe gia' avere. Un'annotazione torna
 * `DA_TRASMETTERE` solo se l'ultimo esito e' definitivo e negativo (`RIFIUTATA`) o se non e' mai
 * partita (`NON_TRASMISSIBILE`, dopo una correzione dei dati). `INCERTA`, `IN_INVIO`,
 * `ATTESA_ESITO`, `TRASMESSA` e `GIA_SU_RENTRI` non si toccano mai da qui: l'incerta si scioglie
 * solo con la verifica (D11). Ogni UPDATE porta lo stato di partenza nel `WHERE`.
 *
 * Ogni azione scrive l'audit nella STESSA transazione. L'audit ha conteggi e id, mai il corpo
 * inviato ne' testo libero dell'utente (D15).
 */
import { Injectable } from '@nestjs/common'
import type { Prisma, StatoTrasmissioneRentri } from '@prisma/client'
import { LoggerService } from '../../../core/logger/logger.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RegistroNonTrovatoError } from '../../registro/registri.service'
import {
  MovimentoNonTrovatoError,
  RichiestaTrasmissioneNonValidaError,
  TrasmissioneNonModificabileError,
  richiediAmministratore,
} from './errori-azioni-rentri-registro'

type Tx = Prisma.TransactionClient

export const MAX_MOVIMENTI_PER_ACCODAMENTO = 1000
export const MAX_INTERVALLO_DICHIARAZIONE = 10_000
const MAX_ID_IN_AUDIT = 200
const PROFONDITA_MASSIMA_CATENA = 1000

/** Stati da cui un'annotazione si puo' riportare in coda a mano. */
const RIACCODABILI: StatoTrasmissioneRentri[] = ['RIFIUTATA', 'NON_TRASMISSIBILE']

export interface EsitoAccodamento {
  /** Righe nuove create `DA_TRASMETTERE`. */
  accodate: number
  /** Righe `RIFIUTATA`/`NON_TRASMISSIBILE` riportate `DA_TRASMETTERE`. */
  riaccodate: number
  /** Predecessori non trasmessi delle correzioni, accodati insieme (compresi in accodate/riaccodate). */
  predecessori: number
  /** Annotazioni scelte ma non accodabili (gia' in coda, in volo, incerte o trasmesse). */
  saltate: number
  saltatePerStato: Partial<Record<StatoTrasmissioneRentri, number>>
}

export interface EsitoDichiarazione {
  dichiarate: number
  /** Movimenti dell'intervallo con una riga che non si tocca (in coda, in volo, incerta, trasmessa). */
  saltate: number
  saltatePerStato: Partial<Record<StatoTrasmissioneRentri, number>>
  /** Movimenti realmente presenti nell'intervallo. */
  movimentiNellIntervallo: number
}

const unici = <T>(xs: T[]) => [...new Set(xs)]

@Injectable()
export class AccodaTrasmissioneRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('AccodaTrasmissioneRentriUseCase')
  }

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  private async registroDellAzienda(tx: Tx, tenantId: string, registroId: string) {
    const registro = await tx.registroRifiuti.findFirst({
      where: { id: registroId, tenantId },
      select: { id: true },
    })
    if (!registro) throw new RegistroNonTrovatoError()
  }

  /**
   * Accoda le annotazioni scelte (1..1000 del registro) e i predecessori non trasmessi delle
   * correzioni (la catena intera: l'ordine lo decide `selezionaLotto`).
   * @throws MovimentoNonTrovatoError se una non e' di questo registro/azienda (nulla viene accodato)
   */
  async accoda(
    tenantId: string,
    utenteId: string,
    registroId: string,
    movimentoIds: string[]
  ): Promise<EsitoAccodamento> {
    const scelti = unici(movimentoIds)
    if (scelti.length === 0 || scelti.length > MAX_MOVIMENTI_PER_ACCODAMENTO) {
      throw new RichiestaTrasmissioneNonValidaError(
        `Indica da 1 a ${MAX_MOVIMENTI_PER_ACCODAMENTO} annotazioni.`
      )
    }

    return this.nelTenant(tenantId, async tx => {
      await this.registroDellAzienda(tx, tenantId, registroId)
      const trovati = await tx.wasteMovement.findMany({
        where: { id: { in: scelti }, tenantId, registroId },
        select: { id: true, type: true, movimentoRettificatoId: true },
      })
      if (trovati.length !== scelti.length) throw new MovimentoNonTrovatoError()

      // Catena dei predecessori: si risale finche' ce ne sono (stesso registro e azienda).
      const tutti = new Map(trovati.map(m => [m.id, m]))
      const predecessori = new Set<string>()
      let fronte = trovati.map(m => m.movimentoRettificatoId).filter((x): x is string => !!x)
      for (let giro = 0; fronte.length > 0 && giro < PROFONDITA_MASSIMA_CATENA; giro++) {
        const nuovi = unici(fronte).filter(id => !tutti.has(id))
        if (nuovi.length === 0) break
        const letti = await tx.wasteMovement.findMany({
          where: { id: { in: nuovi }, tenantId, registroId },
          select: { id: true, type: true, movimentoRettificatoId: true },
        })
        for (const m of letti) {
          tutti.set(m.id, m)
          predecessori.add(m.id)
        }
        fronte = letti.map(m => m.movimentoRettificatoId).filter((x): x is string => !!x)
      }

      const righe = await tx.movimentoTrasmissioneRentri.findMany({
        where: { tenantId, movimentoId: { in: [...tutti.keys()] } },
        select: { movimentoId: true, stato: true },
      })
      const statoDi = new Map(righe.map(r => [r.movimentoId, r.stato]))

      const nuove: string[] = []
      const daRiportare: string[] = []
      const saltatePerStato: Partial<Record<StatoTrasmissioneRentri, number>> = {}
      let saltate = 0
      let predecessoriAccodati = 0
      for (const id of tutti.keys()) {
        const stato = statoDi.get(id)
        const eScelto = !predecessori.has(id)
        if (stato === undefined) {
          nuove.push(id)
          if (!eScelto) predecessoriAccodati++
        } else if (RIACCODABILI.includes(stato)) {
          daRiportare.push(id)
          if (!eScelto) predecessoriAccodati++
        } else if (eScelto) {
          // Un predecessore gia' trasmesso o in volo non e' un problema: non si conta come saltato.
          saltate++
          saltatePerStato[stato] = (saltatePerStato[stato] ?? 0) + 1
        }
      }

      let accodate = 0
      if (nuove.length > 0) {
        const r = await tx.movimentoTrasmissioneRentri.createMany({
          data: nuove.map(id => ({
            tenantId,
            movimentoId: id,
            registroId,
            tipo: tutti.get(id)!.type,
            origine: 'MANUALE' as const,
            accodatoDa: utenteId,
          })),
          skipDuplicates: true,
        })
        accodate = r.count
        // Una riga comparsa nel frattempo (adozione automatica) non e' un errore: e' gia' in coda.
        saltate += nuove.length - r.count
      }
      let riaccodate = 0
      if (daRiportare.length > 0) {
        const r = await tx.movimentoTrasmissioneRentri.updateMany({
          where: { tenantId, movimentoId: { in: daRiportare }, stato: { in: RIACCODABILI } },
          data: {
            stato: 'DA_TRASMETTERE',
            bloccatoInvio: false,
            motivoBlocco: null,
            accodatoDa: utenteId,
          },
        })
        riaccodate = r.count
      }

      const esito: EsitoAccodamento = {
        accodate,
        riaccodate,
        predecessori: predecessoriAccodati,
        saltate,
        saltatePerStato,
      }
      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utenteId,
          action: 'RENTRI_REGISTRO_ACCODATI',
          description: `Annotazioni accodate per RENTRI: ${accodate + riaccodate}, saltate: ${saltate}`,
          metadata: {
            registroId,
            ...esito,
            movimentoIds: [...nuove, ...daRiportare].slice(0, MAX_ID_IN_AUDIT),
          },
        },
      })
      return esito
    })
  }

  /**
   * "Trasmetti lo storico": accoda i movimenti dell'ANNO indicato che non hanno ancora una riga.
   * Non riporta in coda le rifiutate e non risale ai predecessori di anni precedenti.
   * @throws RichiestaTrasmissioneNonValidaError senza `conferma: true` o con un anno non valido
   */
  async accodaStorico(
    tenantId: string,
    utenteId: string,
    registroId: string,
    anno: number,
    conferma: boolean
  ): Promise<EsitoAccodamento> {
    if (conferma !== true) {
      throw new RichiestaTrasmissioneNonValidaError(
        "Per trasmettere lo storico serve la conferma esplicita dell'operazione."
      )
    }
    if (!Number.isInteger(anno) || anno < 2000 || anno > 2100) {
      throw new RichiestaTrasmissioneNonValidaError('Anno non valido.')
    }
    return this.nelTenant(tenantId, async tx => {
      await this.registroDellAzienda(tx, tenantId, registroId)
      const inseriti = await tx.$queryRaw<Array<{ movimento_id: string }>>`
        INSERT INTO "movimenti_trasmissione_rentri"
          ("tenant_id", "movimento_id", "registro_id", "tipo", "origine", "accodato_da", "updated_at")
        SELECT m."tenant_id", m."id", m."registro_id", m."type", 'MANUALE', ${utenteId}::uuid, now()
        FROM "waste_movements" m
        WHERE m."tenant_id" = ${tenantId}::uuid
          AND m."registro_id" = ${registroId}::uuid
          AND m."progressive_year" = ${anno}
          AND NOT EXISTS (
            SELECT 1 FROM "movimenti_trasmissione_rentri" t
            WHERE t."movimento_id" = m."id" AND t."tenant_id" = m."tenant_id")
        ORDER BY m."progressive_number"
        ON CONFLICT ("movimento_id") DO NOTHING
        RETURNING "movimento_id"`
      const esito: EsitoAccodamento = {
        accodate: inseriti.length,
        riaccodate: 0,
        predecessori: 0,
        saltate: 0,
        saltatePerStato: {},
      }
      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utenteId,
          action: 'RENTRI_REGISTRO_ACCODATI',
          description: `Storico ${anno} accodato per RENTRI: ${inseriti.length} annotazioni`,
          metadata: {
            registroId,
            anno,
            storico: true,
            accodate: inseriti.length,
            movimentoIds: inseriti.slice(0, MAX_ID_IN_AUDIT).map(r => r.movimento_id),
          },
        },
      })
      return esito
    })
  }

  /**
   * Toglie un'annotazione dalla coda: si cancella la riga solo se `DA_TRASMETTERE`.
   * @throws TrasmissioneNonModificabileError (409) se la riga e' in un altro stato (intatta)
   * @throws MovimentoNonTrovatoError (404) se non c'e' nessuna riga per questa azienda
   */
  async togliDallaCoda(tenantId: string, utenteId: string, movimentoId: string): Promise<void> {
    await this.nelTenant(tenantId, async tx => {
      const r = await tx.movimentoTrasmissioneRentri.deleteMany({
        where: { tenantId, movimentoId, stato: 'DA_TRASMETTERE' },
      })
      if (r.count === 0) {
        const esiste = await tx.movimentoTrasmissioneRentri.findFirst({
          where: { tenantId, movimentoId },
          select: { stato: true },
        })
        if (!esiste) throw new MovimentoNonTrovatoError()
        throw new TrasmissioneNonModificabileError(
          "L'annotazione non e' piu' in coda: si puo' togliere solo prima dell'invio."
        )
      }
      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utenteId,
          action: 'RENTRI_REGISTRO_TOLTO_DALLA_CODA',
          description: 'Annotazione tolta dalla coda di trasmissione a RENTRI',
          metadata: { movimentoId },
        },
      })
    })
  }

  /**
   * Per chi arriva da un altro programma che ha gia' trasmesso (D12, riservato agli ADMIN): le
   * annotazioni dell'intervallo (anno, da..a) diventano `GIA_SU_RENTRI`, bloccate col motivo.
   * Solo su movimenti senza riga o `RIFIUTATA`/`NON_TRASMISSIBILE`; le altre non si toccano.
   */
  async dichiaraGiaSuRentri(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    registroId: string,
    anno: number,
    daProgressivo: number,
    aProgressivo: number,
    motivo: string
  ): Promise<EsitoDichiarazione> {
    richiediAmministratore(ruolo)
    const testo = (motivo ?? '').trim()
    if (testo === '' || testo.length > 500) {
      throw new RichiestaTrasmissioneNonValidaError(
        'Indica il motivo della dichiarazione (al massimo 500 caratteri).'
      )
    }
    if (
      !Number.isInteger(anno) ||
      !Number.isInteger(daProgressivo) ||
      !Number.isInteger(aProgressivo) ||
      daProgressivo < 1 ||
      aProgressivo < daProgressivo
    ) {
      throw new RichiestaTrasmissioneNonValidaError('Intervallo di numeri non valido.')
    }
    if (aProgressivo - daProgressivo + 1 > MAX_INTERVALLO_DICHIARAZIONE) {
      throw new RichiestaTrasmissioneNonValidaError(
        `L'intervallo non puo' superare ${MAX_INTERVALLO_DICHIARAZIONE} numeri.`
      )
    }

    return this.nelTenant(tenantId, async tx => {
      await this.registroDellAzienda(tx, tenantId, registroId)
      const movimenti = await tx.wasteMovement.findMany({
        where: {
          tenantId,
          registroId,
          progressiveYear: anno,
          progressiveNumber: { gte: daProgressivo, lte: aProgressivo },
        },
        select: { id: true, type: true },
      })
      const righe = await tx.movimentoTrasmissioneRentri.findMany({
        where: { tenantId, movimentoId: { in: movimenti.map(m => m.id) } },
        select: { movimentoId: true, stato: true },
      })
      const statoDi = new Map(righe.map(r => [r.movimentoId, r.stato]))

      const nuovi = movimenti.filter(m => !statoDi.has(m.id))
      const daRiportare = movimenti.filter(m => {
        const s = statoDi.get(m.id)
        return s !== undefined && RIACCODABILI.includes(s)
      })
      const saltatePerStato: Partial<Record<StatoTrasmissioneRentri, number>> = {}
      for (const m of movimenti) {
        const s = statoDi.get(m.id)
        if (s !== undefined && !RIACCODABILI.includes(s)) {
          saltatePerStato[s] = (saltatePerStato[s] ?? 0) + 1
        }
      }

      const dati = {
        stato: 'GIA_SU_RENTRI' as const,
        origine: 'DICHIARATA' as const,
        bloccatoInvio: true,
        motivoBlocco: testo,
        accodatoDa: utenteId,
      }
      let dichiarate = 0
      if (nuovi.length > 0) {
        const r = await tx.movimentoTrasmissioneRentri.createMany({
          data: nuovi.map(m => ({
            tenantId,
            movimentoId: m.id,
            registroId,
            tipo: m.type,
            ...dati,
          })),
          skipDuplicates: true,
        })
        dichiarate += r.count
      }
      if (daRiportare.length > 0) {
        const r = await tx.movimentoTrasmissioneRentri.updateMany({
          where: {
            tenantId,
            movimentoId: { in: daRiportare.map(m => m.id) },
            stato: { in: RIACCODABILI },
          },
          data: dati,
        })
        dichiarate += r.count
      }
      const saltate = movimenti.length - nuovi.length - daRiportare.length

      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utenteId,
          action: 'RENTRI_REGISTRO_DICHIARATI',
          description: `Annotazioni dichiarate gia' su RENTRI: ${dichiarate} (anno ${anno}, dal n. ${daProgressivo} al n. ${aProgressivo})`,
          metadata: {
            registroId,
            anno,
            daProgressivo,
            aProgressivo,
            dichiarate,
            saltate,
            movimentoIds: [...nuovi, ...daRiportare].slice(0, MAX_ID_IN_AUDIT).map(m => m.id),
          },
        },
      })
      return { dichiarate, saltate, saltatePerStato, movimentiNellIntervallo: movimenti.length }
    })
  }
}
