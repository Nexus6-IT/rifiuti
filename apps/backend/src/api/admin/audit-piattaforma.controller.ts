import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { AuditPiattaformaService } from '../../application/admin/audit-piattaforma.service'

/**
 * Audit dell'azienda tecnica "piattaforma": le azioni del super admin compiute senza aver scelto
 * un'azienda. Solo SUPER_ADMIN. Prefix globale `api/v1` -> `GET /api/v1/admin/audit/piattaforma`.
 */
@Controller('admin/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class AuditPiattaformaController {
  constructor(private readonly service: AuditPiattaformaService) {}

  @Get('piattaforma')
  @HttpCode(HttpStatus.OK)
  async leggi(@Query('pagina') pagina?: string, @Query('perPagina') perPagina?: string) {
    return await this.service.leggi({
      pagina: pagina ? parseInt(pagina, 10) || 1 : undefined,
      perPagina: perPagina ? parseInt(perPagina, 10) || 50 : undefined,
    })
  }
}
