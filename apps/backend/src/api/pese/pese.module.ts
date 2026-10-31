import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { RegistroModule } from '../registro/registro.module'
import { AutomezziService } from '../../application/pese/automezzi.service'
import { StrumentiPesaService } from '../../application/pese/strumenti-pesa.service'
import { PeseController } from './pese.controller'

/**
 * PeseModule — pese a ponte (4.8a). Per ora le anagrafiche di strumenti e automezzi:
 *   GET|POST /pese/strumenti, PUT /pese/strumenti/:id
 *   GET|POST /pese/automezzi, PUT /pese/automezzi/:id, PUT /pese/automezzi/:id/tara
 * `RegistroModule` esporta `RegistriService`, che serviranno gli accessi (Task 4).
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, RuoloEffettivoModule, RegistroModule],
  controllers: [PeseController],
  providers: [StrumentiPesaService, AutomezziService],
  exports: [StrumentiPesaService, AutomezziService],
})
export class PeseModule {}
