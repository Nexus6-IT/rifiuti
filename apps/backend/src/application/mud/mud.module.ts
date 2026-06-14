import { Module } from '@nestjs/common';
import { MUDGeneratorService } from './mud-generator.service';
import { MudExportService } from './export/mud-export.service';
import { MudVersionRegistry } from './export/mud-version.registry';
import { MudController } from '../../api/mud/mud.controller';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';

/**
 * MUD Module
 *
 * Handles MUD (Modello Unico Dichiarazione) annual reporting + export
 * telematico versionato per anno.
 */
@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [MudController],
  providers: [MUDGeneratorService, MudExportService, MudVersionRegistry],
  exports: [MUDGeneratorService, MudExportService],
})
export class MUDModule {}
