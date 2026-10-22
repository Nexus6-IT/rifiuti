import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsDateString, IsOptional, IsString } from 'class-validator'

/** Corpo di `POST mud/:year/presentazione`: segna il MUD dell'anno come presentato. */
export class SegnaPresentatoDto {
  @ApiPropertyOptional({
    description: 'Data della presentazione (ISO 8601); senza, la data di oggi. Mai nel futuro.',
    example: '2026-06-30',
  })
  @IsOptional()
  @IsDateString()
  dataPresentazione?: string

  @ApiPropertyOptional({
    description: 'Codici degli avvisi confermati',
    type: [String],
    example: ['SCARICO_SENZA_FIR'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  avvisiConfermati?: string[]

  @ApiPropertyOptional({
    description:
      "`generatoIl` dell'esportazione presentata (fra quelle registrate per l'anno); senza, l'ultima",
    example: '2026-06-29T08:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  esportazioneGenerataIl?: string
}
