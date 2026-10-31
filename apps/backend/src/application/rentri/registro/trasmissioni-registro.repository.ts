/**
 * Repository delle trasmissioni del registro a RENTRI (F2-9, D1, D10, D11, D14).
 *
 * GARANZIA CENTRALE: non si ritrasmette mai cio' che RENTRI potrebbe gia' avere.
 *  - Le righe `IN_INVIO`, `ATTESA_ESITO` e `INCERTA` non sono mai candidate a un nuovo lotto: la
 *    prenotazione legge solo `DA_TRASMETTERE` con `bloccato_invio = false` e, sotto lo stesso lock,
 *    rifiuta il registro che ha gia' un lotto in volo (`GIA_IN_CORSO`).
 *  - La prenotazione e' atomica: advisory lock di transazione per registro, quindi due giri
 *    concorrenti (job + clic) non prenotano mai la stessa annotazione.
 *  - Ogni UPDATE porta lo stato di partenza nel `WHERE`: una riga che nel frattempo ha cambiato
 *    stato non si tocca. Il trigger del database protegge in piu' `TRASMESSA`/`GIA_SU_RENTRI`.
 *  - Un esito incerto va in `INCERTA` (bloccata), mai in `RIFIUTATA`. `segnaRifiutate` vale solo
 *    per `IN_INVIO`: se la POST e' stata accettata (`ATTESA_ESITO`) una riga non diventa
 *    rifiutabile da qui, solo `applicaEsiti` con un esito letto.
 *
 * Tutti i metodi girano nel contesto dell'azienda (`TenantContext` + RLS) e hanno `tenantId`
 * esplicito nel `where`. Nessun corpo inviato viene salvato (D15): solo stati, id e messaggi di
 * validazione `{ campo, codice, tipo }`.
 */
import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { LoggerService } from '../../../core/logger/logger.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import type { EsitoPerRiga } from './esito-movimenti-rentri'
import type { CandidataLotto } from './selezione-lotto-rentri'

type Tx = Prisma.TransactionClient

export type EsitoPrenotazione =
  | { esito: 'PRENOTATO'; lottoId: string; movimentoIds: string[] }
  | { esito: 'GIA_IN_CORSO' | 'NIENTE' | 'SENZA_IDENTIFICATIVO' }

export interface PreparazioneLotto {
  /** Annotazioni scelte per il lotto, nell'ordine d'invio (sottoinsieme delle candidate). */
  lotto: string[]
  /** Annotazioni che non si sanno tradurre: `NON_TRASMISSIBILE` con i motivi in `ultimo_errore`. */
  nonTrasmissibili: Array<{ movimentoId: string; motivi: string[] }>
}

export const MOTIVO_INVIO_INCERTO =
  "Esito dell'invio sconosciuto: verificare prima di ritrasmettere"
const MOTIVO_TRASMESSA = 'Trasmessa a RENTRI'
const FORMATO_IDENTIFICATIVO_MOVIMENTO = /^M[0-9A-Z]{19}$/

const tronca = (testo: string, max: number) => (testo.length > max ? testo.slice(0, max) : testo)

@Injectable()
export class TrasmissioniRegistroRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('TrasmissioniRegistroRepository')
  }

  private nelTenant<R>(
    tenantId: string,
    fn: (tx: Tx) => Promise<R>,
    opzioni?: { timeout: number; maxWait: number }
  ): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn, opzioni))
  }

  /**
   * D10.1: prenotazione di un lotto sotto `pg_advisory_xact_lock` per registro.
   * `prepara` gira nella stessa transazione (puo' leggere e tradurre con `tx`); se lancia, tutto
   * torna indietro. Le `nonTrasmissibili` si registrano anche se il lotto resta vuoto.
   *
   * Il lock e' `pg_try_advisory_xact_lock`: chi perde NON aspetta e risponde subito `GIA_IN_CORSO`
   * (c'e' un altro giro che sta prenotando). La transazione ha un timeout esplicito di 15 s.
   * `prepara` (Task 8) traduce solo le prime `LOTTO_MASSIMO_RENTRI` candidate, non tutte.
   * Registro inesistente per l'azienda = `SENZA_IDENTIFICATIVO` (per il chiamante e' la stessa
   * cosa: non c'e' nulla da trasmettere; non si distingue per non rivelare l'esistenza altrui).
   */
  prenota(
    tenantId: string,
    registroId: string,
    prepara: (tx: Tx, candidate: CandidataLotto[]) => Promise<PreparazioneLotto>
  ): Promise<EsitoPrenotazione> {
    return this.nelTenant(
      tenantId,
      async (tx): Promise<EsitoPrenotazione> => {
        const [{ ottenuto }] = await tx.$queryRaw<Array<{ ottenuto: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${'rentri-registro|' + registroId})) AS ottenuto`
        if (!ottenuto) return { esito: 'GIA_IN_CORSO' }

        const registro = await tx.registroRifiuti.findFirst({
          where: { id: registroId, tenantId },
          select: { identificativoRentri: true },
        })
        if (!registro?.identificativoRentri) return { esito: 'SENZA_IDENTIFICATIVO' }

        const inCorso = await tx.movimentoTrasmissioneRentri.count({
          where: { tenantId, registroId, stato: { in: ['IN_INVIO', 'ATTESA_ESITO'] } },
        })
        if (inCorso > 0) return { esito: 'GIA_IN_CORSO' }

        const righe = await tx.movimentoTrasmissioneRentri.findMany({
          where: { tenantId, registroId, stato: 'DA_TRASMETTERE', bloccatoInvio: false },
          select: {
            movimentoId: true,
            movimento: {
              select: {
                progressiveYear: true,
                progressiveNumber: true,
                movimentoRettificatoId: true,
              },
            },
          },
        })
        if (righe.length === 0) return { esito: 'NIENTE' }

        const predecessoriIds = [
          ...new Set(
            righe
              .map(r => r.movimento.movimentoRettificatoId)
              .filter((id): id is string => id !== null)
          ),
        ]
        const statoPredecessori = new Map(
          (predecessoriIds.length
            ? await tx.movimentoTrasmissioneRentri.findMany({
                where: { tenantId, movimentoId: { in: predecessoriIds } },
                select: { movimentoId: true, stato: true },
              })
            : []
          ).map(p => [p.movimentoId, p.stato])
        )

        const candidate: CandidataLotto[] = righe
          .map(r => {
            const predecessoreId = r.movimento.movimentoRettificatoId
            return {
              movimentoId: r.movimentoId,
              numero: {
                anno: r.movimento.progressiveYear,
                progressivo: r.movimento.progressiveNumber,
              },
              predecessoreId,
              statoPredecessore:
                predecessoreId === null
                  ? null
                  : (statoPredecessori.get(predecessoreId) ?? ('NON_TRASMESSA' as const)),
            }
          })
          .sort(
            (a, b) => a.numero.anno - b.numero.anno || a.numero.progressivo - b.numero.progressivo
          )

        const { lotto, nonTrasmissibili } = await prepara(tx, candidate)

        const ammesse = new Set(candidate.map(c => c.movimentoId))
        const scelte = new Set(lotto)
        if (scelte.size !== lotto.length) {
          throw new Error('Lotto con annotazioni ripetute: errore di programmazione')
        }
        for (const id of [...lotto, ...nonTrasmissibili.map(x => x.movimentoId)]) {
          if (!ammesse.has(id)) {
            throw new Error('Annotazione non candidata alla trasmissione: errore di programmazione')
          }
        }
        for (const id of lotto) {
          if (nonTrasmissibili.some(x => x.movimentoId === id)) {
            throw new Error(
              'Annotazione sia nel lotto sia non trasmissibile: errore di programmazione'
            )
          }
        }

        for (const nt of nonTrasmissibili) {
          await tx.movimentoTrasmissioneRentri.updateMany({
            where: {
              tenantId,
              registroId,
              movimentoId: nt.movimentoId,
              stato: 'DA_TRASMETTERE',
              bloccatoInvio: false,
            },
            data: { stato: 'NON_TRASMISSIBILE', ultimoErrore: tronca(nt.motivi.join('; '), 1000) },
          })
        }
        if (lotto.length === 0) return { esito: 'NIENTE' }

        const lottoId = randomUUID()
        const prenotate = await tx.movimentoTrasmissioneRentri.updateMany({
          where: {
            tenantId,
            registroId,
            movimentoId: { in: lotto },
            stato: 'DA_TRASMETTERE',
            bloccatoInvio: false,
          },
          data: {
            stato: 'IN_INVIO',
            lottoId,
            prenotatoIl: new Date(),
            tentativi: { increment: 1 },
            ultimoErrore: null,
            // Una riga riaccodata (RIFIUTATA/NON_TRASMISSIBILE -> DA_TRASMETTERE) porta ancora la
            // transazione precedente, il cui esito e' definitivo: si azzera, altrimenti
            // `ripristinaPrenotazione` e `stalliInInvio` (WHERE transazione_id IS NULL) non la
            // toccherebbero piu' e il registro resterebbe bloccato per sempre.
            transazioneId: null,
          },
        })
        if (prenotate.count !== lotto.length) {
          // Sotto il lock non dovrebbe succedere: nel dubbio nulla viene prenotato.
          throw new Error('Prenotazione incompleta: errore di concorrenza inatteso')
        }
        return { esito: 'PRENOTATO', lottoId, movimentoIds: [...lotto] }
      },
      { timeout: 15000, maxWait: 5000 }
    )
  }

  /**
   * `IN_INVIO` -> `ATTESA_ESITO`, con la transazione salvata PRIMA del polling.
   * Se la POST e' durata piu' della soglia di stallo, `stalliInInvio` ha gia' portato le righe a
   * `INCERTA` senza transazione: qui la transazione si annota comunque su quelle righe (che
   * restano `INCERTA`, bloccate) e si ritorna `SU_INCERTA`, cosi' la verifica D11 la rilegge.
   * @returns `SALVATA` (ora ATTESA_ESITO) | `SU_INCERTA` (annotata, resta INCERTA)
   * @throws Error se nessuna riga del lotto e' in invio ne' incerta senza transazione
   */
  async salvaTransazione(
    tenantId: string,
    lottoId: string,
    transazioneId: string
  ): Promise<'SALVATA' | 'SU_INCERTA'> {
    return this.nelTenant(tenantId, async tx => {
      const r = await tx.movimentoTrasmissioneRentri.updateMany({
        where: { tenantId, lottoId, stato: 'IN_INVIO' },
        data: { stato: 'ATTESA_ESITO', transazioneId },
      })
      if (r.count > 0) return 'SALVATA'
      const incerte = await tx.movimentoTrasmissioneRentri.updateMany({
        where: { tenantId, lottoId, stato: 'INCERTA', transazioneId: null },
        data: { transazioneId },
      })
      if (incerte.count > 0) return 'SU_INCERTA'
      throw new Error('Nessuna annotazione in invio per il lotto: transazione non salvata')
    })
  }

  /**
   * Esito sconosciuto: `IN_INVIO`/`ATTESA_ESITO` -> `INCERTA`, bloccate. Per lotto (POST) o per
   * transazione (polling, stallo di 7 giorni). Ritorna le righe toccate.
   * `transazioneId` (opzionale, solo per chiave di lotto): annota la transazione RENTRI sulle righe
   * che non ne hanno ancora una (POST accettata ma `salvaTransazione` fallita), cosi' la verifica
   * D11 puo' rileggerla.
   */
  async segnaIncerte(
    tenantId: string,
    chiave: string | { transazioneId: string },
    motivo: string,
    transazioneId?: string
  ): Promise<number> {
    const selettore =
      typeof chiave === 'string' ? { lottoId: chiave } : { transazioneId: chiave.transazioneId }
    const dati = {
      stato: 'INCERTA' as const,
      bloccatoInvio: true,
      motivoBlocco: tronca(motivo, 500),
      ultimoErrore: tronca(motivo, 1000),
    }
    const stati: Array<'IN_INVIO' | 'ATTESA_ESITO'> = ['IN_INVIO', 'ATTESA_ESITO']
    return this.nelTenant(tenantId, async tx => {
      let totale = 0
      if (transazioneId && typeof chiave === 'string') {
        const senza = await tx.movimentoTrasmissioneRentri.updateMany({
          where: { tenantId, ...selettore, stato: { in: stati }, transazioneId: null },
          data: { ...dati, transazioneId },
        })
        totale += senza.count
      }
      const r = await tx.movimentoTrasmissioneRentri.updateMany({
        where: { tenantId, ...selettore, stato: { in: stati } },
        data: dati,
      })
      return totale + r.count
    })
  }

  /** POST respinta con certezza (400/403/404): solo `IN_INVIO` -> `RIFIUTATA`, riaccodabile. */
  async segnaRifiutate(tenantId: string, lottoId: string, errore: string): Promise<number> {
    const r = await this.nelTenant(tenantId, tx =>
      tx.movimentoTrasmissioneRentri.updateMany({
        where: { tenantId, lottoId, stato: 'IN_INVIO' },
        data: { stato: 'RIFIUTATA', bloccatoInvio: false, ultimoErrore: tronca(errore, 1000) },
      })
    )
    return r.count
  }

  /**
   * Applica un esito DECODIFICATO (`applicaEsito`) alle righe ancora `ATTESA_ESITO` della
   * transazione, in un'unica transazione di database. Una riga che nel frattempo ha cambiato stato
   * (es. verificata) non si tocca. Un identificativo fuori formato non blocca la riga: resta
   * `TRASMESSA` con identificativo null (la verifica D11 recupera poi l'identificativo dal numero).
   */
  async applicaEsiti(
    tenantId: string,
    transazioneId: string,
    esiti: EsitoPerRiga[]
  ): Promise<void> {
    await this.nelTenant(tenantId, tx => this.applicaEsitiInTx(tx, tenantId, transazioneId, esiti))
  }

  /**
   * Come {@link applicaEsiti} dentro la transazione del chiamante (la verifica D11 ci aggiunge
   * l'audit). `daStati` dice da quali stati si accetta l'esito: di norma solo `ATTESA_ESITO`; la
   * verifica ammette anche `INCERTA` (l'esito letto e' definitivo, quindi scioglie l'incertezza).
   */
  async applicaEsitiInTx(
    tx: Tx,
    tenantId: string,
    transazioneId: string,
    esiti: EsitoPerRiga[],
    daStati: Array<'ATTESA_ESITO' | 'INCERTA'> = ['ATTESA_ESITO']
  ): Promise<void> {
    const adesso = new Date()
    for (const e of esiti) {
      const messaggi = e.messaggi.map(m => ({ campo: m.campo, codice: m.codice, tipo: m.tipo }))
      const base = {
        tenantId,
        transazioneId,
        movimentoId: e.movimentoId,
        stato: { in: daStati },
      }
      if (e.stato === 'TRASMESSA') {
        if (e.identificativo && !FORMATO_IDENTIFICATIVO_MOVIMENTO.test(e.identificativo)) {
          this.logger.warn('Identificativo di movimento RENTRI fuori formato scartato', {
            movimentoId: e.movimentoId,
          })
        }
        await tx.movimentoTrasmissioneRentri.updateMany({
          where: base,
          data: {
            stato: 'TRASMESSA',
            bloccatoInvio: true,
            motivoBlocco: MOTIVO_TRASMESSA,
            identificativoRentri:
              e.identificativo && FORMATO_IDENTIFICATIVO_MOVIMENTO.test(e.identificativo)
                ? e.identificativo
                : null,
            trasmessoIl: adesso,
            ultimoErrore: null,
            messaggi,
          },
        })
      } else if (e.stato === 'INCERTA') {
        const motivo = tronca(e.motivo ?? MOTIVO_INVIO_INCERTO, 500)
        await tx.movimentoTrasmissioneRentri.updateMany({
          where: base,
          data: {
            stato: 'INCERTA',
            bloccatoInvio: true,
            motivoBlocco: motivo,
            ultimoErrore: motivo,
            messaggi,
          },
        })
      } else {
        await tx.movimentoTrasmissioneRentri.updateMany({
          where: base,
          data: {
            stato: 'RIFIUTATA',
            bloccatoInvio: false,
            motivoBlocco: null,
            ultimoErrore: tronca(e.motivo ?? 'Rifiutata da RENTRI', 1000),
            messaggi,
          },
        })
      }
    }
  }

  /**
   * Righe della transazione, nell'ordine d'invio ((anno, progressivo): lo stesso con cui si compone
   * il payload), per rileggere l'esito in `riprendiAttese`. Comprende ogni stato: l'indice dei
   * messaggi di RENTRI si riferisce alla posizione nel lotto originale.
   */
  async righeDellaTransazione(
    tenantId: string,
    transazioneId: string
  ): Promise<Array<{ movimentoId: string; numero: { anno: number; progressivo: number } }>> {
    const righe = await this.nelTenant(tenantId, tx =>
      tx.movimentoTrasmissioneRentri.findMany({
        where: { tenantId, transazioneId },
        select: {
          movimentoId: true,
          movimento: { select: { progressiveYear: true, progressiveNumber: true } },
        },
      })
    )
    return righe
      .map(r => ({
        movimentoId: r.movimentoId,
        numero: { anno: r.movimento.progressiveYear, progressivo: r.movimento.progressiveNumber },
      }))
      .sort((a, b) => a.numero.anno - b.numero.anno || a.numero.progressivo - b.numero.progressivo)
  }

  /** Errore tecnico nel polling: la riga RESTA `ATTESA_ESITO`, si annota solo l'errore. */
  async annotaErrorePolling(
    tenantId: string,
    transazioneId: string,
    errore: string
  ): Promise<void> {
    await this.nelTenant(tenantId, tx =>
      tx.movimentoTrasmissioneRentri.updateMany({
        where: { tenantId, transazioneId, stato: 'ATTESA_ESITO' },
        data: { ultimoErrore: tronca(errore, 1000) },
      })
    )
  }

  /**
   * Annulla la prenotazione: `IN_INVIO` -> `DA_TRASMETTERE`.
   *
   * VINCOLO PER IL CHIAMANTE (Task 8): va chiamato SOLO sul ramo `TenantSenzaCertificatoRentriError`
   * (o un altro errore lanciato con certezza PRIMA di qualunque I/O di rete). MAI in un `catch`
   * generico, e MAI dopo 429/423 esauriti a meno che il client garantisca che nessuna richiesta sia
   * stata accettata: nel dubbio si usa `segnaIncerte`. Ripristinare dopo una POST forse partita
   * significa ritrasmettere cio' che RENTRI puo' gia' avere.
   */
  async ripristinaPrenotazione(tenantId: string, lottoId: string): Promise<void> {
    await this.nelTenant(tenantId, tx =>
      tx.movimentoTrasmissioneRentri.updateMany({
        where: { tenantId, lottoId, stato: 'IN_INVIO', transazioneId: null },
        data: {
          stato: 'DA_TRASMETTERE',
          lottoId: null,
          prenotatoIl: null,
          tentativi: { decrement: 1 },
        },
      })
    )
  }

  /** `IN_INVIO` prenotata prima di `prima` e senza transazione: la POST e' forse partita -> `INCERTA`. */
  async stalliInInvio(tenantId: string, prima: Date): Promise<number> {
    const r = await this.nelTenant(tenantId, tx =>
      tx.movimentoTrasmissioneRentri.updateMany({
        where: { tenantId, stato: 'IN_INVIO', transazioneId: null, prenotatoIl: { lt: prima } },
        data: {
          stato: 'INCERTA',
          bloccatoInvio: true,
          motivoBlocco: MOTIVO_INVIO_INCERTO,
          ultimoErrore: MOTIVO_INVIO_INCERTO,
        },
      })
    )
    return r.count
  }

  /** Transazioni con esito da leggere (una per transazione), con la data di prenotazione piu' vecchia. */
  async transazioniInAttesa(
    tenantId: string
  ): Promise<Array<{ transazioneId: string; registroId: string; dal: Date }>> {
    const gruppi = await this.nelTenant(tenantId, tx =>
      tx.movimentoTrasmissioneRentri.groupBy({
        by: ['transazioneId', 'registroId'],
        where: { tenantId, stato: 'ATTESA_ESITO', transazioneId: { not: null } },
        _min: { prenotatoIl: true, updatedAt: true },
      })
    )
    return gruppi.map(g => ({
      transazioneId: g.transazioneId as string,
      registroId: g.registroId,
      dal: (g._min.prenotatoIl ?? g._min.updatedAt) as Date,
    }))
  }

  /**
   * D3: adotta i movimenti SENZA riga creati da `invio_rentri_automatico_dal` in poi (registro
   * senza data: nessuno). Una correzione si adotta qui solo se anche il suo predecessore e' nato
   * dopo la data; le altre le gestisce `adottaCorrezioni`. Ordine (anno, progressivo), al piu' `limite`.
   */
  async adottaAutomatiche(tenantId: string, limite: number): Promise<number> {
    return this.nelTenant(
      tenantId,
      tx =>
        tx.$executeRaw`
        INSERT INTO "movimenti_trasmissione_rentri"
          ("tenant_id", "movimento_id", "registro_id", "tipo", "origine", "updated_at")
        SELECT m."tenant_id", m."id", m."registro_id", m."type", 'AUTOMATICA', now()
        FROM "waste_movements" m
        JOIN "registri_rifiuti" r ON r."id" = m."registro_id" AND r."tenant_id" = m."tenant_id"
        LEFT JOIN "waste_movements" p
          ON p."id" = m."movimento_rettificato_id" AND p."tenant_id" = m."tenant_id"
        WHERE m."tenant_id" = ${tenantId}::uuid
          AND r."invio_rentri_automatico_dal" IS NOT NULL
          AND m."created_at" >= r."invio_rentri_automatico_dal"
          AND (m."movimento_rettificato_id" IS NULL
               OR p."created_at" >= r."invio_rentri_automatico_dal")
          AND NOT EXISTS (
            SELECT 1 FROM "movimenti_trasmissione_rentri" t WHERE t."movimento_id" = m."id" AND t."tenant_id" = m."tenant_id")
        ORDER BY m."progressive_year", m."progressive_number"
        LIMIT ${limite}
        ON CONFLICT ("movimento_id") DO NOTHING`
    )
  }

  /**
   * D7: adotta le correzioni SENZA riga il cui predecessore e' `TRASMESSA` o `GIA_SU_RENTRI`
   * (origine `CORREZIONE`). Quelle di un predecessore rifiutato o mai trasmesso non partono.
   */
  async adottaCorrezioni(tenantId: string, limite: number): Promise<number> {
    return this.nelTenant(
      tenantId,
      tx =>
        tx.$executeRaw`
        INSERT INTO "movimenti_trasmissione_rentri"
          ("tenant_id", "movimento_id", "registro_id", "tipo", "origine", "updated_at")
        SELECT m."tenant_id", m."id", m."registro_id", m."type", 'CORREZIONE', now()
        FROM "waste_movements" m
        JOIN "movimenti_trasmissione_rentri" p
          ON p."movimento_id" = m."movimento_rettificato_id" AND p."tenant_id" = m."tenant_id"
        WHERE m."tenant_id" = ${tenantId}::uuid
          AND m."movimento_rettificato_id" IS NOT NULL
          AND p."stato" IN ('TRASMESSA', 'GIA_SU_RENTRI')
          AND NOT EXISTS (
            SELECT 1 FROM "movimenti_trasmissione_rentri" t WHERE t."movimento_id" = m."id" AND t."tenant_id" = m."tenant_id")
        ORDER BY m."progressive_year", m."progressive_number"
        LIMIT ${limite}
        ON CONFLICT ("movimento_id") DO NOTHING`
    )
  }
}
