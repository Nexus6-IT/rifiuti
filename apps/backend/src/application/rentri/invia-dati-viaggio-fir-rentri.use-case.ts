import { Injectable } from '@nestjs/common'
import { verificaFirNonBloccato } from '../../domain/fir/guardia-invio-rentri'
import { FIR, StatoFormulario, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { LoggerService } from '../../core/logger/logger.service'
import { EsitoFormulario, RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import {
  RentriApiError,
  RispostaRentriInattesaError,
} from '../../infrastructure/rentri/rentri-http-resilienza'
import { IDatiViaggioFirRepository } from './dati-viaggio-fir.port'
import { IEventiFirRentriRepository, NuovoEventoFirRentri } from './eventi-fir-rentri.port'
import { registraEventoFirRentri } from './registra-evento-fir-rentri'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import { DatoMancantePerRentriError } from './mappatura/mappa-parti'
import { ValoreNonTraducibilePerRentriError } from './mappatura/mappa-rifiuto'
import { mappaDatiTrasportoTerrestre, mappaQuantitaRifiuto } from './mappatura/mappa-viaggio'

export interface ComandoInviaQuantita {
  firId: string
  tenantId: string
  /** Valore nell'unita' del FIR (`kg`, `litri`, `t`): max 2 decimali, come la quantita' del FIR. */
  quantita: number
  unitaMisura: string
  numeroColli?: number
  rinfusa?: boolean
  verificatoInPartenza?: boolean
  utenteId?: string
  correlationId?: string
}

export interface ComandoInviaTrasporto {
  firId: string
  tenantId: string
  conducenteNome: string
  conducenteCognome: string
  targaAutomezzo?: string
  targaRimorchio?: string
  percorso?: string
  /** Default: la data di trasporto indicata alla creazione del FIR. */
  dataOraInizioTrasporto?: Date
  annotazioni?: string
  utenteId?: string
  correlationId?: string
}

export interface EsitoInviaDatiViaggio {
  /** `Operazione` del contratto effettivamente usata (`DatiQuantita`/`DatiQuantitaUpdate`, `Trasporto`/`TrasportoUpdate`). */
  operazione: string
  /** Stato del formulario riletto dall'ente; `null` se la rilettura non e' riuscita (l'operazione e' comunque riuscita). */
  statoFormulario: StatoFormulario | null
}

interface DefinizioneOperazione {
  /** Operazioni di `/azioni` che rendono ammessa la chiamata (la prima presente e' quella registrata). */
  operazioniAmmesse: readonly string[]
  rifiutata: { rule: string; testo: string }
  nonDisponibile: string
}

const QUANTITA: DefinizioneOperazione = {
  operazioniAmmesse: ['DatiQuantita', 'DatiQuantitaUpdate'],
  rifiutata: { rule: 'QUANTITA_RENTRI_RIFIUTATA', testo: 'la quantità' },
  nonDisponibile:
    "L'ente non consente ora di indicare o correggere la quantità di questo formulario: nessuna operazione è stata inviata.",
}

const TRASPORTO: DefinizioneOperazione = {
  operazioniAmmesse: ['Trasporto', 'TrasportoUpdate'],
  rifiutata: { rule: 'TRASPORTO_RENTRI_RIFIUTATO', testo: 'i dati di trasporto' },
  nonDisponibile:
    "L'ente non consente ora di indicare o correggere i dati di trasporto di questo formulario: nessuna operazione è stata inviata.",
}

/**
 * Quantita' e dati di trasporto di un FIR digitale gia' creato presso l'ente (FIR in viaggio, P2): chiude
 * la fase iniziale quando la creazione non li portava, oppure li corregge. Una sola classe per le due
 * operazioni perche' la sequenza e' identica; cambiano corpo, endpoint e copia locale.
 *
 * **Sequenza fail-closed, in ordine:**
 * 1. Precondizioni locali (FIR del tenant, non bloccato, legato) e mappatura del corpo con i limiti del
 *    contratto — PRIMA di qualunque rete, ente compreso.
 * 2. `/azioni` ({@link GetAzioniDisponibiliUseCase}): l'operazione deve esserci (`DatiQuantita` o
 *    `DatiQuantitaUpdate`; `Trasporto` o `TrasportoUpdate`), altrimenti 409 `OPERAZIONE_NON_DISPONIBILE`
 *    SENZA chiamare l'ente e senza evento: la disponibilita' la decide sempre l'ente.
 * 3. POST dell'operazione. Se l'ente rifiuta (`esito.errore` o un 4xx) evento RIFIUTATA, errore leggibile,
 *    NESSUN dato locale toccato. Errore di rete o tentativi esauriti: evento INCERTA e errore originale.
 * 4. Solo dopo l'esito positivo: stato riletto da `/stato` e applicato al FIR (`save`), POI la copia locale
 *    dei dati (se andasse prima, il `save` dell'aggregate, che porta ancora la quantita' e la targa
 *    vecchie, le riscriverebbe). Una rilettura fallita non annulla l'operazione.
 * 5. Evento ACCETTATA nello storico. Un errore dello storico non maschera mai l'esito.
 *
 * Nessuna firma qui: dopo quantita' e trasporto il formulario passa allo stato `Firma*` e la firma e' del
 * pezzo P3.
 */
@Injectable()
export class InviaDatiViaggioFirRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly datiViaggio: IDatiViaggioFirRepository,
    private readonly eventi: IEventiFirRentriRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('InviaDatiViaggioFirRentriUseCase')
  }

  async inviaQuantita(comando: ComandoInviaQuantita): Promise<EsitoInviaDatiViaggio> {
    return this.esegui({
      ...comando,
      definizione: QUANTITA,
      costruisciCorpo: async () =>
        this.mappa(() =>
          mappaQuantitaRifiuto({
            valore: comando.quantita,
            unitaMisura: comando.unitaMisura,
            numeroColli: comando.numeroColli,
            rinfusa: comando.rinfusa,
            verificatoInPartenza: comando.verificatoInPartenza,
          })
        ) as unknown as Record<string, unknown>,
      invia: (numeroFir, corpo) =>
        this.rentriApiClient.inviaQuantita(comando.tenantId, numeroFir, corpo),
      aggiornaLocale: () =>
        this.datiViaggio.aggiornaQuantitaDopoEnte(comando.tenantId, comando.firId, {
          valore: comando.quantita,
          unitaMisura: comando.unitaMisura,
          numeroColli: comando.numeroColli ?? null,
          rinfusa: comando.rinfusa === true,
          verificatoInPartenza: comando.verificatoInPartenza ?? null,
        }),
    })
  }

  async inviaTrasporto(comando: ComandoInviaTrasporto): Promise<EsitoInviaDatiViaggio> {
    return this.esegui({
      ...comando,
      definizione: TRASPORTO,
      verifica: (fir: FIR) => {
        // Il finto e il contratto ammettono anche ferroviario e marittimo, ma WasteFlow ne modella i
        // dati solo per il terrestre: meglio dirlo che mandare un corpo sbagliato.
        if (fir.tipoTrattaPrincipale !== TipoTratta.TERRESTRE) {
          throw DomainException.businessRuleViolation(
            'TRASPORTO_NON_TERRESTRE',
            'I dati di trasporto si indicano da WasteFlow solo per il trasporto terrestre: per le altre modalità usare il portale RENTRI.'
          )
        }
      },
      costruisciCorpo: async () => {
        const dataTrasporto =
          comando.dataOraInizioTrasporto ??
          (await this.datiViaggio.leggi(comando.tenantId, comando.firId))?.dataTrasporto ??
          new Date()
        return this.mappa(() =>
          mappaDatiTrasportoTerrestre({
            conducenteNome: comando.conducenteNome,
            conducenteCognome: comando.conducenteCognome,
            targaAutomezzo: comando.targaAutomezzo,
            targaRimorchio: comando.targaRimorchio,
            percorso: comando.percorso,
            dataOraInizioTrasporto: dataTrasporto,
            annotazioni: comando.annotazioni,
          })
        ) as unknown as Record<string, unknown>
      },
      invia: (numeroFir, corpo) =>
        this.rentriApiClient.inviaTrasporto(comando.tenantId, numeroFir, corpo),
      aggiornaLocale: (corpo: Record<string, unknown>) => {
        const conducente = corpo.conducente as { nome: string; cognome: string }
        return this.datiViaggio.aggiornaTrasportoDopoEnte(comando.tenantId, comando.firId, {
          targaAutomezzo: (corpo.targa_automezzo as string | undefined) ?? null,
          conducenteNome: conducente.nome,
          conducenteCognome: conducente.cognome,
          targaRimorchio: (corpo.targa_rimorchio as string | undefined) ?? null,
          percorso: (corpo.percorso as string | undefined) ?? null,
        })
      },
    })
  }

  /** Traduce gli errori dei mappatori in un errore di dominio leggibile (400). */
  private mappa<T>(fn: () => T): T {
    try {
      return fn()
    } catch (errore) {
      if (
        errore instanceof DatoMancantePerRentriError ||
        errore instanceof ValoreNonTraducibilePerRentriError
      ) {
        throw DomainException.businessRuleViolation('DATI_VIAGGIO_NON_VALIDI', errore.message)
      }
      throw errore
    }
  }

  private async esegui(p: {
    firId: string
    tenantId: string
    utenteId?: string
    correlationId?: string
    definizione: DefinizioneOperazione
    verifica?: (fir: FIR) => void
    costruisciCorpo: () => Promise<Record<string, unknown>>
    invia: (numeroFir: string, corpo: Record<string, unknown>) => Promise<EsitoFormulario>
    aggiornaLocale: (corpo: Record<string, unknown>) => Promise<void>
  }): Promise<EsitoInviaDatiViaggio> {
    const { firId, tenantId, utenteId, correlationId, definizione } = p

    // --- 1. Precondizioni locali e corpo, PRIMA di qualunque rete ---

    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw DomainException.notFound('FIR', firId)
    }
    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }
    // Fase 3 (D4): FIR importato = nessuna scrittura verso RENTRI prima della riconciliazione.
    verificaFirNonBloccato(fir)
    if (!fir.rentriNumeroFir) {
      throw DomainException.businessRuleViolation(
        'FIR_NON_LEGATO_RENTRI',
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è nulla da aggiornare presso l'ente."
      )
    }
    const numeroFir = fir.rentriNumeroFir
    p.verifica?.(fir)
    const corpo = await p.costruisciCorpo()

    // --- 2. Precondizione da /azioni ---

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const operazione = definizione.operazioniAmmesse.find(nome =>
      azioni.some(a => a.operazione === nome)
    )
    if (!operazione) {
      throw DomainException.businessRuleViolation(
        'OPERAZIONE_NON_DISPONIBILE',
        definizione.nonDisponibile
      )
    }

    // --- 3. Scrittura presso l'ente ---

    let esito: EsitoFormulario
    try {
      esito = await p.invia(numeroFir, corpo)
    } catch (errore) {
      // Rifiuto DEFINITIVO dell'ente: 403 o un altro 4xx non ritentabile (validazione, 404, ...).
      const rifiutoDellEnte =
        (errore instanceof RentriApiError && !errore.retryable) ||
        errore instanceof RispostaRentriInattesaError
      if (rifiutoDellEnte) {
        const dettaglio = [errore.problemTitle, errore.problemDetail].filter(Boolean).join(': ')
        await this.registraEvento({
          tenantId,
          firId,
          operazione,
          payload: corpo,
          transazioneId: null,
          esito: 'RIFIUTATA',
          dettaglioEnte: `${errore.status} ${dettaglio}`.trim(),
          statoFormularioDopo: null,
          utenteId: utenteId ?? null,
        })
        throw DomainException.businessRuleViolation(
          definizione.rifiutata.rule,
          `L'ente ha rifiutato ${definizione.rifiutata.testo} del formulario ${numeroFir}` +
            (dettaglio ? `: ${dettaglio}` : '.')
        )
      }
      // Rete, timeout o tentativi di resilienza esauriti: non si sa se l'ente abbia registrato.
      await this.registraEvento({
        tenantId,
        firId,
        operazione,
        payload: corpo,
        transazioneId: null,
        esito: 'INCERTA',
        dettaglioEnte: errore instanceof Error ? errore.message : String(errore),
        statoFormularioDopo: null,
        utenteId: utenteId ?? null,
      })
      throw errore
    }

    if (esito.errore) {
      await this.registraEvento({
        tenantId,
        firId,
        operazione,
        payload: corpo,
        transazioneId: esito.transazioneId ?? null,
        esito: 'RIFIUTATA',
        dettaglioEnte: JSON.stringify(esito.validazione),
        statoFormularioDopo: null,
        utenteId: utenteId ?? null,
      })
      throw DomainException.businessRuleViolation(
        definizione.rifiutata.rule,
        `L'ente ha rifiutato ${definizione.rifiutata.testo} del formulario ${numeroFir}. ` +
          `Dettaglio della validazione RENTRI: ${JSON.stringify(esito.validazione)}`
      )
    }

    // --- 4. L'ente ha accettato: stato riletto, poi la copia locale ---

    const statoDopo = await this.rileggiStatoEApplica(fir, tenantId, numeroFir, correlationId)
    await p.aggiornaLocale(corpo)

    // --- 5. Storico ---

    await this.registraEvento({
      tenantId,
      firId,
      operazione,
      payload: corpo,
      transazioneId: esito.transazioneId ?? null,
      esito: 'ACCETTATA',
      dettaglioEnte: null,
      statoFormularioDopo: statoDopo,
      utenteId: utenteId ?? null,
    })
    this.logger.info('Dati di viaggio inviati a RENTRI', {
      firId,
      tenantId,
      numeroFir,
      operazione,
      utenteId,
      statoFormularioDopo: statoDopo,
      correlationId,
    })

    return { operazione, statoFormulario: statoDopo }
  }

  /** Rilegge lo stato dall'ente e lo applica al FIR. Se la rilettura fallisce l'operazione resta riuscita. */
  private async rileggiStatoEApplica(
    fir: FIR,
    tenantId: string,
    numeroFir: string,
    correlationId?: string
  ): Promise<StatoFormulario | null> {
    try {
      const statoEnte = await this.rentriApiClient.leggiStato(tenantId, numeroFir)
      fir.applyRentriStato(statoEnte.stato_formulario, correlationId)
      await this.firRepository.save(fir)
      return statoEnte.stato_formulario
    } catch (errore) {
      this.logger.warn('Rilettura dello stato RENTRI non riuscita dopo un invio accettato', {
        firId: fir.id,
        tenantId,
        numeroFir,
        errore: errore instanceof Error ? errore.message : String(errore),
        correlationId,
      })
      return null
    }
  }

  private registraEvento(evento: NuovoEventoFirRentri): Promise<void> {
    return registraEventoFirRentri(this.eventi, this.logger, evento)
  }
}
