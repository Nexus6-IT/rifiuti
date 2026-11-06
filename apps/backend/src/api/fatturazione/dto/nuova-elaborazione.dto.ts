/**
 * Corpo di `POST /elaborazioni-fatturazione` (4.4b1, §11), uguale a `NuovaElaborazione` del
 * frontend. Le date sono solo `AAAA-MM-GG`; la coerenza del periodo e la data futura le controlla
 * il servizio (400 `PERIODO_NON_VALIDO`, `DATA_FUTURA`). L'azienda non e' mai nel corpo
 * (`forbidNonWhitelisted`). Decisione 25: `categoriaIds` e `tipiAddebito` scelgono contratti interi.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator'
import { tipoAddebitoValido } from '../../../domain/listino/tipi-addebito'

export const MAX_ID_FILTRO = 200
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
const MESSAGGIO_DATA = 'La data deve essere nel formato AAAA-MM-GG.'

/** Ogni elemento dell'array e' un tipo di addebito del listino (stessa forma di `tipoAddebitoValido`). */
function TipiAddebitoDelListino(opzioni?: ValidationOptions) {
  return (oggetto: object, proprieta: string) =>
    registerDecorator({
      name: 'tipiAddebitoDelListino',
      target: oggetto.constructor,
      propertyName: proprieta,
      options: { message: 'Un tipo di addebito non è ammesso.', ...opzioni },
      validator: {
        validate: (valore: unknown) =>
          Array.isArray(valore) &&
          valore.every(t => typeof t === 'string' && tipoAddebitoValido(t)),
      },
    })
}

export class FiltriElaborazioneDto {
  @ApiPropertyOptional({ type: [String], maxItems: MAX_ID_FILTRO })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ID_FILTRO)
  @IsUUID('all', { each: true })
  clienteIds?: string[]

  @ApiPropertyOptional({ type: [String], maxItems: MAX_ID_FILTRO })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ID_FILTRO)
  @IsUUID('all', { each: true })
  contrattoIds?: string[]

  @ApiPropertyOptional({ type: [String], maxItems: MAX_ID_FILTRO })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ID_FILTRO)
  @IsUUID('all', { each: true })
  categoriaIds?: string[]

  @ApiPropertyOptional({ type: [String], maxItems: MAX_ID_FILTRO, example: ['CER', 'F'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ID_FILTRO)
  @TipiAddebitoDelListino()
  tipiAddebito?: string[]

  @ApiPropertyOptional({ type: [String], maxItems: MAX_ID_FILTRO })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ID_FILTRO)
  @IsUUID('all', { each: true })
  registroIvaIds?: string[]
}

export class NuovaElaborazioneDto {
  @ApiProperty({ example: '2026-01-01' })
  @Matches(DATA_ISO, { message: MESSAGGIO_DATA })
  periodoDal: string

  @ApiProperty({ example: '2026-03-31' })
  @Matches(DATA_ISO, { message: MESSAGGIO_DATA })
  periodoAl: string

  @ApiProperty({ example: '2026-04-05' })
  @Matches(DATA_ISO, { message: MESSAGGIO_DATA })
  dataDocumento: string

  @ApiProperty({ enum: ['PER_CONTRATTO', 'PER_ELENCO'] })
  @IsIn(['PER_CONTRATTO', 'PER_ELENCO'])
  raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'

  @ApiProperty()
  @IsBoolean()
  includiArretrati: boolean

  @ApiPropertyOptional({ type: FiltriElaborazioneDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FiltriElaborazioneDto)
  filtri: FiltriElaborazioneDto = new FiltriElaborazioneDto()
}
