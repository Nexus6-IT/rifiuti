import { DomainException } from '../../domain/shared/domain-exception'
import { EsitoCompletamentoFirma } from './completa-operazione-con-firma.use-case'
import { EsitoEventoFirRentri } from './eventi-fir-rentri.port'

/**
 * Traduzione dell'esito del ciclo comune di firma nella riga dello storico `fir_eventi_rentri`: la usano
 * tutte le operazioni del viaggio che si chiudono con una firma (partenza P3, annotazione P4, ...).
 */

/** Esito dello storico per un'eccezione del ciclo di firma; `null` = non e' un esito dell'ente (nessuna riga). */
export function esitoEventoDaErroreFirma(errore: unknown): EsitoEventoFirRentri | null {
  if (errore instanceof DomainException) {
    const rule = errore.metadata?.rule as string | undefined
    if (rule === 'FIRMA_RENTRI_RIFIUTATA') return 'RIFIUTATA'
    // Conflitti e precondizioni locali: nessuna operazione e' arrivata all'ente.
    return null
  }
  return 'INCERTA'
}

export function eventoDaEsitoFirma(firma: EsitoCompletamentoFirma): {
  esito: EsitoEventoFirRentri
  dettaglioEnte: string | null
  statoFormularioDopo: string | null
} {
  switch (firma.esito) {
    case 'COMPLETATA':
      return { esito: 'ACCETTATA', dettaglioEnte: null, statoFormularioDopo: firma.statoFormulario }
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
