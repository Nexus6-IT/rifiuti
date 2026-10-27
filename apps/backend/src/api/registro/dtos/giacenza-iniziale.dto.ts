import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const QUANTITA_MASSIMA = 99_999_999.99

/** Vero se la stringa 'AAAA-MM-GG' è un giorno di calendario che esiste (niente 2026-02-30). */
@ValidatorConstraint({ name: 'giornoEsistente', async: false })
export class GiornoEsistenteConstraint implements ValidatorConstraintInterface {
  validate(valore: unknown): boolean {
    if (typeof valore !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valore)) return false
    const data = new Date(`${valore}T00:00:00.000Z`)
    return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valore
  }

  defaultMessage(): string {
    return 'dataRiferimento deve essere un giorno che esiste, nel formato AAAA-MM-GG'
  }
}

/** Una relazione iniziale RENTRI: il carico (anno, protocollo) che compone la giacenza. */
export class OrigineGiacenzaInizialeDto {
  @ApiProperty({ description: 'Anno del carico di origine', example: 2025, minimum: 1990 })
  @IsInt()
  @Min(1990)
  @Max(9999)
  anno: number

  @ApiProperty({ description: 'Protocollo (numero progressivo) del carico', example: 41 })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  protocollo: number

  @ApiPropertyOptional({
    description: 'Quantità di questo carico, nella stessa unità della giacenza (max 2 decimali)',
    example: 120.5,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(QUANTITA_MASSIMA)
  quantita?: number
}

/**
 * Campi di una giacenza iniziale che si possono scrivere sia in creazione sia in modifica.
 * Il tenant non è mai nel corpo: viene dall'azienda selezionata.
 */
export class CampiGiacenzaInizialeDto {
  @ApiProperty({
    description: 'Quantità in deposito (> 0, al più 2 decimali)',
    example: 1250.5,
    minimum: 0.01,
    maximum: QUANTITA_MASSIMA,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(QUANTITA_MASSIMA)
  quantita: number

  @ApiProperty({ description: 'Unità di misura (kg e t sono la stessa famiglia)', example: 'KG' })
  @IsString()
  @MaxLength(10)
  unita: string

  @ApiProperty({
    description: 'Giorno (italiano) dal quale la quantità è in deposito, AAAA-MM-GG, non futuro',
    example: '2026-01-01',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dataRiferimento deve avere il formato AAAA-MM-GG' })
  @Validate(GiornoEsistenteConstraint)
  dataRiferimento: string

  @ApiPropertyOptional({ description: 'Stato fisico (testo libero, max 50)', example: 'SOLIDO' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  statoFisico?: string

  @ApiPropertyOptional({
    description: 'Relazioni iniziali RENTRI (max 200, coppie anno/protocollo distinte)',
    type: [OrigineGiacenzaInizialeDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrigineGiacenzaInizialeDto)
  origini?: OrigineGiacenzaInizialeDto[]

  @ApiPropertyOptional({ description: 'Note (max 500)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

/** Corpo del POST registro/giacenze-iniziali. */
export class CreaGiacenzaInizialeDto extends CampiGiacenzaInizialeDto {
  @ApiProperty({
    description: 'Codice CER (con o senza asterisco: si salva nella forma del catalogo)',
    example: '15 01 10*',
  })
  @IsString()
  @MaxLength(20)
  cerCode: string
}

/**
 * Corpo del PUT registro/giacenze-iniziali/:id: SOSTITUZIONE COMPLETA di tutti i campi
 * tranne CER e registro (che non si modificano: si cancella e si ricrea). `cerCode` nel
 * corpo è rifiutato (400). `quantita`, `unita` e `dataRiferimento` sono obbligatori;
 * `statoFisico`, `origini` e `note` sono facoltativi ma se omessi vengono SVUOTATI.
 */
export class ModificaGiacenzaInizialeDto extends CampiGiacenzaInizialeDto {
  @ApiPropertyOptional({ description: 'Stato fisico. Sostituzione completa: omesso = svuotato.' })
  statoFisico?: string

  @ApiPropertyOptional({
    description: 'Relazioni iniziali RENTRI. Sostituzione completa: omesso = svuotato ([]).',
    type: [OrigineGiacenzaInizialeDto],
  })
  origini?: OrigineGiacenzaInizialeDto[]

  @ApiPropertyOptional({ description: 'Note. Sostituzione completa: omesso = svuotato.' })
  note?: string
}
