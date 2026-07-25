/**
 * Signatures Module — Firma digitale FIR "pronta-ma-non-collegata"
 *
 * Registra tutti i provider, use case, controller e repository necessari
 * per la firma crittografica dei FIR. L'implementazione di default è sandbox
 * (ECDSA effimera, non qualificata). Per attivare la firma qualificata QES:
 *
 *   SIGNATURE_PROVIDER=qes  (+ credenziali QTSP AgID)
 *   TSA_PROVIDER=rfc3161    (+ TSA_URL + credenziali QTSP)
 *
 * Architettura "pronta-ma-non-collegata":
 *  - Endpoint operativi e testati in sandbox
 *  - Provider QES/RFC3161 stub: falliscono con messaggio chiaro se attivati senza config
 *  - Marcatura esplicita: tutto ciò che serve per attivare la firma qualificata è
 *    documentato nei commenti e nel README di ogni provider stub
 *
 * Normativa: DM 59/2023 + art. 188-bis D.Lgs. 152/2006 (FIR digitale),
 *            Reg. UE 910/2014 eIDAS (QES), AgID Linee Guida conservazione.
 */

import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { SignaturesController } from '../../api/signatures/signatures.controller'
import { ApplySignatureUseCase } from './apply-signature.use-case'
import { VerifySignaturesUseCase } from './verify-signatures.use-case'
import {
  DigitalSignatureService,
  resolveSignatureProviderType,
  resolveTsaProviderType,
} from './digital-signature.service'
import { SignatureAuditHandler } from './signature-audit.handler'
import { SignatureFIRRepository } from '../../infrastructure/signatures/signature-fir.repository'
import { FIRPartyResolver } from '../../infrastructure/signatures/fir-party.resolver'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { LoggerService } from '../../core/logger/logger.service'
import { FIR_REPOSITORY } from '../../domain/fir/fir.repository'
import {
  SIGNATURE_PROVIDER,
  TSA_PROVIDER,
  ISignatureProvider,
  ITsaProvider,
} from './providers/signature-provider.interface'
import { SandboxSignatureProvider } from './providers/sandbox-signature.provider'
import { QesSignatureProvider } from './providers/qes-signature.provider'
import { MockTsaProvider } from './providers/mock-tsa.provider'
import { Rfc3161TsaProvider } from './providers/rfc3161-tsa.provider'

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    // EventEmitterModule necessario per ApplySignatureUseCase (eventi dominio firma)
    EventEmitterModule.forRoot({ global: true }),
  ],
  controllers: [SignaturesController],
  providers: [
    // ===== Repository FIR dedicato al contesto firma =====
    // Implementa FIRRepository (old aggregate) con supporto fir_signatures.
    // Separato da FIRPrismaRepository (new aggregate per il lifecycle).
    SignatureFIRRepository,
    {
      provide: FIR_REPOSITORY,
      useExisting: SignatureFIRRepository,
    },

    // Autorizzazione di ruolo-parte sulla firma: verifica che chi firma sia
    // effettivamente il produttore/trasportatore/destinatario designato sul FIR.
    FIRPartyResolver,

    // ===== Provider firma — configurabile via SIGNATURE_PROVIDER env =====
    // SANDBOX (default fuori produzione): ECDSA effimera, NON qualificata.
    // QES (stub): firma qualificata — ATTIVARE con credenziali QTSP AgID.
    // Fail-closed: in produzione (NODE_ENV=production) SIGNATURE_PROVIDER non impostata
    // è un errore all'avvio, non un ripiego silenzioso su sandbox (resolveSignatureProviderType).
    {
      provide: SIGNATURE_PROVIDER,
      useFactory: (config: ConfigService, logger: LoggerService): ISignatureProvider => {
        const providerType = resolveSignatureProviderType(
          config.get<string>('SIGNATURE_PROVIDER'),
          config.get<string>('NODE_ENV', 'development')
        )
        if (providerType === 'qes') {
          return new QesSignatureProvider(config)
        }
        return new SandboxSignatureProvider(logger)
      },
      inject: [ConfigService, LoggerService],
    },

    // ===== Provider TSA — configurabile via TSA_PROVIDER env =====
    // MOCK (default fuori produzione): token JSON non qualificato.
    // RFC3161 (stub): TSA accreditata AgID — ATTIVARE con TSA_URL.
    // Fail-closed: in produzione TSA_PROVIDER non impostata è un errore all'avvio
    // (resolveTsaProviderType), non un ripiego silenzioso su mock.
    {
      provide: TSA_PROVIDER,
      useFactory: (config: ConfigService, logger: LoggerService): ITsaProvider => {
        const providerType = resolveTsaProviderType(
          config.get<string>('TSA_PROVIDER'),
          config.get<string>('NODE_ENV', 'development')
        )
        if (providerType === 'rfc3161') {
          return new Rfc3161TsaProvider(config)
        }
        return new MockTsaProvider(logger)
      },
      inject: [ConfigService, LoggerService],
    },

    // ===== Servizi di dominio e use cases =====
    DigitalSignatureService,
    ApplySignatureUseCase,
    VerifySignaturesUseCase,

    // ===== Audit trail firma (eventi dominio → ActivityLog) =====
    SignatureAuditHandler,
  ],
  // FIR_REPOSITORY esportato perché il ciclo di vita (FIRModule) collega le
  // proprie transizioni (emetti/presaInCarico/confermaConsegna) al sottosistema
  // crittografico: legge la stessa riga fisica FIR tramite l'aggregate
  // crittografico per ottenere toSignableDocument() da firmare (Task 4,
  // pipeline P3). I due aggregate restano separati — si collegano, non si
  // fondono — ma condividono repository/servizio di firma.
  exports: [
    DigitalSignatureService,
    ApplySignatureUseCase,
    VerifySignaturesUseCase,
    FIR_REPOSITORY,
  ],
})
export class SignaturesModule {}
