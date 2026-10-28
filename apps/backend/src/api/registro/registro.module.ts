import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { RegistroController } from './registro.controller'
import { CausaliRegistroController } from './causali-registro.controller'
import { CausaliRegistroService } from '../../application/registro/causali/causali-registro.service'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { ListMovimentiHandler } from '../../application/registro/queries/list-movimenti.handler'
import { ProgressivoInizialeService } from '../../application/registro/progressivo-iniziale.service'
import { GiacenzeInizialiService } from '../../application/registro/giacenze-iniziali.service'
import { CorreggiMovimentoUseCase } from '../../application/registro/use-cases/correggi-movimento.use-case'
import { RegistriService } from '../../application/registro/registri.service'
import { VerificaCatenaRegistroService } from '../../application/registro/verifica-catena-registro.service'

/**
 * RegistroModule — registro cronologico di carico/scarico rifiuti.
 * Art. 190 D.Lgs 152/2006, DM 59/2023.
 *
 * Espone:
 *   POST /api/v1/registro    — registra un movimento (CARICO o SCARICO)
 *   GET  /api/v1/registro    — lista paginata con filtri
 *   GET  /api/v1/registro/registri — registri dell'azienda (sola lettura)
 *   POST /api/v1/registro/registri/assicura — crea i registri mancanti (ruoli di scrittura)
 *   GET  /api/v1/registro/progressivo-iniziale/:anno — progressivo iniziale dell'anno
 *   PUT  /api/v1/registro/progressivo-iniziale/:anno — lo imposta (una volta sola)
 *   POST /api/v1/registro/movimenti/:id/rettifica — rettifica con una nuova annotazione
 *   POST /api/v1/registro/movimenti/:id/annullamento — annulla con una nuova annotazione
 *   GET  /api/v1/registro/verifica-catena — integrita del registro di un anno (amministratori)
 *   GET  /api/v1/registro/causali?tipo=&data= — causali selezionabili (qualunque ruolo)
 *   GET  /api/v1/registro/causali/gestione — vista di gestione (amministratori)
 *   PUT|DELETE /api/v1/registro/causali/sistema/:verso/:codice/disattivazione — (amministratori)
 *   POST /api/v1/registro/causali/aziendali — crea una causale propria (amministratori)
 *   PATCH /api/v1/registro/causali/aziendali/:id — modifica una versione (amministratori)
 *   POST /api/v1/registro/causali/aziendali/:id/versioni — nuova versione (amministratori)
 *   PUT  /api/v1/registro/causali/aziendali/:id/chiusura — chiude una versione (amministratori)
 *   DELETE /api/v1/registro/causali/aziendali/:id — elimina una versione mai usata (amministratori)
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, RuoloEffettivoModule],
  controllers: [RegistroController, CausaliRegistroController],
  providers: [
    RegistraMovimentoUseCase,
    CorreggiMovimentoUseCase,
    ListMovimentiHandler,
    ProgressivoInizialeService,
    GiacenzeInizialiService,
    RegistriService,
    VerificaCatenaRegistroService,
    CausaliRegistroService,
  ],
  exports: [
    RegistraMovimentoUseCase,
    CorreggiMovimentoUseCase,
    ListMovimentiHandler,
    RegistriService,
  ],
})
export class RegistroModule {}
