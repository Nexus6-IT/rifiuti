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
 * manuale (409 Conflict). Un endpoint fire-and-forget renderebbe il lock
 * invisibile al chiamante e quindi non diagnosticabile.
 *
 * PERCHÉ 409 E NON 423: in questo progetto il 423 ha un significato preciso e
 * già cablato — è RENTRI che ha BANDITO il chiamante, e da quel codice
 * dipendono la politica di ritentativo (`rentri-http-resilienza.ts`), lo stato
 * del formulario (`rentri-sync-status.vo.ts`) e gli allarmi previsti da R5.
 * Riusare lo stesso numero per «un nostro giro è già in corso» farebbe leggere
 * a un operatore, o a un monitor, «l'ente ci ha bandito» in un caso in cui
 * verso l'ente non è partita NESSUNA richiesta. Il conflitto è con lo stato
 * della nostra risorsa, non con l'ente: 409.
 *
 * Ruoli: SUPER_ADMIN/ADMIN — stesso principio del Task 1 di R1 e di
 * `RentriSitiController`: allineare le codifiche RENTRI impegna l'azienda
 * verso l'ente, non è un'azione operativa quotidiana.
 */

import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  HttpException,
  Req,
} from '@nestjs/common'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import {
  RentriCodificheSyncService,
  AllineamentoRentriGiaInCorsoError,
} from '../../application/reference-data/rentri-codifiche-sync.service'
import { CERPrismaRepository } from '../../infrastructure/persistence/cer-prisma.repository'

/** Voce dell'elenco codici CER non più confermati dall'ultimo allineamento. */
interface CodiceCerNonPresente {
  code: string
  description: string
  rimossoDaRentriAl: string | null
}

/**
 * Diagnostica di sola lettura per la sezione «Codifiche» dell'area RENTRI
 * (R4 Task 7 Step 2): nessuna azione sui singoli codici, solo cosa è successo
 * nell'ultimo giro e quali CER un amministratore potrebbe dover rivedere su
 * un FIR in bozza.
 */
interface DiagnosticaCodificheResponse {
  /** ISO 8601, o null se nessun ciclo è terminato da quando il processo è partito. */
  ultimoAllineamento: string | null
  /** Somma di nuovi+aggiornati sull'ultimo giro concluso (0 se `ultimoAllineamento` è null). */
  codiciAggiornati: number
  /** CER marcati `presenteInRentri=false`, più recenti prima: possono referenziare un FIR in bozza. */
  codiciNonPresenti: CodiceCerNonPresente[]
}

@ApiTags('rentri')
@ApiBearerAuth()
// Global prefix è `api/v1` (vedi main.ts), quindi il path completo è
// `api/v1/rentri/codifiche/allinea`.
@Controller('rentri/codifiche')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class RentriCodificheController {
  constructor(
    private readonly sync: RentriCodificheSyncService,
    private readonly cerRepository: CERPrismaRepository
  ) {}

  @Get('diagnostica')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Diagnostica di sola lettura sull’ultimo allineamento delle codifiche RENTRI',
    description:
      'Nessuna azione sui singoli codici: solo quando è avvenuto l’ultimo giro concluso in questo ' +
      'processo, quante codifiche ha aggiornato, e quali CER l’ente ha smesso di confermare — utile ' +
      'a un amministratore per rivedere un FIR ancora in bozza che referenzia uno di quei codici.',
  })
  @ApiResponse({ status: 200, description: 'Diagnostica corrente' })
  async diagnostica(): Promise<DiagnosticaCodificheResponse> {
    const esito = this.sync.ottieniUltimoEsito()
    const nonPresenti = await this.cerRepository.listNonPresenti()

    return {
      ultimoAllineamento: esito ? esito.quando.toISOString() : null,
      codiciAggiornati: esito ? this.sommaAggiornamenti(esito) : 0,
      codiciNonPresenti: nonPresenti.map(c => ({
        code: c.code,
        description: c.description,
        rimossoDaRentriAl: c.rimossoDaRentriAl ? c.rimossoDaRentriAl.toISOString() : null,
      })),
    }
  }

  private sommaAggiornamenti(
    esito: ReturnType<RentriCodificheSyncService['ottieniUltimoEsito']>
  ): number {
    if (!esito) return 0
    let totale = 0
    if (esito.cer) totale += esito.cer.nuovi + esito.cer.aggiornati
    if (esito.codificheSemplici) {
      for (const tabella of esito.codificheSemplici) totale += tabella.nuovi + tabella.aggiornati
    }
    if (esito.territoriali) {
      for (const tabella of esito.territoriali) totale += tabella.nuovi + tabella.aggiornati
    }
    return totale
  }

  @Post('allinea')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Allinea ora le codifiche RENTRI (CER, unità/stati/pericolo/R-D, territoriali)',
    description:
      "Esegue subito, in sequenza, i tre sotto-servizi orchestrati da RentriCodificheSyncService (stesso ciclo del cron mensile). Sincrono: risponde solo a ciclo concluso. Protetto da un lock in memoria che impedisce due giri paralleli verso RENTRI (schedulato + manuale, o due chiamate manuali sovrapposte) — se un altro giro è già in corso risponde 409 senza contattare l'ente.",
  })
  @ApiResponse({ status: 200, description: 'Ciclo di allineamento concluso' })
  @ApiResponse({
    status: 409,
    description: 'Un allineamento è già in corso (schedulato o avviato da un altro amministratore)',
  })
  async allinea(@Req() req: any): Promise<{ eseguito: true }> {
    const tenantId = requireRequestTenantId(req)
    try {
      await this.sync.allineaTutto(tenantId)
      return { eseguito: true }
    } catch (e) {
      if (e instanceof AllineamentoRentriGiaInCorsoError) {
        // 409, non 423: v. il commento di testata — il 423 in questo progetto
        // significa «RENTRI ci ha bandito» ed è già cablato altrove.
        throw new HttpException(e.message, HttpStatus.CONFLICT)
      }
      throw e
    }
  }
}
