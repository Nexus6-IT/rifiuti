import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  Max,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator'

const MSG_REGISTRO = 'Indica il registro (identificativo mancante o non valido).'
const MSG_CER = 'Il codice CER deve essere di sei cifre, ad esempio 15 01 01.'
const CER = /^\d{2}\s?\d{2}\s?\d{2}\s?\*?$/

/** Query di `GET /abbinamenti` e di `GET /abbinamenti/differenze`. */
export class AbbinamentiQueryDto {
  @ApiProperty({ description: 'Registro di cui leggere gli abbinamenti.' })
  @IsUUID('all', { message: MSG_REGISTRO })
  registroId!: string
}

export class DifferenzeQueryDto {
  @ApiProperty({ description: 'Registro da confrontare.' })
  @IsUUID('all', { message: MSG_REGISTRO })
  registroId!: string

  @ApiPropertyOptional({ description: 'Solo questo CER (sei cifre, anche con spazi).' })
  @IsOptional()
  @IsString({ message: MSG_CER })
  @Matches(CER, { message: MSG_CER })
  cerCode?: string
}

export class RigaAbbinamentoDto {
  @ApiPropertyOptional({ description: 'Radice del carico (movimento).' })
  @IsOptional()
  @IsUUID('all', { message: 'Il carico indicato non è valido.' })
  caricoId?: string

  @ApiPropertyOptional({ description: 'Giacenza iniziale usata come carico.' })
  @IsOptional()
  @IsUUID('all', { message: 'La giacenza iniziale indicata non è valida.' })
  giacenzaInizialeId?: string

  @ApiProperty({ description: 'Quantità abbinata, maggiore di zero, nell’unità dell’ambito.' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 },
    { message: 'La quantità deve essere un numero con al massimo 3 decimali.' }
  )
  @IsPositive({ message: 'La quantità deve essere maggiore di zero.' })
  @Max(999_999_999.999, { message: 'La quantità non può superare 999.999.999,999.' })
  quantita!: number
}

export class SalvaAbbinamentoDto {
  @ApiProperty({
    type: [RigaAbbinamentoDto],
    description:
      'Righe che sostituiscono TUTTE quelle dello scarico (massimo 500). Un elenco vuoto scollega ' +
      'lo scarico, ma al prossimo ricalcolo (anche "solo i non abbinati") il FIFO lo riabbina.',
  })
  @IsArray({ message: 'Le righe devono essere un elenco.' })
  @ArrayMaxSize(500, { message: 'Si possono indicare al massimo 500 righe.' })
  @ValidateNested({ each: true })
  @Type(() => RigaAbbinamentoDto)
  righe!: RigaAbbinamentoDto[]
}

export class RicalcoloDto {
  @ApiProperty()
  @IsUUID('all', { message: MSG_REGISTRO })
  registroId!: string

  @ApiPropertyOptional({ description: 'Solo questo CER.' })
  @IsOptional()
  @IsString({ message: MSG_CER })
  @Matches(CER, { message: MSG_CER })
  cerCode?: string

  @ApiProperty({
    enum: ['NON_ABBINATI', 'AUTOMATICI'],
    description:
      'NON_ABBINATI riempie solo gli scarichi senza righe; AUTOMATICI rifà le righe automatiche e ' +
      'tiene le manuali (solo amministratori).',
  })
  @IsIn(['NON_ABBINATI', 'AUTOMATICI'], {
    message: 'La modalità deve essere NON_ABBINATI oppure AUTOMATICI.',
  })
  modalita!: 'NON_ABBINATI' | 'AUTOMATICI'
}
