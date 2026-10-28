import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { RuoloEffettivoService } from './ruolo-effettivo.service'

/**
 * Ruolo dell'utente nell'azienda selezionata (A-C-06), senza le dipendenze di `MeModule`.
 *
 * `MeModule` porta `AuthModule`, il cui `RedisService` apre una connessione appena
 * istanziato: i moduli che devono solo conoscere il ruolo effettivo (MUD, registro)
 * importano questo modulo, che dipende soltanto da Prisma.
 *
 * Globale perche' `RolesGuard` (risolto nel modulo di ogni controller che lo usa) dipende da
 * `RuoloEffettivoService`: senza, ogni modulo dovrebbe importare questo e uno dimenticato
 * romperebbe l'avvio del backend. E' importato una sola volta in `AppModule`.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [RuoloEffettivoService],
  exports: [RuoloEffettivoService],
})
export class RuoloEffettivoModule {}
