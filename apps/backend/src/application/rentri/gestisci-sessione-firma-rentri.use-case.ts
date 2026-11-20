import { Injectable } from '@nestjs/common'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { LoggerService } from '../../core/logger/logger.service'
import {
  CompletaOperazioneConFirmaUseCase,
  EsitoCompletamentoFirma,
} from './completa-operazione-con-firma.use-case'
import {
  FirmaPartenzaRentriUseCase,
  operazionePartenzaDaTipo,
} from './firma-partenza-rentri.use-case'
import { ISessioniFirmaRentriRepository, STATI_SESSIONE_APERTA } from './sessioni-firma-rentri.port'

/** Vista della sessione per l'interfaccia: mai token, digest o handle. */
export interface SessioneFirmaInAttesa {
  id: string
  tipoOperazione: string
  scadenza: Date
  /** IN_ATTESA = ancora da confermare; SCADUTA/RIFIUTATA = chiusa, resta visibile per riprovare o annullare. */
  stato: 'IN_ATTESA' | 'SCADUTA' | 'RIFIUTATA'
  /**
   * `true` se non si puo' riprendere (sessione gia' SCADUTA/RIFIUTATA oppure limite dei 120 s passato):
   * va richiesta una nuova firma.
   */
  scaduta: boolean
}

export interface ComandoRiprendiFirma {
  firId: string
  tenantId: string
  sessioneId: string
  utenteId?: string
  /** Richiesta esplicita di ripartire con una nuova sessione (pulsante del banner dopo la scadenza). */
  nuovaSessione?: boolean
  correlationId?: string
}

/**
 * Lettura e ripresa della sessione di firma remota di un FIR (FIR in viaggio, P1).
 *
 * - {@link inAttesa}: alimenta il banner «In attesa della tua conferma...». Solo lettura, nessuna
 *   chiamata all'ente.
 * - {@link riprendi}: «Ho confermato, controlla». Riprende il polling dello STESSO handle tramite
 *   {@link CompletaOperazioneConFirmaUseCase} (una sola richiesta sul telefono). Una sessione gia'
 *   chiusa SCADUTA/RIFIUTATA restituisce il suo esito senza toccare l'ente, a meno che l'utente chieda
 *   `nuovaSessione`: nessun nuovo tentativo parte da solo.
 */
@Injectable()
export class GestisciSessioneFirmaRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly sessioni: ISessioniFirmaRentriRepository,
    private readonly completaOperazioneConFirma: CompletaOperazioneConFirmaUseCase,
    private readonly logger: LoggerService,
    private readonly firmaPartenza: FirmaPartenzaRentriUseCase
  ) {
    this.logger.setContext('GestisciSessioneFirmaRentriUseCase')
  }

  /**
   * La sessione da mostrare nel banner: quella aperta, oppure l'ULTIMA del FIR se e' SCADUTA o
   * RIFIUTATA (cosi' dopo una scadenza o un rifiuto l'utente ha ancora «Richiedi di nuovo» e «Annulla»).
   * Una sessione COMPLETATA o ANNULLATA piu' recente la fa sparire.
   */
  async inAttesa(firId: string, tenantId: string): Promise<SessioneFirmaInAttesa | null> {
    const fir = await this.verificaFir(firId, tenantId)
    const ultima = await this.sessioni.ultima(tenantId, firId)
    if (!ultima) return null
    if (STATI_SESSIONE_APERTA.includes(ultima.stato)) {
      return {
        id: ultima.id,
        tipoOperazione: ultima.tipoOperazione,
        scadenza: ultima.scadenza,
        stato: 'IN_ATTESA',
        scaduta: ultima.scadenza.getTime() <= Date.now(),
      }
    }
    if (ultima.stato === 'SCADUTA' || ultima.stato === 'RIFIUTATA') {
      // Una richiesta chiusa resta visibile solo finche' il formulario e' ancora in attesa di firma
      // (`Firma*`): dopo un reset, un rollback o una firma fatta altrove non c'e' piu' nulla da
      // richiedere di nuovo ne' da annullare.
      if (!fir.rentriStatoFormulario?.startsWith('Firma')) return null
      return {
        id: ultima.id,
        tipoOperazione: ultima.tipoOperazione,
        scadenza: ultima.scadenza,
        stato: ultima.stato,
        scaduta: true,
      }
    }
    return null
  }

  async riprendi(comando: ComandoRiprendiFirma): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, sessioneId, utenteId, correlationId } = comando
    await this.verificaFir(firId, tenantId)

    const sessione = await this.sessioni.trovaPerId(tenantId, sessioneId)
    if (!sessione || sessione.firId !== firId) {
      throw DomainException.notFound('Sessione di firma', sessioneId)
    }

    // `nuovaSessione` vale solo per una richiesta scaduta o rifiutata: su una conclusa (COMPLETATA) o
    // annullata non c'e' nulla da rifare, e partirebbe una scrittura inutile verso l'ente.
    if (
      comando.nuovaSessione &&
      (sessione.stato === 'COMPLETATA' || sessione.stato === 'ANNULLATA')
    ) {
      throw DomainException.businessRuleViolation(
        'SESSIONE_FIRMA_NON_ATTIVA',
        `Questa richiesta di firma è già conclusa (${sessione.stato}): non si può richiedere di nuovo.`
      )
    }

    if (
      sessione.stato !== 'IN_ATTESA' &&
      sessione.stato !== 'IN_AVVIO' &&
      sessione.stato !== 'IN_FIRMA' &&
      !comando.nuovaSessione
    ) {
      if (sessione.stato === 'SCADUTA') {
        return {
          esito: 'SCADUTA',
          handle: sessione.handle ?? '',
          sessioneId: sessione.id,
          rilevataDa: sessione.dettaglioEnte ? 'ente' : 'orologio-locale',
          ...(sessione.dettaglioEnte && { dettaglioEnte: sessione.dettaglioEnte }),
        }
      }
      if (sessione.stato === 'RIFIUTATA') {
        return {
          esito: 'RIFIUTATA',
          handle: sessione.handle ?? '',
          sessioneId: sessione.id,
          ...(sessione.dettaglioEnte && { dettaglioEnte: sessione.dettaglioEnte }),
        }
      }
      throw DomainException.businessRuleViolation(
        'SESSIONE_FIRMA_NON_ATTIVA',
        `Questa richiesta di firma è già conclusa (${sessione.stato}): non c'è nulla da riprendere.`
      )
    }

    // Firma di partenza: passa dal suo use case, cosi' lo storico registra l'esito della ripresa e una nuova
    // richiesta ricontrolla `/azioni` prima di una nuova `authorize`.
    const operazionePartenza = operazionePartenzaDaTipo(sessione.tipoOperazione)
    if (operazionePartenza) {
      const { firma } = await this.firmaPartenza.execute({
        firId,
        tenantId,
        utenteId,
        nuovaSessione: comando.nuovaSessione,
        correlationId,
        ammesse: [operazionePartenza],
      })
      return firma
    }

    return this.completaOperazioneConFirma.execute({
      firId,
      tenantId,
      tipoOperazione: sessione.tipoOperazione,
      utenteId,
      nuovaSessione: comando.nuovaSessione,
      correlationId,
    })
  }

  private async verificaFir(firId: string, tenantId: string): Promise<FIR> {
    const fir = await this.firRepository.findById(firId)
    if (!fir) throw DomainException.notFound('FIR', firId)
    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }
    return fir
  }
}
