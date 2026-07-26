import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RentriModule } from '../../infrastructure/rentri/rentri.module'
import { CERPrismaRepository } from '../../infrastructure/persistence/cer-prisma.repository'
import { RentriCodificaSempliceRepository } from '../../infrastructure/persistence/rentri-codifica-semplice.repository'
import { RentriTerritorialeRepository } from '../../infrastructure/persistence/rentri-territoriale.repository'
import { REFERENCE_DATA_CONFIG, loadReferenceDataConfig } from './reference-data.config'
import { ReferenceDataService } from './reference-data.service'
import { ReferenceDataSeederService } from './reference-data-seeder.service'
import { ReferenceDataController } from './reference-data.controller'
import { RentriCerSyncService } from './rentri-cer-sync.service'
import { RentriCodificheSempliciSyncService } from './rentri-codifiche-semplici-sync.service'
import { RentriTerritorialiSyncService } from './rentri-territoriali-sync.service'
import { RentriCodificheSyncService } from './rentri-codifiche-sync.service'

/**
 * ReferenceDataModule — dati di riferimento condivisi (ATECO, ISTAT
 * nazioni/province/comuni, CER) comuni a tutto l'applicativo, con
 * popolamento automatico via cron. Esporta ReferenceDataService per
 * anagrafiche/MUD.
 *
 * `RentriCerSyncService` (R4 Task 4) vive qui ma è DISTINTO da
 * `ReferenceDataSeederService`: fonte (RENTRI, non CSV), ciclo di vita
 * (nessun cron proprio da R4 Task 5, nessun endpoint admin) e soprattutto
 * politica (mai cancellazione, solo marcatura) sono diversi — v. il
 * commento di testata di `rentri-cer-sync.service.ts`. `CERPrismaRepository`
 * è registrato qui sotto il token `ICERRepository` invece di importare
 * `CERModule` (che non lo esporta oggi) per non allargare il perimetro di
 * quel modulo.
 *
 * R4 Task 5 aggiunge `RentriCodificheSempliciSyncService` (unità di misura,
 * stati fisici, caratteristiche di pericolo, attività R/D) e
 * `RentriTerritorialiSyncService` (province, nazioni, comuni — DISTINTE da
 * `Istat*`, v. `docs/audits/rentri-codifiche-campi-2026-07-26.md`), entrambi
 * orchestrati dall'unico `RentriCodificheSyncService`, che possiede il solo
 * cron mensile del gruppo (v. il suo commento di testata).
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
    RentriCodificaSempliceRepository,
    RentriTerritorialeRepository,
    RentriCodificheSempliciSyncService,
    RentriTerritorialiSyncService,
    RentriCodificheSyncService,
  ],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
