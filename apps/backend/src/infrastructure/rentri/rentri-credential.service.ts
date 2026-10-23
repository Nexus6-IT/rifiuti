import { Injectable, Inject, BadRequestException, Logger } from '@nestjs/common'
import * as Sentry from '@sentry/node'
import { RENTRISyncStatus as PrismaRentriSyncStatus } from '@prisma/client'
import { PrismaService } from '../persistence/prisma.service'
import { RentriConfig, RENTRI_CONFIG } from './rentri-config'
import { encryptSecret, decryptSecret } from './rentri-crypto.util'
import { CODICE_CERTIFICATO_MANCANTE } from './rentri-certificato.costanti'

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
  /**
   * Numero di iscrizione dell'OPERATORE (R4 Task 3), parametro `num_iscr` di
   * `GET /anagrafiche/v1.0/operatore/{num_iscr}/siti`. Senza questo valore
   * `SincronizzaSitiUseCase` non può leggere le unità locali dall'ente
   * (fail-closed): non è lo stesso dato di `numIscrSito` (quello identifica
   * una singola unità locale, questo l'intero operatore).
   */
  numIscrOperatore?: string | null
  /**
   * `credentials_id` della firma remota RENTRI (API `ca-rentri`, R3 Task 3),
   * o `null` se il tenant non ha ancora fatto il boarding (QR Code + PIN
   * dall'area Operatori del portale: passo umano, non automatizzabile).
   * Senza questo valore `CompletaOperazioneConFirmaUseCase` si ferma
   * fail-closed PRIMA di contattare l'ente.
   */
  credentialsIdFirmaRemota?: string | null
}

/** Dati per creare/aggiornare la credenziale di un tenant. */
export interface RentriCredentialInput {
  clientId: string
  certificatePem: string
  privateKeyPem: string
  algorithm?: 'RS256' | 'ES256'
  environment?: string
  /**
   * DEPRECATO (R2 multi-sede): il modello attuale è `RentriUnitaLocaleService`
   * (tabella figlia del tenant, supporta più sedi). Mantenuto qui solo per
   * compatibilità col dato già scritto finché la migrazione non è verificata
   * in produzione. Non scrivere più nuovi valori qui.
   */
  numIscrSito?: string | null
  /** V. {@link RentriCredentialPlain.numIscrOperatore}. */
  numIscrOperatore?: string | null
  /** V. {@link RentriCredentialPlain.credentialsIdFirmaRemota}. */
  credentialsIdFirmaRemota?: string | null
}

/**
 * Gestisce la persistenza delle credenziali RENTRI per-tenant. La chiave privata
 * è SEMPRE cifrata a riposo (AES-256-GCM) e decifrata solo al momento dell'uso.
 */
@Injectable()
export class RentriCredentialService {
  private readonly logger = new Logger(RentriCredentialService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig
  ) {}

  /** Salva (crea o aggiorna) la credenziale RENTRI di un tenant, cifrando la chiave. Ritorna gli id dei FIR riaperti (v. riapriFirFermiPerCertificatoMancante). */
  async upsertForTenant(tenantId: string, input: RentriCredentialInput): Promise<string[]> {
    if (input.numIscrSito && !NUM_ISCR_SITO_PATTERN.test(input.numIscrSito)) {
      throw new BadRequestException(
        `Numero di iscrizione dell'unità locale RENTRI non valido: deve rispettare il formato ${NUM_ISCR_SITO_PATTERN.source}`
      )
    }

    // Nessuna regex sul `credentials_id` (formato non documentato da alcuna
    // fonte ufficiale, v. commento nello schema Prisma): l'unico controllo
    // possibile senza inventare un vincolo è "non vuoto se valorizzato" —
    // una stringa di soli spazi verso `ca-rentri` sarebbe un 400 sicuro.
    if (input.credentialsIdFirmaRemota !== undefined && input.credentialsIdFirmaRemota !== null) {
      if (input.credentialsIdFirmaRemota.trim() === '') {
        throw new BadRequestException(
          'Identificativo delle credenziali di firma remota RENTRI non valido: non può essere una stringa vuota. Lascialo assente se il boarding della firma remota non è ancora stato fatto.'
        )
      }
    }

    const privateKeyEnc = encryptSecret(input.privateKeyPem, this.config.credentialEncKey)
    const data = {
      clientId: input.clientId,
      certificatePem: input.certificatePem,
      privateKeyEnc,
      algorithm: input.algorithm || 'RS256',
      environment: input.environment || 'demo',
      numIscrSito: input.numIscrSito ?? null,
      numIscrOperatore: input.numIscrOperatore ?? null,
      credentialsIdFirmaRemota: input.credentialsIdFirmaRemota?.trim() ?? null,
    }

    await this.prisma.rentriCredential.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    })

    return this.riapriFirFermiPerCertificatoMancante(tenantId)
  }

  /**
   * Il certificato c'è: i FIR di QUESTA azienda fermi perché ne era privo tornano
   * PENDING (tentativi azzerati). Il filtro su tenant e codice non tocca gli altri
   * fallimenti permanenti (403, validazione...) né i FIR annullati. Ritorna gli id
   * riaperti: in AUTOMATICA/IBRIDA li accoda il chiamante (il controller, perché la
   * coda sta in RentriSyncModule, che importa RentriModule: iniettarla qui farebbe
   * un ciclo); in MANUALE l'utente preme «Trasmetti a RENTRI».
   *
   * Un errore qui NON fa fallire il salvataggio del certificato (già riuscito): si
   * logga e si segnala, e i FIR restano fermi finché l'utente non li riapre a mano.
   */
  private async riapriFirFermiPerCertificatoMancante(tenantId: string): Promise<string[]> {
    try {
      const filtro = {
        tenantId,
        rentriSyncStatus: PrismaRentriSyncStatus.PERMANENTLY_FAILED,
        rentriLastSyncErrorCode: CODICE_CERTIFICATO_MANCANTE,
        status: { not: 'CANCELLED' as const },
      }
      const fermi = await this.prisma.fIR.findMany({ where: filtro, select: { id: true } })
      if (fermi.length === 0) return []
      const ids = fermi.map(fir => fir.id)
      const riaperti = await this.prisma.fIR.updateMany({
        where: { ...filtro, id: { in: ids } },
        data: {
          rentriSyncStatus: PrismaRentriSyncStatus.PENDING,
          rentriSyncAttempts: 0,
          rentriLastSyncError: null,
          rentriLastSyncErrorCode: null,
          rentriNextRetryAt: null,
        },
      })
      this.logger.log(
        `Certificato RENTRI caricato: ${riaperti.count} FIR fermi per certificato mancante riaperti (tenant ${tenantId})`
      )
      return ids
    } catch (error) {
      this.logger.error(
        `Riapertura dei FIR fermi per certificato mancante non riuscita (tenant ${tenantId}): il certificato e' comunque salvato`,
        error instanceof Error ? error.stack : String(error)
      )
      try {
        Sentry.captureException(error, { extra: { tenantId, fase: 'riapertura-fir-certificato' } })
      } catch {
        /* Bugsink irraggiungibile: il salvataggio del certificato non deve cambiare */
      }
      return []
    }
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
      numIscrOperatore: record.numIscrOperatore ?? null,
      credentialsIdFirmaRemota: record.credentialsIdFirmaRemota ?? null,
    }
  }

  /**
   * Solo il `credentials_id` della firma remota del tenant (R3 Task 3), o
   * `null` se non configurato / tenant senza credenziale.
   *
   * Metodo dedicato invece di {@link getForTenant}: quest'ultimo DECIFRA la
   * chiave privata di interoperabilità per portarla in memoria in chiaro —
   * un costo e un'esposizione ingiustificati per leggere un identificativo
   * che non è un segreto. `CompletaOperazioneConFirmaUseCase` usa questo.
   */
  async getCredentialsIdFirmaRemota(tenantId: string): Promise<string | null> {
    const record = await this.prisma.rentriCredential.findUnique({
      where: { tenantId },
      select: { credentialsIdFirmaRemota: true },
    })
    return record?.credentialsIdFirmaRemota ?? null
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

  /**
   * Timestamp dell'ultimo allineamento riuscito delle unità locali del
   * tenant (R4 Task 3), o `null` se mai eseguito / tenant senza credenziale.
   * Usato da `SincronizzaSitiUseCase` come cache TTL.
   */
  async getSitiSincronizzatiAl(tenantId: string): Promise<Date | null> {
    const record = await this.prisma.rentriCredential.findUnique({
      where: { tenantId },
      select: { sitiSincronizzatiAl: true },
    })
    return record?.sitiSincronizzatiAl ?? null
  }

  /**
   * Marca ORA come ultimo allineamento riuscito delle unità locali del
   * tenant. Chiamato da `SincronizzaSitiUseCase` dopo aver scaricato e
   * salvato con successo l'elenco siti da RENTRI — mai prima, altrimenti un
   * allineamento fallito a metà risulterebbe "recente" e la cache
   * nasconderebbe il problema fino alla scadenza del TTL.
   */
  async markSitiSincronizzati(tenantId: string): Promise<void> {
    await this.prisma.rentriCredential.update({
      where: { tenantId },
      data: { sitiSincronizzatiAl: new Date() },
    })
  }
}
