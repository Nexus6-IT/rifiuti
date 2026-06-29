/**
 * SignupDto — payload per la registrazione self-service di una nuova azienda.
 *
 * Raccoglie i dati minimi per creare un tenant TRIAL e il suo utente ADMIN:
 *   - Identificativo aziendale: ragione sociale + partita IVA
 *   - Dati del responsabile: nome, cognome, email, codice fiscale
 *   - Consensi legali obbligatori: ToS + privacy policy
 *
 * Le validazioni di formato (P.IVA, CF) sono replicate anche nel service
 * per sicurezza difensiva. L'indirizzo non è raccolto al signup: l'ADMIN
 * può completare l'anagrafica aziendale dopo la prima autenticazione.
 */

import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsBoolean,
  Equals,
  Length,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class SignupDto {
  // ── Dati azienda ──────────────────────────────────────────────────────────

  @IsString()
  @IsNotEmpty({ message: 'La ragione sociale è obbligatoria' })
  @Length(1, 255, { message: 'La ragione sociale non può superare 255 caratteri' })
  ragioneSociale!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{11}$/, { message: 'La partita IVA deve contenere esattamente 11 cifre' })
  partitaIva!: string;

  // ── Dati responsabile (admin del tenant) ──────────────────────────────────

  @IsString()
  @IsNotEmpty({ message: 'Il nome è obbligatorio' })
  @Length(1, 100)
  firstName!: string;

  @IsString()
  @IsNotEmpty({ message: 'Il cognome è obbligatorio' })
  @Length(1, 100)
  lastName!: string;

  @IsEmail({}, { message: 'Inserisci un indirizzo email valido' })
  @IsNotEmpty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  /**
   * Codice fiscale personale del responsabile (16 caratteri alfanumerici).
   * Diventa lo `username` Keycloak (identificativo SAML `fiscalCode`).
   */
  @IsString()
  @IsNotEmpty()
  @Length(16, 16, { message: 'Il codice fiscale deve essere di 16 caratteri' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase().trim() : value,
  )
  fiscalCode!: string;

  // ── Consensi legali ───────────────────────────────────────────────────────

  @IsBoolean({ message: 'Indicare l\'accettazione dei Termini di Servizio' })
  @Equals(true, { message: 'Devi accettare i Termini di Servizio per procedere' })
  tosAccepted!: boolean;

  @IsBoolean({ message: 'Indicare l\'accettazione della Privacy Policy' })
  @Equals(true, { message: 'Devi accettare la Privacy Policy per procedere' })
  privacyAccepted!: boolean;
}
