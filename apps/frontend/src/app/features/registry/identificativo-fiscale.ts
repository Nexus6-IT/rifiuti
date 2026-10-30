/**
 * Gemella frontend del VO `IdentificativoFiscale` del backend
 * (`domain/registry/value-objects/identificativo-fiscale.ts`, F2-10 D2): stesse regole, stessi
 * messaggi. Il backend resta l'autorita'; qui si anticipa l'errore prima di inviare il form.
 *
 * Il checksum si applica solo quando un identificativo viene IMPOSTATO, mai in lettura.
 * I messaggi non riportano mai il valore ricevuto: il codice fiscale di un privato e' un dato
 * personale.
 */
import type { TipoAnagrafica } from './anagrafica-form-dialog.component'

export const MESSAGGIO_IDENTIFICATIVO_ASSENTE = 'Indica la partita IVA o il codice fiscale.'
export const MESSAGGIO_PARTITA_IVA_NON_VALIDA =
  'Partita IVA non valida: servono 11 cifre con la cifra di controllo corretta.'
export const MESSAGGIO_CODICE_FISCALE_NON_VALIDO = 'Codice fiscale non valido.'
export const MESSAGGIO_CODICE_FISCALE_TROPPO_LUNGO =
  'Il codice fiscale ha al massimo 16 caratteri: le controparti estere non sono ancora gestite.'
export const MESSAGGIO_PRIVATO_SOLO_PRODUTTORE =
  'Un privato senza partita IVA può essere solo produttore.'

/** Forma del CF di persona, omocodia compresa (lettere LMNPQRSTUV al posto delle cifre). */
const FORMA_CF_PERSONA =
  /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/

const CARATTERI = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// prettier-ignore
const VALORI_DISPARI = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, // 0-9
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, // A-J
  2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23, // K-Z
]

function valorePari(c: string): number {
  const i = CARATTERI.indexOf(c)
  return i < 10 ? i : i - 10
}

function carattereDiControllo(primi15: string): string {
  let somma = 0
  for (let i = 0; i < 15; i++) {
    const c = primi15[i]
    somma += i % 2 === 0 ? VALORI_DISPARI[CARATTERI.indexOf(c)] : valorePari(c)
  }
  return String.fromCharCode('A'.charCodeAt(0) + (somma % 26))
}

/** Maiuscolo, senza spazi e senza il prefisso `IT` davanti a una partita IVA. */
export function normalizzaIdentificativo(valore: string | null | undefined): string {
  const pulito = (valore ?? '').replace(/\s/g, '').toUpperCase()
  return /^IT\d{11}$/.test(pulito) ? pulito.slice(2) : pulito
}

/** 11 cifre con la cifra di controllo corretta. */
export function partitaIvaValida(valore: string | null | undefined): boolean {
  const v = normalizzaIdentificativo(valore)
  if (!/^\d{11}$/.test(v)) return false
  const cifre = v.split('').map(Number)
  let somma = 0
  for (let i = 0; i < 10; i++) {
    let c = cifre[i]
    if (i % 2 !== 0) {
      c *= 2
      if (c > 9) c -= 9
    }
    somma += c
  }
  return (10 - (somma % 10)) % 10 === cifre[10]
}

/** CF di persona (16 caratteri con controllo) oppure di ditta (11 cifre con checksum). */
export function codiceFiscaleValido(valore: string | null | undefined): boolean {
  const v = normalizzaIdentificativo(valore)
  if (/^\d{11}$/.test(v)) return partitaIvaValida(v)
  if (!FORMA_CF_PERSONA.test(v)) return false
  return carattereDiControllo(v.slice(0, 15)) === v[15]
}

/** Vero se la partita IVA e' presente ma non passa il checksum (si segnala, non si corregge). */
export function partitaIvaDaVerificare(valore: string | null | undefined): boolean {
  if (!valore) return false
  return !partitaIvaValida(valore)
}

export interface IdentificativiInput {
  partitaIva?: string | null
  codiceFiscale?: string | null
}

export interface ErroriIdentificativi {
  partitaIva?: string
  codiceFiscale?: string
  /** Errore non riferito a un solo campo (nessun identificativo). */
  generale?: string
}

export interface EsitoIdentificativi {
  errori: ErroriIdentificativi
  /** Valori normalizzati (null se assenti o, per il CF, uguale alla P.IVA). */
  partitaIva: string | null
  codiceFiscale: string | null
  /** Privato (D2.5): solo un CF di 16 caratteri, nessuna P.IVA. */
  privato: boolean
}

/**
 * Valida gli identificativi come il VO del backend. `richiediAlmenoUno` (default vero) serve in
 * creazione; in modifica si validano solo i valori nuovi e il "nessuno" non e' un errore.
 */
export function validaIdentificativi(
  input: IdentificativiInput,
  tipo: TipoAnagrafica,
  richiediAlmenoUno = true,
  /** In modifica: la ditta ha gia' una P.IVA, quindi un CF aggiunto non la rende un privato. */
  partitaIvaGiaPresente = false
): EsitoIdentificativi {
  const grezzaPiva = (input.partitaIva ?? '').trim()
  const grezzoCf = (input.codiceFiscale ?? '').trim()
  const errori: ErroriIdentificativi = {}
  let partitaIva: string | null = null
  let codiceFiscale: string | null = null

  if (!grezzaPiva && !grezzoCf) {
    if (richiediAlmenoUno) errori.generale = MESSAGGIO_IDENTIFICATIVO_ASSENTE
    return { errori, partitaIva, codiceFiscale, privato: false }
  }

  if (grezzaPiva) {
    const n = normalizzaIdentificativo(grezzaPiva)
    if (partitaIvaValida(n)) partitaIva = n
    else errori.partitaIva = MESSAGGIO_PARTITA_IVA_NON_VALIDA
  }

  if (grezzoCf) {
    const n = normalizzaIdentificativo(grezzoCf)
    if (n.length > 16) errori.codiceFiscale = MESSAGGIO_CODICE_FISCALE_TROPPO_LUNGO
    else if (!codiceFiscaleValido(n)) errori.codiceFiscale = MESSAGGIO_CODICE_FISCALE_NON_VALIDO
    else codiceFiscale = n === partitaIva ? null : n
  }

  const privato =
    !grezzaPiva && !partitaIvaGiaPresente && codiceFiscale !== null && codiceFiscale.length === 16
  if (privato && tipo !== 'produttore' && !errori.codiceFiscale) {
    errori.codiceFiscale = MESSAGGIO_PRIVATO_SOLO_PRODUTTORE
  }
  return { errori, partitaIva, codiceFiscale, privato }
}

/** Il valore da cercare con `cercaDitta`: la P.IVA valida, altrimenti il CF valido, altrimenti null. */
export function identificativoPerRicerca(
  partitaIva: string | null | undefined,
  codiceFiscale: string | null | undefined
): string | null {
  if (partitaIva?.trim() && partitaIvaValida(partitaIva))
    return normalizzaIdentificativo(partitaIva)
  if (codiceFiscale?.trim() && codiceFiscaleValido(codiceFiscale))
    return normalizzaIdentificativo(codiceFiscale)
  return null
}

export interface IdentificativiImpostati {
  partitaIva: string | null
  codiceFiscale: string | null
  partitaIvaDaVerificare: boolean
}

export interface IdentificativiDaInviare {
  errori: ErroriIdentificativi
  /** Da inviare solo se presente: in modifica sono solo i valori nuovi (D2.7-D2.8). */
  partitaIVA?: string
  codiceFiscale?: string
}

/**
 * Cosa inviare al backend e quali errori mostrare.
 * - Creazione (`impostati` nullo): validazione completa, almeno uno dei due.
 * - Modifica: gli identificativi impostati non si cambiano (salvo la P.IVA "da verificare",
 *   D2.8) e non si ri-validano; si validano e si inviano solo quelli aggiunti o sostituiti.
 */
export function identificativiPerSalvataggio(
  input: { partitaIVA: string; codiceFiscale: string },
  tipo: TipoAnagrafica,
  impostati: IdentificativiImpostati | null
): IdentificativiDaInviare {
  if (!impostati) {
    const e = validaIdentificativi(
      { partitaIva: input.partitaIVA, codiceFiscale: input.codiceFiscale },
      tipo
    )
    return {
      errori: e.errori,
      partitaIVA: e.partitaIva ?? undefined,
      codiceFiscale: e.codiceFiscale ?? undefined,
    }
  }
  const pivaModificabile = !impostati.partitaIva || impostati.partitaIvaDaVerificare
  const cfModificabile = !impostati.codiceFiscale
  let nuovaPiva = pivaModificabile ? input.partitaIVA.trim() : ''
  if (
    nuovaPiva &&
    impostati.partitaIva &&
    normalizzaIdentificativo(nuovaPiva) === normalizzaIdentificativo(impostati.partitaIva)
  ) {
    nuovaPiva = '' // invariata: non si invia e non si ri-valida
  }
  const nuovoCf = cfModificabile ? input.codiceFiscale.trim() : ''
  const e = validaIdentificativi(
    { partitaIva: nuovaPiva, codiceFiscale: nuovoCf },
    tipo,
    false,
    !!impostati.partitaIva
  )
  return {
    errori: e.errori,
    partitaIVA: e.partitaIva ?? undefined,
    codiceFiscale: e.codiceFiscale ?? undefined,
  }
}
