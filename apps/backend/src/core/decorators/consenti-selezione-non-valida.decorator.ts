import { SetMetadata } from '@nestjs/common'

export const CONSENTI_SELEZIONE_NON_VALIDA = 'consentiSelezioneNonValida'

/**
 * Rotte di RECUPERO: rispondono anche quando l'header `X-Tenant-ID` indica un'azienda
 * che l'utente non può (più) usare, perché servono a sceglierne un'altra o a gestire la
 * sessione (elenco delle aziende, switch, login/refresh/logout).
 *
 * Ovunque altrove il `TenantSwitchInterceptor` rifiuta la richiesta con 403
 * `AZIENDA_SELEZIONATA_NON_ACCESSIBILE` invece di ricadere sull'azienda primaria: un
 * ripiego silenzioso scriverebbe nell'azienda sbagliata. Su queste rotte la richiesta
 * prosegue col tenant primario del token, come se l'header non ci fosse.
 *
 * Non va messo su rotte che leggono o scrivono dati di un'azienda.
 */
export const ConsentiSelezioneNonValida = () => SetMetadata(CONSENTI_SELEZIONE_NON_VALIDA, true)
