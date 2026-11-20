/**
 * Nonce contro il login CSRF sul ritorno SPID/CIE. Un link `/campo/accesso#accessToken=..` mandato
 * da un malintenzionato infilerebbe nel telefono della vittima la sessione di un altro autista, a
 * cui la vittima attribuirebbe poi i propri esiti. Prima di partire per l'IdP la pagina di login
 * genera un nonce casuale e lo tiene qui; il backend lo rimanda nel fragment (RelayState
 * `campo.<nonce>`) e l'accesso e' accettato solo se coincide, una volta sola.
 *
 * localStorage e non sessionStorage: con la PWA installata su iOS il ritorno dall'IdP puo' cadere in
 * un altro contesto di navigazione. Se localStorage non e' scrivibile non si puo' verificare nulla:
 * si rifiuta (fail closed).
 */
export const CHIAVE_NONCE = 'wasteflow.campo.nonce-accesso';
const DURATA_MS = 15 * 60_000;

function base64url(byte: Uint8Array): string {
  let s = '';
  for (const b of byte) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Genera e ricorda un nonce di 22 caratteri; `null` se non si puo' ricordare. */
export function generaNonceAccesso(): string | null {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  try {
    localStorage.setItem(CHIAVE_NONCE, JSON.stringify({ nonce, scadenza: Date.now() + DURATA_MS }));
    return nonce;
  } catch {
    return null;
  }
}

/** Confronta col nonce ricordato e lo butta SEMPRE (monouso, anche se non coincide). */
export function consumaNonceAccesso(ricevuto: string | null): boolean {
  let salvato: { nonce?: unknown; scadenza?: unknown } | null = null;
  try {
    const grezzo = localStorage.getItem(CHIAVE_NONCE);
    localStorage.removeItem(CHIAVE_NONCE);
    salvato = grezzo ? (JSON.parse(grezzo) as typeof salvato) : null;
  } catch {
    return false;
  }
  if (!salvato || typeof salvato.nonce !== 'string' || typeof salvato.scadenza !== 'number') {
    return false;
  }
  if (!ricevuto || Date.now() > salvato.scadenza) return false;
  return uguali(salvato.nonce, ricevuto);
}

function uguali(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
