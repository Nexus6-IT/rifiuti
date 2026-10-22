import { Module } from '@nestjs/common'
import { MUDGeneratorService } from './mud-generator.service'
import { MudExportService } from './export/mud-export.service'
import { MudVersionRegistry } from './export/mud-version.registry'
import { MudAggregazioneService } from './aggregazione/mud-aggregazione.service'
import { MudController } from '../../api/mud/mud.controller'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { ReferenceDataModule } from '../reference-data/reference-data.module'
import { RuoloEffettivoModule } from '../../api/me/ruolo-effettivo.module'

/**
 * MUD Module
 *
 * Handles MUD (Modello Unico Dichiarazione) annual reporting + export
 * telematico versionato per anno.
 */
@Module({
  // RuoloEffettivoModule e non MeModule: MeModule porta AuthModule e Redis.
  imports: [PrismaModule, LoggerModule, ReferenceDataModule, RuoloEffettivoModule],
  controllers: [MudController],
  providers: [MUDGeneratorService, MudExportService, MudVersionRegistry, MudAggregazioneService],
  exports: [MUDGeneratorService, MudExportService, MudAggregazioneService],
})
export class MUDModule {}
