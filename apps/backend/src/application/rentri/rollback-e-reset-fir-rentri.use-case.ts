import { Injectable } from '@nestjs/common'
import { verificaFirNonBloccato } from '../../domain/fir/guardia-invio-rentri'
import { StatoFormulario } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { LoggerService } from '../../core/logger/logger.service'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import { IEventiFirRentriRepository } from './eventi-fir-rentri.port'
import { registraEventoFirRentri } from './registra-evento-fir-rentri'
import { ISessioniFirmaRentriRepository } from './sessioni-firma-rentri.port'

export type OperazioneRollbackOReset = 'RollbackFirma' | 'Reset'

export interface ComandoRollbackOReset {
  firId: string
  tenantId: string
  operazione: OperazioneRollbackOReset
  /** Utente che ha chiesto l'operazione: finisce nel log di audit. */
  utenteId?: string
  correlationId?: string
}

export interface EsitoRollbackOReset {
  operazione: OperazioneRollbackOReset
  /** Stato del formulario RILETTO dall'ente dopo l'operazione. */
  statoFormulario: StatoFormulario
  /** Sessione di firma in attesa chiusa ANNULLATA da questa operazione, se c'era. */
  sessioneAnnullataId?: string
}

/**
 * Annulla l'ultima firma (`RollbackFirma`) oppure cancella gli ultimi dati inseriti e non ancora firmati
 * (`Reset`) di un FIR RENTRI (FIR in viaggio, P1).
 *
 * `Reset` e' anche il «Annulla la richiesta» del banner di firma in attesa: riporta il formulario allo
 * stato precedente e chiude la sessione di firma aperta come ANNULLATA.
 *
 * **Sequenza fail-closed, in ordine:**
 * 1. Precondizioni locali (FIR del tenant, non bloccato, legato a RENTRI) — prima di qualunque rete.
 * 2. `/azioni` (via {@link GetAzioniDisponibiliUseCase}): l'operazione deve esserci, altrimenti
 *    `OPERAZIONE_NON_DISPONIBILE` (409) SENZA chiamare l'ente: la disponibilita' la decide sempre l'ente,
 *    mai una deduzione locale (le condizioni di `rollback-firma` — 15 minuti, xFIR gia' scaricato, copie
 *    gia' restituite — le conosce solo lui).
 * 3. POST dell'operazione; se l'ente rifiuta (`esito.errore`) errore leggibile, NESSUN dato locale toccato.
 * 4. Solo dopo l'esito positivo: stato riletto da `/stato` e applicato al FIR, poi la sessione aperta
 *    (se c'e') chiusa ANNULLATA.
 *
 * L'evento di audit e' una riga di `fir_eventi_rentri` (utente, operazione, esito, stato dopo), oltre al log
 * strutturato: scritta a esito noto, e un suo errore non maschera mai l'esito dell'operazione.
 */
@Injectable()
export class RollbackEResetFirRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly sessioni: ISessioniFirmaRentriRepository,
    private readonly logger: LoggerService,
    private readonly eventi: IEventiFirRentriRepository
  ) {
    this.logger.setContext('RollbackEResetFirRentriUseCase')
  }

  async execute(comando: ComandoRollbackOReset): Promise<EsitoRollbackOReset> {
    const { firId, tenantId, operazione, utenteId, correlationId } = comando

    // --- 1. Precondizioni locali ---

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
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è nulla da annullare presso l'ente."
      )
    }
    const numeroFir = fir.rentriNumeroFir

    // --- 2. Precondizione da /azioni ---

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    if (!azioni.some(a => a.operazione === operazione)) {
      throw DomainException.businessRuleViolation(
        'OPERAZIONE_NON_DISPONIBILE',
        operazione === 'Reset'
          ? "L'ente non consente ora di annullare l'ultima richiesta su questo formulario: nessuna operazione è stata inviata."
          : "L'ente non consente ora di annullare l'ultima firma di questo formulario (può essere troppo tardi o il file è già stato scaricato): nessuna operazione è stata inviata."
      )
    }

    // --- 3. Scrittura presso l'ente ---

    const esito =
      operazione === 'Reset'
        ? await this.rentriApiClient.resetStato(tenantId, numeroFir)
        : await this.rentriApiClient.rollbackFirma(tenantId, numeroFir)

    if (esito.errore) {
      await registraEventoFirRentri(this.eventi, this.logger, {
        tenantId,
        firId,
        operazione,
        payload: null,
        transazioneId: null,
        esito: 'RIFIUTATA',
        dettaglioEnte: JSON.stringify(esito.validazione),
        statoFormularioDopo: null,
        utenteId: utenteId ?? null,
      })
      throw DomainException.businessRuleViolation(
        operazione === 'Reset' ? 'RESET_RENTRI_RIFIUTATO' : 'ROLLBACK_FIRMA_RIFIUTATO',
        `L'ente ha rifiutato l'operazione ${operazione} sul formulario ${numeroFir}. ` +
          `Dettaglio della validazione RENTRI: ${JSON.stringify(esito.validazione)}`
      )
    }

    // --- 4. L'ente ha eseguito: la sessione aperta si chiude SUBITO (anche se la rilettura fallisse) ---

    const aperta = await this.sessioni.trovaAperta(tenantId, firId)
    let sessioneAnnullataId: string | undefined
    if (aperta) {
      await this.sessioni.chiudi(tenantId, aperta.id, 'ANNULLATA', `Chiusa da ${operazione}`)
      sessioneAnnullataId = aperta.id
    }

    // Stato riletto dall'ente, mai dedotto.

    const statoEnte = await this.rentriApiClient.leggiStato(tenantId, numeroFir)
    fir.applyRentriStato(statoEnte.stato_formulario, correlationId)
    await this.firRepository.save(fir)

    await registraEventoFirRentri(this.eventi, this.logger, {
      tenantId,
      firId,
      operazione,
      payload: null,
      transazioneId: null,
      esito: 'ACCETTATA',
      dettaglioEnte: null,
      statoFormularioDopo: statoEnte.stato_formulario,
      utenteId: utenteId ?? null,
    })

    this.logger.info('Operazione RENTRI di annullamento eseguita', {
      firId,
      tenantId,
      numeroFir,
      operazione,
      utenteId,
      statoFormularioDopo: statoEnte.stato_formulario,
      sessioneAnnullataId,
      correlationId,
    })

    return {
      operazione,
      statoFormulario: statoEnte.stato_formulario,
      ...(sessioneAnnullataId && { sessioneAnnullataId }),
    }
  }
}
