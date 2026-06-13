import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { ContractService, ContractStatus } from './contract.service'
import { CreateContractDto, ChangeContractStatusDto } from './dto/create-contract.dto'

/**
 * Contract Controller — gestione contratti e auto-compilazione FIR.
 */
@ApiTags('contracts')
@Controller('contracts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un contratto (stato iniziale DRAFT)' })
  @ApiResponse({ status: 201, description: 'Contratto creato' })
  async create(@Body() dto: CreateContractDto, @CurrentUser() user: CurrentUserPayload) {
    return this.contractService.create(user.tenantId, {
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    })
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lista contratti del tenant (filtro per stato)' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: ContractStatus,
  ) {
    return this.contractService.list(user.tenantId, status)
  }

  @Get('auto-fill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suggerimento auto-compilazione FIR da contratto attivo',
    description: 'Dato produttore + CER, ritorna la controparte e il pricing dal contratto attivo.',
  })
  async autoFill(
    @CurrentUser() user: CurrentUserPayload,
    @Query('producerId') producerId: string,
    @Query('cerCode') cerCode: string,
  ) {
    return this.contractService.getAutoFillForFir(user.tenantId, producerId, cerCode)
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dettaglio contratto' })
  async getById(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.contractService.getById(user.tenantId, id)
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambia stato del contratto (workflow di approvazione)' })
  @ApiResponse({ status: 400, description: 'Transizione di stato non ammessa' })
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeContractStatusDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.contractService.changeStatus(user.tenantId, id, dto.status as ContractStatus)
  }
}
