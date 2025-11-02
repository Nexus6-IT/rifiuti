import { Module } from '@nestjs/common';
import { MUDGeneratorService } from './mud-generator.service';
import { MudController } from '../../api/mud/mud.controller';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';

/**
 * MUD Module
 *
 * Handles MUD (Modello Unico Dichiarazione) annual reporting.
 */
@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [MudController],
  providers: [MUDGeneratorService],
  exports: [MUDGeneratorService],
})
export class MUDModule {}
