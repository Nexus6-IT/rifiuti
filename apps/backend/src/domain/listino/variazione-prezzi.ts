import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { arrotonda, prezzoCalcolato } from './importi-riga'

/**
 * Regole pure delle variazioni di prezzo (E21, E22) e dell'adeguamento ISTAT (E24, D20-D22):
 * stringhe decimali, aritmetica esatta, nessun `number`, nessun database.
 */

export type TipoVariazione =
  | 'AUMENTO_PERCENTUALE'
  | 'AUMENTO_IMPORTO'
  | 'DIMINUZIONE_PERCENTUALE'
  | 'DIMINUZIONE_IMPORTO'
  | 'SOSTITUZIONE_IVA'

export type EsitoPrezzo = { prezzo: string } | { errore: string }

const NUMERO = /^\d+([.,]\d+)?$/
const NUMERO_CON_SEGNO = /^-?\d+([.,]\d+)?$/
/** Decimal(14,6): il prezzo deve restare sotto 1e8. */
const TETTO_PREZZO = new Prisma.Decimal(100000000)
const CENTO = new Prisma.Decimal(100)

const dec = (v: string): Prisma.Decimal => new Prisma.Decimal(v.trim().replace(',', '.'))

/** Decimali significativi (zeri finali tolti), minimo 2 (R4). */
function precisione(v: Prisma.Decimal): number {
  return Math.max(2, v.decimalPlaces())
}

export function nuovoPrezzo(
  attuale: string,
  tipo: Exclude<TipoVariazione, 'SOSTITUZIONE_IVA'>,
  valore: string
): EsitoPrezzo {
  if (!NUMERO.test(attuale.trim())) return { errore: 'Il prezzo attuale non è un numero.' }
  if (!NUMERO_CON_SEGNO.test(valore.trim())) return { errore: 'Il valore non è un numero.' }
  const v = dec(valore)
  if (v.lte(0)) return { errore: 'Il valore deve essere maggiore di 0.' }
  const p = dec(attuale)
  const importo = tipo === 'AUMENTO_IMPORTO' || tipo === 'DIMINUZIONE_IMPORTO'
  if (importo && v.decimalPlaces() > 6) {
    return { errore: "L'importo può avere al massimo 6 decimali." }
  }

  let risultato: Prisma.Decimal
  switch (tipo) {
    case 'AUMENTO_PERCENTUALE':
      risultato = p.plus(p.times(v).div(CENTO))
      break
    case 'DIMINUZIONE_PERCENTUALE':
      risultato = p.minus(p.times(v).div(CENTO))
      break
    case 'AUMENTO_IMPORTO':
      risultato = p.plus(v)
      break
    case 'DIMINUZIONE_IMPORTO':
      risultato = p.minus(v)
      break
  }
  if (risultato.isNegative() && !risultato.isZero())
    return { errore: 'Il nuovo prezzo sarebbe negativo.' }
  // Importi fino a 6 decimali (D20); le percentuali seguono la precisione del prezzo (R4).
  const arrotondato = arrotonda(risultato.toFixed(), importo ? 6 : precisione(p))
  if (dec(arrotondato).gte(TETTO_PREZZO))
    return { errore: 'Il nuovo prezzo sarebbe troppo grande.' }
  return { prezzo: prezzoCalcolato(arrotondato) }
}

function prezzoVuotoOZero(p: string): boolean {
  const t = p.trim()
  return t === '' || (NUMERO.test(t) && dec(t).isZero())
}

/** Applica `f` ai prezzi delle fasce; zero e vuoti restano invariati; il primo errore annulla tutto. */
export function nuoviScaglioni<T extends { prezzo: string }>(
  s: readonly T[],
  f: (p: string) => EsitoPrezzo
): { scaglioni: T[] } | { errore: string } {
  const out: T[] = []
  for (const riga of s) {
    if (prezzoVuotoOZero(riga.prezzo)) {
      out.push({ ...riga })
      continue
    }
    const r = f(riga.prezzo)
    if ('errore' in r) return { errore: r.errore }
    out.push({ ...riga, prezzo: r.prezzo })
  }
  return { scaglioni: out }
}

export interface PercentualeIstat {
  anno: number
  mese: number
  percentuale: string
}

const MSG_PERCENTUALE = 'La percentuale deve essere maggiore di 0 e minore di 100.'
const MSG_DECRESCENTI =
  'Le percentuali devono essere decrescenti dai mesi più vecchi ai più recenti.'

/** Messaggi di errore, senza ripetizioni; elenco vuoto = valido. */
export function validaPercentualiIstat(p: readonly PercentualeIstat[]): string[] {
  if (p.length === 0) return ['Indica almeno una percentuale.']
  const errori = new Set<string>()
  const validi: { chiave: number; pct: Prisma.Decimal }[] = []
  const visti = new Set<number>()
  let tutteValide = true

  for (const r of p) {
    const meseOk = Number.isInteger(r.mese) && r.mese >= 1 && r.mese <= 12
    const annoOk = Number.isInteger(r.anno) && r.anno >= 1900 && r.anno <= 9999
    if (!meseOk || !annoOk) {
      errori.add(meseOk ? "L'anno indicato non è valido." : 'Il mese indicato non è valido.')
      tutteValide = false
      continue
    }
    const chiave = r.anno * 12 + (r.mese - 1)
    if (visti.has(chiave)) {
      errori.add('Il mese è indicato più volte.')
      tutteValide = false
      continue
    }
    visti.add(chiave)
    const testo = typeof r.percentuale === 'string' ? r.percentuale.trim() : ''
    if (!NUMERO_CON_SEGNO.test(testo)) {
      errori.add(MSG_PERCENTUALE)
      tutteValide = false
      continue
    }
    const pct = dec(testo)
    if (pct.lte(0) || pct.gte(CENTO)) {
      errori.add(MSG_PERCENTUALE)
      tutteValide = false
      continue
    }
    validi.push({ chiave, pct })
  }

  if (tutteValide) {
    validi.sort((a, b) => a.chiave - b.chiave)
    for (let i = 1; i < validi.length; i++) {
      if (validi[i].pct.gt(validi[i - 1].pct)) {
        errori.add(MSG_DECRESCENTI)
        break
      }
    }
  }
  return [...errori]
}

/** Adeguamento ISTAT di un prezzo: come un aumento percentuale, con percentuale > 0. */
export function aumentoIstat(attuale: string, percentuale: string): EsitoPrezzo {
  return nuovoPrezzo(attuale, 'AUMENTO_PERCENTUALE', percentuale)
}

/**
 * Impronta SHA-256 delle righe dell'anteprima (D20, R12): coppie `id:versione` deduplicate e
 * ordinate, cosi' l'ordine di ingresso e i doppioni non cambiano il risultato.
 */
export function improntaVariazione(righe: readonly { id: string; versione: number }[]): string {
  const coppie = [...new Set(righe.map(r => `${r.id}\u0000${r.versione}`))].sort()
  return createHash('sha256').update(coppie.join('\n')).digest('hex')
}
