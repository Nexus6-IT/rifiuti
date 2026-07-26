/**
 * ⚠️ NON È LA STRADA PRINCIPALE PER LA FIRMA DEL FIR VERSO RENTRI.
 *
 * Decisione del 2026-07-26, ADR `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md`:
 * la via **principale** per la sottoscrizione del formulario verso l'ente è
 * la **firma remota RENTRI** — `CompletaOperazioneConFirmaUseCase`
 * (`src/application/rentri/completa-operazione-con-firma.use-case.ts`, R3
 * Task 3), che orchestra la sequenza `ca-rentri` (`credentials/authorize` →
 * conferma dell'utente sull'app ufficiale *RENTRI FIR Digitale* →
 * `sign-hash` → `acquisizione-firma`). In quella via **la chiave privata non
 * passa mai da noi**: è custodita dal sistema RENTRI. È esattamente il
 * motivo per cui è stata scelta (eIDAS art. 3 p. 12: una firma è qualificata
 * solo se la chiave resta sotto controllo esclusivo del firmatario).
 *
 * Questo provider resta come **opzione 2 dell'ADR — ramo futuro/opzionale**:
 * integrazione con un QTSP terzo via API CSC (Cloud Signature Consortium),
 * utile SOLO all'azienda che ha già un proprio contratto QTSP e vuole usarlo.
 * Non è la strada primaria e **non deve essere selezionato come default in
 * produzione**.
 *
 * Verificato al momento di scrivere questa nota: `resolveSignatureProviderType`
 * (`../digital-signature.service.ts`) NON rende mai `qes` un default — fuori
 * produzione il default è `sandbox`, in produzione non esiste alcun default e
 * `SIGNATURE_PROVIDER` va impostata esplicitamente. Questo provider è quindi
 * raggiungibile solo su opt-in esplicito `SIGNATURE_PROVIDER=qes`, e in quel
 * caso fallisce subito con un messaggio chiaro (v. sotto): nessun codice
 * aggiuntivo serve a proteggerlo, solo questa nota, la cui assenza era il
 * difetto segnalato dal piano (uno stub che sembra una capacità disponibile).
 *
 * ---
 *
 * QES Signature Provider — STUB FIRMA QUALIFICATA (non operativo)
 *
 * Stub dell'implementazione QES (Qualified Electronic Signature) / SPID-CIE.
 * NON operativo: fallisce con messaggio chiaro se selezionato senza credenziali.
 *
 * ARCHITETTURA (quando attivato):
 *  - Integrazione con QTSP (Qualified Trust Service Provider) accreditato AgID
 *    (Aruba PEC, InfoCert, Namirial, Poste Italiane) per firma qualificata eIDAS.
 *  - Supporto SPID Level 2 / CIE come strumento di autenticazione del firmatario.
 *  - Certificato qualificato emesso da CA accreditata (elenco pubblico AgID/EIDAS).
 *  - Chiave privata conservata nell'HSM del QTSP, MAI estratta.
 *
 * ATTIVARE:
 *  1. Stipulare contratto con QTSP AgID (Aruba/InfoCert/Namirial/Poste Italiane)
 *  2. Configurare nel .env:
 *     SIGNATURE_PROVIDER=qes
 *     QES_QTSP_ENDPOINT=https://api.qtsp.example.it/sign
 *     QES_CLIENT_CERT=/run/secrets/qes-client-cert.pem
 *     QES_CLIENT_KEY=/run/secrets/qes-client-key.pem  (cifrata, passphrase QES_KEY_PASSPHRASE)
 *     QES_API_KEY=<chiave API QTSP>
 *  3. Sostituire questa classe con l'implementazione concreta via chiamata HTTP al QTSP.
 *
 * Normativa: Reg. UE 910/2014 eIDAS art. 26-27 (firma avanzata); art. 28-32 (firma qualificata).
 * La firma qualificata è l'unica con valore legale equivalente alla firma autografa in tutti gli
 * Stati Membri UE. Per i FIR digitali (DM 59/2023) è ammessa anche la firma elettronica avanzata.
 */

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  ISignatureProvider,
  SignatureProviderResult,
  SignatureProviderType,
} from './signature-provider.interface'

@Injectable()
export class QesSignatureProvider implements ISignatureProvider {
  constructor(private readonly config: ConfigService) {}

  async sign(_document: any, _userId: string): Promise<SignatureProviderResult> {
    this.validateConfig()
    // STUB: implementazione reale chiama API QTSP
    // La logica di sign va qui una volta disponibile il contratto QTSP.
    throw new Error(
      '[QES] Provider QES non ancora implementato. ' +
        'Configurare QTSP (Aruba/InfoCert/Namirial/Poste) e sostituire questo stub. ' +
        'Documentazione: https://www.agid.gov.it/en/platforms/qualified-electronic-signature'
    )
  }

  async verify(
    _documentHash: string,
    _signatureValue: string,
    _publicKey: string
  ): Promise<boolean> {
    this.validateConfig()
    throw new Error('[QES] Verifica QES non ancora implementata — stub provider.')
  }

  getProviderType(): SignatureProviderType {
    return 'QES'
  }

  isQualified(): boolean {
    return true
  }

  private validateConfig(): void {
    const endpoint = this.config.get<string>('QES_QTSP_ENDPOINT')
    const cert = this.config.get<string>('QES_CLIENT_CERT')
    const key = this.config.get<string>('QES_CLIENT_KEY')

    const missing: string[] = []
    if (!endpoint) missing.push('QES_QTSP_ENDPOINT')
    if (!cert) missing.push('QES_CLIENT_CERT')
    if (!key) missing.push('QES_CLIENT_KEY')

    if (missing.length > 0) {
      throw new Error(
        `[QES] Credenziali mancanti per firma qualificata: ${missing.join(', ')}. ` +
          'Impostare le variabili env o usare SIGNATURE_PROVIDER=sandbox per la modalità sandbox.'
      )
    }
  }
}
