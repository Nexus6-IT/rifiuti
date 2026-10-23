import { Injectable, Inject, Logger } from '@nestjs/common'
import { algoritmoEffettivo } from './certificato/algoritmo-da-chiave'
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
 * interoperabilità. Il tenant è passato in modo ESPLICITO a {@link resolve}
 * (è l'unico punto di risoluzione, usato sia dal JWT `Authorization` sia dalla
 * firma di integrità `Agid-JWT-Signature`):
 *  1. se il tenant ha una credenziale configurata → usa quella;
 *  2. altrimenti ricade sulle credenziali globali da env (pilota
 *     single-operator / sviluppo), loggando un warn con l'id del tenant.
 *
 * Se in modalità `live` non c'è né credenziale del tenant né fallback da env,
 * lancia un errore esplicito (non si può firmare senza certificato).
 *
 * Senza tenant esplicito si ricade sul {@link TenantContext} (con un warn): nei
 * worker BullMQ il contesto non c'è, quindi i chiamanti devono passare il tenant.
 */
@Injectable()
export class RentriCredentialResolver {
  private readonly logger = new Logger(RentriCredentialResolver.name)

  constructor(
    private readonly credentialService: RentriCredentialService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig
  ) {}

  async resolve(tenantIdEsplicito?: string): Promise<ResolvedRentriCredential> {
    let tenantId: string | undefined = tenantIdEsplicito
    if (!tenantId) {
      tenantId = TenantContext.getTenantId() ?? undefined
      this.logger.warn(
        'risoluzione della credenziale RENTRI dal contesto: passare il tenant in modo esplicito'
      )
    }

    if (tenantId) {
      const cred = await this.credentialService.getForTenant(tenantId)
      if (cred) {
        return {
          clientId: cred.clientId,
          certificatePem: cred.certificatePem,
          privateKeyPem: cred.privateKeyPem,
          algorithm: this.algoritmo(cred.privateKeyPem, cred.algorithm),
          source: 'tenant',
        }
      }
    }

    // Fallback: credenziale globale da env (pilota single-operator / dev).
    if (this.config.certificatePem && this.config.privateKeyPem) {
      if (tenantIdEsplicito) {
        // Mai materiale di chiave nel log: solo l'id del tenant.
        this.logger.warn(
          `Il tenant ${tenantIdEsplicito} non ha una credenziale RENTRI propria: si firma con la credenziale globale da env`
        )
      }
      return {
        clientId: this.config.clientId,
        certificatePem: this.config.certificatePem,
        privateKeyPem: this.config.privateKeyPem,
        algorithm: this.algoritmo(this.config.privateKeyPem, this.config.algorithm),
        source: 'env',
      }
    }

    throw new Error(
      tenantId
        ? `RENTRI: nessuna credenziale per il tenant ${tenantId} e nessun fallback da env`
        : 'RENTRI: nessun TenantContext e nessuna credenziale di fallback da env'
    )
  }

  /** Algoritmo di firma = quello della chiave; la colonna `algorithm` e' solo informativa. */
  private algoritmo(privateKeyPem: string, dichiarato: 'RS256' | 'ES256'): 'RS256' | 'ES256' {
    const { algoritmo, discordante } = algoritmoEffettivo(privateKeyPem, dichiarato)
    if (discordante) {
      this.logger.warn(
        `Algoritmo RENTRI salvato (${dichiarato}) diverso da quello della chiave (${algoritmo}): si firma con ${algoritmo}`
      )
    }
    return algoritmo
  }
}
