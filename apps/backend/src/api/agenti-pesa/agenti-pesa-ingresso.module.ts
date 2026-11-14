import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { ModuliAttiviModule } from '../../application/admin/moduli-attivi.module'
import { AbbinamentoAgenteService } from '../../application/pese/agenti/abbinamento-agente.service'
import { IngressoLettureService } from '../../application/pese/agenti/ingresso-letture.service'
import { BattitoAgenteService } from '../../application/pese/agenti/battito-agente.service'
import { RisoluzioneAgenteService } from '../../application/pese/agenti/risoluzione-agente.service'
import { AgentePesaGuard } from './agente-pesa.guard'
import { IngressoAgenteController } from './ingresso-agente.controller'
import { ThrottlerAbbinamentoGuard } from './throttler-abbinamento.guard'
import { FallimentiAutenticazione } from './fallimenti-autenticazione'
import { ThrottlerAgenteGuard } from './throttler-agente.guard'

/**
 * Ingresso dell'agente di pesa (Fase 4 pezzo 8b): rotte senza utente, autenticate dal token
 * dell'agente. NON importa un proprio `ThrottlerModule.forRoot`: il modulo e' globale e un secondo `forRoot`
 * sostituirebbe i limiti di tutta l'API (review finale, I1). I guard dell'agente usano opzioni e
 * storage globali e fissano da soli i propri limitatori in `onModuleInit` (nome `default`, che
 * short/medium/long non toccano).
 */
@Module({
  imports: [
    PrismaModule,
    ModuliAttiviModule,
  ],
  controllers: [IngressoAgenteController],
  providers: [
    RisoluzioneAgenteService,
    AbbinamentoAgenteService,
    IngressoLettureService,
    BattitoAgenteService,
    AgentePesaGuard,
    ThrottlerAgenteGuard,
    ThrottlerAbbinamentoGuard,
    FallimentiAutenticazione,
  ],
  exports: [RisoluzioneAgenteService, BattitoAgenteService],
})
export class AgentiPesaIngressoModule {}
