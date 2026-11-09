import { SetMetadata } from '@nestjs/common'
import type { FeatureKey } from '../../application/admin/feature-catalog'

export const RICHIEDE_MODULO = 'richiedeModulo'
export const SENZA_MODULO = 'senzaModulo'

/**
 * La rotta (o tutta la classe) richiede un modulo commerciale attivo per l'azienda selezionata.
 * Con piu' chiavi ne basta UNA (es. CER si legge con cer, fir, registro o giacenze).
 * Il decoratore sul metodo prevale su quello della classe.
 * Il controllo lo fa `ModuloAttivoInterceptor`: 403 `MODULO_NON_ATTIVO` se nessuna e' attiva.
 */
export const RichiedeModulo = (...chiavi: [FeatureKey, ...FeatureKey[]]) =>
  SetMetadata(RICHIEDE_MODULO, chiavi)

/**
 * La rotta non dipende da nessun modulo (area base, pubblica o di piattaforma). Il motivo
 * e' obbligatorio e finisce nella documentazione del codice, non nella risposta.
 */
export const SenzaModulo = (motivo: string) => SetMetadata(SENZA_MODULO, motivo)
