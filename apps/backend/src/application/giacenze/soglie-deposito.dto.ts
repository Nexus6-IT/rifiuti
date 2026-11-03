import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator'
import { LIMITI_LEGGE } from '../../domain/waste-movement/deposito-temporaneo'
import { LUNGHEZZA_MAX_NOTA } from './soglie-deposito.service'
import { MaxDecimali } from '../../core/validators/max-decimali'

export enum CriterioDepositoDto {
  NON_SCELTO = 'NON_SCELTO',
  TEMPORALE = 'TEMPORALE',
  QUANTITATIVO = 'QUANTITATIVO',
}

const tagliaSpazi = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/**
 * Corpo di `PUT .../soglie` (azienda o registro). Le relazioni fra campi (pericolosi <= totale,
 * preavviso < giorniMax) le controlla `validaSoglie` nel servizio, che risponde 400 coi messaggi.
 */
export class SoglieDepositoDto {
  @ApiProperty({
    enum: CriterioDepositoDto,
    description:
      'Criterio scelto dal produttore per il deposito temporaneo (art. 185-bis D.Lgs. 152/2006): ' +
      'TEMPORALE (tre mesi di calendario), QUANTITATIVO (30 m3, di cui 10 pericolosi, e un anno) ' +
      'oppure NON_SCELTO (si controllano entrambi).',
  })
  @IsEnum(CriterioDepositoDto)
  criterio!: CriterioDepositoDto

  @ApiProperty({
    nullable: true,
    minimum: 1,
    maximum: LIMITI_LEGGE.giorniMaxConsentiti,
    description:
      'Soglia aggiuntiva in giorni, che puo solo anticipare i tre mesi di calendario di legge. ' +
      'Obbligatorio nel corpo: null = nessuna soglia aggiuntiva.',
  })
  @IsDefined({ message: 'giorniMax è obbligatorio (null = nessuna soglia aggiuntiva)' })
  @ValidateIf(o => o.giorniMax !== null)
  @IsInt()
  @Min(1)
  @Max(LIMITI_LEGGE.giorniMaxConsentiti)
  giorniMax!: number | null

  @ApiProperty({
    description:
      "Kg che, per questa azienda, corrispondono al limite di 30 m3 (conversione indicata dall'azienda).",
  })
  @MaxDecimali(2, 'Il limite totale in kg')
  @IsPositive()
  @Max(10_000_000)
  kgMaxTotale!: number

  @ApiProperty({
    description:
      "Kg che, per questa azienda, corrispondono al limite di 10 m3 di rifiuti pericolosi (conversione indicata dall'azienda).",
  })
  @MaxDecimali(2, 'Il limite dei rifiuti pericolosi in kg')
  @IsPositive()
  @Max(10_000_000)
  kgMaxPericolosi!: number

  @ApiProperty({ minimum: 0, maximum: LIMITI_LEGGE.preavvisoGiorniMax })
  @IsInt()
  @Min(0)
  @Max(LIMITI_LEGGE.preavvisoGiorniMax)
  preavvisoGiorni!: number

  @ApiProperty({ minimum: 0, maximum: 99, description: '0 = nessun preavviso' })
  @IsInt()
  @Min(0)
  @Max(99)
  preavvisoPercentuale!: number

  @ApiPropertyOptional({ nullable: true, maxLength: LUNGHEZZA_MAX_NOTA })
  @IsOptional()
  @Transform(tagliaSpazi)
  @IsString()
  @MaxLength(LUNGHEZZA_MAX_NOTA)
  note?: string | null
}
