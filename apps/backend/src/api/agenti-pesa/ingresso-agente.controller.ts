import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../../auth/decorators/public.decorator'
import { AbbinamentoAgenteService } from '../../application/pese/agenti/abbinamento-agente.service'
import { IngressoLettureService } from '../../application/pese/agenti/ingresso-letture.service'
import { BattitoAgenteService } from '../../application/pese/agenti/battito-agente.service'
import { BattitoDto } from './dto/battito.dto'
import { LottoLettureDto } from './dto/lotto-letture.dto'
import { AbbinamentoDto } from './dto/abbinamento.dto'
import { AgentePesaGuard } from './agente-pesa.guard'
import { AgenteCorrente, type AgenteCorrenteDati } from './agente-richiesta'
import { comeHttpAgente } from './errori-http-agenti'
import { LIMITI_AGENTE, LimiteAgente, ThrottlerAgenteGuard } from './throttler-agente.guard'
import { ThrottlerAbbinamentoGuard } from './throttler-abbinamento.guard'

/**
 * Rotte dell'agente di pesa (D8): SENZA utente. `abbinamento` e' pubblica (il codice monouso e'
 * la credenziale); le altre sono autenticate dal token dell'agente (`AgentePesaGuard`), che
 * risolve l'azienda e verifica il modulo `pese`. `X-Tenant-ID` e' ignorato: l'azienda viene SOLO
 * dal token.
 *
 * `@SkipThrottle` toglie il limite globale per IP (dietro nginx e' quello del proxy): le rotte
 * hanno i propri limiti, per agente (`ThrottlerAgenteGuard`) o dedicati (`ThrottlerAbbinamentoGuard`).
 */
@ApiTags('agenti-pesa')
@Controller('agenti-pesa')
@SkipThrottle({ short: true, medium: true, long: true })
export class IngressoAgenteController {
  constructor(
    private readonly abbinamento: AbbinamentoAgenteService,
    private readonly letture: IngressoLettureService,
    private readonly battito: BattitoAgenteService
  ) {}

  @Public()
  @Post('abbinamento')
  @UseGuards(ThrottlerAbbinamentoGuard)
  @ApiOperation({ summary: 'Scambia il codice di abbinamento con il token dell’agente' })
  async abbina(@Body() dto: AbbinamentoDto) {
    return comeHttpAgente(() => this.abbinamento.abbina(dto))
  }

  @Get('configurazione')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentePesaGuard, ThrottlerAgenteGuard)
  @LimiteAgente(LIMITI_AGENTE.configurazione)
  @ApiOperation({ summary: 'Configurazione dell’agente (strumenti assegnati, simulazione)' })
  async configurazione(@AgenteCorrente() agente: AgenteCorrenteDati) {
    return comeHttpAgente(() => this.abbinamento.configurazione(agente))
  }

  @Post('letture')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentePesaGuard, ThrottlerAgenteGuard)
  @LimiteAgente(LIMITI_AGENTE.letture)
  @ApiOperation({ summary: 'Riceve un lotto (1..50) di letture firmate; un esito per elemento' })
  async riceviLetture(@AgenteCorrente() agente: AgenteCorrenteDati, @Body() dto: LottoLettureDto) {
    const esiti = await comeHttpAgente(() =>
      this.letture.riceviLotto(agente, dto.letture, new Date())
    )
    return { esiti }
  }

  @Post('battito')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentePesaGuard, ThrottlerAgenteGuard)
  @LimiteAgente(LIMITI_AGENTE.battito)
  @ApiOperation({
    summary: 'Battito: ultimo contatto, scarto dell’orologio, coda, stato strumenti',
  })
  async registraBattito(
    @AgenteCorrente() agente: AgenteCorrenteDati,
    @Body() dto: BattitoDto,
    @Req() req: Request
  ) {
    return comeHttpAgente(() => this.battito.registra(agente, dto, req.ip ?? null, new Date()))
  }
}
