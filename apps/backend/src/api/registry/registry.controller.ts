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
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
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
import {
  CreateProduttoreDto,
  CreateTrasportatoreDto,
  CreateDestinatarioDto,
  UpdateProduttoreDto,
  UpdateTrasportatoreDto,
  UpdateDestinatarioDto,
} from './dto/create-registry.dto'

@ApiTags('registry')
@ApiBearerAuth()
@Controller('registry')
@UseGuards(JwtAuthGuard)
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

  @Post('produttori')
  @HttpCode(HttpStatus.CREATED)
  async createProduttore(@Body() dto: CreateProduttoreDto) {
    const result = await this.createProduttoreUseCase.execute(this.mapProduttoreDto(dto))

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
    }
  }

  @Post('trasportatori')
  @HttpCode(HttpStatus.CREATED)
  async createTrasportatore(@Body() dto: CreateTrasportatoreDto) {
    const result = await this.createTrasportatoreUseCase.execute(this.mapTrasportatoreDto(dto))

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      numeroIscrizione: result.value.numeroIscrizione,
    }
  }

  @Post('destinatari')
  @HttpCode(HttpStatus.CREATED)
  async createDestinatario(@Body() dto: CreateDestinatarioDto) {
    const result = await this.createDestinatarioUseCase.execute(this.mapDestinatarioDto(dto))

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sede: this.indirizzoToObject(result.value.sede),
      numeroAutorizzazione: result.value.numeroAutorizzazione,
    }
  }

  // ============= PRODUTTORI GET/UPDATE/DELETE =============

  @Get('produttori')
  async listProduttori(@Req() req: any) {
    // req.tenantId è impostato dal TenantContextMiddleware (da JWT) e sovrascritto
    // dal TenantSwitchInterceptor quando l'utente invia X-Tenant-ID valido.
    // NON usare req.user?.tenantId: il JwtStrategy lo popola sempre dal tenant
    // primario del DB, ignorando qualunque switch di società.
    const tenantId = req.tenantId || req.user?.tenantId || ''
    const result = await this.listProduttoriUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const items = result.value.map(p => ({
      id: p.id,
      ragioneSociale: p.ragioneSociale,
      partitaIVA: p.partitaIVA.getValue(),
      sedeLegale: this.indirizzoToObject(p.sedeLegale),
      email: p.email,
      telefono: p.telefono,
      pec: p.pec,
    }))
    return this.toPaginated(items)
  }

  @Get('produttori/:id')
  async getProduttore(@Param('id') id: string) {
    const result = await this.getProduttoreUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Put('produttori/:id')
  async updateProduttore(@Param('id') id: string, @Body() dto: UpdateProduttoreDto) {
    const result = await this.updateProduttoreUseCase.execute({
      id,
      ...this.mapUpdateProduttoreDto(dto),
    })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Delete('produttori/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProduttore(@Param('id') id: string) {
    const result = await this.deleteProduttoreUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }
  }

  // ============= TRASPORTATORI GET/UPDATE/DELETE =============

  @Get('trasportatori')
  async listTrasportatori(@Req() req: any) {
    const tenantId = req.tenantId || req.user?.tenantId || ''
    const result = await this.listTrasportatoriUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const items = result.value.map(t => ({
      id: t.id,
      ragioneSociale: t.ragioneSociale,
      partitaIVA: t.partitaIVA.getValue(),
      sedeLegale: this.indirizzoToObject(t.sedeLegale),
      numeroIscrizione: t.numeroIscrizione,
      email: t.email,
      telefono: t.telefono,
      pec: t.pec,
    }))
    return this.toPaginated(items)
  }

  @Get('trasportatori/:id')
  async getTrasportatore(@Param('id') id: string) {
    const result = await this.getTrasportatoreUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      numeroIscrizione: result.value.numeroIscrizione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Put('trasportatori/:id')
  async updateTrasportatore(@Param('id') id: string, @Body() dto: UpdateTrasportatoreDto) {
    const result = await this.updateTrasportatoreUseCase.execute({
      id,
      ...this.mapUpdateTrasportatoreDto(dto),
    })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sedeLegale: this.indirizzoToObject(result.value.sedeLegale),
      numeroIscrizione: result.value.numeroIscrizione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Delete('trasportatori/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTrasportatore(@Param('id') id: string) {
    const result = await this.deleteTrasportatoreUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }
  }

  // ============= DESTINATARI GET/UPDATE/DELETE =============

  @Get('destinatari')
  async listDestinatari(@Req() req: any) {
    const tenantId = req.tenantId || req.user?.tenantId || ''
    const result = await this.listDestinatariUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    const items = result.value.map(d => ({
      id: d.id,
      ragioneSociale: d.ragioneSociale,
      partitaIVA: d.partitaIVA.getValue(),
      sede: this.indirizzoToObject(d.sede),
      numeroAutorizzazione: d.numeroAutorizzazione,
      email: d.email,
      telefono: d.telefono,
      pec: d.pec,
    }))
    return this.toPaginated(items)
  }

  @Get('destinatari/:id')
  async getDestinatario(@Param('id') id: string) {
    const result = await this.getDestinatarioUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sede: this.indirizzoToObject(result.value.sede),
      numeroAutorizzazione: result.value.numeroAutorizzazione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Put('destinatari/:id')
  async updateDestinatario(@Param('id') id: string, @Body() dto: UpdateDestinatarioDto) {
    const result = await this.updateDestinatarioUseCase.execute({
      id,
      ...this.mapUpdateDestinatarioDto(dto),
    })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sede: this.indirizzoToObject(result.value.sede),
      numeroAutorizzazione: result.value.numeroAutorizzazione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Delete('destinatari/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDestinatario(@Param('id') id: string) {
    const result = await this.deleteDestinatarioUseCase.execute({ id })

    if (result.isFailure) {
      throw new NotFoundException(result.error)
    }
  }

  // ============= RESPONSE HELPERS =============

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
      sedeLegale: this.mapIndirizzoToCommand(dto.sedeLegale),
      numeroIscrizione: dto.numeroIscrizione,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
    }
  }

  private mapDestinatarioDto(dto: CreateDestinatarioDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      partitaIVA: dto.partitaIVA,
      sede: this.mapIndirizzoToCommand(dto.sede),
      numeroAutorizzazione: dto.numeroAutorizzazione,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
    }
  }

  private mapUpdateProduttoreDto(dto: UpdateProduttoreDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      sedeLegale: dto.sedeLegale ? this.mapIndirizzoToCommand(dto.sedeLegale) : undefined,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
    }
  }

  private mapUpdateTrasportatoreDto(dto: UpdateTrasportatoreDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      sedeLegale: dto.sedeLegale ? this.mapIndirizzoToCommand(dto.sedeLegale) : undefined,
      numeroIscrizione: dto.numeroIscrizione,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
    }
  }

  private mapUpdateDestinatarioDto(dto: UpdateDestinatarioDto) {
    return {
      ragioneSociale: dto.ragioneSociale,
      sede: dto.sede ? this.mapIndirizzoToCommand(dto.sede) : undefined,
      numeroAutorizzazione: dto.numeroAutorizzazione,
      email: dto.email,
      telefono: dto.telefono,
      pec: dto.pec,
    }
  }
}
