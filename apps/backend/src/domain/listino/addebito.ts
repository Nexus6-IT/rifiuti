import { Prisma } from '@prisma/client'
import { cascataValida, normalizzaCascata } from './importi-riga'
import { famigliaTipo, tipoAmmessoInArchivio } from './tipi-addebito'

/**
 * Archivio degli addebiti (4.2a, D6, E7, E8): regole pure, senza database. Codice a cinque
 * cifre, sei listini (prezzo, sconto e provvigione a cascata), proposta di prezzo e di
 * provvigione per la riga. I prezzi sono stringhe decimali, mai `number`.
 */

export type TipoProvvigione = 'SCONTATO' | 'LORDO'

export interface PrezzoListino {
  numero: 1 | 2 | 3 | 4 | 5 | 6
  prezzo: string | null
  sconto: string | null
  provvigione: string | null
}

export interface DatiAddebito {
  codice: string
  descrizione: string
  gruppoId: string | null
  unitaMisura: string
  codiceIvaId: string | null
  tipo: string
  categoriaId: string | null
  tipoProvvigione: TipoProvvigione
  centroRicavoId: string | null
  categoriaStatistica1Id: string | null
  categoriaStatistica2Id: string | null
  notaUsoInterno: string | null
  appunti: string | null
  listini: PrezzoListino[]
  attivo: boolean
}

const NUMERI_LISTINO = [1, 2, 3, 4, 5, 6] as const
/** Messaggio del codice non valido (condiviso col servizio, che lo usa in modifica). */
export const MSG_CODICE_ADDEBITO = 'Il codice ha da 1 a 5 cifre.'
const DESCRIZIONE_MAX = 45
const NOTA_MAX = 45
const PREZZO = /^\d{1,8}(\.\d{1,6})?$/
const UNITA_MISURA = /^[A-Z0-9/%#]{1,3}$/
const CODICE_MAX = 99999

const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const oNull = (v: unknown): string | null => {
  const t = testo(v)
  return t === '' ? null : t
}

/** `"12"` -> `"00012"` (come `Format(Val, "00000")`). Vuoto -> null; il resto passa e lo rifiuta `validaAddebito`. */
export function normalizzaCodiceAddebito(v: unknown): string | null {
  const t = typeof v === 'number' ? String(v) : testo(v)
  if (t === '') return null
  return /^\d{1,5}$/.test(t) ? t.padStart(5, '0') : t
}

function normalizzaPrezzo(v: unknown): string | null {
  const t = (typeof v === 'number' ? String(v) : testo(v)).replace(/\s+/g, '').replace(',', '.')
  return t === '' ? null : t
}

/** Sempre sei listini ordinati per numero; i mancanti sono vuoti (null). */
function normalizzaListini(v: unknown): PrezzoListino[] {
  const dati = Array.isArray(v) ? (v as Record<string, unknown>[]) : []
  return NUMERI_LISTINO.map(numero => {
    const l = dati.find(x => x !== null && typeof x === 'object' && Number(x.numero) === numero)
    return {
      numero,
      prezzo: normalizzaPrezzo(l?.prezzo),
      sconto: normalizzaCascata(l?.sconto),
      provvigione: normalizzaCascata(l?.provvigione),
    }
  })
}

export function normalizzaAddebito(g: Partial<Record<keyof DatiAddebito, unknown>>): DatiAddebito {
  const tipo = testo(g.tipo)
  return {
    codice: normalizzaCodiceAddebito(g.codice) ?? '',
    descrizione: testo(g.descrizione),
    gruppoId: oNull(g.gruppoId),
    unitaMisura: testo(g.unitaMisura).toUpperCase(),
    codiceIvaId: oNull(g.codiceIvaId),
    tipo: tipo === '' ? 'V' : tipo,
    categoriaId: oNull(g.categoriaId),
    // Vuoto = predefinito SCONTATO; un valore sconosciuto passa invariato e lo rifiuta `validaAddebito`.
    tipoProvvigione: (testo(g.tipoProvvigione).toUpperCase() || 'SCONTATO') as TipoProvvigione,
    centroRicavoId: oNull(g.centroRicavoId),
    categoriaStatistica1Id: oNull(g.categoriaStatistica1Id),
    categoriaStatistica2Id: oNull(g.categoriaStatistica2Id),
    notaUsoInterno: oNull(g.notaUsoInterno),
    appunti: oNull(g.appunti),
    listini: normalizzaListini(g.listini),
    attivo: g.attivo === undefined ? true : g.attivo === true,
  }
}

/** Messaggi in italiano, nell'ordine dei campi; vuoto = valido. */
export function validaAddebito(d: DatiAddebito): string[] {
  const errori: string[] = []

  if (d.codice !== '') {
    if (!/^\d{5}$/.test(d.codice)) errori.push(MSG_CODICE_ADDEBITO)
    else if (d.codice === '00000') errori.push('Il codice 00000 è riservato.')
  }

  if (d.descrizione === '') errori.push("Inserisci la descrizione dell'addebito.")
  else if (d.descrizione.length > DESCRIZIONE_MAX) {
    errori.push(`La descrizione può avere al massimo ${DESCRIZIONE_MAX} caratteri.`)
  }

  if (d.gruppoId === null) errori.push("Indica il gruppo dell'addebito.")

  if (d.unitaMisura === '') {
    errori.push("Indica l'unità di misura.")
  } else if (!UNITA_MISURA.test(d.unitaMisura)) {
    errori.push("L'unità di misura ha da 1 a 3 caratteri (lettere maiuscole, cifre, / % #).")
  }

  if (!tipoAmmessoInArchivio(d.tipo)) {
    errori.push('Il tipo di addebito non è ammesso nell’archivio.')
  } else if (
    famigliaTipo(d.tipo) === 'QUANTITA_MOVIMENTI' &&
    d.unitaMisura !== 'KG' &&
    d.unitaMisura !== 'TON'
  ) {
    errori.push("Per gli addebiti di tipo T l'unità di misura è KG o TON.")
  }

  if (d.tipoProvvigione !== 'SCONTATO' && d.tipoProvvigione !== 'LORDO') {
    errori.push('Il tipo di provvigione non è ammesso (scontato o lordo).')
  }

  if (d.notaUsoInterno !== null && d.notaUsoInterno.length > NOTA_MAX) {
    errori.push(`La nota d'uso interno può avere al massimo ${NOTA_MAX} caratteri.`)
  }

  if (d.listini.length !== 6 || !NUMERI_LISTINO.every((n, i) => d.listini[i]?.numero === n)) {
    errori.push('I listini devono essere sei, numerati da 1 a 6.')
    return errori
  }

  for (const l of d.listini) {
    const p = `Listino ${l.numero}: `
    if (l.prezzo !== null && !PREZZO.test(l.prezzo)) {
      errori.push(`${p}il prezzo deve essere un numero non negativo con al massimo sei decimali.`)
    }
    if (!cascataValida(l.sconto)) {
      errori.push(
        `${p}lo sconto si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.`
      )
    }
    if (!cascataValida(l.provvigione)) {
      errori.push(
        `${p}la provvigione si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.`
      )
    }
  }

  return errori
}

/**
 * E7: se il cliente ha un listino, quello (solo se ha un prezzo: nessun ripiego sul 1, R6);
 * senza listino, il 1 se gli altri cinque sono vuoti, altrimenti nessuna proposta.
 */
export function prezzoProposto(
  listini: readonly PrezzoListino[],
  listinoCliente: number | null
): PrezzoListino | null {
  const pieno = (l: PrezzoListino | undefined): PrezzoListino | null =>
    l !== undefined && l.prezzo !== null ? l : null
  if (listinoCliente !== null) return pieno(listini.find(l => l.numero === listinoCliente))
  const altriPieni = listini.some(l => l.numero !== 1 && l.prezzo !== null)
  return altriPieni ? null : pieno(listini.find(l => l.numero === 1))
}

/** Cascata con almeno un termine maggiore di zero (E7: "se > 0"). */
function positiva(f: string | null): boolean {
  const n = normalizzaCascata(f)
  return n !== null && n.split('+').some(t => new Prisma.Decimal(t).gt(0))
}

/** E7: la provvigione del cliente, se positiva, sostituisce quella del listino (con il suo tipo se indicato). */
export function provvigioneProposta(
  daListino: { provvigione: string | null; tipo: TipoProvvigione },
  cliente: { provvigione: string | null; tipo: TipoProvvigione | null }
): { provvigione: string | null; tipo: TipoProvvigione } {
  if (positiva(cliente.provvigione)) {
    return {
      provvigione: normalizzaCascata(cliente.provvigione),
      tipo: cliente.tipo ?? daListino.tipo,
    }
  }
  return { provvigione: daListino.provvigione, tipo: daListino.tipo }
}

/** Primo codice libero `00001`-`99999` (`00000` escluso); null se esauriti (R7). */
export function prossimoCodiceAddebito(usati: readonly string[]): string | null {
  const occupati = new Set(usati.map(c => Number(c)))
  for (let n = 1; n <= CODICE_MAX; n++) {
    if (!occupati.has(n)) return String(n).padStart(5, '0')
  }
  return null
}
