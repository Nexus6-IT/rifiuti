import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'

/** Corpo di `POST` e `PUT /pese/automezzi`. Le targhe le normalizza e valida il servizio. */
export class AutomezzoDto {
  @ApiProperty({ maxLength: 40 })
  @IsString({ message: 'Targa non valida.' })
  @MaxLength(40, { message: 'Targa non valida.' })
  targa!: string

  @ApiPropertyOptional({ nullable: true, maxLength: 40 })
  @IsOptional()
  @IsString({ message: 'Targa del rimorchio non valida.' })
  @MaxLength(40, { message: 'Targa del rimorchio non valida.' })
  targaRimorchio?: string | null

  @ApiPropertyOptional({ nullable: true, description: 'Trasportatore dell’azienda selezionata' })
  @IsOptional()
  @IsUUID('all', { message: 'Trasportatore non valido.' })
  trasportatoreId?: string | null

  @ApiPropertyOptional({ nullable: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Le note possono avere al massimo 500 caratteri.' })
  note?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  attivo?: boolean
}

export class ElencoAutomezziQueryDto {
  @ApiPropertyOptional({ description: 'Parte della targa' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  targa?: string
}
