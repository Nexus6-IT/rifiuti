/**
 * Porta dello storico delle operazioni del viaggio inviate all'ente (FIR in viaggio, P2): una riga per
 * operazione (quantita', trasporto, rollback, reset, ...), scritta a esito noto. SOLO INSERIMENTO: la
 * tabella `fir_eventi_rentri` non ammette UPDATE ne' DELETE ai ruoli applicativi.
 *
 * Il `payload` e' il corpo di DOMINIO inviato all'ente: mai dati di firma, token ne' certificati.
 */

export type EsitoEventoFirRentri = 'INVIATA' | 'ACCETTATA' | 'RIFIUTATA' | 'INCERTA'

export interface EventoFirRentri {
  id: string
  tenantId: string
  firId: string
  /** Nome dell'`Operazione` del contratto (`DatiQuantita`, `Trasporto`, `Reset`, ...). */
  operazione: string
  payload: unknown | null
  transazioneId: string | null
  esito: EsitoEventoFirRentri
  /** Dettaglio dell'ente (validazione) o del problema locale, in testo. */
  dettaglioEnte: string | null
  /** Stato del formulario riletto dall'ente dopo l'operazione (`StatoFormulario`). */
  statoFormularioDopo: string | null
  utenteId: string | null
  createdAt: Date
}

export type NuovoEventoFirRentri = Omit<EventoFirRentri, 'id' | 'createdAt'>

export abstract class IEventiFirRentriRepository {
  abstract registra(evento: NuovoEventoFirRentri): Promise<EventoFirRentri>
  /** Dal piu' recente; `limite` di default 200. */
  abstract elenca(tenantId: string, firId: string, limite?: number): Promise<EventoFirRentri[]>
}
