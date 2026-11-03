/**
 * DTO di `PUT /impostazioni-fatturazione` (4.3, §4.9). Il DTO controlla forma e tipi; la validita'
 * della data (calendario) e' del servizio, che risponde 400 con `details.errori` sul campo (R60).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator'

export class ImpostaFatturazioneDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-01-01',
    description: 'AAAA-MM-GG; null spegne la fatturazione. Il campo è obbligatorio.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  fatturazioneDa: string | null

  @ApiProperty({ example: 1, description: '0 se l’impostazione non esiste ancora' })
  @IsInt()
  @Min(0)
  versione: number

  @ApiPropertyOptional({ description: 'Movimenti toccati già visti e accettati dall’utente' })
  @IsOptional()
  @IsInt()
  @Min(0)
  confermaMovimenti?: number
}
