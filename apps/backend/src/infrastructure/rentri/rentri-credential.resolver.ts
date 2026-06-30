import { Injectable, Inject } from '@nestjs/common'
import { TenantContext } from '../../core/context/tenant-context'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriCredentialService } from './rentri-credential.service'

/** Credenziale effettiva usata per firmare le chiamate RENTRI. */
export interface ResolvedRentriCredential {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  algorithm: 'RS256' | 'ES256'
  /** Origine: certificato del tenant corrente oppure fallback da env. */
  source: 'tenant' | 'env'
}

/**
 * Risolve la credenziale RENTRI da usare per la richiesta corrente.
 *
 * Modello multi-tenant: ogni tenant usa il PROPRIO certificato di
 * interoperabilità. Il resolver legge il tenant dal {@link TenantContext} e:
 *  1. se il tenant ha una credenziale configurata → usa quella;
 *  2. altrimenti ricade sulle credenziali globali da env (utile per pilota
 *     single-operator / sviluppo).
 *
 * Se in modalità `live` non c'è né credenziale del tenant né fallback da env,
 * lancia un errore esplicito (non si può firmare senza certificato).
 *
 * NB: perché la risoluzione per-tenant funzioni, la chiamata RENTRI deve essere
 * eseguita entro il contesto del tenant (TenantContext.run). I job che
 * sincronizzano FIR per più tenant devono impostare il contesto per ciascun FIR.
 */
@Injectable()
export class RentriCredentialResolver {
  constructor(
    private readonly credentialService: RentriCredentialService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig
  ) {}

  async resolve(): Promise<ResolvedRentriCredential> {
    const tenantId = TenantContext.getTenantId()

    if (tenantId) {
      const cred = await this.credentialService.getForTenant(tenantId)
      if (cred) {
        return {
          clientId: cred.clientId,
          certificatePem: cred.certificatePem,
          privateKeyPem: cred.privateKeyPem,
          algorithm: cred.algorithm,
          source: 'tenant',
        }
      }
    }

    // Fallback: credenziale globale da env (pilota single-operator / dev).
    if (this.config.certificatePem && this.config.privateKeyPem) {
      return {
        clientId: this.config.clientId,
        certificatePem: this.config.certificatePem,
        privateKeyPem: this.config.privateKeyPem,
        algorithm: this.config.algorithm,
        source: 'env',
      }
    }

    throw new Error(
      tenantId
        ? `RENTRI: nessuna credenziale per il tenant ${tenantId} e nessun fallback da env`
        : 'RENTRI: nessun TenantContext e nessuna credenziale di fallback da env'
    )
  }
}
