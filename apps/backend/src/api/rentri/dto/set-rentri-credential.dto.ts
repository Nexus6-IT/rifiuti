import { IsString, IsNotEmpty, IsOptional, IsIn, ValidateIf, IsBase64 } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

/**
 * DTO per impostare/aggiornare la credenziale RENTRI del tenant corrente.
 *
 * Supporta DUE modalità alternative e mutuamente esclusive:
 *  1. PEM diretto:  { clientId, certificatePem, privateKeyPem, ... }
 *  2. PKCS#12:      { clientId, pkcs12Base64, pkcs12Passphrase, ... }
 *
 * La validazione richiede almeno una delle due (vedi `ValidateIf`): se manca
 * `pkcs12Base64`, allora certificatePem+privateKeyPem diventano obbligatori; se
 * `pkcs12Base64` è presente, passphrase e clientId restano obbligatori ma i PEM
 * sono ignorati.
 *
 * SICUREZZA: questo DTO trasporta segreti (chiave privata / PKCS#12). Non deve
 * MAI essere serializzato nei log né restituito nelle risposte.
 */
export class SetRentriCredentialDto {
  @ApiProperty({ example: 'rentri-client-id', description: 'Client ID RENTRI del tenant' })
  @IsString()
  @IsNotEmpty()
  clientId: string

  // --- Modalità 1: PEM diretto ---
  // Obbligatorio solo se NON è stato fornito un PKCS#12.

  @ApiPropertyOptional({
    description: 'Certificato in formato PEM (alternativo al PKCS#12)',
  })
  @ValidateIf((o: SetRentriCredentialDto) => !o.pkcs12Base64)
  @IsString()
  @IsNotEmpty()
  certificatePem?: string

  @ApiPropertyOptional({
    description: 'Chiave privata in formato PEM (alternativa al PKCS#12)',
  })
  @ValidateIf((o: SetRentriCredentialDto) => !o.pkcs12Base64)
  @IsString()
  @IsNotEmpty()
  privateKeyPem?: string

  // --- Modalità 2: PKCS#12 (.p12/.pfx) ---
  // Obbligatorio solo se NON sono stati forniti i PEM diretti.

  @ApiPropertyOptional({
    description: 'Container PKCS#12 (.p12/.pfx) codificato base64 (alternativo ai PEM)',
  })
  @ValidateIf((o: SetRentriCredentialDto) => !o.certificatePem && !o.privateKeyPem)
  @IsString()
  @IsNotEmpty()
  @IsBase64()
  pkcs12Base64?: string

  @ApiPropertyOptional({
    description: 'Passphrase del PKCS#12 (obbligatoria se si carica un PKCS#12)',
  })
  @ValidateIf((o: SetRentriCredentialDto) => !!o.pkcs12Base64)
  @IsString()
  @IsNotEmpty()
  pkcs12Passphrase?: string

  // --- Opzioni comuni ---

  @ApiPropertyOptional({
    enum: ['RS256', 'ES256'],
    default: 'RS256',
    description: 'Algoritmo di firma',
  })
  @IsOptional()
  @IsIn(['RS256', 'ES256'])
  algorithm?: 'RS256' | 'ES256'

  @ApiPropertyOptional({ example: 'demo', description: 'Ambiente RENTRI (es. demo/produzione)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  environment?: string
}
