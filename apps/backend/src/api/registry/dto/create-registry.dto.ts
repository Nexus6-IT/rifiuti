/**
 * Registry DTOs
 * Data Transfer Objects for Registry API
 */

import {
  IsUUID,
  MaxLength,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsDateString,
  ValidateNested,
  IsDefined,
  IsNotEmptyObject,
} from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'

export class IndirizzoDto {
  @IsString()
  @IsNotEmpty()
  via: string

  @IsString()
  @IsNotEmpty()
  civico: string

  @IsString()
  @IsNotEmpty()
  cap: string

  @IsString()
  @IsNotEmpty()
  comune: string

  @IsString()
  @IsNotEmpty()
  provincia: string

  @IsString()
  @IsOptional()
  nazione?: string
}

export class CreateProduttoreDto {
  @IsString()
  @IsNotEmpty()
  ragioneSociale: string

  @IsString()
  @IsNotEmpty()
  partitaIVA: string

  /** Facoltativo, in aggiunta alla partita IVA. Al massimo 16 caratteri (D2/M8). */
  @ApiPropertyOptional({
    description:
      'Codice fiscale della ditta (al massimo 16 caratteri), facoltativo e in aggiunta alla partita IVA. Un privato senza partita IVA è ammesso solo come produttore.',
    maxLength: 16,
    example: 'RSSMRA80A01H501U',
  })
  @IsString()
  @IsOptional()
  @MaxLength(16, {
    message:
      'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite',
  })
  codiceFiscale?: string

  @IsDefined()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => IndirizzoDto)
  sedeLegale: IndirizzoDto

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string
}

export class CreateTrasportatoreDto {
  @IsString()
  @IsNotEmpty()
  ragioneSociale: string

  @IsString()
  @IsNotEmpty()
  partitaIVA: string

  /** Facoltativo, in aggiunta alla partita IVA. Al massimo 16 caratteri (D2/M8). */
  @ApiPropertyOptional({
    description:
      'Codice fiscale della ditta (al massimo 16 caratteri), facoltativo e in aggiunta alla partita IVA. Un privato senza partita IVA è ammesso solo come produttore.',
    maxLength: 16,
    example: 'RSSMRA80A01H501U',
  })
  @IsString()
  @IsOptional()
  @MaxLength(16, {
    message:
      'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite',
  })
  codiceFiscale?: string

  @IsDefined()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => IndirizzoDto)
  sedeLegale: IndirizzoDto

  @IsString()
  @IsNotEmpty()
  numeroIscrizione: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string

  // Scadenza dell'iscrizione all'Albo Gestori: facoltativa, non tutte le
  // anagrafiche la hanno ancora valorizzata (Task 3 dello scadenzario).
  @IsDateString()
  @IsOptional()
  scadenzaIscrizione?: string
}

export class CreateDestinatarioDto {
  @IsString()
  @IsNotEmpty()
  ragioneSociale: string

  @IsString()
  @IsNotEmpty()
  partitaIVA: string

  /** Facoltativo, in aggiunta alla partita IVA. Al massimo 16 caratteri (D2/M8). */
  @ApiPropertyOptional({
    description:
      'Codice fiscale della ditta (al massimo 16 caratteri), facoltativo e in aggiunta alla partita IVA. Un privato senza partita IVA è ammesso solo come produttore.',
    maxLength: 16,
    example: 'RSSMRA80A01H501U',
  })
  @IsString()
  @IsOptional()
  @MaxLength(16, {
    message:
      'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite',
  })
  codiceFiscale?: string

  @IsDefined()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => IndirizzoDto)
  sede: IndirizzoDto

  @IsString()
  @IsNotEmpty()
  numeroAutorizzazione: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string

  // Scadenza dell'autorizzazione: facoltativa, non tutte le anagrafiche la
  // hanno ancora valorizzata (Task 3 dello scadenzario).
  @IsDateString()
  @IsOptional()
  scadenzaAutorizzazione?: string
}

// Update DTOs
// Note: gli identificativi gia' impostati non si cambiano (D2.7); unica eccezione D2.8
export class UpdateProduttoreDto {
  @IsString()
  @IsOptional()
  ragioneSociale?: string

  /** D2.7: aggiunge l'identificativo mancante della ditta. */
  @ApiPropertyOptional({
    description:
      'Aggiunge il codice fiscale mancante della ditta; uno già impostato non si cambia.',
    maxLength: 16,
    example: 'RSSMRA80A01H501U',
  })
  @IsString()
  @IsOptional()
  @MaxLength(16, {
    message:
      'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite',
  })
  codiceFiscale?: string

  /** D2.7 / D2.8: aggiunta, o sostituzione se quella registrata non passa il controllo. */
  @ApiPropertyOptional({
    description:
      'Aggiunge la partita IVA mancante della ditta, oppure sostituisce quella registrata solo se non passa il controllo di validità; una partita IVA valida non si cambia.',
  })
  @IsString()
  @IsOptional()
  partitaIVA?: string

  /** D7: nuova sede predefinita del ruolo (attiva, della stessa ditta). Esclude l'indirizzo. */
  @ApiPropertyOptional({
    description:
      "Nuova sede predefinita del ruolo: deve essere attiva e della stessa ditta. Esclude l'indirizzo (sedeLegale/sede).",
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sedeId?: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  @IsOptional()
  sedeLegale?: IndirizzoDto

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string
}

export class UpdateTrasportatoreDto {
  @IsString()
  @IsOptional()
  ragioneSociale?: string

  /** D2.7: aggiunge l'identificativo mancante della ditta. */
  @ApiPropertyOptional({
    description:
      'Aggiunge il codice fiscale mancante della ditta; uno già impostato non si cambia.',
    maxLength: 16,
    example: 'RSSMRA80A01H501U',
  })
  @IsString()
  @IsOptional()
  @MaxLength(16, {
    message:
      'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite',
  })
  codiceFiscale?: string

  /** D2.7 / D2.8: aggiunta, o sostituzione se quella registrata non passa il controllo. */
  @ApiPropertyOptional({
    description:
      'Aggiunge la partita IVA mancante della ditta, oppure sostituisce quella registrata solo se non passa il controllo di validità; una partita IVA valida non si cambia.',
  })
  @IsString()
  @IsOptional()
  partitaIVA?: string

  /** D7: nuova sede predefinita del ruolo (attiva, della stessa ditta). Esclude l'indirizzo. */
  @ApiPropertyOptional({
    description:
      "Nuova sede predefinita del ruolo: deve essere attiva e della stessa ditta. Esclude l'indirizzo (sedeLegale/sede).",
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sedeId?: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  @IsOptional()
  sedeLegale?: IndirizzoDto

  @IsString()
  @IsOptional()
  numeroIscrizione?: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string

  // Assente = campo non toccato; `null` = azzeramento esplicito della
  // scadenza; stringa ISO = nuova scadenza. `@IsOptional()` di
  // class-validator salta la validazione sia per undefined sia per null.
  @IsDateString()
  @IsOptional()
  scadenzaIscrizione?: string | null
}

export class UpdateDestinatarioDto {
  @IsString()
  @IsOptional()
  ragioneSociale?: string

  /** D2.7: aggiunge l'identificativo mancante della ditta. */
  @ApiPropertyOptional({
    description:
      'Aggiunge il codice fiscale mancante della ditta; uno già impostato non si cambia.',
    maxLength: 16,
    example: 'RSSMRA80A01H501U',
  })
  @IsString()
  @IsOptional()
  @MaxLength(16, {
    message:
      'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite',
  })
  codiceFiscale?: string

  /** D2.7 / D2.8: aggiunta, o sostituzione se quella registrata non passa il controllo. */
  @ApiPropertyOptional({
    description:
      'Aggiunge la partita IVA mancante della ditta, oppure sostituisce quella registrata solo se non passa il controllo di validità; una partita IVA valida non si cambia.',
  })
  @IsString()
  @IsOptional()
  partitaIVA?: string

  /** D7: nuova sede predefinita del ruolo (attiva, della stessa ditta). Esclude l'indirizzo. */
  @ApiPropertyOptional({
    description:
      "Nuova sede predefinita del ruolo: deve essere attiva e della stessa ditta. Esclude l'indirizzo (sedeLegale/sede).",
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  sedeId?: string

  @ValidateNested()
  @Type(() => IndirizzoDto)
  @IsOptional()
  sede?: IndirizzoDto

  @IsString()
  @IsOptional()
  numeroAutorizzazione?: string

  @IsEmail()
  @IsOptional()
  email?: string

  @IsString()
  @IsOptional()
  telefono?: string

  @IsString()
  @IsOptional()
  pec?: string

  // Assente = campo non toccato; `null` = azzeramento esplicito della
  // scadenza; stringa ISO = nuova scadenza. `@IsOptional()` di
  // class-validator salta la validazione sia per undefined sia per null.
  @IsDateString()
  @IsOptional()
  scadenzaAutorizzazione?: string | null
}
