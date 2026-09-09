/**
 * AdminSystemHealthModule — pagina «Stato del sistema».
 *
 * Modulo separato da `AdminUserModule`/`AdminTenantModule` (stessa convenzione
 * del repository: un modulo per superficie admin).
 *
 * CABLAGGIO DELLE CODE. Le `Queue` servono in SOLA LETTURA (conteggi e, cosa
 * che conta davvero, i consumatori connessi). Vengono registrate qui con
 * `BullModule.registerQueue` e raccolte in una `Map` sotto un unico token,
 * cosi' la probe riceve un dizionario testabile invece di sette dipendenze.
 * La connessione root e' quella globale gia' aperta da `PermissionsModule`
 * (`BullModule.forRootAsync` e' `global: true`): qui non si configura un
 * secondo Redis, si riusa quello del resto del sistema — altrimenti la
 * pagina potrebbe dire «tutto bene» guardando un Redis diverso da quello che
 * le code usano davvero.
 *
 * I job rilanciabili a mano NON vengono riprovveduti qui: arrivano dai loro
 * moduli (`RentriSyncModule`, `ReferenceDataModule`), che li esportano
 * apposta. Riprovvederli creerebbe una seconda istanza con i propri `@Cron`
 * registrati, cioe' raddoppierebbe i job schedulati del sistema.
 */

import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'
import { BullModule, getQueueToken } from '@nestjs/bullmq'
import type { Queue } from 'bullmq'

import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { AuthModule } from '../../auth/auth.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { RentriSyncModule } from '../rentri/rentri-sync.module'
import { ReferenceDataModule } from '../reference-data/reference-data.module'
import { S3Service } from '../../infrastructure/storage/s3.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { SystemHealthController } from '../../api/admin/system-health.controller'
import { SystemHealthService, CODE_SYSTEM_HEALTH } from './system-health/system-health.service'
import { JobActionsService } from './system-health/job-actions.service'
import { EvidenzeDbService } from './system-health/evidenze-db.service'
import { CodeProbe, CODE_ATTESE } from './system-health/probes/code.probe'
import { JobSchedulatiProbe } from './system-health/probes/job-schedulati.probe'
import { InfrastrutturaProbe } from './system-health/probes/infrastruttura.probe'
import { FreschezzaProbe } from './system-health/probes/freschezza.probe'
import { CredenzialiProbe } from './system-health/probes/credenziali.probe'
import { FlagProbe } from './system-health/probes/flag.probe'

const NOMI_CODE = CODE_ATTESE.map(coda => coda.nome)

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    AuthModule,
    LoggerModule,
    HttpModule,
    RentriSyncModule,
    ReferenceDataModule,
    BullModule.registerQueue(...NOMI_CODE.map(name => ({ name }))),
  ],
  controllers: [SystemHealthController],
  providers: [
    SystemHealthService,
    JobActionsService,
    EvidenzeDbService,
    CodeProbe,
    JobSchedulatiProbe,
    InfrastrutturaProbe,
    FreschezzaProbe,
    CredenzialiProbe,
    FlagProbe,
    S3Service,
    EmailService,
    {
      provide: CODE_SYSTEM_HEALTH,
      useFactory: (...code: Queue[]) =>
        new Map<string, Queue>(NOMI_CODE.map((nome, indice) => [nome, code[indice]])),
      inject: NOMI_CODE.map(nome => getQueueToken(nome)),
    },
  ],
})
export class AdminSystemHealthModule {}
