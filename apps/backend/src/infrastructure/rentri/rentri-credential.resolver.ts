import { Injectable, Inject, Logger, Optional } from '@nestjs/common'
import { algoritmoEffettivo } from './certificato/algoritmo-da-chiave'
import { TenantContext } from '../../core/context/tenant-context'
import { MetricsService } from '../../core/metrics/metrics.service'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { RentriCredentialService } from './rentri-credential.service'

/** Credenziale effettiva usata per firmare le chiamate RENTRI. */
export interface ResolvedRentriCredential {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  algorithm: 'RS256' | 'ES256'
  /** Origine: certificato del tenant oppure credenziale globale da env. */
  source: 'tenant' | 'env'
}

export { CODICE_CERTIFICATO_MANCANTE } from './rentri-certificato.costanti'

/** Messaggio per l'utente (mai l'id del tenant): unica fonte, usata anche da `traduciErroreRentri`. */
export const MESSAGGIO_CERTIFICATO_MANCANTE =
  "L'azienda non ha un certificato RENTRI configurato: caricalo nella pagina del certificato RENTRI."

/**
 * Il tenant non ha un certificato RENTRI proprio e non e' l'azienda legata alla
 * credenziale env: non si firma. Il messaggio e' pensato per l'utente e NON
 * contiene l'id del tenant (sta nel log).
 */
export class TenantSenzaCertificatoRentriError extends Error {
  constructor() {
    super(MESSAGGIO_CERTIFICATO_MANCANTE)
    this.name = 'TenantSenzaCertificatoRentriError'
  }
}

/**
 * Risolve la credenziale RENTRI da usare per la richiesta corrente.
 *
 * Il tenant e' passato in modo ESPLICITO a {@link resolve} (unico punto di
 * risoluzione, usato sia dal JWT `Authorization` sia dalla firma di integrita'
 * `Agid-JWT-Signature`). Regole:
 *  1. tenant con credenziale propria -> la usa;
 *  2. tenant SENZA credenziale propria -> usa la credenziale globale da env
 *     SOLO se e' l'azienda legata da `RENTRI_ENV_TENANT_ID`; altrimenti (anche
 *     con la variabile vuota) solleva {@link TenantSenzaCertificatoRentriError}:
 *     fail-closed, RENTRI non deve vedere il titolare del certificato env agire
 *     sui registri di un'altra azienda;
 *  3. nessun tenant (chiamate di piattaforma in sola lettura, es. sync mensile
 *     delle codifiche) -> credenziale env, se configurata.
 *
 * Senza tenant esplicito si ricade sul {@link TenantContext} (con un warn, una
 * volta per processo): nei worker BullMQ il contesto non c'e', quindi i
 * chiamanti devono passare il tenant. I warn di tenant si scrivono una volta per
 * tenant per processo; ogni uso dell'env da parte di un tenant incrementa
 * `rentri_credential_env_fallback_total`.
 */
@Injectable()
export class RentriCredentialResolver {
  private readonly logger = new Logger(RentriCredentialResolver.name)
  /** Tenant per cui il warn "usa la credenziale env" e' gia' stato scritto. */
  private readonly warnEnvFatto = new Set<string>()
  /** Tenant per cui il warn "algoritmo discordante" e' gia' stato scritto. */
  private readonly warnAlgoritmoFatto = new Set<string>()
  /** Tenant per cui il warn "senza certificato" e' gia' stato scritto. */
  private readonly warnSenzaCertFatto = new Set<string>()
  private warnContestoFatto = false

  constructor(
    private readonly credentialService: RentriCredentialService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    @Optional() private readonly metrics?: MetricsService
  ) {}

  async resolve(tenantIdEsplicito?: string): Promise<ResolvedRentriCredential> {
    let tenantId: string | undefined = tenantIdEsplicito
    if (!tenantId) {
      tenantId = TenantContext.getTenantId() ?? undefined
      if (!this.warnContestoFatto) {
        this.warnContestoFatto = true
        this.logger.warn(
          'risoluzione della credenziale RENTRI dal contesto: passare il tenant in modo esplicito'
        )
      }
    }

    if (tenantId) {
      const cred = await this.credentialService.getForTenant(tenantId)
      if (cred) {
        return {
          clientId: cred.clientId,
          certificatePem: cred.certificatePem,
          privateKeyPem: cred.privateKeyPem,
          algorithm: this.algoritmo(tenantId, cred.privateKeyPem, cred.algorithm),
          source: 'tenant',
        }
      }

      // Tenant senza credenziale propria: l'env vale solo per l'azienda legata.
      if (!this.legatoAllEnv(tenantId)) {
        if (!this.warnSenzaCertFatto.has(tenantId)) {
          this.warnSenzaCertFatto.add(tenantId)
          this.logger.warn(
            `Il tenant ${tenantId} non ha una credenziale RENTRI propria e non e' legato alla credenziale env (RENTRI_ENV_TENANT_ID): firma rifiutata`
          )
        }
        throw new TenantSenzaCertificatoRentriError()
      }
    }

    if (this.config.certificatePem && this.config.privateKeyPem) {
      if (tenantId) {
        // Mai materiale di chiave nel log: solo l'id del tenant.
        this.metrics?.rentriCredentialEnvFallback.inc({ tenant_id: tenantId })
        if (!this.warnEnvFatto.has(tenantId)) {
          this.warnEnvFatto.add(tenantId)
          this.logger.warn(
            `Il tenant ${tenantId} non ha una credenziale RENTRI propria: si firma con la credenziale globale da env (RENTRI_ENV_TENANT_ID)`
          )
        }
      }
      return {
        clientId: this.config.clientId,
        certificatePem: this.config.certificatePem,
        privateKeyPem: this.config.privateKeyPem,
        algorithm: this.algoritmo(
          tenantId ?? '(piattaforma)',
          this.config.privateKeyPem,
          this.config.algorithm
        ),
        source: 'env',
      }
    }

    // L'id del tenant sta solo nel log: il messaggio puo' arrivare all'utente.
    if (tenantId) {
      this.logger.error(
        `RENTRI: nessuna credenziale per il tenant ${tenantId} e nessun fallback da env (PEM env vuoti)`
      )
    }
    throw new Error(
      tenantId
        ? "RENTRI: nessuna credenziale configurata per l'azienda e nessun fallback da env"
        : 'RENTRI: nessun TenantContext e nessuna credenziale di fallback da env'
    )
  }

  /**
   * Il tenant ha una credenziale utilizzabile? Stessa regola di {@link resolve}
   * (credenziale propria; altrimenti env solo per il tenant legato da
   * `RENTRI_ENV_TENANT_ID`, anche se i PEM env mancano: li' resolve da' un errore di configurazione), ma non solleva e non ha
   * effetti collaterali: niente warn, niente conteggio del fallback env (un
   * controllo dei job periodici non e' un uso). Se la lettura della credenziale
   * fallisce l'errore si propaga: non e' un "no" e va trattato come guasto vero.
   */
  async haCredenziale(tenantId: string): Promise<boolean> {
    if (await this.credentialService.getForTenant(tenantId)) return true
    // Legato all'env ma con PEM mancanti: true, cosi' il cron procede e resolve
    // solleva l'errore di configurazione vero (che si segnala), non un "senza certificato".
    return this.legatoAllEnv(tenantId)
  }

  /** Unica regola "l'env vale per questo tenant": solo l'azienda legata da RENTRI_ENV_TENANT_ID. */
  private legatoAllEnv(tenantId: string): boolean {
    return Boolean(this.config.envTenantId) && tenantId === this.config.envTenantId
  }

  /** Algoritmo di firma = quello della chiave; la colonna `algorithm` e' solo informativa. */
  private algoritmo(
    chiaveWarn: string,
    privateKeyPem: string,
    dichiarato: 'RS256' | 'ES256'
  ): 'RS256' | 'ES256' {
    const { algoritmo, discordante } = algoritmoEffettivo(privateKeyPem, dichiarato)
    if (discordante && !this.warnAlgoritmoFatto.has(chiaveWarn)) {
      this.warnAlgoritmoFatto.add(chiaveWarn)
      this.logger.warn(
        `Algoritmo RENTRI salvato (${dichiarato}) diverso da quello della chiave (${algoritmo}): si firma con ${algoritmo} (tenant ${chiaveWarn})`
      )
    }
    return algoritmo
  }
}
