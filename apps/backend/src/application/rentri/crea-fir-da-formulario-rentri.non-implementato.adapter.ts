import { Injectable } from '@nestjs/common'
import { DomainException } from '../../domain/shared/domain-exception'
import { CreaFIRDaFormularioRENTRIPort } from './crea-fir-da-formulario-rentri.port'

/**
 * Placeholder di {@link CreaFIRDaFormularioRENTRIPort}: il Task 5
 * (creazione del FIR locale dal dettaglio RENTRI) non è ancora implementato
 * in questo worktree. Registrato esplicitamente in `RentriSyncModule` invece
 * di lasciare il token non risolvibile — un provider mancante darebbe un
 * errore di risoluzione DI opaco al bootstrap dell'intero modulo, non un
 * errore di dominio leggibile solo quando l'utente sceglie davvero il ramo
 * "nuovo formulario" (v. R0 Task 4 per il precedente di cosa succede quando
 * un pezzo del sistema resta silenziosamente orfano).
 *
 * Da sostituire con l'implementazione reale quando il Task 5 sarà pronto:
 * nessun'altra modifica richiesta in `AcquisisciFormularioRENTRIUseCase`
 * (dipende dalla porta, non da questo adapter).
 */
@Injectable()
export class CreaFIRDaFormularioRENTRINonImplementatoAdapter
  implements CreaFIRDaFormularioRENTRIPort
{
  async creaDaDettaglio(): Promise<never> {
    throw DomainException.businessRuleViolation(
      'CREAZIONE_FIR_DA_RENTRI_NON_IMPLEMENTATA',
      'La creazione automatica del FIR locale dal dettaglio RENTRI (Task 5) non è ancora disponibile: ' +
        'usa "collega al FIR locale" su un FIR già esistente.'
    )
  }
}
