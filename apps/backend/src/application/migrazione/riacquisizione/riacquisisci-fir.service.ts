/**
 * Riacquisizione dei FIR DIGITALI da RENTRI (pezzo I5, T3; Q5 del 14/11). I FIR digitali di WinWaste
 * NON si copiano: il pacchetto ne porta solo l'elenco (fase `fir-digitali`: numero RENTRI + IDRENTRI)
 * e questo servizio li rilegge dall'ente con `AcquisisciFormularioRENTRIUseCase`, scelta `NUOVO`.
 *
 * SOLA LETTURA verso RENTRI, per costruzione:
 *  - la visibilita' si dichiara GIA' acquisita (`visibilitaGiaAcquisita: true`): non si chiama mai
 *    `acquisisciVisibilita`, che e' una scrittura sull'ente. Se la visibilita' manca l'ente rifiuta la
 *    lettura (403) e il FIR e' un esito `VISIBILITA_NON_ACQUISITA` da risolvere a mano dal portale;
 *  - nessun `creaFormulario` ne' altra POST: il servizio non ha accesso al client, solo al caso d'uso.
 *
 * LIMITE DI FREQUENZA (in aggiunta al limitatore per azienda del client): pausa fra due chiamate,
 * massimo di FIR per esecuzione, stop al primo errore transitorio dell'ente (429/423/5xx a tentativi
 * esauriti). Senza `esegui` e' una simulazione: non si contatta RENTRI.
 *
 * Un FIR riacquisito NON e' un import: nasce senza provenienza e non bloccato (Q5). Rapporto: solo
 * numeri di FIR (identificativi dell'ente), esiti e codici. Mai valori dei dati dell'azienda.
 */
import { LoggerService } from '../../../core/logger/logger.service'
import { DomainException } from '../../../domain/shared/domain-exception'
import { RentriApiError } from '../../../infrastructure/rentri/rentri-http-resilienza'
import { TenantSenzaCertificatoRentriError } from '../../../infrastructure/rentri/rentri-credential.resolver'
import { RentriRateLimitTimeoutError } from '../../../infrastructure/rentri/rentri-rate-limiter.service'
import type {
  AcquisisciFormularioRENTRIInput,
  AcquisisciFormularioRENTRIResult,
} from '../../rentri/acquisisci-formulario-rentri.use-case'
import { RUOLI_SCRITTURA_RENTRI } from '../../rentri/verifica-ruolo-scrittura-rentri'
import type { PacchettoAperto } from '../pacchetto/lettore-pacchetto'
import { validaRecordFirDigitale } from '../pacchetto/record-fir'

export type EsitoRiacquisizione =
  | 'RIACQUISITO'
  | 'GIA_PRESENTE'
  | 'SENZA_UNITA_LOCALE'
  | 'SIMULATO'
  | 'RINVIATO'
  | 'VISIBILITA_NON_ACQUISITA'
  | 'NON_TROVATO_SU_RENTRI'
  | 'INTERROTTO_ENTE'
  | 'INTERROTTO_CREDENZIALE'
  | 'FALLITO'

export interface PortaAcquisizioneFir {
  acquisisci(input: AcquisisciFormularioRENTRIInput): Promise<AcquisisciFormularioRENTRIResult>
}

export interface ArchivioRiacquisizione {
  /** Il numero RENTRI e' gia' agganciato a un FIR dell'azienda. */
  firGiaPresente(tenantId: string, numeroFir: string): Promise<boolean>
  /** `numIscrSito` dell'unita' locale RENTRI (mappa), `null` se non esiste per quell'azienda. */
  numIscrSito(tenantId: string, unitaLocaleId: string): Promise<string | null>
  /** Ruolo dell'utente nell'azienda, `null` se non e' un utente dell'azienda. */
  ruoloUtente(tenantId: string, userId: string): Promise<string | null>
}

export interface RichiestaRiacquisizione {
  readonly tenantId: string
  /** Utente dell'azienda a cui si attribuisce l'operazione (ruolo con scritture RENTRI). */
  readonly userId: string
  readonly pacchetto: PacchettoAperto
  /** `false` = simulazione: nessuna chiamata a RENTRI. */
  readonly esegui: boolean
  /** Pausa fra due chiamate a RENTRI, in millisecondi. */
  readonly pausaMs: number
  /** Massimo di FIR riacquisiti in questa esecuzione; il resto e' `RINVIATO`. */
  readonly massimo: number
}

export interface RapportoRiacquisizione {
  readonly esiti: ReadonlyArray<{
    numeroFir: string
    esito: EsitoRiacquisizione
    /** Solo per `FALLITO`: codice stabile (`HTTP_<status>` o nome della classe d'errore). */
    codice?: string
  }>
  readonly conteggi: Readonly<Partial<Record<EsitoRiacquisizione, number>>>
  /** `true` se un errore transitorio dell'ente ha fermato l'esecuzione. */
  readonly interrotto: boolean
}

/** L'utente indicato non e' dell'azienda o non puo' fare scritture RENTRI. Mai il ruolo trovato. */
export class UtenteNonAbilitatoError extends Error {
  constructor() {
    super("L'utente non e' un utente dell'azienda abilitato alle operazioni RENTRI")
    this.name = 'UtenteNonAbilitatoError'
  }
}

const attesaReale = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export class RiacquisisciFirService {
  constructor(
    private readonly porta: PortaAcquisizioneFir,
    private readonly archivio: ArchivioRiacquisizione,
    private readonly logger: LoggerService,
    private readonly attendi: (ms: number) => Promise<void> = attesaReale
  ) {
    this.logger.setContext('RiacquisisciFirService')
  }

  async esegui(r: RichiestaRiacquisizione): Promise<RapportoRiacquisizione> {
    let ruoloUtente = 'OPERATOR'
    if (r.esegui) {
      const ruolo = await this.archivio.ruoloUtente(r.tenantId, r.userId)
      if (ruolo === null || !(RUOLI_SCRITTURA_RENTRI as readonly string[]).includes(ruolo)) {
        throw new UtenteNonAbilitatoError()
      }
      ruoloUtente = ruolo
    }
    const esiti: Array<{ numeroFir: string; esito: EsitoRiacquisizione; codice?: string }> = []
    const conteggi: Partial<Record<EsitoRiacquisizione, number>> = {}
    const registra = (numeroFir: string, esito: EsitoRiacquisizione, codice?: string) => {
      esiti.push(codice === undefined ? { numeroFir, esito } : { numeroFir, esito, codice })
      conteggi[esito] = (conteggi[esito] ?? 0) + 1
    }
    let chiamate = 0
    let interrotto = false
    for await (const { record } of r.pacchetto.leggi('FIR', 'fir-digitali')) {
      const d = validaRecordFirDigitale(record, r.pacchetto.mappa)
      if (interrotto) {
        registra(d.numeroFir, 'RINVIATO')
        continue
      }
      if (await this.archivio.firGiaPresente(r.tenantId, d.numeroFir)) {
        registra(d.numeroFir, 'GIA_PRESENTE')
        continue
      }
      const numIscrSito =
        d.unitaLocaleId === null
          ? null
          : await this.archivio.numIscrSito(r.tenantId, d.unitaLocaleId)
      if (numIscrSito === null) {
        registra(d.numeroFir, 'SENZA_UNITA_LOCALE')
        continue
      }
      if (!r.esegui) {
        registra(d.numeroFir, 'SIMULATO')
        continue
      }
      if (chiamate >= r.massimo) {
        registra(d.numeroFir, 'RINVIATO')
        continue
      }
      if (chiamate > 0) await this.attendi(r.pausaMs)
      chiamate++
      try {
        await this.porta.acquisisci({
          tenantId: r.tenantId,
          userId: r.userId,
          userRole: ruoloUtente,
          numeroFir: d.numeroFir,
          numIscrSito,
          // Mai `acquisisciVisibilita`: e' una scrittura sull'ente (vedi commento di modulo).
          visibilitaGiaAcquisita: true,
          scelta: { tipo: 'NUOVO' },
        })
        registra(d.numeroFir, 'RIACQUISITO')
      } catch (e) {
        if (
          e instanceof RentriRateLimitTimeoutError ||
          (e instanceof RentriApiError && e.retryable)
        ) {
          registra(d.numeroFir, 'INTERROTTO_ENTE')
          interrotto = true
        } else if (
          e instanceof TenantSenzaCertificatoRentriError ||
          (e instanceof RentriApiError && e.status === 401)
        ) {
          // Problema di credenziale: vale per tutti i FIR, inutile continuare.
          registra(d.numeroFir, 'INTERROTTO_CREDENZIALE')
          interrotto = true
        } else if (e instanceof RentriApiError && e.status === 403) {
          registra(d.numeroFir, 'VISIBILITA_NON_ACQUISITA')
        } else if (e instanceof RentriApiError && e.status === 404) {
          registra(d.numeroFir, 'NON_TROVATO_SU_RENTRI')
        } else if (
          e instanceof DomainException &&
          /GIA_AGGANCIATO/.test(String(e.metadata?.rule))
        ) {
          registra(d.numeroFir, 'GIA_PRESENTE')
        } else {
          // Solo un codice: il messaggio potrebbe portare valori.
          const codice =
            e instanceof RentriApiError
              ? `HTTP_${e.status}`
              : e instanceof Error
                ? e.name
                : 'SCONOSCIUTO'
          registra(d.numeroFir, 'FALLITO', codice)
          this.logger.warn('Riacquisizione FIR fallita', { tenantId: r.tenantId, errore: codice })
        }
      }
    }
    this.logger.info('Riacquisizione FIR conclusa', { tenantId: r.tenantId, ...conteggi })
    return { esiti, conteggi, interrotto }
  }
}
