/**
 * Interfacce provider firma digitale FIR — architettura "pronta-ma-non-collegata"
 *
 * Il sistema espone due livelli di astrazione:
 *
 * 1. ISignatureProvider — genera e verifica la firma crittografica sul documento.
 *    - SandboxSignatureProvider (default): ECDSA effimera P-256, NON qualificata.
 *    - QesSignatureProvider (stub): firma qualificata QES/SPID-CIE via QTSP AgID.
 *      ATTIVARE: contratto QTSP + SIGNATURE_PROVIDER=qes + config chiavi.
 *
 * 2. ITsaProvider — genera la marca temporale (non-ripudio).
 *    - MockTsaProvider (default): timestamp JSON mock, non qualificato.
 *    - Rfc3161TsaProvider (stub): TSA accreditata AgID, RFC 3161.
 *      ATTIVARE: QTSP accreditata AgID (Aruba/InfoCert/Namirial/Poste) +
 *      TSA_PROVIDER=rfc3161 + TSA_URL + credenziali.
 *
 * Normativa di riferimento:
 *  - DM 59/2023 (RENTRI) + art. 188-bis D.Lgs. 152/2006: FIR digitale obbligatorio
 *  - Reg. UE 910/2014 (eIDAS): livelli firma EAS/AdES/QES; QES = valore legale firma autografa
 *  - CAD D.Lgs. 82/2005: firma digitale e marca temporale
 *  - AgID: LineeGuida conservazione 10 anni (formazione, gestione, conservazione doc. informatici)
 *  - RFC 3161: Internet X.509 PKI Time-Stamp Protocol (TSP)
 *
 * Fonti:
 *  - https://www.agid.gov.it/en/platforms/qualified-electronic-signature
 *  - https://demoapi.rentri.gov.it/docs?page=guida-tecnica-struttura-fir-digitale
 *  - https://www.agid.gov.it/sites/agid/files/2024-05/linee_guida_sul_documento_informatico.pdf
 */

export type SignatureProviderType = 'SANDBOX' | 'QES' | 'SPID_CIE'
export type TsaProviderType = 'MOCK' | 'RFC3161'

/** Tipo di metodo firma; FIRMA-NON-QUALIFICATA è il sandbox. */
export type SignatureMethodProvider =
  | 'ECDSA-SHA256'
  | 'RSA-SHA256'
  | 'FIRMA-NON-QUALIFICATA'

export interface SignatureProviderResult {
  /** Valore firma, base64. */
  signatureValue: string
  /** Hash SHA-256 del documento firmato (hex). */
  documentHash: string
  /** Hash SHA-256 della chiave pubblica / certificato (hex). */
  certificateHash: string
  /** Chiave pubblica PEM (per verifica). MAI loggata in chiaro. */
  publicKey: string
  signatureMethod: SignatureMethodProvider
  providerType: SignatureProviderType
  /** false = sandbox/non qualificata; true = QES/firma qualificata a norma. */
  isQualified: boolean
}

/**
 * Interfaccia provider firma crittografica.
 *
 * Implementazioni: SandboxSignatureProvider (default), QesSignatureProvider (stub).
 * Selezione: env SIGNATURE_PROVIDER=sandbox|qes (default: sandbox).
 *
 * SICUREZZA: chiavi private MAI restituite in output, MAI loggate.
 * La chiave privata viene generata internamente al provider e usata una volta sola
 * (sandbox = effimera). In modalità QES, viene gestita dall'HSM/QTSP.
 */
export interface ISignatureProvider {
  /**
   * Firma il documento per conto dell'utente identificato da userId.
   * La chiave privata è generata internamente (sandbox) o recuperata dal QTSP (QES).
   * La chiave privata NON viene mai esposta nell'output.
   */
  sign(document: any, userId: string): Promise<SignatureProviderResult>

  /**
   * Verifica la firma crittografica del documento.
   */
  verify(documentHash: string, signatureValue: string, publicKey: string): Promise<boolean>

  getProviderType(): SignatureProviderType
  isQualified(): boolean
}

export interface TsaTokenResult {
  /** Token marca temporale, base64. */
  token: string
  providerType: TsaProviderType
  /** false = mock; true = TSA accreditata AgID RFC 3161. */
  isQualified: boolean
}

/**
 * Interfaccia provider marca temporale (TSA).
 *
 * Implementazioni: MockTsaProvider (default), Rfc3161TsaProvider (stub).
 * Selezione: env TSA_PROVIDER=mock|rfc3161 (default: mock).
 *
 * La marca temporale qualificata (RFC 3161) è richiesta per la conservazione
 * a norma AgID (10 anni) e per la validità probatoria del documento nel tempo.
 * ATTIVARE: TSA_PROVIDER=rfc3161 + TSA_URL + credenziali QTSP.
 */
export interface ITsaProvider {
  /**
   * Genera il token di marca temporale per l'hash documentale dato.
   * In sandbox: token JSON mock (non qualificato).
   * In produzione: chiamata HTTP al TSA AgID (RFC 3161 timestampRequest/Response).
   */
  generateToken(documentHash: string): Promise<TsaTokenResult>

  getProviderType(): TsaProviderType
  isQualified(): boolean
}

/** Token DI per ISignatureProvider — usare con @Inject(SIGNATURE_PROVIDER). */
export const SIGNATURE_PROVIDER = Symbol('SIGNATURE_PROVIDER')

/** Token DI per ITsaProvider — usare con @Inject(TSA_PROVIDER). */
export const TSA_PROVIDER = Symbol('TSA_PROVIDER')
