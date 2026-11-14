import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { RegistroModule } from '../registro/registro.module'
import { AutomezziService } from '../../application/pese/automezzi.service'
import { StrumentiPesaService } from '../../application/pese/strumenti-pesa.service'
import { AccessiPesaService } from '../../application/pese/accessi-pesa.service'
import { AllegatiPesaService } from '../../application/pese/allegati-pesa.service'
import { RettifichePesoService } from '../../application/pese/rettifiche-peso.service'
import { CollegamentiAccessoService } from '../../application/pese/collegamenti-accesso.service'
import { AgentiPesaService } from '../../application/pese/agenti/agenti-pesa.service'
import { LetturePesaService } from '../../application/pese/agenti/letture-pesa.service'
import { AgentiPesaIngressoModule } from '../agenti-pesa/agenti-pesa-ingresso.module'
import { AgentiPesaController } from './agenti-pesa.controller'
import { PeseController } from './pese.controller'

/**
 * PeseModule — pese a ponte (4.8a). Per ora le anagrafiche di strumenti e automezzi:
 *   GET|POST /pese/strumenti, PUT /pese/strumenti/:id
 *   GET|POST /pese/automezzi, PUT /pese/automezzi/:id, PUT /pese/automezzi/:id/tara
 * `RegistroModule` esporta `RegistriService`, che serviranno gli accessi (Task 4).
 */
@Module({
  imports: [
    PrismaModule,
    LoggerModule,
    AuthModule,
    RuoloEffettivoModule,
    RegistroModule,
    AgentiPesaIngressoModule,
  ],
  controllers: [PeseController, AgentiPesaController],
  providers: [
    StrumentiPesaService,
    AutomezziService,
    AllegatiPesaService,
    AccessiPesaService,
    RettifichePesoService,
    CollegamentiAccessoService,
    AgentiPesaService,
    LetturePesaService,
  ],
  exports: [
    StrumentiPesaService,
    AutomezziService,
    AllegatiPesaService,
    AccessiPesaService,
    RettifichePesoService,
    CollegamentiAccessoService,
  ],
})
export class PeseModule {}
