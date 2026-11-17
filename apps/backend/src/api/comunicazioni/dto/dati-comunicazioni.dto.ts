import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString } from 'class-validator'

/**
 * Anagrafica di una sede ditta per le comunicazioni (4.9c-f). I formati (ATECO, ISTAT, codice ARPA,
 * date, lunghezze) li controlla il servizio, che risponde con l'elenco degli errori.
 */
export class AnagraficaComunicazioniDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'eComune deve essere vero o falso.' })
  eComune?: boolean

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  codiceIstatComune?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  codiceAteco?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  codiceOrso?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  alboDataIscrizione?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  alboClassi?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  autorizzazioneData?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  legaleRappresentanteCognome?: string | null

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  legaleRappresentanteNome?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'esclusaOrr deve essere vero o falso.' })
  esclusaOrr?: boolean
}

export class SegnaInviataDto {
  @ApiPropertyOptional({
    description:
      'Per i tracciati ricavati da WinWaste: conferma di aver verificato che il consorzio accetta il file.',
  })
  @IsOptional()
  @IsBoolean({ message: 'confermaVerifica deve essere vero o falso.' })
  confermaVerifica?: boolean
}
