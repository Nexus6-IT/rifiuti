import { Module } from '@nestjs/common'
import { AggiornaPrezziService } from '../../application/legami-movimento/aggiorna-prezzi.service'
import { AzioniMassaService } from '../../application/legami-movimento/azioni-massa.service'
import { LegamiService } from '../../application/legami-movimento/conferma-legame.service'
import { ImpostazioniFatturazioneService } from '../../application/legami-movimento/impostazioni-fatturazione.service'
import { ListaLegamiService } from '../../application/legami-movimento/lista-legami.service'
import { PropostaLegameService } from '../../application/legami-movimento/proposta-legame.service'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { ImpostazioniFatturazioneController } from './impostazioni-fatturazione.controller'
import { LegamiMovimentoController } from './legami-movimento.controller'
import { MovimentoLegameController } from './movimento-legame.controller'

/**
 * LegamiMovimentoModule — legame movimento-cliente-prezzo (4.3): «fatturazione da», proposta,
 * conferma, lista «Da collegare», azioni di massa e «Aggiorna prezzi».
 */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [
    ImpostazioniFatturazioneController,
    LegamiMovimentoController,
    MovimentoLegameController,
  ],
  providers: [
    ImpostazioniFatturazioneService,
    PropostaLegameService,
    LegamiService,
    ListaLegamiService,
    AggiornaPrezziService,
    AzioniMassaService,
  ],
  exports: [ImpostazioniFatturazioneService, PropostaLegameService, LegamiService],
})
export class LegamiMovimentoModule {}
