/**
 * Registry Controller
 * Handles HTTP requests for Produttori, Trasportatori, and Destinatari
 */

import {
  Controller,
  Post,
  Body,
  Get,
  Put,
  Delete,
  Param,
  UseGuards,
  HttpStatus,
  HttpCode,
  Req,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { calcolaScadenza } from '../../application/notifications/scadenza-controparte.util'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CreateProduttoreUseCase } from '../../application/registry/use-cases/create-produttore.use-case'
import { CreateTrasportatoreUseCase } from '../../application/registry/use-cases/create-trasportatore.use-case'
import { CreateDestinatarioUseCase } from '../../application/registry/use-cases/create-destinatario.use-case'
import { ListProduttoriUseCase } from '../../application/registry/use-cases/list-produttori.use-case'
import { ListTrasportatoriUseCase } from '../../application/registry/use-cases/list-trasportatori.use-case'
import { ListDestinatariUseCase } from '../../application/registry/use-cases/list-destinatari.use-case'
import { GetProduttoreUseCase } from '../../application/registry/use-cases/get-produttore.use-case'
import { GetTrasportatoreUseCase } from '../../application/registry/use-cases/get-trasportatore.use-case'
import { GetDestinatarioUseCase } from '../../application/registry/use-cases/get-destinatario.use-case'
import { UpdateProduttoreUseCase } from '../../application/registry/use-cases/update-produttore.use-case'
import { UpdateTrasportatoreUseCase } from '../../application/registry/use-cases/update-trasportatore.use-case'
import { UpdateDestinatarioUseCase } from '../../application/registry/use-cases/update-destinatario.use-case'
import { DeleteProduttoreUseCase } from '../../application/registry/use-cases/delete-produttore.use-case'
import { DeleteTrasportatoreUseCase } from '../../application/registry/use-cases/delete-trasportatore.use-case'
import { DeleteDestinatarioUseCase } from '../../application/registry/use-cases/delete-destinatario.use-case'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import {
  CreateProduttoreDto,
  CreateTrasportatoreDto,
  CreateDestinatarioDto,
  UpdateProduttoreDto,
  UpdateTrasportatoreDto,
  UpdateDestinatarioDto,
} from './dto/create-registry.dto'

// ---- Swagger: campi di ditta e sede comuni alle risposte (F2-10) ----
const CAMPI_DITTA_SWAGGER = {
  codiceFiscale: {
    type: 'string',
    nullable: true,
    description: "Codice fiscale della ditta (per un privato è l'unico identificativo)",
  },
  dittaId: { type: 'string', format: 'uuid', description: 'Ditta a cui appartiene il ruolo' },
  sedeId: {
    type: 'string',
    format: 'uuid',
    description: 'Sede predefinita del ruolo (indirizzo e contatti mostrati)',
  },
  numeroSedi: { type: 'integer', description: 'Numero di sedi attive della ditta' },
  partitaIvaDaVerificare: {
    type: 'boolean',
    description: 'La partita IVA registrata non passa il controllo di validità: va corretta',
  },
}
const CAMPI_DETTAGLIO_SWAGGER = {
  ...CAMPI_DITTA_SWAGGER,
  ruoliDitta: {
    type: 'array',
    items: { type: 'string', enum: ['PRODUTTORE', 'TRASPORTATORE', 'DESTINATARIO'] },
    description: 'Ruoli che la stessa ditta ha in questa azienda',
  },
}
const CAMPI_CREAZIONE_SWAGGER = {
  ...CAMPI_DITTA_SWAGGER,
  dittaEsistente: {
    type: 'boolean',
    description: 'La ditta era già registrata (per un altro ruolo) ed è stata riusata',
  },
  avvisi: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Avvisi non bloccanti, es. la ragione sociale già registrata per la ditta è stata mantenuta',
  },
}
const rispostaSwagger = (proprieta: Record<string, unknown>) => ({
  schema: { type: 'object', properties: proprieta },
})

@ApiTags('registry')
@ApiBearerAuth()
@Controller('registry')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RegistryController {
  constructor(
    private readonly createProduttoreUseCase: CreateProduttoreUseCase,
    private readonly createTrasportatoreUseCase: CreateTrasportatoreUseCase,
    private readonly createDestinatarioUseCase: CreateDestinatarioUseCase,
    private readonly listProduttoriUseCase: ListProduttoriUseCase,
    private readonly listTrasportatoriUseCase: ListTrasportatoriUseCase,
    private readonly listDestinatariUseCase: ListDestinatariUseCase,
    private readonly getProduttoreUseCase: GetProduttoreUseCase,
    private readonly getTrasportatoreUseCase: GetTrasportatoreUseCase,
    private readonly getDestinatarioUseCase: GetDestinatarioUseCase,
    private readonly updateProduttoreUseCase: UpdateProduttoreUseCase,
    private readonly updateTrasportatoreUseCase: UpdateTrasportatoreUseCase,
    private readonly updateDestinatarioUseCase: UpdateDestinatarioUseCase,
    private readonly deleteProduttoreUseCase: DeleteProduttoreUseCase,
    private readonly deleteTrasportatoreUseCase: DeleteTrasportatoreUseCase,
    private readonly deleteDestinatarioUseCase: DeleteDestinatarioUseCase
  ) {}

  @ApiOperation({
    summary: 'Crea un produttore su una ditta (nuova o già registrata) e relativa sede',
  })
  @ApiResponse({
    status: 201,
    description:
      'Controparte creata; `dittaEsistente` e `avvisi` dicono se la ditta è stata riusata',
    ...rispostaSwagger(CAMPI_CREAZIONE_SWAGGER),
  })
  @ApiResponse({
    status: 400,
    description: 'Dati non validi, identificativi in conflitto o ruolo già presente per la ditta',
  })
  @Post('produttori')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.CREATED)
  async createProduttore(@Body() dto: CreateProduttoreDto) {
    const result = await this.createProduttoreUseCase.execute(this.mapProduttoreDto(dto))

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const { ruolo, dittaEsistente, avvisi } = result.value

    return {
      id: ruolo.id,
      ragioneSociale: ruolo.ragioneSociale,
      partitaIVA: ruolo.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(ruolo),
      sedeLegale: this.indirizzoToObject(ruolo.sedeLegale),
      dittaEsistente,
      avvisi,
    }
  }

  @ApiOperation({
    summary: 'Crea un trasportatore su una ditta (nuova o già registrata) e relativa sede',
  })
  @ApiResponse({
    status: 201,
    description:
      'Controparte creata; `dittaEsistente` e `avvisi` dicono se la ditta è stata riusata',
    ...rispostaSwagger(CAMPI_CREAZIONE_SWAGGER),
  })
  @ApiResponse({
    status: 400,
    description: 'Dati non validi, identificativi in conflitto o ruolo già presente per la ditta',
  })
  @Post('trasportatori')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.CREATED)
  async createTrasportatore(@Body() dto: CreateTrasportatoreDto) {
    const result = await this.createTrasportatoreUseCase.execute(this.mapTrasportatoreDto(dto))

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const { ruolo, dittaEsistente, avvisi } = result.value

    return {
      id: ruolo.id,
      ragioneSociale: ruolo.ragioneSociale,
      partitaIVA: ruolo.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(ruolo),
      sedeLegale: this.indirizzoToObject(ruolo.sedeLegale),
      numeroIscrizione: ruolo.numeroIscrizione,
      scadenzaIscrizione: this.dateToIso(ruolo.scadenzaIscrizione),
      dittaEsistente,
      avvisi,
    }
  }

  @ApiOperation({
    summary: 'Crea un destinatario su una ditta (nuova o già registrata) e relativa sede',
  })
  @ApiResponse({
    status: 201,
    description:
      'Controparte creata; `dittaEsistente` e `avvisi` dicono se la ditta è stata riusata',
    ...rispostaSwagger(CAMPI_CREAZIONE_SWAGGER),
  })
  @ApiResponse({
    status: 400,
    description: 'Dati non validi, identificativi in conflitto o ruolo già presente per la ditta',
  })
  @Post('destinatari')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.CREATED)
  async createDestinatario(@Body() dto: CreateDestinatarioDto) {
    const result = await this.createDestinatarioUseCase.execute(this.mapDestinatarioDto(dto))

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const { ruolo, dittaEsistente, avvisi } = result.value

    return {
      id: ruolo.id,
      ragioneSociale: ruolo.ragioneSociale,
      partitaIVA: ruolo.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(ruolo),
      sede: this.indirizzoToObject(ruolo.sede),
      numeroAutorizzazione: ruolo.numeroAutorizzazione,
      scadenzaAutorizzazione: this.dateToIso(ruolo.scadenzaAutorizzazione),
      dittaEsistente,
      avvisi,
    }
  }

  // ============= PRODUTTORI GET/UPDATE/DELETE =============

  @ApiOperation({ summary: "Elenco dei produttori dell'azienda" })
  @ApiResponse({
    status: 200,
    description: 'Elenco paginato; ogni voce porta ditta, sede predefinita e numero di sedi',
  })
  @Get('produttori')
  async listProduttori(@Req() req: any) {
    // req.tenantId è impostato dal TenantContextMiddleware (da JWT) e sovrascritto
    // dal TenantSwitchInterceptor quando l'utente invia X-Tenant-ID valido.
    // NON usare req.user?.tenantId: il JwtStrategy lo popola sempre dal tenant
    // primario del DB, ignorando qualunque switch di società.
    const tenantId = requireRequestTenantId(req)
    const result = await this.listProduttoriUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const items = result.value.map(p => ({
      id: p.id,
      ragioneSociale: p.ragioneSociale,
      partitaIVA: p.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(p),
      sedeLegale: this.indirizzoToObject(p.sedeLegale),
      email: p.email,
      telefono: p.telefono,
      pec: p.pec,
    }))
    return this.toPaginated(items)
  }

  @ApiOperation({ summary: 'Dettaglio di un produttore, con i ruoli della ditta' })
  @ApiResponse({
    status: 200,
    description: 'Dettaglio del ruolo, con `ruoliDitta`',
    ...rispostaSwagger(CAMPI_DETTAGLIO_SWAGGER),
  })
  @ApiResponse({ status: 404, description: 'Controparte non trovata' })
  @Get('produttori/:id')
  async getProduttore(@Param('id') id: string) {
    const result = await this.getProduttoreUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(result.value),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @ApiOperation({
    summary:
      'Modifica un produttore (tutto o niente): identificativi della ditta, sede predefinita, indirizzo e contatti',
  })
  @ApiResponse({
    status: 200,
    description: 'Controparte aggiornata, con `ruoliDitta`',
    ...rispostaSwagger(CAMPI_DETTAGLIO_SWAGGER),
  })
  @ApiResponse({
    status: 400,
    description:
      "Dati non validi, `sedeId` non valida per il ruolo o `sedeId` insieme all'indirizzo",
  })
  @ApiResponse({
    status: 409,
    description: "Identificativo già di un'altra ditta o indirizzo già di un'altra sede attiva",
  })
  @Put('produttori/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  async updateProduttore(@Param('id') id: string, @Body() dto: UpdateProduttoreDto) {
    const result = await this.updateProduttoreUseCase.execute({
      id,
      ...this.mapUpdateProduttoreDto(dto),
    })

    if (result.isFailure) {
      this.throwUpdateFailure(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(result.value),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Delete('produttori/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProduttore(@Param('id') id: string) {
    const result = await this.deleteProduttoreUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }
  }

  // ============= TRASPORTATORI GET/UPDATE/DELETE =============

  @ApiOperation({ summary: "Elenco dei trasportatori dell'azienda" })
  @ApiResponse({
    status: 200,
    description: 'Elenco paginato; ogni voce porta ditta, sede predefinita e numero di sedi',
  })
  @Get('trasportatori')
  async listTrasportatori(@Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    const result = await this.listTrasportatoriUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const items = result.value.map(t => {
      // Task 4 dello scadenzario: l'operatore va avvisato SUBITO quando
      // sceglie il trasportatore in un formulario, non solo via email il
      // giorno dopo. Stessa `calcolaScadenza` del controllo periodico
      // (Task 1/3): senza data (`undefined`), niente avviso inventato.
      const { giorniAllaScadenza, scaduta } = calcolaScadenza(t.scadenzaIscrizione)
      return {
        id: t.id,
        ragioneSociale: t.ragioneSociale,
        partitaIVA: t.partitaIVA?.getValue() ?? null,
        ...this.campiDitta(t),
        sedeLegale: this.indirizzoToObject(t.sedeLegale),
        numeroIscrizione: t.numeroIscrizione,
        email: t.email,
        telefono: t.telefono,
        pec: t.pec,
        scadenzaIscrizione: this.dateToIso(t.scadenzaIscrizione),
        iscrizioneScaduta: scaduta,
        giorniAllaScadenza,
      }
    })
    return this.toPaginated(items)
  }

  @ApiOperation({ summary: 'Dettaglio di un trasportatore, con i ruoli della ditta' })
  @ApiResponse({
    status: 200,
    description: 'Dettaglio del ruolo, con `ruoliDitta`',
    ...rispostaSwagger(CAMPI_DETTAGLIO_SWAGGER),
  })
  @ApiResponse({ status: 404, description: 'Controparte non trovata' })
  @Get('trasportatori/:id')
  async getTrasportatore(@Param('id') id: string) {
    const result = await this.getTrasportatoreUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(result.value),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      numeroIscrizione: result.value.numeroIscrizione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
      scadenzaIscrizione: this.dateToIso(result.value.scadenzaIscrizione),
    }
  }

  @ApiOperation({
    summary:
      'Modifica un trasportatore (tutto o niente): identificativi della ditta, sede predefinita, indirizzo e contatti',
  })
  @ApiResponse({
    status: 200,
    description: 'Controparte aggiornata, con `ruoliDitta`',
    ...rispostaSwagger(CAMPI_DETTAGLIO_SWAGGER),
  })
  @ApiResponse({
    status: 400,
    description:
      "Dati non validi, `sedeId` non valida per il ruolo o `sedeId` insieme all'indirizzo",
  })
  @ApiResponse({
    status: 409,
    description: "Identificativo già di un'altra ditta o indirizzo già di un'altra sede attiva",
  })
  @Put('trasportatori/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  async updateTrasportatore(@Param('id') id: string, @Body() dto: UpdateTrasportatoreDto) {
    const result = await this.updateTrasportatoreUseCase.execute({
      id,
      ...this.mapUpdateTrasportatoreDto(dto),
    })

    if (result.isFailure) {
      this.throwUpdateFailure(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(result.value),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      numeroIscrizione: result.value.numeroIscrizione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
      scadenzaIscrizione: this.dateToIso(result.value.scadenzaIscrizione),
    }
  }

  @Delete('trasportatori/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTrasportatore(@Param('id') id: string) {
    const result = await this.deleteTrasportatoreUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }
  }

  // ============= DESTINATARI GET/UPDATE/DELETE =============

  @ApiOperation({ summary: "Elenco dei destinatari dell'azienda" })
  @ApiResponse({
    status: 200,
    description: 'Elenco paginato; ogni voce porta ditta, sede predefinita e numero di sedi',
  })
  @Get('destinatari')
  async listDestinatari(@Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    const result = await this.listDestinatariUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const items = result.value.map(d => {
      // Task 4 dello scadenzario: stessa logica dei trasportatori sopra —
      // l'avviso compare alla scelta del destinatario, non solo via email.
      const { giorniAllaScadenza, scaduta } = calcolaScadenza(d.scadenzaAutorizzazione)
      return {
        id: d.id,
        ragioneSociale: d.ragioneSociale,
        partitaIVA: d.partitaIVA?.getValue() ?? null,
        ...this.campiDitta(d),
        sede: this.indirizzoToObject(d.sede),
        numeroAutorizzazione: d.numeroAutorizzazione,
        email: d.email,
        telefono: d.telefono,
        pec: d.pec,
        scadenzaAutorizzazione: this.dateToIso(d.scadenzaAutorizzazione),
        autorizzazioneScaduta: scaduta,
        giorniAllaScadenza,
      }
    })
    return this.toPaginated(items)
  }

  @ApiOperation({ summary: 'Dettaglio di un destinatario, con i ruoli della ditta' })
  @ApiResponse({
    status: 200,
    description: 'Dettaglio del ruolo, con `ruoliDitta`',
    ...rispostaSwagger(CAMPI_DETTAGLIO_SWAGGER),
  })
  @ApiResponse({ status: 404, description: 'Controparte non trovata' })
  @Get('destinatari/:id')
  async getDestinatario(@Param('id') id: string) {
    const result = await this.getDestinatarioUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(result.value),
      sede: this.indirizzoToObject(result.value.sede),
      numeroAutorizzazione: result.value.numeroAutorizzazione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
      scadenzaAutorizzazione: this.dateToIso(result.value.scadenzaAutorizzazione),
    }
  }

  @ApiOperation({
    summary:
      'Modifica un destinatario (tutto o niente): identificativi della ditta, sede predefinita, indirizzo e contatti',
  })
  @ApiResponse({
    status: 200,
    description: 'Controparte aggiornata, con `ruoliDitta`',
    ...rispostaSwagger(CAMPI_DETTAGLIO_SWAGGER),
  })
  @ApiResponse({
    status: 400,
    description:
      "Dati non validi, `sedeId` non valida per il ruolo o `sedeId` insieme all'indirizzo",
  })
  @ApiResponse({
    status: 409,
    description: "Identificativo già di un'altra ditta o indirizzo già di un'altra sede attiva",
  })
  @Put('destinatari/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  async updateDestinatario(@Param('id') id: string, @Body() dto: UpdateDestinatarioDto) {
    const result = await this.updateDestinatarioUseCase.execute({
      id,
      ...this.mapUpdateDestinatarioDto(dto),
    })

    if (result.isFailure) {
      this.throwUpdateFailure(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA?.getValue() ?? null,
      ...this.campiDitta(result.value),
      sede: this.indirizzoToObject(result.value.sede),
      numeroAutorizzazione: result.value.numeroAutorizzazione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
      scadenzaAutorizzazione: this.dateToIso(result.value.scadenzaAutorizzazione),
    }
  }

  @Delete('destinatari/:id')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDestinatario(@Param('id') id: string) {
    const result = await this.deleteDestinatarioUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }
  }

  // ============= ERROR / RESPONSE HELPERS =============

  /**
   * Campi della ditta e della sede predefinita comuni ai tre ruoli (D7). Il codice fiscale di un
   * privato e' un dato personale: sta solo nel corpo della risposta, mai in log o messaggi.
   * `numeroSedi` e `ruoliDitta` compaiono solo quando la lettura li ha calcolati (`ruoliDitta`
   * solo nel dettaglio e nella modifica).
   */
  private campiDitta(e: {
    codiceFiscale: string | null
    dittaId: string
    sedeId: string
    numeroSedi?: number
    partitaIvaDaVerificare: boolean
    ruoliDitta?: string[]
  }) {
    return {
      codiceFiscale: e.codiceFiscale,
      dittaId: e.dittaId,
      sedeId: e.sedeId,
      ...(e.numeroSedi !== undefined && { numeroSedi: e.numeroSedi }),
      partitaIvaDaVerificare: e.partitaIvaDaVerificare,
      ...(e.ruoliDitta !== undefined && { ruoliDitta: e.ruoliDitta }),
    }
  }

  /**
   * Mappa il fallimento di un update allo status HTTP corretto: una risorsa
   * inesistente diventa 404 (coerente con GET/DELETE), mentre gli errori di
   * validazione di dominio restano 400.
   */
  private throwUpdateFailure(error?: string): never {
    if (typeof error === 'string' && error.toLowerCase().includes('not found')) {
      throw new NotFoundException(error)
    }
    throw new BadRequestException(error)
  }

  /**
   * Converte il value object Indirizzo in un oggetto piano compatibile con il
   * modello frontend (Indirizzo: via/civico/cap/comune/provincia). Il dominio
   * usa `citta`, il frontend usa `comune`: si mappa qui per evitare confusione.
   * Fix bug "Sede legale: undefined undefined" (l'endpoint restituiva la stringa
   * formattata invece di un oggetto strutturato).
   */
  private indirizzoToObject(indirizzo: any) {
    if (!indirizzo) return null
    return {
      via: indirizzo.getVia?.() ?? indirizzo.via ?? '',
      civico: indirizzo.getCivico?.() ?? indirizzo.civico ?? '',
      cap: indirizzo.getCAP?.() ?? indirizzo.cap ?? '',
      comune: indirizzo.getCitta?.() ?? indirizzo.citta ?? indirizzo.comune ?? '',
      provincia: indirizzo.getProvincia?.() ?? indirizzo.provincia ?? '',
    }
  }

  /**
   * Converte una data di dominio nella stringa ISO (solo giorno) attesa dal
   * frontend, o `undefined` se la scadenza non è impostata (campo
   * facoltativo, Task 3 dello scadenzario).
   */
  private dateToIso(date?: Date): string | undefined {
    if (!date) return undefined
    return date.toISOString().slice(0, 10)
  }

  /**
   * Avvolge la lista nell'envelope paginato atteso dal frontend
   * (PaginatedResponse: items/total/page/limit/totalPages), coerente con
   * gli endpoint FIR e CER. Le liste anagrafiche non sono ancora paginate
   * lato dominio: si restituisce l'intero set come pagina unica.
   */
  private toPaginated<T>(items: T[]) {
    return {
      items,
      total: items.length,
      page: 1,
      limit: items.length,
      totalPages: 1,
    }
  }

  // ============= MAPPER METHODS =============
  // Maps DTO (comune) to Command (citta) for domain layer

  private mapIndirizzoToCommand(indirizzo: any) {
    return {
      via: indirizzo.via,
      civico: indirizzo.civico,
      cap: indirizzo.cap,
      citta: indirizzo.comune, // Map DTO "comune" to Command "citta"
      provincia: indirizzo.provincia,
      nazione: indirizzo.nazione,
    }
  }

  private mapProduttoreDto(dto: CreateProduttoreDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      partitaIVA: dto.partitaIVA,
      codiceFiscale: dto.codiceFiscale,
      sedeLegale: this.mapIndirizzoToCommand(dto.sedeLegale),
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
    }
  }

  private mapTrasportatoreDto(dto: CreateTrasportatoreDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      partitaIVA: dto.partitaIVA,
      codiceFiscale: dto.codiceFiscale,
      sedeLegale: this.mapIndirizzoToCommand(dto.sedeLegale),
      numeroIscrizione: dto.numeroIscrizione,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
      scadenzaIscrizione: dto.scadenzaIscrizione ? new Date(dto.scadenzaIscrizione) : undefined,
    }
  }

  private mapDestinatarioDto(dto: CreateDestinatarioDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      partitaIVA: dto.partitaIVA,
      codiceFiscale: dto.codiceFiscale,
      sede: this.mapIndirizzoToCommand(dto.sede),
      numeroAutorizzazione: dto.numeroAutorizzazione,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
      scadenzaAutorizzazione: dto.scadenzaAutorizzazione
        ? new Date(dto.scadenzaAutorizzazione)
        : undefined,
    }
  }

  private mapUpdateProduttoreDto(dto: UpdateProduttoreDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      codiceFiscale: dto.codiceFiscale,
      partitaIVA: dto.partitaIVA,
      sedeId: dto.sedeId,
      sedeLegale: dto.sedeLegale ? this.mapIndirizzoToCommand(dto.sedeLegale) : undefined,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
    }
  }

  private mapUpdateTrasportatoreDto(dto: UpdateTrasportatoreDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      codiceFiscale: dto.codiceFiscale,
      partitaIVA: dto.partitaIVA,
      sedeId: dto.sedeId,
      sedeLegale: dto.sedeLegale ? this.mapIndirizzoToCommand(dto.sedeLegale) : undefined,
      numeroIscrizione: dto.numeroIscrizione,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
      scadenzaIscrizione: this.mapScadenzaUpdate(dto.scadenzaIscrizione),
    }
  }

  private mapUpdateDestinatarioDto(dto: UpdateDestinatarioDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      codiceFiscale: dto.codiceFiscale,
      partitaIVA: dto.partitaIVA,
      sedeId: dto.sedeId,
      sede: dto.sede ? this.mapIndirizzoToCommand(dto.sede) : undefined,
      numeroAutorizzazione: dto.numeroAutorizzazione,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
      scadenzaAutorizzazione: this.mapScadenzaUpdate(dto.scadenzaAutorizzazione),
    }
  }

  /**
   * Mappa il valore ISO/null/assente di una scadenza in update al comando:
   * assente → `undefined` (campo non toccato), `null` → `null` (azzeramento
   * esplicito), stringa ISO → `Date`.
   */
  private mapScadenzaUpdate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined
    if (value === null) return null
    return new Date(value)
  }
}
