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
    private readonly deleteDestinatarioUseCase: DeleteDestinatarioUseCase,
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
      sedeLegale: result.value.sedeLegale.getFormatted(),
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
      sedeLegale: result.value.sedeLegale.getFormatted(),
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
      sede: result.value.sede.getFormatted(),
      numeroAutorizzazione: result.value.numeroAutorizzazione,
    }
  }

  // ============= PRODUTTORI GET/UPDATE/DELETE =============

  @Get('produttori')
  async listProduttori(@Req() req: any) {
    const tenantId = req.user?.tenantId || 'default-tenant'
    const result = await this.listProduttoriUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return result.value.map(p => ({
      id: p.id,
      ragioneSociale: p.ragioneSociale,
      partitaIVA: p.partitaIVA.getValue(),
      sedeLegale: p.sedeLegale.getFormatted(),
      email: p.email,
      telefono: p.telefono,
      pec: p.pec,
    }))
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
      sedeLegale: result.value.sedeLegale.getFormatted(),
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Put('produttori/:id')
  async updateProduttore(@Param('id') id: string, @Body() dto: UpdateProduttoreDto) {
    const result = await this.updateProduttoreUseCase.execute({ id, ...this.mapUpdateProduttoreDto(dto) })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sedeLegale: result.value.sedeLegale.getFormatted(),
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
    const tenantId = req.user?.tenantId || 'default-tenant'
    const result = await this.listTrasportatoriUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return result.value.map(t => ({
      id: t.id,
      ragioneSociale: t.ragioneSociale,
      partitaIVA: t.partitaIVA.getValue(),
      sedeLegale: t.sedeLegale.getFormatted(),
      numeroIscrizione: t.numeroIscrizione,
      email: t.email,
      telefono: t.telefono,
      pec: t.pec,
    }))
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
      sedeLegale: result.value.sedeLegale.getFormatted(),
      numeroIscrizione: result.value.numeroIscrizione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Put('trasportatori/:id')
  async updateTrasportatore(@Param('id') id: string, @Body() dto: UpdateTrasportatoreDto) {
    const result = await this.updateTrasportatoreUseCase.execute({ id, ...this.mapUpdateTrasportatoreDto(dto) })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sedeLegale: result.value.sedeLegale.getFormatted(),
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
    const tenantId = req.user?.tenantId || 'default-tenant'
    const result = await this.listDestinatariUseCase.execute({ tenantId })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return result.value.map(d => ({
      id: d.id,
      ragioneSociale: d.ragioneSociale,
      partitaIVA: d.partitaIVA.getValue(),
      sede: d.sede.getFormatted(),
      numeroAutorizzazione: d.numeroAutorizzazione,
      email: d.email,
      telefono: d.telefono,
      pec: d.pec,
    }))
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
      sede: result.value.sede.getFormatted(),
      numeroAutorizzazione: result.value.numeroAutorizzazione,
      email: result.value.email,
      telefono: result.value.telefono,
      pec: result.value.pec,
    }
  }

  @Put('destinatari/:id')
  async updateDestinatario(@Param('id') id: string, @Body() dto: UpdateDestinatarioDto) {
    const result = await this.updateDestinatarioUseCase.execute({ id, ...this.mapUpdateDestinatarioDto(dto) })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return {
      id: result.value.id,
      ragioneSociale: result.value.ragioneSociale,
      partitaIVA: result.value.partitaIVA.getValue(),
      sede: result.value.sede.getFormatted(),
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
