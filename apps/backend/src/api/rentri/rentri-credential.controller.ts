/**
 * RENTRI Credential Controller — REST API
 *
 * Endpoint admin per la gestione del certificato RENTRI per-tenant. Consente di
 * caricare la credenziale come PEM diretto oppure come container PKCS#12
 * (.p12/.pfx), che viene convertito in PEM lato server.
 *
 * SICUREZZA: nessun endpoint restituisce o logga mai la chiave privata, il
 * certificato completo o il PKCS#12. Lo stato espone al massimo clientId ed
 * environment.
 */

import {
  Controller,
  Put,
  Get,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import { parsePkcs12 } from '../../infrastructure/rentri/rentri-pkcs12.util'
import { SetRentriCredentialDto } from './dto/set-rentri-credential.dto'

/** Esito generico delle operazioni di scrittura (mai segreti). */
interface SuccessResponse {
  success: true
}

/** Stato della credenziale del tenant (mai chiave né certificato completo). */
interface CredentialStatusResponse {
  configured: boolean
  clientId?: string
  environment?: string
}

@ApiTags('rentri')
@ApiBearerAuth()
// Global prefix is `api/v1` (vedi main.ts), quindi il path completo è
// `api/v1/rentri/credential`.
@Controller('rentri/credential')
// Gestione di un segreto sensibile (certificato/chiave del tenant): riservata
// agli amministratori del tenant.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class RentriCredentialController {
  constructor(private readonly credentialService: RentriCredentialService) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Imposta/aggiorna la credenziale RENTRI del tenant corrente',
    description:
      'Accetta PEM diretto (certificatePem+privateKeyPem) oppure un PKCS#12 (.p12/.pfx) base64 con passphrase, che viene convertito in PEM lato server.',
  })
  @ApiResponse({ status: 200, description: 'Credenziale salvata' })
  @ApiResponse({ status: 400, description: 'Dati non validi (PKCS#12 illeggibile, PEM mancanti)' })
  @ApiResponse({ status: 401, description: 'Non autenticato' })
  async set(
    @Body() dto: SetRentriCredentialDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<SuccessResponse> {
    let certificatePem: string
    let privateKeyPem: string

    if (dto.pkcs12Base64) {
      // Modalità PKCS#12: estrai cert + chiave in PEM. Eventuali errori (file
      // non valido / passphrase errata) diventano 400 con messaggio chiaro,
      // senza esporre il contenuto del container.
      try {
        const pem = parsePkcs12(dto.pkcs12Base64, dto.pkcs12Passphrase ?? '')
        certificatePem = pem.certificatePem
        privateKeyPem = pem.privateKeyPem
      } catch (error) {
        const message = error instanceof Error ? error.message : 'PKCS#12 non valido'
        throw new BadRequestException(message)
      }
    } else if (dto.certificatePem && dto.privateKeyPem) {
      // Modalità PEM diretto.
      certificatePem = dto.certificatePem
      privateKeyPem = dto.privateKeyPem
    } else {
      throw new BadRequestException(
        'Fornire (certificatePem + privateKeyPem) oppure (pkcs12Base64 + pkcs12Passphrase)'
      )
    }

    await this.credentialService.upsertForTenant(user.tenantId, {
      clientId: dto.clientId,
      certificatePem,
      privateKeyPem,
      algorithm: dto.algorithm,
      environment: dto.environment,
    })

    // NON restituire mai chiave/cert.
    return { success: true }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stato della credenziale RENTRI del tenant corrente',
    description: 'Restituisce solo se configurata + clientId/environment. Mai segreti.',
  })
  @ApiResponse({ status: 200, description: 'Stato credenziale' })
  @ApiResponse({ status: 401, description: 'Non autenticato' })
  async status(@CurrentUser() user: CurrentUserPayload): Promise<CredentialStatusResponse> {
    const cred = await this.credentialService.getForTenant(user.tenantId)
    if (!cred) {
      return { configured: false }
    }

    // Espone solo metadati non sensibili.
    return {
      configured: true,
      clientId: cred.clientId,
      environment: cred.environment,
    }
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rimuove la credenziale RENTRI del tenant corrente' })
  @ApiResponse({ status: 200, description: 'Credenziale rimossa' })
  @ApiResponse({ status: 401, description: 'Non autenticato' })
  async remove(@CurrentUser() user: CurrentUserPayload): Promise<SuccessResponse> {
    await this.credentialService.removeForTenant(user.tenantId)
    return { success: true }
  }
}
