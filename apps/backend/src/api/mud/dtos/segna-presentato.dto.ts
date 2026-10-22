import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsDateString, IsOptional, IsString } from 'class-validator'

/**
 * Corpo di `POST mud/:year/presentazione`: segna il MUD dell'anno come presentato. Gli avvisi
 * confermati non si mandano: sono quelli dell'esportazione a cui la segnatura si lega (A-W-03).
 */
export class SegnaPresentatoDto {
  @ApiPropertyOptional({
    description: 'Data della presentazione (ISO 8601); senza, la data di oggi. Mai nel futuro.',
    example: '2026-06-30',
  })
  @IsOptional()
  @IsDateString()
  dataPresentazione?: string

  @ApiPropertyOptional({
    description:
      "`generatoIl` dell'esportazione presentata (fra quelle registrate per l'anno); senza, l'ultima",
    example: '2026-06-29T08:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  esportazioneGenerataIl?: string
}
