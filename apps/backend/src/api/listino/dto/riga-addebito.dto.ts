/**
 * DTO delle righe di addebito (4.2b, D9, R36, R37). Il DTO controlla forma e tipi; i valori, le
 * famiglie e i campi obbligatori sono del dominio `riga-addebito` e rispondono con
 * `RIGA_ADDEBITO_NON_VALIDA` e l'elenco `errori` per campo. Per questo ogni campo e' facoltativo
 * qui: un campo mancante lo segnala il dominio, col suo campo, non la pipe.
 *
 * Booleani e UUID sono controllati davvero (`@IsBoolean`, `@IsUUID`): la pipe globale ha
 * `transform: true`, ma "false" come stringa NON diventa un booleano. `null` e' ammesso solo per i
 * campi facoltativi (in modifica li svuota); gli importi arrivano come stringa o come numero.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator'

/** Stringa oppure numero finito (importi e percentuali: il dominio ne controlla il formato). */
function IsTestoONumero(opzioni?: ValidationOptions) {
  return (oggetto: object, proprieta: string) =>
    registerDecorator({
      name: 'isTestoONumero',
      target: oggetto.constructor,
      propertyName: proprieta,
      options: { message: `${proprieta} deve essere un testo o un numero`, ...opzioni },
      validator: {
        validate: (v: unknown) =>
          typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
      },
    })
}

export class ScaglioneRigaDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  ordine?: number

  @IsOptional()
  @IsTestoONumero()
  finoA?: string | number | null

  @ValidateIf((_, v) => v !== undefined)
  @IsTestoONumero()
  prezzo?: string | number

  @IsOptional()
  @IsTestoONumero()
  sconto?: string | number | null

  @IsOptional()
  @IsTestoONumero()
  provvigione?: string | number | null

  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  tipoCalcolo?: string
}

export class ScadenzaRigaDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  ordine?: number

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  giorno?: number

  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  mese?: number

  @IsOptional()
  @IsInt()
  anno?: number | null

  /** Campo di sola lettura della vista: se il FE rimanda la scadenza com'e', si ignora. */
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  fatturabileNelContratto?: boolean
}

export class CampiRigaAddebitoDto {
  @ApiPropertyOptional({ example: 'V', description: 'CER, V, F, T…, N…, M…, $A/$D/$R' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  tipo?: string

  @ApiPropertyOptional({ example: '20 03 01', description: 'Solo per il tipo CER' })
  @IsOptional()
  @IsString()
  cerCode?: string | null

  @ApiPropertyOptional({ description: 'Addebito dell’archivio: per tutti i tipi diversi da CER' })
  @IsOptional()
  @IsUUID()
  addebitoId?: string | null

  @ApiPropertyOptional({ description: 'Vuoto = riferimento vuoto; "?" = qualsiasi' })
  @IsOptional()
  @IsTestoONumero()
  riferimento?: string | number | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descrizione?: string | null

  @ApiPropertyOptional({ example: 'PESO_NETTO' })
  @IsOptional()
  @IsString()
  tipoQuantita?: string | null

  @ApiPropertyOptional({ description: 'Solo tipo F; vuoto = 1, 0 = non fatturare' })
  @IsOptional()
  @IsTestoONumero()
  quantitaFissa?: string | number | null

  @ApiPropertyOptional({ example: 'KG' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  unitaMisura?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsTestoONumero()
  prezzo?: string | number | null

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  prezzoSpeciale?: boolean

  @ApiPropertyOptional({ example: '10+5' })
  @IsOptional()
  @IsTestoONumero()
  sconto?: string | number | null

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  codiceIvaId?: string

  @ApiPropertyOptional({ example: '5' })
  @IsOptional()
  @IsTestoONumero()
  provvigione?: string | number | null

  @ApiPropertyOptional({ example: 'SCONTATO' })
  @IsOptional()
  @IsString()
  tipoProvvigione?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipologiaRifiuto?: string | null

  @ApiPropertyOptional({ description: 'Codice RENTRI della tabella stati-fisici' })
  @IsOptional()
  @IsString()
  statoFisico?: string | null

  @ApiPropertyOptional({ description: 'Codice RENTRI della tabella attivita-rs' })
  @IsOptional()
  @IsString()
  operazione?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoriaId?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  centroRicavoId?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  applicaA?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  condizione?: number | null

  @ApiPropertyOptional({ example: '12C' })
  @IsOptional()
  @IsString()
  condizioniRiferite?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsTestoONumero()
  minimoFatturabile?: string | number | null

  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  minimoPerCategoria?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  riferimentoGiorno?: number | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  riferimentoMese?: number | null

  @ApiPropertyOptional({ example: 'MP' })
  @IsOptional()
  @IsString()
  periodoScadenze?: string | null

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  periodoExtraDal?: string | null

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  periodoExtraAl?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsTestoONumero()
  stimaAnnuaKg?: string | number | null

  @ApiPropertyOptional({ type: [String], description: 'CER, CER/RIF, CER/* o CER/' })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  cerProposta?: string[]

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  addebitiProposti?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appunti?: string | null

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notaUsoInterno?: string | null

  @ApiPropertyOptional({ type: [ScaglioneRigaDto], description: 'Assenti = invariate' })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => ScaglioneRigaDto)
  scaglioni?: ScaglioneRigaDto[]

  @ApiPropertyOptional({ type: [ScadenzaRigaDto], description: 'Assenti = invariate' })
  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ScadenzaRigaDto)
  scadenze?: ScadenzaRigaDto[]
}

export class CreaRigaAddebitoDto extends CampiRigaAddebitoDto {}

export class ModificaRigaAddebitoDto extends CampiRigaAddebitoDto {
  @ApiProperty({ description: 'Versione letta: se nel frattempo e cambiata, 409' })
  @IsInt()
  @Min(1)
  versione: number
}
