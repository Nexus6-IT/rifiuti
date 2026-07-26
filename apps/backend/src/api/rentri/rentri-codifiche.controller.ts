/**
 * RENTRI Codifiche Controller — REST API (R4 Task 6)
 *
 * Espone `RentriCodificheSyncService.allineaTutto()` (l'orchestratore unico
 * di CER + codifiche semplici + territoriali, v. il commento di testata di
 * quel servizio) come endpoint admin, in aggiunta al cron mensile già
 * esistente: utile per far ripartire l'allineamento subito dopo aver
 * configurato una nuova credenziale RENTRI, senza attendere il primo del
 * mese.
 *
 * **Sincrono, non fire-and-forget — a differenza di
 * `POST /api/v1/reference-data/reseed`.** `reseed` risponde 202 subito e
 * prosegue in background (best-effort, l'eventuale errore è solo loggato,
 * il chiamante non lo saprà mai). Questo endpoint invece attende il
 * completamento dell'intero ciclo e risponde 200 solo a operazione
 * conclusa: è precisamente ciò che permette al lock di concorrenza in
 * memoria del servizio (v. `rentri-codifiche-sync.service.ts`) di
 * funzionare in modo prevedibile — il chiamante sa, dalla risposta HTTP
 * stessa, se il proprio giro è effettivamente partito (200) o è stato
 * rifiutato perché un altro allineamento era già in corso, schedulato o
 * manuale (423 Locked). Un endpoint fire-and-forget renderebbe il lock
 * invisibile al chiamante e quindi non diagnosticabile.
 *
 * Ruoli: SUPER_ADMIN/ADMIN — stesso principio del Task 1 di R1 e di
 * `RentriSitiController`: allineare le codifiche RENTRI impegna l'azienda
 * verso l'ente, non è un'azione operativa quotidiana.
 */

import { Controller, Post, HttpCode, HttpStatus, UseGuards, HttpException } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import {
  RentriCodificheSyncService,
  AllineamentoRentriGiaInCorsoError,
} from '../../application/reference-data/rentri-codifiche-sync.service'

@ApiTags('rentri')
@ApiBearerAuth()
// Global prefix è `api/v1` (vedi main.ts), quindi il path completo è
// `api/v1/rentri/codifiche/allinea`.
@Controller('rentri/codifiche')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class RentriCodificheController {
  constructor(private readonly sync: RentriCodificheSyncService) {}

  @Post('allinea')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Allinea ora le codifiche RENTRI (CER, unità/stati/pericolo/R-D, territoriali)',
    description:
      "Esegue subito, in sequenza, i tre sotto-servizi orchestrati da RentriCodificheSyncService (stesso ciclo del cron mensile). Sincrono: risponde solo a ciclo concluso. Protetto da un lock in memoria che impedisce due giri paralleli verso RENTRI (schedulato + manuale, o due chiamate manuali sovrapposte) — se un altro giro è già in corso risponde 423 senza contattare l'ente.",
  })
  @ApiResponse({ status: 200, description: 'Ciclo di allineamento concluso' })
  @ApiResponse({
    status: 423,
    description: 'Un allineamento è già in corso (schedulato o avviato da un altro amministratore)',
  })
  async allinea(@CurrentUser() user: CurrentUserPayload): Promise<{ eseguito: true }> {
    try {
      await this.sync.allineaTutto(user.tenantId)
      return { eseguito: true }
    } catch (e) {
      if (e instanceof AllineamentoRentriGiaInCorsoError) {
        // HttpStatus di questa versione di @nestjs/common non definisce
        // LOCKED (423 WebDAV, RFC 4918 §11.3): letterale, stesso codice.
        throw new HttpException(e.message, 423)
      }
      throw e
    }
  }
}
