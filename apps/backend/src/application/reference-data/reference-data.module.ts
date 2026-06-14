import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { HttpModule } from '@nestjs/axios'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { REFERENCE_DATA_CONFIG, loadReferenceDataConfig } from './reference-data.config'
import { ReferenceDataService } from './reference-data.service'
import { ReferenceDataSeederService } from './reference-data-seeder.service'
import { ReferenceDataController } from './reference-data.controller'

/**
 * ReferenceDataModule — dati di riferimento condivisi (ATECO, ISTAT
 * nazioni/province/comuni) comuni a tutto l'applicativo, con popolamento
 * automatico via cron. Esporta ReferenceDataService per anagrafiche/MUD.
 */
@Module({
  imports: [ConfigModule, HttpModule, PrismaModule, LoggerModule, AuthModule],
  controllers: [ReferenceDataController],
  providers: [
    {
      provide: REFERENCE_DATA_CONFIG,
      useFactory: (config: ConfigService) => loadReferenceDataConfig(config),
      inject: [ConfigService],
    },
    ReferenceDataService,
    ReferenceDataSeederService,
  ],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
