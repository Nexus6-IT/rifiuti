import * as QRCode from 'qrcode'
import { codificaBase45 } from './base45'

/**
 * Catena del QR di un formulario vidimato: `qr_code_bytes` (Base64, cosi'
 * come lo restituisce il servizio `vidimazione-formulari`, v.
 * `docs/audits/rentri-vidimazione-e-qr-2026-09-10.md`) -> byte -> Base45
 * (RFC 9285, `./base45.ts`) -> QR Code a livello di correzione **H**
 * (massimo previsto da ISO/IEC 18004, richiesto dalla regola tecnica
 * dell'ente per i processi di stampa alternativi al modello scaricato dalle
 * API di vidimazione).
 *
 * Nessuna firma, nessun CBOR/COSE costruito qui: quei byte sono GIA' firmati
 * dall'ente quando arrivano. Questo modulo si limita a ricodificarli e a
 * disegnarli — la stessa distinzione gia' dichiarata in
 * `tools/rentri-fake/src/stato/vidimazione.ts`.
 */

/**
 * Decodifica `qrCodeBytesBase64` e restituisce il testo Base45 da incidere
 * nel QR — utile a chi debba ispezionare il contenuto senza generare
 * un'immagine (es. test, log diagnostici).
 */
export function contenutoQrVidimazione(qrCodeBytesBase64: string): string {
  const bytes = Buffer.from(qrCodeBytesBase64, 'base64')
  return codificaBase45(bytes)
}

/**
 * Genera il QR Code del formulario vidimato come data URL PNG, livello di
 * correzione H. L'alfabeto Base45 e' un sottoinsieme del set "alfanumerico"
 * ISO/IEC 18004 (v. commento di testata di `base45.ts`): `qrcode` sceglie
 * automaticamente quella modalita' per una stringa che rientra nel suo
 * charset, senza bisogno di forzarla qui.
 */
export async function generaQrVidimazione(qrCodeBytesBase64: string): Promise<string> {
  const contenuto = contenutoQrVidimazione(qrCodeBytesBase64)
  return QRCode.toDataURL(contenuto, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
  })
}
