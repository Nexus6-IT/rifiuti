/**
 * RFC 3161 TSA Provider — STUB MARCA TEMPORALE QUALIFICATA (non operativo)
 *
 * Stub dell'implementazione TSA (Time Stamping Authority) qualificata RFC 3161.
 * NON operativo: fallisce con messaggio chiaro se selezionato senza configurazione.
 *
 * ARCHITETTURA (quando attivato):
 *  1. Costruisce una TSARequest RFC 3161 con l'hash del documento
 *  2. HTTP POST al TSA endpoint (QTSP AgID):
 *       Content-Type: application/timestamp-query
 *       Body: DER-encoded TimeStampRequest
 *  3. Valida la TSAResponse (HTTP 200, Content-Type: application/timestamp-reply)
 *  4. Estrae il TimeStampToken DER e lo restituisce base64-encoded
 *
 * QTSP AgID accreditati per timestamp (elenco aggiornato su trust-list EIDAS):
 *  - Aruba PEC: https://ca.aruba.it/
 *  - InfoCert: https://www.infocert.it/
 *  - Namirial: https://www.namirial.it/
 *  - Poste Italiane: https://www.poste.it/firma-digitale.html
 *  - freeTSA (test): https://freetsa.org/tsr (NON accreditato AgID)
 *
 * ATTIVARE:
 *  Configurare nel .env:
 *    TSA_PROVIDER=rfc3161
 *    TSA_URL=https://tsa.qtsp.example.it/tsr
 *    TSA_USERNAME=<utente TSA>       (se richiesto)
 *    TSA_PASSWORD=<password TSA>     (se richiesto, cifrata a riposo)
 *    TSA_POLICY_OID=1.2.3.4.5       (OID della policy TSA)
 *
 * Normativa:
 *  - RFC 3161: Internet X.509 PKI Time-Stamp Protocol (TSP)
 *  - ETSI EN 319 422: Electronic Signatures Timestamping Formats
 *  - AgID REGIT-TSA-TSPS v1.0: regole tecniche TSA in Italia
 *  - CAD art. 20, co. 3: effetto della marca temporale sui documenti informatici
 */

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ITsaProvider, TsaTokenResult, TsaProviderType } from './signature-provider.interface'

@Injectable()
export class Rfc3161TsaProvider implements ITsaProvider {
  constructor(private readonly config: ConfigService) {}

  async generateToken(_documentHash: string): Promise<TsaTokenResult> {
    this.validateConfig()
    // STUB: implementazione reale:
    // 1. Crea TimeStampRequest ASN.1/DER
    // 2. HTTP POST a TSA_URL (Content-Type: application/timestamp-query)
    // 3. Valida TimeStampResponse e restituisce TimeStampToken base64
    throw new Error(
      '[RFC3161-TSA] Provider TSA qualificato non ancora implementato. ' +
        'Configurare QTSP AgID accreditato (Aruba/InfoCert/Namirial/Poste) e ' +
        'impostare TSA_URL + TSA_PROVIDER=rfc3161. ' +
        'Riferimento: https://www.agid.gov.it/sites/default/files/repository_files/register_manuale_v1.0.pdf'
    )
  }

  getProviderType(): TsaProviderType {
    return 'RFC3161'
  }

  isQualified(): boolean {
    return true
  }

  private validateConfig(): void {
    const tsaUrl = this.config.get<string>('TSA_URL')
    if (!tsaUrl) {
      throw new Error(
        '[RFC3161-TSA] TSA_URL non configurata. ' +
          'Impostare TSA_URL o usare TSA_PROVIDER=mock per la modalità sandbox.'
      )
    }
  }
}
