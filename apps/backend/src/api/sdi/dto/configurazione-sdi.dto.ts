/**
 * DTO delle rotte `/sdi/configurazione` (4.5a). Il DTO controlla forma e tipi; l'appartenenza ai
 * cataloghi (provider, ambiente) e' del servizio, che risponde 400 con `details.errori`.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class ImpostaConfigurazioneSdiDto {
  @ApiProperty({
    example: 'fake',
    description: 'Codice del provider (catalogo chiuso, vedi servizio)',
  })
  @IsString()
  @MaxLength(20)
  provider: string

  @ApiProperty({ example: 'SANDBOX', description: 'SANDBOX o PRODUZIONE' })
  @IsString()
  @MaxLength(12)
  ambiente: string

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description:
      'Credenziali del provider. Omesse = invariate; null = account di piattaforma. Non vengono mai restituite.',
  })
  @IsOptional()
  @IsObject()
  credenziali?: Record<string, string> | null

  @ApiPropertyOptional({
    nullable: true,
    description: 'Id della configurazione della P.IVA presso il provider',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idConfigurazioneProvider?: string | null

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Segreto del webhook del provider. Omesso = invariato; null = rimosso. Non viene mai restituito.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  segretoWebhook?: string | null

  @ApiPropertyOptional({ description: 'Il provider firma il file (D4)' })
  @IsOptional()
  @IsBoolean()
  firmaDalProvider?: boolean

  @ApiProperty({ example: 0, description: '0 se la configurazione non esiste ancora' })
  @IsInt()
  @Min(0)
  versione: number
}

export class VersioneSdiDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  versione: number
}

export class ImpostaInvioAttivoSdiDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  attivo: boolean

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  versione: number
}

export class ImpostaPassoOnboardingSdiDto {
  @ApiProperty({ example: 'CONTRATTO_PROVIDER' })
  @IsString()
  @MaxLength(40)
  passo: string

  @ApiProperty({ example: true })
  @IsBoolean()
  fatto: boolean

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  versione: number
}
