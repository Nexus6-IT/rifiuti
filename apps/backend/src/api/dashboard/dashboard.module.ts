import { Module } from '@nestjs/common'
import { DashboardController } from './dashboard.controller'
import { AttenzioneController } from './attenzione.controller'
import { AndamentoController } from './andamento.controller'
import { ModuliAttiviModule } from '../../application/admin/moduli-attivi.module'
import { AnalyticsModule } from '../../application/analytics/analytics.module'
import { RaccogliAttenzioneUseCase } from '../../application/dashboard/raccogli-attenzione.use-case'
import { RaccogliIndicatoriAzioneUseCase } from '../../application/dashboard/raccogli-indicatori-azione.use-case'
import { RaccogliAndamentoMensileUseCase } from '../../application/dashboard/raccogli-andamento-mensile.use-case'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { RentriScortaRepository } from '../../infrastructure/persistence/rentri-scorta.repository'

/**
 * Dashboard API Module
 *
 * Tutti i provider di questo modulo (i tre use case del cruscotto e
 * `RentriScortaRepository`) dipendono dal `PrismaService` di
 * `infrastructure/persistence` — la classe CON l'estensione di isolamento a
 * livello di riga (RLS). Fino alla revisione finale (2026-09-11) i tre use
 * case importavano invece `infrastructure/database/prisma.service`: una
 * classe DISTINTA che estende `PrismaClient` per conto proprio, quindi un
 * secondo pool di connessioni reale, non "un'altra vista dello stesso
 * client" come affermava erroneamente un commento qui rimosso. Le query di
 * questo modulo filtravano già esplicitamente per `tenantId`, quindi non
 * c'era una fuga di dati in atto, ma la difesa in profondità dell'estensione
 * RLS non le copriva — il pool duplicato è sparito con questo import, ma
 * `RaccogliAttenzioneUseCase` e `RaccogliIndicatoriAzioneUseCase` chiamavano
 * ancora `this.prisma.<model>` (client nudo), non `this.prisma.db.<model>`
 * (client esteso): quel secondo pezzo è stato corretto separatamente in
 * quei due file (v. i loro commenti "DIFESA IN PROFONDITÀ"), quindi ORA le
 * query di questo modulo — tranne l'unica in `$queryRaw` di
 * `RaccogliAndamentoMensileUseCase`, fuori portata per disegno — sono
 * coperte anche dall'estensione. `PrismaModule` (di `infrastructure/persistence`) è
 * `@Global()` (già importato da `AppModule`), ma lo importiamo comunque qui
 * esplicitamente: un modulo non deve dipendere da un side-effect di import
 * altrove nel grafo per risolvere le proprie dipendenze (verificato: senza
 * questo import un test che istanzia `DashboardModule` da solo fallisce con
 * "Nest can't resolve dependencies of RentriScortaRepository").
 */
@Module({
  imports: [AnalyticsModule, PrismaModule, ModuliAttiviModule],
  controllers: [DashboardController, AttenzioneController, AndamentoController],
  providers: [
    RaccogliAttenzioneUseCase,
    RaccogliIndicatoriAzioneUseCase,
    RaccogliAndamentoMensileUseCase,
    RentriScortaRepository,
  ],
})
export class DashboardModule {}
