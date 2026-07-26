import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RentriModule } from '../../infrastructure/rentri/rentri.module'
import { CERPrismaRepository } from '../../infrastructure/persistence/cer-prisma.repository'
import { REFERENCE_DATA_CONFIG, loadReferenceDataConfig } from './reference-data.config'
import { ReferenceDataService } from './reference-data.service'
import { ReferenceDataSeederService } from './reference-data-seeder.service'
import { ReferenceDataController } from './reference-data.controller'
import { RentriCerSyncService } from './rentri-cer-sync.service'

/**
 * ReferenceDataModule — dati di riferimento condivisi (ATECO, ISTAT
 * nazioni/province/comuni, CER) comuni a tutto l'applicativo, con
 * popolamento automatico via cron. Esporta ReferenceDataService per
 * anagrafiche/MUD.
 *
 * `RentriCerSyncService` (R4 Task 4) vive qui ma è DISTINTO da
 * `ReferenceDataSeederService`: fonte (RENTRI, non CSV), ciclo di vita
 * (cron proprio, nessun endpoint admin) e soprattutto politica (mai
 * cancellazione, solo marcatura) sono diversi — v. il commento di testata di
 * `rentri-cer-sync.service.ts`. `CERPrismaRepository` è registrato qui sotto
 * il token `ICERRepository` invece di importare `CERModule` (che non lo
 * esporta oggi) per non allargare il perimetro di quel modulo.
 */
@Module({
  imports: [ConfigModule, HttpModule, PrismaModule, LoggerModule, AuthModule, RentriModule],
  controllers: [ReferenceDataController],
  providers: [
    {
      provide: REFERENCE_DATA_CONFIG,
      useFactory: (config: ConfigService) => loadReferenceDataConfig(config),
      inject: [ConfigService],
    },
    ReferenceDataService,
    ReferenceDataSeederService,
    CERPrismaRepository,
    { provide: 'ICERRepository', useExisting: CERPrismaRepository },
    RentriCerSyncService,
  ],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
