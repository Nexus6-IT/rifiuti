import { Injectable } from '@nestjs/common'
import { verificaFirNonBloccato } from '../../domain/fir/guardia-invio-rentri'
import { FIR, StatoFormulario } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { LoggerService } from '../../core/logger/logger.service'
import { Operazione } from '../../infrastructure/rentri/rentri-api.client'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import {
  CompletaOperazioneConFirmaUseCase,
  EsitoCompletamentoFirma,
} from './completa-operazione-con-firma.use-case'
import { IEventiFirRentriRepository, EsitoEventoFirRentri } from './eventi-fir-rentri.port'
import { registraEventoFirRentri } from './registra-evento-fir-rentri'

/**
 * `tipoOperazione` della sessione di firma delle firme di partenza. Costante: una seconda richiesta di
 * firma di partenza sullo stesso FIR riprende la sessione aperta (stessa operazione) invece di
 * mandare una seconda richiesta sul telefono; una sessione aperta per un'ALTRA operazione
 * (accettazione, annullamento) blocca con 409 `SESSIONE_FIRMA_IN_CORSO`.
 */
export const TIPO_OPERAZIONE_PARTENZA = 'PARTENZA'

/**
 * Le firme di partenza, dalla piu' completa alla meno: quando l'ente ne propone piu' di una (tenant che e'
 * insieme produttore e trasportatore) si sceglie quella che chiude piu' firme in un colpo. La scelta e'
 * informativa: `acquisizione-firma` e' un solo endpoint, e a decidere cosa si firma e' lo stato del
 * formulario presso l'ente.
 */
export const OPERAZIONI_FIRMA_PARTENZA = [
  'AcquisizioneFirmaProduttoreTrasportatore',
  'AcquisizioneFirmaProduttore',
  'AcquisizioneFirmaTrasportatore',
] as const satisfies readonly Operazione[]

export type OperazioneFirmaPartenza = (typeof OPERAZIONI_FIRMA_PARTENZA)[number]

export const AVVISO_FIRMA_RENTRI_DA_COMPLETARE = 'Firma RENTRI da completare'

export interface ComandoFirmaPartenza {
  firId: string
  tenantId: string
  /** Utente che chiede la firma: finisce sulla sessione di firma e nello storico. */
  utenteId?: string
  /** Richiesta esplicita di una nuova sessione dopo una scaduta o rifiutata (pulsante del banner). */
  nuovaSessione?: boolean
  correlationId?: string
}

export interface EsitoFirmaPartenza {
  /** L'operazione che `/azioni` ha proposto e che si e' firmata. */
  operazione: OperazioneFirmaPartenza
  /** Esito del ciclo di firma: COMPLETATA (stato riletto), IN_ATTESA, SCADUTA, RIFIUTATA. */
  firma: EsitoCompletamentoFirma
}

/**
 * Esito della firma proposta DOPO un'azione locale gia' riuscita («Emetti», «Presa in carico»). Mai
 * un'eccezione: l'azione locale non si annulla se la firma RENTRI non va a buon fine.
 */
export type EsitoFirmaPartenzaDopoAzione =
  /** FIR non legato a RENTRI (flusso cartaceo): nessuna chiamata all'ente. */
  | { stato: 'NON_APPLICABILE' }
  | { stato: 'COMPLETATA'; statoFormulario: StatoFormulario }
  /** Richiesta partita: l'utente deve confermare sul telefono (banner di P1). */
  | { stato: 'IN_ATTESA'; sessioneId?: string; scadenza: Date }
  | { stato: 'SCADUTA' | 'RIFIUTATA'; sessioneId?: string; avviso: string }
  /** La firma non e' partita o e' fallita: resta da fare dal pulsante «Firma la partenza su RENTRI». */
  | { stato: 'DA_COMPLETARE'; codice?: string; avviso: string }

/** Traduce l'esito del ciclo di firma nell'esito proposto all'interfaccia dopo un'azione. */
export function esitoProposta(firma: EsitoCompletamentoFirma): EsitoFirmaPartenzaDopoAzione {
  switch (firma.esito) {
    case 'COMPLETATA':
      return { stato: 'COMPLETATA', statoFormulario: firma.statoFormulario }
    case 'IN_ATTESA':
      return {
        stato: 'IN_ATTESA',
        ...(firma.sessioneId && { sessioneId: firma.sessioneId }),
        scadenza: firma.scadenzaAutorizzazione,
      }
    case 'SCADUTA':
      return {
        stato: 'SCADUTA',
        ...(firma.sessioneId && { sessioneId: firma.sessioneId }),
        avviso: `${AVVISO_FIRMA_RENTRI_DA_COMPLETARE}: la richiesta sul telefono è scaduta, puoi chiederla di nuovo.`,
      }
    case 'RIFIUTATA':
      return {
        stato: 'RIFIUTATA',
        ...(firma.sessioneId && { sessioneId: firma.sessioneId }),
        avviso: `${AVVISO_FIRMA_RENTRI_DA_COMPLETARE}: la firma è stata rifiutata, puoi riprovare.`,
      }
  }
}

/**
 * Firme di partenza su RENTRI (FIR in viaggio, P3): porta il formulario da una fase `Firma*Iniziale` allo
 * stato di viaggio.
 *
 * L'operazione (`AcquisizioneFirmaProduttore`, `...Trasportatore`, `...ProduttoreTrasportatore`) la decide
 * SEMPRE `/azioni`, mai una deduzione locale; la firma passa dal ciclo comune
 * ({@link CompletaOperazioneConFirmaUseCase}: sessione riprendibile, presa esclusiva, nessuna doppia firma) e lo
 * stato finale e' RILETTO dall'ente.
 *
 * {@link dopoAzioneLocale} e' il legame con le azioni locali: dopo «Emetti» o «Presa in carico» riuscite propone
 * la firma, e se questa fallisce restituisce l'avviso «firma RENTRI da completare» senza toccare l'azione locale.
 */
@Injectable()
export class FirmaPartenzaRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly completaOperazioneConFirma: CompletaOperazioneConFirmaUseCase,
    private readonly eventi: IEventiFirRentriRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('FirmaPartenzaRentriUseCase')
  }

  async execute(comando: ComandoFirmaPartenza): Promise<EsitoFirmaPartenza> {
    const { firId, tenantId, utenteId, correlationId } = comando

    // --- 1. Precondizioni locali, PRIMA di qualunque chiamata all'ente ---

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
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è nessuna partenza da firmare presso l'ente."
      )
    }

    // --- 2. L'operazione la sceglie /azioni (riconcilia anche lo stato del FIR) ---

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const proposte = new Set(azioni.map(a => a.operazione))
    const operazione = OPERAZIONI_FIRMA_PARTENZA.find(o => proposte.has(o))
    if (!operazione) {
      throw DomainException.businessRuleViolation(
        'FIRMA_PARTENZA_NON_DISPONIBILE',
        "L'ente non chiede ora la firma di partenza di questo formulario: mancano ancora dei dati del viaggio " +
          '(quantità o trasporto), oppure la partenza è già stata firmata. Nessuna firma è stata richiesta.'
      )
    }

    // --- 3. Firma: ciclo comune (ripresa, esclusivita', stato riletto) ---

    let firma: EsitoCompletamentoFirma
    try {
      firma = await this.completaOperazioneConFirma.execute({
        firId,
        tenantId,
        tipoOperazione: TIPO_OPERAZIONE_PARTENZA,
        utenteId,
        nuovaSessione: comando.nuovaSessione,
        correlationId,
      })
    } catch (errore) {
      const esito = this.esitoDaErrore(errore)
      if (esito) {
        await registraEventoFirRentri(this.eventi, this.logger, {
          tenantId,
          firId,
          operazione,
          payload: null,
          transazioneId: null,
          esito,
          dettaglioEnte: errore instanceof Error ? errore.message : String(errore),
          statoFormularioDopo: null,
          utenteId: utenteId ?? null,
        })
      }
      throw errore
    }

    await registraEventoFirRentri(this.eventi, this.logger, {
      tenantId,
      firId,
      operazione,
      payload: null,
      transazioneId: null,
      ...this.eventoDaEsito(firma),
      utenteId: utenteId ?? null,
    })

    this.logger.info('Firma di partenza RENTRI', {
      firId,
      tenantId,
      operazione,
      esito: firma.esito,
      utenteId,
      correlationId,
    })

    return { operazione, firma }
  }

  /**
   * Propone la firma di partenza dopo un'azione locale GIA' riuscita. Non solleva mai: ogni problema (rete,
   * rifiuto, ente non pronto, database) diventa `DA_COMPLETARE` con l'avviso, e l'azione locale resta.
   */
  async dopoAzioneLocale(comando: ComandoFirmaPartenza): Promise<EsitoFirmaPartenzaDopoAzione> {
    const { firId, tenantId } = comando
    try {
      const fir = await this.firRepository.findById(firId)
      if (!fir || fir.tenantId !== tenantId || !fir.rentriNumeroFir) {
        return { stato: 'NON_APPLICABILE' }
      }

      const { firma } = await this.execute(comando)
      return esitoProposta(firma)
    } catch (errore) {
      const codice =
        errore instanceof DomainException
          ? (errore.metadata?.rule as string | undefined)
          : undefined
      this.logger.warn('Firma di partenza RENTRI non completata dopo l’azione locale', {
        firId,
        tenantId,
        codice,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
      const motivo =
        errore instanceof DomainException &&
        codice === 'FIRMA_PARTENZA_NON_DISPONIBILE' &&
        typeof errore.metadata?.details === 'string'
          ? errore.metadata.details
          : 'la richiesta di firma non è andata a buon fine, puoi riprovare dal pulsante «Firma la partenza su RENTRI».'
      return {
        stato: 'DA_COMPLETARE',
        ...(codice && { codice }),
        avviso: `${AVVISO_FIRMA_RENTRI_DA_COMPLETARE}: ${motivo}`,
      }
    }
  }

  /**
   * L'azienda del FIR se e' legato a RENTRI, altrimenti `null` (anche per un FIR inesistente: lo decide il
   * flusso locale). Serve a «Presa in carico»: su un FIR legato la presa in carico locale e' vietata (la firma
   * del trasportatore la riceve l'ente), quindi l'azione e' la firma di partenza.
   */
  async tenantSeLegatoRentri(firId: string): Promise<string | null> {
    const fir = await this.firRepository.findById(firId)
    return fir?.rentriNumeroFir ? (fir.tenantId ?? null) : null
  }

  /** Rilegge il FIR dopo una firma completata (lo stato e' cambiato su un'altra istanza); `null` se non riesce. */
  async rileggiFir(firId: string): Promise<FIR | null> {
    try {
      return await this.firRepository.findById(firId)
    } catch (errore) {
      this.logger.warn('Rilettura del FIR dopo la firma di partenza non riuscita', {
        firId,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
      return null
    }
  }

  /** Esito dello storico per un'eccezione del ciclo di firma; `null` = non e' un esito dell'ente. */
  private esitoDaErrore(errore: unknown): EsitoEventoFirRentri | null {
    if (errore instanceof DomainException) {
      const rule = errore.metadata?.rule as string | undefined
      if (rule === 'FIRMA_RENTRI_RIFIUTATA') return 'RIFIUTATA'
      // Conflitti e precondizioni locali: nessuna operazione e' arrivata all'ente.
      return null
    }
    return 'INCERTA'
  }

  private eventoDaEsito(firma: EsitoCompletamentoFirma): {
    esito: EsitoEventoFirRentri
    dettaglioEnte: string | null
    statoFormularioDopo: string | null
  } {
    switch (firma.esito) {
      case 'COMPLETATA':
        return {
          esito: 'ACCETTATA',
          dettaglioEnte: null,
          statoFormularioDopo: firma.statoFormulario,
        }
      case 'IN_ATTESA':
        return {
          esito: 'INVIATA',
          dettaglioEnte: 'in attesa della conferma sul telefono',
          statoFormularioDopo: null,
        }
      case 'SCADUTA':
        return {
          esito: 'RIFIUTATA',
          dettaglioEnte: firma.dettaglioEnte ?? 'richiesta di firma scaduta',
          statoFormularioDopo: null,
        }
      case 'RIFIUTATA':
        return {
          esito: 'RIFIUTATA',
          dettaglioEnte: firma.dettaglioEnte ?? 'firma rifiutata',
          statoFormularioDopo: null,
        }
    }
  }
}
