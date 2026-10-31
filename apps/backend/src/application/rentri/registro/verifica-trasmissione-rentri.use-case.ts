/**
 * Verifica di un'annotazione incerta (F2-9, D11).
 *
 * REGOLA CHIAVE: dall'incertezza si esce solo con una risposta DEFINITIVA di RENTRI.
 *  1. Con `transazione_id` si rilegge prima l'esito della transazione: se e' decodificato lo si
 *     applica a tutte le righe incerte di quella transazione (TRASMESSA o RIFIUTATA).
 *  2. Altrimenti (o se RENTRI non conosce la transazione) si cerca il numero (anno, progressivo)
 *     sul registro: trovata e uguale -> `TRASMESSA` con l'identificativo; trovata ma diversa ->
 *     resta `INCERTA` col motivo (il numero e' occupato da un'altra registrazione, mai
 *     sovrascritta); 404 del dettaglio -> `DA_TRASMETTERE` e sbloccata.
 *  3. Qualsiasi errore tecnico (5xx, timeout, 429/423 esauriti, certificato, sconosciuto) lascia
 *     la riga com'e': mai `DA_TRASMETTERE`. Gli errori si riconoscono per tipo/status, mai per testo.
 * Con una transazione ancora in elaborazione la lettura fallisce: la riga resta com'e' e il 404 del
 * numero NON si usa (RENTRI potrebbe non averla ancora registrata).
 *
 * Una `TRASMESSA` con identificativo nullo (scartato perche' fuori formato) si puo' verificare per
 * recuperare l'identificativo dal numero: lo stato non cambia mai.
 *
 * Nessuna chiamata a RENTRI dentro una transazione di database. Audit nella stessa transazione
 * della modifica, senza dati personali.
 */
import { Inject, Injectable, Optional } from '@nestjs/common'
import type { Prisma, StatoTrasmissioneRentri } from '@prisma/client'
import { LoggerService } from '../../../core/logger/logger.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import { TransazioneRentriNonTrovataError } from '../../../infrastructure/rentri/rentri-api.client'
import {
  RentriRegistriClient,
  type MovimentoDettaglioModel,
} from '../../../infrastructure/rentri/rentri-registri.client'
import { confrontaConRentri } from './confronto-registrazione-rentri'
import {
  MovimentoNonTrovatoError,
  TrasmissioneNonModificabileError,
} from './errori-azioni-rentri-registro'
import { applicaEsitoDettagliato } from './esito-movimenti-rentri'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import {
  traduciAnnotazione,
  type AnnotazionePerRentri,
  type EsitoTraduzione,
} from './mappa-registrazione-rentri'
import { NumeroDuplicatoNelLottoError } from './selezione-lotto-rentri'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'
import { TRADUTTORE_REGISTRAZIONE_RENTRI } from './trasmetti-lotto-registro.use-case'

type Tx = Prisma.TransactionClient
type Traduttore = (a: AnnotazionePerRentri) => EsitoTraduzione

export const MOTIVO_NUMERO_OCCUPATO =
  "Il numero è occupato su RENTRI da un'altra registrazione: controllare il portale"
const MOTIVO_NON_CONFRONTABILE =
  "Il numero è presente su RENTRI ma l'annotazione non si può confrontare: controllare il portale"
/**
 * Eta' minima dell'ultimo tentativo di invio perche' "RENTRI non ha il numero" valga come assenza
 * DEFINITIVA e l'annotazione possa tornare in coda. 6 ore: 24 volte la soglia di stallo della POST
 * (15 minuti), cioe' molto piu' del tempo in cui una transazione accettata ma ancora in elaborazione
 * puo' non avere ancora registrato il numero; abbastanza corta da non lasciare l'utente bloccato
 * oltre il turno di lavoro. Sempre >= SOGLIA_STALLO_RENTRI_MS (verificato dai test).
 */
export const ETA_MINIMA_ASSENZA_DEFINITIVA_MS = 6 * 60 * 60 * 1000
const MOTIVO_TROPPO_RECENTE =
  "L'ultimo invio è troppo recente per escludere che RENTRI stia ancora elaborando: riprovare più tardi."
const MOTIVO_REGISTRO_SCONOSCIUTO =
  'Identificativo del registro non trovato su RENTRI: controllarlo.'
const MOTIVO_TROVATO_SENZA_NUMERO =
  'RENTRI dà risposte non coerenti su questo numero: controllare il portale.'
const MOTIVO_TRASMESSA_VERIFICATA = 'Trasmessa a RENTRI (verificata)'

export interface EsitoVerifica {
  esito:
    | 'TRASMESSA'
    | 'RIFIUTATA'
    | 'DA_TRASMETTERE'
    | 'DIVERSA'
    | 'IDENTIFICATIVO_RECUPERATO'
    | 'NON_VERIFICABILE'
  /** Stato della riga dopo la verifica. */
  stato: StatoTrasmissioneRentri
  /** Frase per l'utente, senza id ne' dati fiscali. */
  messaggio: string
}

const STATI_VERIFICABILI: StatoTrasmissioneRentri[] = ['INCERTA', 'ATTESA_ESITO']

@Injectable()
export class VerificaTrasmissioneRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: TrasmissioniRegistroRepository,
    private readonly lettore: LettoreAnnotazioniRentri,
    private readonly client: RentriRegistriClient,
    private readonly logger: LoggerService,
    // Solo per i test: in produzione resta `traduciAnnotazione`.
    @Optional()
    @Inject(TRADUTTORE_REGISTRAZIONE_RENTRI)
    private readonly traduci: Traduttore = traduciAnnotazione
  ) {
    this.logger.setContext('VerificaTrasmissioneRentriUseCase')
  }

  private nelTenant<R>(tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
    return TenantContext.run({ tenantId }, async () => await this.prisma.$transaction(fn))
  }

  /**
   * @throws MovimentoNonTrovatoError (404) se non c'e' una riga per questa azienda
   * @throws TrasmissioneNonModificabileError (409) se la riga non e' incerta ne' in attesa (e non e'
   *   una TRASMESSA senza identificativo): nessuna chiamata a RENTRI
   */
  async verifica(tenantId: string, utenteId: string, movimentoId: string): Promise<EsitoVerifica> {
    const riga = await this.nelTenant(tenantId, async tx => {
      const r = await tx.movimentoTrasmissioneRentri.findFirst({
        where: { tenantId, movimentoId },
        select: {
          id: true,
          stato: true,
          registroId: true,
          transazioneId: true,
          identificativoRentri: true,
          prenotatoIl: true,
          updatedAt: true,
          movimento: { select: { progressiveYear: true, progressiveNumber: true } },
        },
      })
      if (!r) return null
      const registro = await tx.registroRifiuti.findFirst({
        where: { id: r.registroId, tenantId },
        select: { identificativoRentri: true },
      })
      return { ...r, identificativoRegistro: registro?.identificativoRentri ?? null }
    })
    if (!riga) throw new MovimentoNonTrovatoError()

    const recuperoIdentificativo = riga.stato === 'TRASMESSA' && riga.identificativoRentri === null
    if (!STATI_VERIFICABILI.includes(riga.stato) && !recuperoIdentificativo) {
      throw new TrasmissioneNonModificabileError(
        'Si possono verificare solo le annotazioni con esito incerto o in attesa.'
      )
    }

    const nonVerificabile = (messaggio: string): EsitoVerifica => ({
      esito: 'NON_VERIFICABILE',
      stato: riga.stato,
      messaggio,
    })

    // 1. Con la transazione: l'esito si rilegge prima del numero.
    if (riga.transazioneId && !recuperoIdentificativo) {
      let esito
      try {
        esito = await this.client.attendiEsitoMovimenti(riga.transazioneId, tenantId, {
          maxTentativi: 1,
        })
      } catch (errore) {
        if (!(errore instanceof TransazioneRentriNonTrovataError)) {
          this.logger.warn("Lettura dell'esito in verifica non riuscita: riga invariata", {
            tipo: errore instanceof Error ? errore.name : 'sconosciuto',
          })
          return nonVerificabile(
            "RENTRI non ha ancora un esito leggibile (o non risponde): riprovare piu' tardi."
          )
        }
        esito = null
      }
      if (esito) {
        const lotto = await this.repo.righeDellaTransazione(tenantId, riga.transazioneId)
        let righe
        try {
          righe = applicaEsitoDettagliato(lotto, esito).righe
        } catch (errore) {
          if (errore instanceof NumeroDuplicatoNelLottoError) {
            return nonVerificabile(
              'Esito di RENTRI non attribuibile alle annotazioni: controllare il portale.'
            )
          }
          throw errore
        }
        const transazioneId = riga.transazioneId
        const esitoTx = await this.nelTenant(
          tenantId,
          async (tx): Promise<EsitoVerifica | null> => {
            await this.repo.applicaEsitiInTx(
              tx,
              tenantId,
              transazioneId,
              righe,
              STATI_VERIFICABILI as Array<'ATTESA_ESITO' | 'INCERTA'>
            )
            const dopo = await tx.movimentoTrasmissioneRentri.findFirstOrThrow({
              where: { id: riga.id, tenantId },
              select: { stato: true },
            })
            // INCERTA (esito senza conferma ne' rifiuto): niente da annunciare, si prosegue per numero.
            if (dopo.stato !== 'INCERTA' || riga.stato !== 'INCERTA') {
              await this.audit(
                tx,
                tenantId,
                utenteId,
                movimentoId,
                riga.stato,
                dopo.stato,
                'TRANSAZIONE'
              )
            }
            if (dopo.stato === 'TRASMESSA') {
              return {
                esito: 'TRASMESSA' as const,
                stato: dopo.stato,
                messaggio: 'RENTRI ha confermato la trasmissione.',
              }
            }
            if (dopo.stato === 'RIFIUTATA') {
              return {
                esito: 'RIFIUTATA' as const,
                stato: dopo.stato,
                messaggio:
                  "RENTRI ha risposto che l'annotazione non è stata registrata: si può riaccodare.",
              }
            }
            if (dopo.stato === 'INCERTA') return null
            return nonVerificabile("L'esito non ha cambiato lo stato dell'annotazione.")
          }
        )
        if (esitoTx) return esitoTx
        // La riga e' stata aggiornata dall'esito: si ricarica lo stato per i controlli del passo 2.
        await this.ricarica(tenantId, riga)
      }
    }

    // 1bis. Senza transazione annotata: la POST puo' essere partita (transazione "orfana") senza che il
    // transazione_id sia stato salvato. L'ultima transazione del registro si rilegge PRIMA di cercare per numero.
    if (!riga.transazioneId && !recuperoIdentificativo && riga.identificativoRegistro) {
      const orfana = await this.verificaTransazioneOrfana(tenantId, utenteId, movimentoId, riga)
      if (orfana) return orfana
    }

    // 2. Per numero (anno, progressivo).
    if (!riga.identificativoRegistro) {
      return nonVerificabile(
        'Il registro non ha un identificativo RENTRI: impostarlo prima di verificare.'
      )
    }
    let dettaglio: MovimentoDettaglioModel | null
    let assenzaDefinitiva = false
    try {
      dettaglio = await this.client.dettaglioMovimentoPerAnnoProgressivo(
        riga.identificativoRegistro,
        riga.movimento.progressiveYear,
        riga.movimento.progressiveNumber,
        { variazioni: false },
        tenantId
      )
    } catch (errore) {
      if (errore instanceof RentriApiError && errore.status === 404 && !errore.retryable) {
        dettaglio = null
        // Un 404 del dettaglio non basta (vale anche per un registro sbagliato, o per un numero non
        // ancora registrato): serve anche che il registro risponda "zero" su quel numero e che
        // l'ultimo invio sia abbastanza vecchio.
        if (!recuperoIdentificativo) {
          const ultimo = riga.prenotatoIl ?? riga.updatedAt
          if (Date.now() - ultimo.getTime() < ETA_MINIMA_ASSENZA_DEFINITIVA_MS) {
            return nonVerificabile(MOTIVO_TROPPO_RECENTE)
          }
          try {
            const quanti = await this.client.contaMovimenti(
              riga.identificativoRegistro,
              {
                anno: riga.movimento.progressiveYear,
                progressivo: riga.movimento.progressiveNumber,
              },
              tenantId
            )
            if (!Number.isInteger(quanti) || quanti < 0) {
              return nonVerificabile(
                "RENTRI non ha dato una risposta definitiva: riprovare piu' tardi."
              )
            }
            if (quanti > 0) return nonVerificabile(MOTIVO_TROVATO_SENZA_NUMERO)
            assenzaDefinitiva = true
          } catch (e) {
            if (e instanceof RentriApiError && e.status === 404 && !e.retryable) {
              return nonVerificabile(MOTIVO_REGISTRO_SCONOSCIUTO)
            }
            this.logger.warn('Conteggio per numero su RENTRI non riuscito: riga invariata', {
              tipo: e instanceof Error ? e.name : 'sconosciuto',
            })
            return nonVerificabile(
              "RENTRI non ha dato una risposta definitiva: riprovare piu' tardi."
            )
          }
        }
      } else {
        this.logger.warn('Ricerca per numero su RENTRI non riuscita: riga invariata', {
          tipo: errore instanceof Error ? errore.name : 'sconosciuto',
          status: errore instanceof RentriApiError ? errore.status : undefined,
        })
        return nonVerificabile("RENTRI non ha dato una risposta definitiva: riprovare piu' tardi.")
      }
    }

    const via = riga.transazioneId ? 'TRANSAZIONE_SCONOSCIUTA' : 'NUMERO'
    return this.nelTenant(tenantId, async tx => {
      const adesso = await tx.movimentoTrasmissioneRentri.findFirst({
        where: { id: riga.id, tenantId },
        select: { stato: true, identificativoRentri: true, updatedAt: true },
      })
      // La riga e' cambiata mentre si chiamava RENTRI: non si decide su dati vecchi.
      if (
        !adesso ||
        adesso.stato !== riga.stato ||
        adesso.identificativoRentri !== riga.identificativoRentri ||
        adesso.updatedAt.getTime() !== riga.updatedAt.getTime()
      ) {
        return nonVerificabile("L'annotazione è cambiata nel frattempo: rieseguire la verifica.")
      }

      if (dettaglio === null) {
        if (recuperoIdentificativo || !assenzaDefinitiva) {
          return nonVerificabile('Annotazione non trovata su RENTRI: controllare il portale.')
        }
        const r = await tx.movimentoTrasmissioneRentri.updateMany({
          where: {
            id: riga.id,
            tenantId,
            stato: { in: STATI_VERIFICABILI },
            updatedAt: riga.updatedAt,
          },
          data: {
            stato: 'DA_TRASMETTERE',
            bloccatoInvio: false,
            motivoBlocco: null,
            ultimoErrore: null,
          },
        })
        if (r.count !== 1)
          return nonVerificabile("L'annotazione è cambiata nel frattempo: rieseguire la verifica.")
        await this.audit(tx, tenantId, utenteId, movimentoId, riga.stato, 'DA_TRASMETTERE', via)
        return {
          esito: 'DA_TRASMETTERE',
          stato: 'DA_TRASMETTERE',
          messaggio: 'RENTRI non ha questa annotazione: è tornata in coda e si può trasmettere.',
        }
      }

      const [annotazione] = await this.lettore.leggi(tx, tenantId, riga.registroId, [movimentoId])
      const tradotta = annotazione ? this.traduci(annotazione) : null
      const confronto =
        annotazione && tradotta?.ok
          ? confrontaConRentri(tradotta.corpo, annotazione.tipoAnnotazione, dettaglio)
          : { uguale: false, identificativo: null, nonConfrontabile: true as const }

      if (recuperoIdentificativo) {
        if (confronto.uguale && confronto.identificativo) {
          const r = await tx.movimentoTrasmissioneRentri.updateMany({
            where: {
              id: riga.id,
              tenantId,
              stato: 'TRASMESSA',
              identificativoRentri: null,
              updatedAt: riga.updatedAt,
            },
            data: { identificativoRentri: confronto.identificativo },
          })
          if (r.count === 1) {
            await this.audit(
              tx,
              tenantId,
              utenteId,
              movimentoId,
              'TRASMESSA',
              'TRASMESSA',
              'NUMERO'
            )
            return {
              esito: 'IDENTIFICATIVO_RECUPERATO',
              stato: 'TRASMESSA',
              messaggio: "Identificativo RENTRI recuperato dall'annotazione trasmessa.",
            }
          }
        }
        return nonVerificabile(
          "Non è stato possibile recuperare l'identificativo: controllare il portale."
        )
      }

      if (confronto.uguale) {
        const r = await tx.movimentoTrasmissioneRentri.updateMany({
          where: {
            id: riga.id,
            tenantId,
            stato: { in: STATI_VERIFICABILI },
            updatedAt: riga.updatedAt,
          },
          data: {
            stato: 'TRASMESSA',
            bloccatoInvio: true,
            motivoBlocco: MOTIVO_TRASMESSA_VERIFICATA,
            identificativoRentri: confronto.identificativo,
            trasmessoIl: new Date(),
            ultimoErrore: null,
          },
        })
        if (r.count !== 1)
          return nonVerificabile("L'annotazione è cambiata nel frattempo: rieseguire la verifica.")
        await this.audit(tx, tenantId, utenteId, movimentoId, riga.stato, 'TRASMESSA', via)
        return {
          esito: 'TRASMESSA',
          stato: 'TRASMESSA',
          messaggio: 'RENTRI ha già questa annotazione: risulta trasmessa.',
        }
      }

      // Trovata ma diversa (o non confrontabile): resta bloccata, mai sovrascritta.
      const motivo =
        tradotta?.ok && !confronto.nonConfrontabile
          ? MOTIVO_NUMERO_OCCUPATO
          : MOTIVO_NON_CONFRONTABILE
      await tx.movimentoTrasmissioneRentri.updateMany({
        where: {
          id: riga.id,
          tenantId,
          stato: { in: STATI_VERIFICABILI },
          updatedAt: riga.updatedAt,
        },
        data: { stato: 'INCERTA', bloccatoInvio: true, motivoBlocco: motivo, ultimoErrore: motivo },
      })
      await this.audit(tx, tenantId, utenteId, movimentoId, riga.stato, 'INCERTA', via)
      return { esito: 'DIVERSA', stato: 'INCERTA', messaggio: motivo }
    })
  }

  /**
   * Rilegge l'esito dell'ultima transazione del registro quando la riga non ha un `transazione_id`.
   * Se la transazione conferma il numero se ne annota SOLO l'id sulla riga (puo' essere di un altro
   * programma sullo stesso registro: conferma il numero, non il contenuto) e si ritorna `null`: il
   * chiamante prosegue SEMPRE col confronto per numero. Ritorna un esito solo per `NON_VERIFICABILE`
   * (lettura non definitiva, riga cambiata). Una transazione gia' nota ad altre righe non e' orfana;
   * un esito definitivo che non cita il numero non rifiuta nulla (potrebbe non essere la nostra).
   */
  private async verificaTransazioneOrfana(
    tenantId: string,
    utenteId: string,
    movimentoId: string,
    riga: {
      id: string
      stato: StatoTrasmissioneRentri
      transazioneId: string | null
      identificativoRentri: string | null
      identificativoRegistro: string | null
      updatedAt: Date
      movimento: { progressiveYear: number; progressiveNumber: number }
    }
  ): Promise<EsitoVerifica | null> {
    const piuTardi = (): EsitoVerifica => ({
      esito: 'NON_VERIFICABILE',
      stato: riga.stato,
      messaggio: "RENTRI non ha ancora un esito leggibile (o non risponde): riprovare piu' tardi.",
    })
    let ultima: string | null
    try {
      ultima = await this.client.ultimaTransazioneId(
        riga.identificativoRegistro as string,
        tenantId
      )
    } catch (errore) {
      this.logger.warn("Lettura dell'ultima transazione RENTRI non riuscita: riga invariata", {
        tipo: errore instanceof Error ? errore.name : 'sconosciuto',
      })
      return piuTardi()
    }
    if (!ultima) return null
    const note = await this.repo.righeDellaTransazione(tenantId, ultima)
    if (note.length > 0) return null

    let esito
    try {
      esito = await this.client.attendiEsitoMovimenti(ultima, tenantId, { maxTentativi: 1 })
    } catch (errore) {
      if (errore instanceof TransazioneRentriNonTrovataError) return null
      this.logger.warn("Lettura dell'esito dell'ultima transazione non riuscita: riga invariata", {
        tipo: errore instanceof Error ? errore.name : 'sconosciuto',
      })
      return piuTardi()
    }
    const numero = {
      anno: riga.movimento.progressiveYear,
      progressivo: riga.movimento.progressiveNumber,
    }
    const [mia] = applicaEsitoDettagliato([{ movimentoId, numero }], esito).righe
    if (mia.stato !== 'TRASMESSA') return null

    // L'ultima transazione puo' essere di un altro programma sullo stesso registro: conferma il numero,
    // non il contenuto. Si annota solo il transazione_id e si prosegue SEMPRE col confronto per numero.
    const annotata = await this.nelTenant(tenantId, async tx => {
      const r = await tx.movimentoTrasmissioneRentri.updateMany({
        where: {
          id: riga.id,
          tenantId,
          stato: { in: STATI_VERIFICABILI },
          transazioneId: null,
          updatedAt: riga.updatedAt,
        },
        data: { transazioneId: ultima },
      })
      return r.count === 1
    })
    if (!annotata) {
      return {
        esito: 'NON_VERIFICABILE',
        stato: riga.stato,
        messaggio: "L'annotazione è cambiata nel frattempo: rieseguire la verifica.",
      }
    }
    await this.ricarica(tenantId, riga)
    return null
  }

  /** Rilegge dal database i campi della riga che i controlli del passo 2 confrontano. */
  private async ricarica(
    tenantId: string,
    riga: {
      id: string
      stato: StatoTrasmissioneRentri
      transazioneId: string | null
      identificativoRentri: string | null
      updatedAt: Date
    }
  ): Promise<void> {
    const adesso = await this.nelTenant(tenantId, tx =>
      tx.movimentoTrasmissioneRentri.findFirst({
        where: { id: riga.id, tenantId },
        select: { stato: true, transazioneId: true, identificativoRentri: true, updatedAt: true },
      })
    )
    if (adesso) Object.assign(riga, adesso)
  }

  private async audit(
    tx: Tx,
    tenantId: string,
    utenteId: string,
    movimentoId: string,
    statoPrima: StatoTrasmissioneRentri,
    statoDopo: StatoTrasmissioneRentri,
    via: string
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action: 'RENTRI_REGISTRO_VERIFICATA',
        description: `Verifica con RENTRI di un'annotazione incerta: da ${statoPrima} a ${statoDopo}`,
        metadata: { movimentoId, statoPrima, statoDopo, via },
      },
    })
  }
}
