/**
 * AccessRequestDto — payload del form pubblico "Richiedi accesso" (lead capture).
 *
 * NON crea alcun account: raccoglie i dati minimi di contatto perché un
 * consulente/commerciale ricontatti l'azienda e attivi eventualmente una prova
 * guidata (TRIAL) tramite il provisioning admin (white-glove).
 *
 * Campi obbligatori: ragione sociale, nome, cognome, email + consenso privacy.
 * P.IVA, telefono e messaggio sono facoltativi (non servono a creare nulla).
 */

import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsBoolean,
  IsOptional,
  Equals,
  Length,
  Matches,
} from 'class-validator'
import { Transform } from 'class-transformer'

export class AccessRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'La ragione sociale è obbligatoria' })
  @Length(1, 255, { message: 'La ragione sociale non può superare 255 caratteri' })
  ragioneSociale!: string

  /** Partita IVA facoltativa (11 cifre se fornita). */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{11}$/, { message: 'La partita IVA deve contenere esattamente 11 cifre' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value
  )
  partitaIva?: string

  @IsString()
  @IsNotEmpty({ message: 'Il nome è obbligatorio' })
  @Length(1, 100)
  firstName!: string

  @IsString()
  @IsNotEmpty({ message: 'Il cognome è obbligatorio' })
  @Length(1, 100)
  lastName!: string

  @IsEmail({}, { message: 'Inserisci un indirizzo email valido' })
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value
  )
  email!: string

  /** Telefono facoltativo per il ricontatto commerciale. */
  @IsOptional()
  @IsString()
  @Length(1, 30)
  phone?: string

  /** Messaggio libero facoltativo (esigenze, note). */
  @IsOptional()
  @IsString()
  @Length(1, 2000, { message: 'Il messaggio non può superare 2000 caratteri' })
  message?: string

  @IsBoolean({ message: "Indicare l'accettazione dell'informativa privacy" })
  @Equals(true, { message: 'Devi accettare il trattamento dei dati per procedere' })
  privacyAccepted!: boolean
}
