import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { AddebitiService } from '../../application/listino/addebiti.service'
import { CodiciIvaService } from '../../application/listino/codici-iva.service'
import { CodificheAddebitoService } from '../../application/listino/codifiche-addebito.service'
import { VariazioniArchivioService } from '../../application/listino/variazioni-archivio.service'
import { AddebitiController } from './addebiti.controller'
import { CodiciIvaController } from './codici-iva.controller'
import { CodificheAddebitoController } from './codifiche-addebito.controller'

/**
 * ListinoModule — archivio addebiti e listini (4.2a). Per ora: codici IVA e codifiche di
 * addebito (Task 8), archivio degli addebiti (Task 9); le variazioni stanno su `addebiti/variazioni-prezzi` (Task 10).
 */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CodiciIvaController, CodificheAddebitoController, AddebitiController],
  providers: [
    CodiciIvaService,
    CodificheAddebitoService,
    AddebitiService,
    VariazioniArchivioService,
  ],
  exports: [CodiciIvaService, CodificheAddebitoService, AddebitiService],
})
export class ListinoModule {}
