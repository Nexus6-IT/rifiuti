/**
 * SPID Level Guard
 *
 * Verifica che l'utente abbia il livello SPID adeguato per operazioni
 * sensibili come l'apposizione della firma digitale sul FIR.
 *
 * MODALITÀ SANDBOX (default):
 *  - Se il JWT non include il campo `spidLevel`, il guard accetta la richiesta
 *    simulando SPID Level 2 (per lo sviluppo/test senza IdP SPID reale).
 *  - Un warning è loggato per evidenziare che la verifica è simulata.
 *
 * ATTIVARE la verifica SPID reale:
 *  1. Configurare SPID_STRICT_LEVEL_CHECK=true nell'env.
 *  2. Assicurarsi che il JWT emesso da Keycloak (realm ignicraft, client rifiuti)
 *     includa il claim `spidLevel` (o `acr`) impostato dall'IdP SPID/CIE.
 *  3. Con SPID Level 2 (auth a due fattori via SPID o CIE) il claim è presente.
 *
 * Normativa:
 *  - DPCM 24/10/2014 e successive modifiche: livelli SPID 1, 2, 3
 *  - DM 59/2023: la firma del FIR richiede strumento di firma elettronica avanzata
 *    (FEA) — SPID Level 2 è uno strumento FEA idoneo (art. 20 CAD)
 *  - AgID: https://www.agid.gov.it/en/platforms/qualified-electronic-signature
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/** Livello SPID minimo richiesto per la firma FIR. */
const REQUIRED_SPID_LEVEL = 2

@Injectable()
export class SpidLevelGuard implements CanActivate {
  private readonly logger = new Logger(SpidLevelGuard.name)

  constructor(private readonly config?: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (!user) {
      throw new ForbiddenException('Utente non autenticato')
    }

    // `acr` è il claim OpenID Connect usato da Keycloak per il livello SPID
    // (Access Context Class Reference). In assenza, cerchiamo `spidLevel`.
    const spidLevel: number =
      this.parseAcr(user.acr) ?? user.spidLevel ?? user.amr?.level ?? null

    const strictCheck = this.config?.get<string>('SPID_STRICT_LEVEL_CHECK') === 'true'

    if (spidLevel === null || spidLevel === undefined) {
      if (strictCheck) {
        throw new ForbiddenException(
          'Livello SPID non rilevabile dal JWT. ' +
          'Autenticarsi con SPID Level 2 o CIE per firmare il FIR.',
        )
      }
      // SANDBOX: claim assente → simuliamo Level 2 (sviluppo/test)
      this.logger.warn(
        '[SANDBOX] Claim spidLevel assente nel JWT — livello SPID simulato a 2. ' +
        'ATTIVARE: SPID_STRICT_LEVEL_CHECK=true in produzione.',
      )
      return true
    }

    if (spidLevel < REQUIRED_SPID_LEVEL) {
      throw new ForbiddenException(
        `Livello SPID insufficiente (${spidLevel}). ` +
        `Richiesto SPID Level ${REQUIRED_SPID_LEVEL} per la firma FIR (DM 59/2023).`,
      )
    }

    return true
  }

  /**
   * Converte il claim `acr` OpenID Connect in livello numerico SPID.
   * Keycloak con SPID emette acr come "https://www.spid.gov.it/SpidL2" o simili.
   */
  private parseAcr(acr?: string): number | null {
    if (!acr) return null
    const match = acr.match(/SpidL(\d)/)
    if (match) return parseInt(match[1], 10)
    // CIE (Carta d'Identità Elettronica) equivale a SPID Level 2
    if (acr.includes('cie') || acr.includes('CIE')) return 2
    return null
  }
}
