import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { CodiciIvaService } from '../../application/listino/codici-iva.service'
import { CodificheAddebitoService } from '../../application/listino/codifiche-addebito.service'
import { CodiciIvaController } from './codici-iva.controller'
import { CodificheAddebitoController } from './codifiche-addebito.controller'

/**
 * ListinoModule — archivio addebiti e listini (4.2a). Per ora: codici IVA e codifiche di
 * addebito (Task 8); addebiti, prezzi e variazioni arrivano nei Task 9-10.
 */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CodiciIvaController, CodificheAddebitoController],
  providers: [CodiciIvaService, CodificheAddebitoService],
  exports: [CodiciIvaService, CodificheAddebitoService],
})
export class ListinoModule {}
