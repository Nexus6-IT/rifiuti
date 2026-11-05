/**
 * DTO di `PUT /cedente-fatturazione` (4.4a, §4.9). I campi facoltativi accettano `null` (il
 * frontend lo manda quando l'utente svuota il campo) e lo salvano come null, cioe' cancellano il
 * valore. `capitaleSociale` e' una stringa col punto (mai il numero JSON, mai la virgola).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator'
import { REGIMI_FISCALI } from '../../../domain/fatturazione/costanti-fiscali'

export class ImpostaCedenteDto {
  @ApiProperty({ example: 'RF01', enum: REGIMI_FISCALI as string[] })
  @IsIn(REGIMI_FISCALI as string[])
  regimeFiscale: string

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'RM',
    description: 'Sigla della provincia',
  })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'reaUfficio: due lettere maiuscole' })
  reaUfficio?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, example: '1000.50' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,13}(\.\d{1,2})?$/, {
    message: 'capitaleSociale: numero con il punto decimale e al più 2 decimali',
  })
  capitaleSociale?: string | null

  @ApiPropertyOptional({ type: String, nullable: true, enum: ['SU', 'SM'] })
  @IsOptional()
  @IsIn(['SU', 'SM'])
  socioUnico?: 'SU' | 'SM' | null

  @ApiPropertyOptional({ enum: ['LN', 'LS'], default: 'LN' })
  @IsOptional()
  @IsIn(['LN', 'LS'])
  statoLiquidazione?: 'LN' | 'LS'

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  registroIvaPredefinitoId?: string | null

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Vuoto = partita IVA del cedente',
  })
  @IsOptional()
  @Matches(/^[A-Za-z0-9]{1,28}$/, {
    message: 'idTrasmittenteCodice: da 1 a 28 caratteri alfanumerici',
  })
  idTrasmittenteCodice?: string | null

  @ApiProperty({ example: 0, description: '0 se i dati non esistono ancora' })
  @IsInt()
  @Min(0)
  versione: number
}
