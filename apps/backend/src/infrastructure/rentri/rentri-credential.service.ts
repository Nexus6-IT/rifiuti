import { Injectable, Inject } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma.service'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { encryptSecret, decryptSecret } from './rentri-crypto.util'

/** Credenziale RENTRI in chiaro (chiave privata decifrata) per uso runtime. */
export interface RentriCredentialPlain {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  algorithm: 'RS256' | 'ES256'
  environment: string
}

/** Dati per creare/aggiornare la credenziale di un tenant. */
export interface RentriCredentialInput {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  algorithm?: 'RS256' | 'ES256'
  environment?: string
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
    const privateKeyEnc = encryptSecret(input.privateKeyPem, this.config.credentialEncKey)
    const data = {
      clientId: input.clientId,
      certificatePem: input.certificatePem,
      privateKeyEnc,
      algorithm: input.algorithm || 'RS256',
      environment: input.environment || 'demo',
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
