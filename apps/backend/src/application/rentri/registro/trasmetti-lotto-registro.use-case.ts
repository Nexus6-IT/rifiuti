/**
 * Ciclo d'invio del registro a RENTRI e ripresa degli esiti (F2-9, D10).
 *
 * REGOLA CHIAVE: non si ritrasmette mai cio' che RENTRI potrebbe gia' avere.
 *  - `ripristinaPrenotazione` SOLO quando la POST certamente non e' partita
 *    (`TenantSenzaCertificatoRentriError` lanciato da `inviaMovimenti`, prima di ogni I/O di rete).
 *  - Ogni altro errore dopo la prenotazione e' `INCERTA` (5xx, timeout, 429/423 esauriti, errore
 *    sconosciuto) oppure, per 400/403/404 della POST, `RIFIUTATA` (RENTRI ha risposto che non ha
 *    registrato nulla). Gli errori si riconoscono per tipo/`causa`/`status`, mai per testo.
 *  - `applicaEsiti` riceve solo un esito DECODIFICATO e definitivo. Transazione non trovata,
 *    errori tecnici di lettura, timeout: mai `RIFIUTATA`.
 *  - La transazione si salva PRIMA del polling; se la riga e' gia' `INCERTA` (stallo durante la
 *    POST) la verifica D11 la rilegge, qui non si fa polling.
 * Il corpo inviato non si salva e non si logga (D15): i log hanno solo conteggi e stati.
 */
import { Inject, Injectable, Optional } from '@nestjs/common'
import { LoggerService } from '../../../core/logger/logger.service'
import { TenantSenzaCertificatoRentriError } from '../../../infrastructure/rentri/rentri-credential.resolver'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import {
  TransazioneRentriNonTrovataError,
  TrasmissioneRentriIncertaError,
} from '../../../infrastructure/rentri/rentri-api.client'
import { RentriRegistriClient } from '../../../infrastructure/rentri/rentri-registri.client'
import { applicaEsitoDettagliato, type EsitoPerRiga } from './esito-movimenti-rentri'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import {
  traduciAnnotazione,
  type EsitoTraduzione,
  type AnnotazionePerRentri,
  type NumeroRegistrazione,
} from './mappa-registrazione-rentri'
import {
  LOTTO_MASSIMO_RENTRI,
  NumeroDuplicatoNelLottoError,
  selezionaLotto,
} from './selezione-lotto-rentri'
import {
  MOTIVO_INVIO_INCERTO,
  TrasmissioniRegistroRepository,
} from './trasmissioni-registro.repository'

/** Una transazione senza esito dopo 7 giorni diventa `INCERTA` (D10.4). */
export const ETA_MASSIMA_ATTESA_ESITO_MS = 7 * 24 * 60 * 60 * 1000

/** Tentativi di polling per transazione nella ripresa (il giro e' periodico: si riprova dopo). */
const TENTATIVI_POLLING_RIPRESA = 3

const MOTIVO_TRANSAZIONE_SCONOSCIUTA =
  'RENTRI non conosce la transazione: verificare prima di ritrasmettere'
const MOTIVO_ATTESA_SCADUTA =
  'Nessun esito da RENTRI dopo 7 giorni: verificare prima di ritrasmettere'
const MOTIVO_ESITO_AMBIGUO =
  'Esito di RENTRI non attribuibile alle annotazioni: verificare prima di ritrasmettere'
const MOTIVO_REGISTRO_NON_TROVATO = "Registro non trovato su RENTRI: controllare l'identificativo"

export interface EsitoGiroRegistro {
  esito:
    | 'NIENTE'
    | 'GIA_IN_CORSO'
    | 'SENZA_IDENTIFICATIVO'
    | 'SENZA_CERTIFICATO'
    | 'INVIATO'
    | 'INCERTO'
    | 'RIFIUTATO'
  trasmesse: number
  rifiutate: number
  nonTrasmissibili: number
  /** Candidate rimaste fuori dal lotto (correzioni in attesa del predecessore, oltre il massimo). */
  inAttesa: number
  /** Righe del lotto ancora in `ATTESA_ESITO`: il polling non ha chiuso, le riprende `riprendiAttese`. */
  attesaEsito: number
}

/** Token di iniezione del traduttore (solo per i test: in produzione resta `traduciAnnotazione`). */
export const TRADUTTORE_REGISTRAZIONE_RENTRI = 'TRADUTTORE_REGISTRAZIONE_RENTRI'

/** Il dettaglio di un problema RENTRI puo' riportare valori inviati: si mascherano CF e P.IVA. */
function dettaglioSicuro(dettaglio: string | undefined): string | null {
  const t = dettaglio
    ?.replace(/\b[A-Z0-9]{16}\b/gi, '***')
    .replace(/\b\d{11}\b/g, '***')
    .trim()
  return t ? t.slice(0, 300) : null
}

type Traduttore = (a: AnnotazionePerRentri) => EsitoTraduzione

interface Preparata {
  movimentoId: string
  numero: NumeroRegistrazione
  corpo: Record<string, unknown>
}

@Injectable()
export class TrasmettiLottoRegistroUseCase {
  constructor(
    private readonly repo: TrasmissioniRegistroRepository,
    private readonly lettore: LettoreAnnotazioniRentri,
    private readonly client: RentriRegistriClient,
    private readonly logger: LoggerService,
    // Solo per i test: in produzione resta `traduciAnnotazione`.
    @Optional()
    @Inject(TRADUTTORE_REGISTRAZIONE_RENTRI)
    private readonly traduci: Traduttore = traduciAnnotazione
  ) {
    this.logger.setContext('TrasmettiLottoRegistroUseCase')
  }

  async trasmettiRegistro(tenantId: string, registroId: string): Promise<EsitoGiroRegistro> {
    let identificativo = ''
    let preparate: Preparata[] = []
    let nonTrasmissibili = 0
    let inAttesa = 0

    const pren = await this.repo.prenota(tenantId, registroId, async (tx, candidate) => {
      // Solo le prime LOTTO_MASSIMO_RENTRI si leggono e si traducono.
      const sel = selezionaLotto(candidate, LOTTO_MASSIMO_RENTRI)
      inAttesa = sel.inAttesa.length
      const registro = await tx.registroRifiuti.findFirst({
        where: { id: registroId, tenantId },
        select: { identificativoRentri: true },
      })
      identificativo = registro?.identificativoRentri ?? ''
      const annotazioni = await this.lettore.leggi(tx, tenantId, registroId, sel.lotto)
      const non: Array<{ movimentoId: string; motivi: string[] }> = []
      preparate = []
      for (const a of annotazioni) {
        const t = this.traduci(a)
        if (t.ok) preparate.push({ movimentoId: a.movimentoId, numero: a.numero, corpo: t.corpo })
        else non.push({ movimentoId: a.movimentoId, motivi: t.motivi })
      }
      preparate.sort(
        (a, b) => a.numero.anno - b.numero.anno || a.numero.progressivo - b.numero.progressivo
      )
      nonTrasmissibili = non.length
      return { lotto: preparate.map(p => p.movimentoId), nonTrasmissibili: non }
    })

    const vuoto = (esito: EsitoGiroRegistro['esito']): EsitoGiroRegistro => ({
      esito,
      trasmesse: 0,
      rifiutate: 0,
      nonTrasmissibili,
      inAttesa,
      attesaEsito: 0,
    })
    if (pren.esito !== 'PRENOTATO') return vuoto(pren.esito)

    const { lottoId } = pren
    let transazioneId: string
    try {
      ;({ transazioneId } = await this.client.inviaMovimenti(
        identificativo,
        preparate.map(p => p.corpo),
        tenantId
      ))
    } catch (errore) {
      return this.dopoErrorePost(tenantId, lottoId, errore, vuoto)
    }

    let salvata: 'SALVATA' | 'SU_INCERTA'
    try {
      salvata = await this.repo.salvaTransazione(tenantId, lottoId, transazioneId)
    } catch {
      // La POST e' stata accettata ma la transazione non si e' potuta annotare: non si ritrasmette.
      // Il transazione_id si annota comunque sulle righe incerte (D11 le rilegge) e si logga (D15).
      this.logger.warn('Transazione RENTRI accettata ma non annotata: righe segnate incerte', {
        righe: preparate.length,
        transazioneId,
      })
      await this.repo.segnaIncerte(tenantId, lottoId, MOTIVO_INVIO_INCERTO, transazioneId)
      return vuoto('INCERTO')
    }
    if (salvata === 'SU_INCERTA') {
      this.logger.warn('Stallo durante la POST: transazione annotata su righe incerte', {
        righe: preparate.length,
      })
      return vuoto('INCERTO')
    }

    const risultato = await this.leggiEApplica(
      tenantId,
      transazioneId,
      preparate.map(p => ({ movimentoId: p.movimentoId, numero: p.numero })),
      undefined
    )
    return {
      esito:
        risultato.esito === 'APPLICATO'
          ? risultato.trasmesse > 0
            ? 'INVIATO'
            : 'RIFIUTATO'
          : risultato.esito === 'INCERTO'
            ? 'INCERTO'
            : 'INVIATO',
      trasmesse: risultato.trasmesse,
      rifiutate: risultato.rifiutate,
      nonTrasmissibili,
      inAttesa,
      attesaEsito: risultato.esito === 'RESTA_IN_ATTESA' ? preparate.length : 0,
    }
  }

  /**
   * Rilegge l'esito delle transazioni in `ATTESA_ESITO` (nessuna POST). Oltre 7 giorni senza esito
   * si fa un'ultima lettura: se e' definitiva si applica, altrimenti la transazione diventa `INCERTA`
   * (D10.4). Un errore su una transazione non ferma le altre.
   */
  async riprendiAttese(tenantId: string): Promise<{ riletti: number; incerte: number }> {
    let riletti = 0
    let incerte = 0
    const attese = await this.repo.transazioniInAttesa(tenantId)
    for (const a of attese) {
      try {
        const scaduta = Date.now() - a.dal.getTime() > ETA_MASSIMA_ATTESA_ESITO_MS
        const righe = await this.repo.righeDellaTransazione(tenantId, a.transazioneId)
        const r = await this.leggiEApplica(
          tenantId,
          a.transazioneId,
          righe,
          scaduta ? 1 : TENTATIVI_POLLING_RIPRESA
        )
        if (r.esito === 'APPLICATO') riletti++
        else if (r.esito === 'INCERTO') incerte += r.incerte
        else if (scaduta) {
          incerte += await this.repo.segnaIncerte(
            tenantId,
            { transazioneId: a.transazioneId },
            MOTIVO_ATTESA_SCADUTA
          )
        }
      } catch (errore) {
        this.logger.warn('Ripresa di una transazione RENTRI non riuscita: si prosegue', {
          tipo: errore instanceof Error ? errore.name : 'sconosciuto',
        })
      }
    }
    return { riletti, incerte }
  }

  private async dopoErrorePost(
    tenantId: string,
    lottoId: string,
    errore: unknown,
    vuoto: (e: EsitoGiroRegistro['esito']) => EsitoGiroRegistro
  ): Promise<EsitoGiroRegistro> {
    // Unico caso in cui la POST certamente non e' partita.
    if (errore instanceof TenantSenzaCertificatoRentriError) {
      await this.repo.ripristinaPrenotazione(tenantId, lottoId)
      return vuoto('SENZA_CERTIFICATO')
    }
    if (
      errore instanceof RentriApiError &&
      !errore.retryable &&
      [400, 403, 404].includes(errore.status)
    ) {
      const titolo = errore.problemTitle ?? 'Richiesta rifiutata da RENTRI'
      const dettaglio = dettaglioSicuro(errore.problemDetail)
      const motivo =
        errore.status === 404
          ? MOTIVO_REGISTRO_NON_TROVATO
          : dettaglio
            ? `${titolo}: ${dettaglio}`
            : titolo
      await this.repo.segnaRifiutate(tenantId, lottoId, motivo)
      return vuoto('RIFIUTATO')
    }
    // 5xx, nessuna risposta, 202 senza id, 429/423 esauriti, altri 4xx, errore sconosciuto: incerto.
    const causa =
      errore instanceof TrasmissioneRentriIncertaError
        ? errore.causa
        : errore instanceof RentriApiError
          ? `HTTP_${errore.status}`
          : 'SCONOSCIUTA'
    this.logger.warn('Esito della POST a RENTRI incerto: righe segnate incerte', { causa })
    await this.repo.segnaIncerte(tenantId, lottoId, MOTIVO_INVIO_INCERTO)
    return vuoto('INCERTO')
  }

  /**
   * Legge l'esito e lo applica. `RESTA_IN_ATTESA` = errore tecnico (righe ancora `ATTESA_ESITO`,
   * annotato l'errore); `INCERTO` = transazione sconosciuta o esito non attribuibile.
   */
  private async leggiEApplica(
    tenantId: string,
    transazioneId: string,
    lotto: Array<{ movimentoId: string; numero: NumeroRegistrazione }>,
    maxTentativi: number | undefined
  ): Promise<{
    esito: 'APPLICATO' | 'RESTA_IN_ATTESA' | 'INCERTO'
    trasmesse: number
    rifiutate: number
    incerte: number
  }> {
    let esito
    try {
      esito = await this.client.attendiEsitoMovimenti(
        transazioneId,
        tenantId,
        maxTentativi ? { maxTentativi } : undefined
      )
    } catch (errore) {
      if (errore instanceof TransazioneRentriNonTrovataError) {
        const incerte = await this.repo.segnaIncerte(
          tenantId,
          { transazioneId },
          MOTIVO_TRANSAZIONE_SCONOSCIUTA
        )
        return { esito: 'INCERTO', trasmesse: 0, rifiutate: 0, incerte }
      }
      // Errore tecnico (rete, 5xx, 429/423 esauriti, certificato, tentativi finiti): la riga resta in attesa.
      const descrizione =
        errore instanceof RentriApiError
          ? `Lettura dell'esito non riuscita (HTTP ${errore.status}): riprovare`
          : "Lettura dell'esito non riuscita: riprovare"
      this.logger.warn("Lettura dell'esito RENTRI non riuscita: le righe restano in attesa", {
        tipo: errore instanceof Error ? errore.name : 'sconosciuto',
      })
      await this.repo.annotaErrorePolling(tenantId, transazioneId, descrizione)
      return { esito: 'RESTA_IN_ATTESA', trasmesse: 0, rifiutate: 0, incerte: 0 }
    }

    let righe: EsitoPerRiga[]
    try {
      const d = applicaEsitoDettagliato(lotto, esito)
      righe = d.righe
      if (d.fuoriLotto.length > 0 || d.anomalie.length > 0) {
        this.logger.warn('Esito RENTRI con anomalie', {
          fuoriLotto: d.fuoriLotto.length,
          anomalie: d.anomalie.length,
        })
      }
    } catch (errore) {
      if (errore instanceof NumeroDuplicatoNelLottoError) {
        const incerte = await this.repo.segnaIncerte(
          tenantId,
          { transazioneId },
          MOTIVO_ESITO_AMBIGUO
        )
        return { esito: 'INCERTO', trasmesse: 0, rifiutate: 0, incerte }
      }
      throw errore
    }
    await this.repo.applicaEsiti(tenantId, transazioneId, righe)
    const trasmesse = righe.filter(r => r.stato === 'TRASMESSA').length
    return { esito: 'APPLICATO', trasmesse, rifiutate: righe.length - trasmesse, incerte: 0 }
  }
}
