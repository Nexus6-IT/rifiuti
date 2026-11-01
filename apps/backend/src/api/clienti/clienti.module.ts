import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { RegistryModule } from '../registry/registry.module'
import { CondizioniPagamentoService } from '../../application/clienti/condizioni-pagamento.service'
import { ContiCorrentiService } from '../../application/clienti/conti-correnti.service'
import { RegistriIvaService } from '../../application/clienti/registri-iva.service'
import { TestiFatturazioneService } from '../../application/clienti/testi-fatturazione.service'
import { CodificheContrattoService } from '../../application/clienti/codifiche-contratto.service'
import { AgentiService } from '../../application/clienti/agenti.service'
import { ClientiService } from '../../application/clienti/clienti.service'
import { AllegatiContrattoClienteService } from '../../application/contratti-cliente/allegati-contratto-cliente.service'
import { SpeseAccessorieService } from '../../application/clienti/spese-accessorie.service'
import { CondizioniPagamentoController } from './condizioni-pagamento.controller'
import { ContiCorrentiController } from './conti-correnti.controller'
import { RegistriIvaController } from './registri-iva.controller'
import { TestiFatturazioneController } from './testi-fatturazione.controller'
import { CodificheContrattoController } from './codifiche-contratto.controller'
import { AgentiController } from './agenti.controller'
import { ClientiController } from './clienti.controller'
import { SpeseAccessorieController } from './spese-accessorie.controller'
import { AllegatiContrattoClienteController } from './allegati-contratto-cliente.controller'

/**
 * ClientiModule — clienti, contratti verso i clienti e relative tabelle di fatturazione (4.1).
 * Per ora condizioni di pagamento, conti correnti, spese accessorie, registri IVA, testi di fatturazione e codifiche del contratto (4.1a); i task successivi aggiungono provider e controller.
 */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule, RegistryModule],
  controllers: [
    CondizioniPagamentoController,
    ContiCorrentiController,
    SpeseAccessorieController,
    RegistriIvaController,
    TestiFatturazioneController,
    CodificheContrattoController,
    AgentiController,
    ClientiController,
    AllegatiContrattoClienteController,
  ],
  providers: [
    CondizioniPagamentoService,
    ContiCorrentiService,
    SpeseAccessorieService,
    RegistriIvaService,
    TestiFatturazioneService,
    CodificheContrattoService,
    AgentiService,
    ClientiService,
    AllegatiContrattoClienteService,
  ],
  exports: [
    CondizioniPagamentoService,
    ContiCorrentiService,
    SpeseAccessorieService,
    RegistriIvaService,
    TestiFatturazioneService,
    CodificheContrattoService,
    AgentiService,
    ClientiService,
  ],
})
export class ClientiModule {}
