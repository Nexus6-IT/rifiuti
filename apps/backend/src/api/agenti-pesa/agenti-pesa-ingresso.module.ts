import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
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
 * dell'agente. Ha il PROPRIO `ThrottlerModule` (storage in memoria separato da quello globale):
 * i guard dell'agente fissano da soli i limitatori, le opzioni qui servono solo a costruirli.
 */
@Module({
  imports: [
    PrismaModule,
    ModuliAttiviModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
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
