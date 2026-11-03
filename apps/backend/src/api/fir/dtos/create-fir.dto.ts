/**
 * Create FIR DTO - Request validation
 */

import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Min,
  IsEnum,
  IsUUID,
  IsInt,
  IsArray,
  IsPositive,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { TipoTratta, ProvenienzaRifiuto } from '../../../domain/fir/aggregates/fir.aggregate'
import { MaxDecimali } from '../../../core/validators/max-decimali'

/**
 * Valori ammessi per lo stato fisico del rifiuto (norma tecnica, art. 193
 * D.Lgs 152/2006 e allegati DM 59/2023).
 *
 * GASSOSO e MISTO rimossi (2026-09): il contratto RENTRI (`StatiFisici`) non
 * prevede alcun codice corrispondente, quindi un FIR marcato così non
 * sarebbe mai trasmissibile. Verificato che nessun formulario in produzione
 * usa questi due valori prima della rimozione.
 */
export enum StatoFisicoRifiuto {
  SOLIDO = 'Solido',
  LIQUIDO = 'Liquido',
  FANGOSO = 'Fangoso',
  POLVERE = 'Polvere',
}

export class RifiutoDto {
  @ApiProperty({ example: '13 02 05*', description: 'Codice CER del rifiuto' })
  @IsString()
  @IsNotEmpty()
  cerCode: string

  @ApiProperty({ example: 120, description: 'Quantità dichiarata', minimum: 0.01 })
  @MaxDecimali(2, 'La quantità')
  @Min(0.01, { message: 'La quantità deve essere almeno 0,01.' })
  quantita: number

  @ApiPropertyOptional({
    enum: UnitaMisura,
    default: UnitaMisura.KG,
    description: 'Unità di misura',
  })
  @IsEnum(UnitaMisura)
  @IsOptional()
  unitaMisura?: UnitaMisura

  /**
   * Campo 2 FIR (DM 59/2023): stato fisico del rifiuto.
   * Valori: Solido, Liquido, Fangoso, Gassoso, Polvere, Misto.
   */
  @ApiPropertyOptional({
    enum: StatoFisicoRifiuto,
    example: StatoFisicoRifiuto.LIQUIDO,
    description: 'Campo 2 FIR: stato fisico del rifiuto (DM 59/2023)',
  })
  @IsEnum(StatoFisicoRifiuto)
  @IsOptional()
  statoFisico?: string

  /**
   * Campo 2 FIR: caratteristiche di pericolo HP (Reg. UE 1357/2014, All. III
   * D.Lgs 152/2006). Multi-valore, separato da virgola es. "HP4,HP14".
   */
  @ApiPropertyOptional({
    example: 'HP4,HP14',
    description: 'Campo 2 FIR: caratteristiche di pericolo HP (Reg. UE 1357/2014), comma-separated',
  })
  @IsString()
  @IsOptional()
  caratteristichePericolo?: string

  /**
   * Campo 2 FIR (DM 59/2023): numero di colli dichiarato dal produttore.
   */
  @ApiPropertyOptional({
    example: 5,
    description: 'Campo 2 FIR: numero di colli',
    minimum: 1,
  })
  @IsInt()
  @IsPositive()
  @IsOptional()
  numeroColli?: number

  /**
   * Campo 3 FIR: codice operazione di recupero (R1–R13) o smaltimento
   * (D1–D15) effettuata dal destinatario (Allegati B e C D.Lgs 152/2006).
   */
  @ApiPropertyOptional({
    example: 'R13',
    description: 'Campo 3 FIR: codice operazione R/D (Allegati B e C D.Lgs 152/2006)',
  })
  @IsString()
  @IsOptional()
  codiceOperazione?: string
}

export class TrasportatoreAggiuntivoDto {
  @ApiProperty({
    example: 'trasportatore-uuid',
    description: 'ID del trasportatore (registro) per questa tratta intermodale',
  })
  @IsString()
  @IsNotEmpty()
  trasportatoreId: string

  @ApiProperty({
    enum: TipoTratta,
    example: TipoTratta.FERROVIARIA,
    description: 'Tipo di tratta (terrestre / ferroviaria / marittima)',
  })
  @IsEnum(TipoTratta)
  tipoTratta: TipoTratta

  @ApiProperty({
    example: 2,
    minimum: 1,
    description: 'Ordine della tratta nella sequenza del trasporto intermodale (1-based)',
  })
  @IsInt()
  @Min(1)
  ordine: number
}

export class CreateFIRDto {
  @ApiProperty({
    example: 'tenant-uuid-producer',
    description: 'ID tenant produttore/detentore',
  })
  @IsString()
  @IsNotEmpty()
  produttoreId: string

  @ApiPropertyOptional({
    description:
      "Sede del produttore da cui prendere l'indirizzo. Se assente: sede predefinita del ruolo (F2-10 D9)",
  })
  @IsOptional()
  @IsUUID()
  produttoreSedeId?: string

  @ApiProperty({ type: RifiutoDto, description: 'Dettagli rifiuto' })
  @ValidateNested()
  @Type(() => RifiutoDto)
  rifiuto: RifiutoDto

  @ApiProperty({
    example: 'tenant-uuid-transporter',
    description: 'ID tenant trasportatore',
  })
  @IsString()
  @IsNotEmpty()
  trasportatoreId: string

  @ApiProperty({
    example: 'tenant-uuid-destination',
    description: 'ID tenant destinatario',
  })
  @IsString()
  @IsNotEmpty()
  destinatarioId: string

  @ApiPropertyOptional({
    description:
      "Sede del destinatario da cui prendere l'indirizzo. Se assente: sede predefinita del ruolo (F2-10 D9)",
  })
  @IsOptional()
  @IsUUID()
  destinatarioSedeId?: string

  @ApiPropertyOptional({
    type: [TrasportatoreAggiuntivoDto],
    description:
      'Trasportatori aggiuntivi per trasporto intermodale (oltre al trasportatore ' +
      'principale). Ordinati per `ordine`. Omettere per un FIR mono-trasportatore.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrasportatoreAggiuntivoDto)
  trasportatoriAggiuntivi?: TrasportatoreAggiuntivoDto[]

  /**
   * Campo 17 FIR (DM 59/2023): annotazioni libere del produttore. Obbligatorio
   * per alcune tipologie di rifiuto (es. rifiuti sanitari, amianto).
   */
  @ApiPropertyOptional({
    example: 'Rifiuto proveniente da attività di manutenzione impianti.',
    description: 'Campo 17 FIR: annotazioni libere (DM 59/2023)',
  })
  @IsString()
  @IsOptional()
  annotazioni?: string

  /**
   * Provenienza del rifiuto (D.Lgs 152/2006): urbano o speciale. Richiesta
   * dal contratto RENTRI (enum `ProvenienzaRifiuto` dell'ente, codici 'U'/'S'
   * — la traduzione è compito del mappatore RENTRI, non di questo DTO).
   * Obbligatoria per i FIR nuovi: senza questo dato l'invio a RENTRI verrebbe
   * comunque rifiutato dal mappatore, meglio chiederlo subito in creazione.
   */
  @ApiProperty({
    enum: ProvenienzaRifiuto,
    example: ProvenienzaRifiuto.SPECIALE,
    description: 'Provenienza del rifiuto: urbano o speciale (richiesta dal contratto RENTRI)',
  })
  @IsEnum(ProvenienzaRifiuto)
  provenienza: ProvenienzaRifiuto

  /**
   * Modalità di trasporto della tratta principale (Campo 4, trasportatore
   * inline): riusa lo stesso enum `TipoTratta` già in uso per le tratte
   * intermodali aggiuntive. Richiesta dal contratto RENTRI, stessa ragione di
   * `provenienza` sopra.
   */
  @ApiProperty({
    enum: TipoTratta,
    example: TipoTratta.TERRESTRE,
    description: 'Modalità di trasporto della tratta principale (richiesta dal contratto RENTRI)',
  })
  @IsEnum(TipoTratta)
  tipoTrattaPrincipale: TipoTratta
}
