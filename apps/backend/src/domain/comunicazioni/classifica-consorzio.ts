import { cerSoloCifre } from '../waste-movement/cer-registro'

/**
 * Classificatore dei movimenti per consorzio (fase 4.9b, T9, P9 §4.1, decisione D3 = a).
 *
 * Funzione PURA: dato un movimento, le regole dell'azienda e le correzioni manuali sul singolo
 * movimento, dice a quali consorzi appartiene. Non legge il database, non entra nell'`entryHash` e
 * non tocca `WasteMovement`. Chi la usa passa la RADICE della catena del movimento vigente
 * (`movimentoOriginaleId ?? id`): le correzioni manuali stanno sulla radice e cosi' seguono
 * rettifiche e annullamenti.
 */

export const CONSORZI = ['CONOU', 'COBAT', 'COREPLA'] as const
export type Consorzio = (typeof CONSORZI)[number]
export type VersoMovimento = 'CARICO' | 'SCARICO'

export function eConsorzio(valore: string): valore is Consorzio {
  return (CONSORZI as readonly string[]).includes(valore)
}

export interface RegolaConsorzioDef {
  id?: string
  consorzio: Consorzio
  /** `null` = carichi e scarichi. */
  verso: VersoMovimento | null
  /** Le sole cifre: 2 (capitolo) o 4 (sottocapitolo). Alternativo a `cerEsatto`. */
  cerPrefisso: string | null
  /** Le sole cifre: 6. */
  cerEsatto: string | null
  causaleCodice: string | null
  registroId: string | null
  attiva: boolean
  /** Primo giorno di validita', `AAAA-MM-GG`. */
  validaDal: string
}

export interface MovimentoDaClassificare {
  /** Radice della catena: la ORDINARIA di partenza (`movimentoOriginaleId ?? id`). */
  radiceId: string
  registroId: string
  verso: VersoMovimento
  /** Il CER in qualunque forma: si confrontano le sole cifre. */
  cer: string
  causale: string
  /** Giorno del movimento (di Roma), `AAAA-MM-GG`. */
  giorno: string
}

/** Correzione manuale: `escluso` false = marcatura manuale, true = esclusione manuale. */
export interface OverrideMovimento {
  consorzio: Consorzio
  escluso: boolean
}

export interface Marcatura {
  consorzio: Consorzio
  origine: 'REGOLA' | 'MANUALE'
  /** Presente solo se `origine` e' `REGOLA` e la regola ha un id. */
  regolaId?: string
}

export interface EsitoClassificazione {
  /** Un elemento per consorzio, nell'ordine di `CONSORZI`. */
  marcature: Marcatura[]
  /** Consorzi che una regola avrebbe preso ma che l'utente ha escluso a mano. */
  esclusi: Consorzio[]
}

function regolaCombacia(m: MovimentoDaClassificare, r: RegolaConsorzioDef): boolean {
  if (!r.attiva || m.giorno < r.validaDal) return false
  if (r.verso !== null && r.verso !== m.verso) return false
  if (r.causaleCodice !== null && r.causaleCodice !== m.causale) return false
  if (r.registroId !== null && r.registroId !== m.registroId) return false
  const cifre = cerSoloCifre(m.cer)
  if (r.cerEsatto !== null) return cifre === r.cerEsatto
  if (r.cerPrefisso !== null) return cifre.startsWith(r.cerPrefisso)
  // Una regola senza CER non e' ammessa dal database; qui non marca nulla.
  return false
}

export function classificaConsorzi(
  movimento: MovimentoDaClassificare,
  regole: readonly RegolaConsorzioDef[],
  overrides: readonly OverrideMovimento[]
): EsitoClassificazione {
  const marcature: Marcatura[] = []
  const esclusi: Consorzio[] = []
  for (const consorzio of CONSORZI) {
    const correzione = overrides.find(o => o.consorzio === consorzio)
    const regola = regole.find(r => r.consorzio === consorzio && regolaCombacia(movimento, r))
    if (correzione?.escluso) {
      if (regola) esclusi.push(consorzio)
      continue
    }
    if (correzione) {
      marcature.push({ consorzio, origine: 'MANUALE' })
    } else if (regola) {
      marcature.push(
        regola.id === undefined
          ? { consorzio, origine: 'REGOLA' }
          : { consorzio, origine: 'REGOLA', regolaId: regola.id }
      )
    }
  }
  return { marcature, esclusi }
}

/**
 * Regole in vigore per un'azienda: per ogni consorzio, se l'azienda ha almeno una regola propria
 * (anche disattiva: e' il modo di spegnere il consorzio) valgono solo le sue; altrimenti valgono
 * quelle di sistema.
 */
export function regoleEfficaci(
  dellAzienda: readonly RegolaConsorzioDef[],
  disistema: readonly RegolaConsorzioDef[]
): RegolaConsorzioDef[] {
  const conRegoleProprie = new Set(dellAzienda.map(r => r.consorzio))
  return [...dellAzienda, ...disistema.filter(r => !conRegoleProprie.has(r.consorzio))]
}

/**
 * Dal CER scritto dall'utente (in qualunque forma) alla coppia prefisso/codice esatto della regola:
 * 2 o 4 cifre = prefisso (capitolo, sottocapitolo), 6 cifre = codice esatto. `null` se non valido.
 */
export function normalizzaCerRegola(
  testo: string
): { cerPrefisso: string | null; cerEsatto: string | null } | null {
  const cifre = cerSoloCifre(testo)
  if (cifre.length === 2 || cifre.length === 4) return { cerPrefisso: cifre, cerEsatto: null }
  if (cifre.length === 6) return { cerPrefisso: null, cerEsatto: cifre }
  return null
}
