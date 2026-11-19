import { Injectable } from '@nestjs/common'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { LoggerService } from '../../core/logger/logger.service'
import {
  CompletaOperazioneConFirmaUseCase,
  EsitoCompletamentoFirma,
} from './completa-operazione-con-firma.use-case'
import { ISessioniFirmaRentriRepository } from './sessioni-firma-rentri.port'

/** Vista della sessione per l'interfaccia: mai token, digest o handle. */
export interface SessioneFirmaInAttesa {
  id: string
  tipoOperazione: string
  scadenza: Date
  /** `true` se il limite dei 120 s e' gia' passato: va richiesta una nuova firma, non ripresa. */
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
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('GestisciSessioneFirmaRentriUseCase')
  }

  async inAttesa(firId: string, tenantId: string): Promise<SessioneFirmaInAttesa | null> {
    await this.verificaFir(firId, tenantId)
    const aperta = await this.sessioni.trovaAperta(tenantId, firId)
    if (!aperta) return null
    return {
      id: aperta.id,
      tipoOperazione: aperta.tipoOperazione,
      scadenza: aperta.scadenza,
      scaduta: aperta.scadenza.getTime() <= Date.now(),
    }
  }

  async riprendi(comando: ComandoRiprendiFirma): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, sessioneId, utenteId, correlationId } = comando
    await this.verificaFir(firId, tenantId)

    const sessione = await this.sessioni.trovaPerId(tenantId, sessioneId)
    if (!sessione || sessione.firId !== firId) {
      throw DomainException.notFound('Sessione di firma', sessioneId)
    }

    if (sessione.stato !== 'IN_ATTESA' && !comando.nuovaSessione) {
      if (sessione.stato === 'SCADUTA') {
        return {
          esito: 'SCADUTA',
          handle: sessione.handle,
          sessioneId: sessione.id,
          rilevataDa: sessione.dettaglioEnte ? 'ente' : 'orologio-locale',
          ...(sessione.dettaglioEnte && { dettaglioEnte: sessione.dettaglioEnte }),
        }
      }
      if (sessione.stato === 'RIFIUTATA') {
        return {
          esito: 'RIFIUTATA',
          handle: sessione.handle,
          sessioneId: sessione.id,
          ...(sessione.dettaglioEnte && { dettaglioEnte: sessione.dettaglioEnte }),
        }
      }
      throw DomainException.businessRuleViolation(
        'SESSIONE_FIRMA_NON_ATTIVA',
        `Questa richiesta di firma è già conclusa (${sessione.stato}): non c'è nulla da riprendere.`
      )
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

  private async verificaFir(firId: string, tenantId: string): Promise<void> {
    const fir = await this.firRepository.findById(firId)
    if (!fir) throw DomainException.notFound('FIR', firId)
    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }
  }
}
