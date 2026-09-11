import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { AttenzioneController } from './attenzione.controller'
import { AndamentoController } from './andamento.controller'
import { AnalyticsModule } from '../../application/analytics/analytics.module'
import { RaccogliAttenzioneUseCase } from '../../application/dashboard/raccogli-attenzione.use-case'
import { RaccogliIndicatoriAzioneUseCase } from '../../application/dashboard/raccogli-indicatori-azione.use-case'
import { RaccogliAndamentoMensileUseCase } from '../../application/dashboard/raccogli-andamento-mensile.use-case'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { PrismaModule as PersistencePrismaModule } from '../../infrastructure/persistence/prisma.module'
import { RentriScortaRepository } from '../../infrastructure/persistence/rentri-scorta.repository'

/**
 * Dashboard API Module
 *
 * `RentriScortaRepository` dipende dal `PrismaService` di
 * `infrastructure/persistence` (client con estensione RLS), diverso dal
 * `PrismaService` di `infrastructure/database` usato dal resto di questo
 * modulo: sono due viste dello stesso `PrismaClient` generato (v. commento
 * in `infrastructure/persistence/prisma.service.ts`), non una seconda
 * connessione. `PersistencePrismaModule` è `@Global()` (già importato da
 * `AppModule`), ma lo importiamo comunque qui esplicitamente: un modulo non
 * deve dipendere da un side-effect di import altrove nel grafo per risolvere
 * le proprie dipendenze (verificato: senza questo import un test che
 * istanzia `DashboardModule` da solo fallisce con "Nest can't resolve
 * dependencies of RentriScortaRepository").
 */
@Module({
  imports: [AnalyticsModule, PrismaModule, PersistencePrismaModule],
  controllers: [DashboardController, AttenzioneController, AndamentoController],
  providers: [
    RaccogliAttenzioneUseCase,
    RaccogliIndicatoriAzioneUseCase,
    RaccogliAndamentoMensileUseCase,
    RentriScortaRepository,
  ],
})
export class DashboardModule {}
