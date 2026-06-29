/**
 * Signatures Controller
 *
 * Endpoint REST per la firma digitale dei FIR:
 *  - POST /fir/:firId/sign    — applica firma digitale (richiede auth SPID Level 2+)
 *  - GET  /fir/:firId/verify  — verifica tutte le firme (endpoint pubblico)
 *  - GET  /fir/:firId/verify-url — URL pubblica per verifica QR code
 *
 * Workflow firma tre stadi (DM 59/2023):
 *  1. Produttore firma all'emissione del rifiuto
 *  2. Trasportatore firma alla presa in carico
 *  3. Destinatario firma alla consegna
 *
 * FIRMA NON QUALIFICATA (sandbox, default):
 *  Le chiavi sono effimere, generate server-side per ogni firma.
 *  Il client NON invia mai chiavi crittografiche.
 *  ATTIVARE firma qualificata: SIGNATURE_PROVIDER=qes (vedi SignaturesModule).
 *
 * Normativa: DM 59/2023, art. 188-bis D.Lgs. 152/2006, Reg. UE 910/2014 (eIDAS).
 */
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpidLevelGuard } from '../../auth/guards/spid-level.guard';
import { ApplySignatureUseCase } from '../../application/signatures/apply-signature.use-case';
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case';
import {
  ApplySignatureDto,
  ApplySignatureResponseDto,
} from './dto/apply-signature.dto';
import { VerifySignaturesResponseDto } from './dto/verify-signatures.dto';

@ApiTags('Signatures')
@Controller('fir/:firId')
export class SignaturesController {
  constructor(
    private readonly applySignatureUseCase: ApplySignatureUseCase,
    private readonly verifySignaturesUseCase: VerifySignaturesUseCase,
  ) {}

  /**
   * Applica firma digitale al FIR.
   *
   * POST /fir/:firId/sign
   *
   * Richiede:
   *  - Autenticazione JWT (JwtAuthGuard)
   *  - SPID Level 2+ (SpidLevelGuard — in sandbox simulato se claim assente)
   *  - Ordine firma: Produttore → Trasportatore → Destinatario
   *
   * SICUREZZA: nessuna chiave crittografica viene accettata dal client.
   * Il provider genera/recupera le chiavi internamente.
   *
   * ATTIVARE firma qualificata: SIGNATURE_PROVIDER=qes in .env.
   */
  @Post('sign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, SpidLevelGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Applica firma digitale al FIR',
    description:
      'Applica firma crittografica al documento FIR.\n\n' +
      '**Sandbox (default):** firma ECDSA P-256 effimera, NON qualificata.\n' +
      '**ATTIVARE:** SIGNATURE_PROVIDER=qes con credenziali QTSP AgID per firma qualificata (DM 59/2023).',
  })
  @ApiParam({ name: 'firId', description: 'ID FIR', example: 'fir-uuid-123' })
  @ApiResponse({ status: 200, description: 'Firma applicata con successo', type: ApplySignatureResponseDto })
  @ApiResponse({ status: 400, description: 'Ordine firma non rispettato o firma duplicata' })
  @ApiResponse({ status: 401, description: 'Non autenticato' })
  @ApiResponse({ status: 403, description: 'Livello SPID insufficiente o autenticazione scaduta' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async applySignature(
    @Param('firId') firId: string,
    @Body() dto: ApplySignatureDto,
    @Req() req: any,
  ): Promise<ApplySignatureResponseDto> {
    const user = req.user;

    // SANDBOX: spidLevel=2 simulato se claim assente (gestito anche da SpidLevelGuard)
    const acrLevel = user.acr ? parseInt((user.acr.match(/SpidL(\d)/) ?? [])[1] ?? '0', 10) || null : null
    const spidLevel: number = user.spidLevel ?? acrLevel ?? 2;
    const authenticatedAt: Date = user.authenticatedAt
      ? new Date(user.authenticatedAt)
      : new Date(); // Sandbox: ora corrente come fallback

    const result = await this.applySignatureUseCase.execute({
      firId,
      tenantId: user.tenantId,
      userId: user.id,   // UUID utente (per fir_signatures.user_id)
      role: dto.role,
      signerFiscalCode: user.fiscalCode ?? user.sub ?? 'SANDBOX000A00A000A',
      signerName: user.name ?? (`${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Utente Sandbox'),
      spidLevel,
      authenticatedAt,
    });

    return {
      ...result,
      message: `Firma ${dto.role} applicata (${result.signature.isQualified ? 'QUALIFICATA' : 'SANDBOX-NON-QUALIFICATA'})`,
    };
  }

  /**
   * Verifica le firme del FIR (endpoint pubblico per QR code).
   *
   * GET /fir/:firId/verify
   *
   * Endpoint pubblico — nessuna autenticazione richiesta.
   * Verifica crittograficamente tutte le firme presenti sul FIR.
   * Usato per la scansione QR code sulle copie cartacee.
   */
  @Get('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verifica firme FIR (endpoint pubblico)',
    description:
      'Verifica crittograficamente tutte le firme sul FIR.\n\n' +
      '**Endpoint pubblico** — nessuna autenticazione richiesta.\n' +
      'Utilizzabile per scansione QR code e verifica di terzi.',
  })
  @ApiParam({ name: 'firId', description: 'ID FIR', example: 'fir-uuid-123' })
  @ApiResponse({ status: 200, description: 'Verifica completata', type: VerifySignaturesResponseDto })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async verifySignatures(
    @Param('firId') firId: string,
  ): Promise<VerifySignaturesResponseDto> {
    return this.verifySignaturesUseCase.execute({ firId });
  }

  /**
   * URL di verifica per QR code.
   *
   * GET /fir/:firId/verify-url
   *
   * Restituisce l'URL pubblica di verifica firma (per il PDF del FIR).
   */
  @Get('verify-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'URL pubblica di verifica firma (per QR code)',
    description: 'Restituisce l\'URL pubblica per la verifica firma FIR (per generare QR code nel PDF).',
  })
  @ApiParam({ name: 'firId', description: 'ID FIR' })
  @ApiResponse({
    status: 200,
    schema: { type: 'object', properties: { url: { type: 'string', example: 'https://rifiuti.ignicraft.com/verify/fir-123' } } },
  })
  async getVerificationUrl(
    @Param('firId') firId: string,
  ): Promise<{ url: string }> {
    const url = this.verifySignaturesUseCase.generateVerificationUrl(firId);
    return { url };
  }
}
