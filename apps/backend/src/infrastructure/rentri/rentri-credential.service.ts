import { Injectable, Inject, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma.service'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { encryptSecret, decryptSecret } from './rentri-crypto.util'

/**
 * Formato del numero di iscrizione dell'unità locale RENTRI (`num_iscr_sito`),
 * identico su ogni path del contratto formulari.yaml che lo referenzia (es.
 * riga 684, `/{numero_fir}/acquisizione-visibilita/{num_iscr_sito}`). Un
 * valore fuori pattern verso RENTRI diventerebbe un 400 (o peggio, un 423 per
 * insistenza con richieste non valide): va bloccato qui, prima di persistere.
 */
export const NUM_ISCR_SITO_PATTERN = /^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$/

/** Credenziale RENTRI in chiaro (chiave privata decifrata) per uso runtime. */
export interface RentriCredentialPlain {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  algorithm: 'RS256' | 'ES256'
  environment: string
  /** Numero di iscrizione dell'unità locale RENTRI del tenant, se configurato. */
  numIscrSito?: string | null
}

/** Dati per creare/aggiornare la credenziale di un tenant. */
export interface RentriCredentialInput {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  algorithm?: 'RS256' | 'ES256'
  environment?: string
  /**
   * Numero di iscrizione dell'unità locale RENTRI (opzionale in R2: inserito a
   * mano dall'amministratore; R4 potrà proporlo/precompilarlo dalle
   * anagrafiche senza cambiare questo contratto).
   */
  numIscrSito?: string | null
}

/**
 * Gestisce la persistenza delle credenziali RENTRI per-tenant. La chiave privata
 * è SEMPRE cifrata a riposo (AES-256-GCM) e decifrata solo al momento dell'uso.
 */
@Injectable()
export class RentriCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig
  ) {}

  /** Salva (crea o aggiorna) la credenziale RENTRI di un tenant, cifrando la chiave. */
  async upsertForTenant(tenantId: string, input: RentriCredentialInput): Promise<void> {
    if (input.numIscrSito && !NUM_ISCR_SITO_PATTERN.test(input.numIscrSito)) {
      throw new BadRequestException(
        `Numero di iscrizione dell'unità locale RENTRI non valido: deve rispettare il formato ${NUM_ISCR_SITO_PATTERN.source}`
      )
    }

    const privateKeyEnc = encryptSecret(input.privateKeyPem, this.config.credentialEncKey)
    const data = {
      clientId: input.clientId,
      certificatePem: input.certificatePem,
      privateKeyEnc,
      algorithm: input.algorithm || 'RS256',
      environment: input.environment || 'demo',
      numIscrSito: input.numIscrSito ?? null,
    }

    await this.prisma.rentriCredential.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    })
  }

  /** Ritorna la credenziale in chiaro del tenant, o null se non configurata. */
  async getForTenant(tenantId: string): Promise<RentriCredentialPlain | null> {
    const record = await this.prisma.rentriCredential.findUnique({
      where: { tenantId },
    })
    if (!record) return null

    return {
      clientId: record.clientId,
      certificatePem: record.certificatePem,
      privateKeyPem: decryptSecret(record.privateKeyEnc, this.config.credentialEncKey),
      algorithm: (record.algorithm as 'RS256' | 'ES256') || 'RS256',
      environment: record.environment,
      numIscrSito: record.numIscrSito ?? null,
    }
  }

  /** Indica se il tenant ha una credenziale configurata (senza decifrare). */
  async hasForTenant(tenantId: string): Promise<boolean> {
    const count = await this.prisma.rentriCredential.count({ where: { tenantId } })
    return count > 0
  }

  /** Rimuove la credenziale RENTRI di un tenant. */
  async removeForTenant(tenantId: string): Promise<void> {
    await this.prisma.rentriCredential.deleteMany({ where: { tenantId } })
  }
}
