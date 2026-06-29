import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SignatureRole } from '../../../domain/fir/digital-signature.vo';

/**
 * Apply Signature Request DTO
 *
 * Richiesta per POST /fir/:id/sign.
 *
 * SICUREZZA: le chiavi crittografiche NON vengono mai passate dal client.
 * In modalità sandbox il provider genera chiavi effimere internamente.
 * In modalità QES il provider recupera il certificato dall'HSM/QTSP.
 *
 * ATTIVARE firma qualificata: SIGNATURE_PROVIDER=qes + credenziali QTSP.
 */
export class ApplySignatureDto {
  @ApiProperty({
    description: 'Ruolo del firmatario (Produttore, Trasportatore o Destinatario)',
    enum: ['PRODUCER', 'CARRIER', 'RECEIVER'],
    example: 'PRODUCER',
  })
  @IsEnum(['PRODUCER', 'CARRIER', 'RECEIVER'], {
    message: 'Il ruolo deve essere PRODUCER, CARRIER o RECEIVER',
  })
  @IsNotEmpty()
  role: SignatureRole;
}

/**
 * Apply Signature Response DTO
 */
export class ApplySignatureResponseDto {
  @ApiProperty({ description: 'Esito operazione', example: true })
  success: boolean;

  @ApiProperty({ description: 'Dettagli firma applicata' })
  signature: {
    role: SignatureRole;
    signerFiscalCode: string;
    signerName: string;
    signedAt: Date;
    signatureMethod: string;
    /** false = sandbox/non qualificata; true = QES a norma */
    isQualified: boolean;
  };

  @ApiProperty({ description: 'Nuovo stato FIR dopo la firma', example: 'SIGNED_BY_PRODUCER' })
  firStatus: string;

  @ApiProperty({ description: 'FIR completo (tutte e tre le firme presenti)', example: false })
  isCompleted: boolean;

  @ApiProperty({ description: 'Messaggio operazione', required: false })
  message?: string;
}
