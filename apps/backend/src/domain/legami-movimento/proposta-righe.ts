import { quantitaDaMovimento } from '../listino/importi-riga'
import type { TipoQuantita } from '../listino/riga-addebito'
import { chiaveConfrontoCer } from '../waste-movement/cer-registro'
import { convertiInKg } from '../waste-movement/unita-misura-registro'

export interface RigaCandidata {
  id: string
  tipo: string
  cerCode: string | null
  riferimento: string | null
  addebitoCodice: string | null
  cerProposta: string[]
  addebitiProposti: string[]
  tipoQuantita: TipoQuantita | null
  unitaMisura: string
}

export interface EsitoRighe {
  principale: RigaCandidata | null
  motivo: 'SENZA_RIGA_CER' | 'RIGA_AMBIGUA' | null
  candidateCer: RigaCandidata[]
  proposte: RigaCandidata[]
}

export interface MovimentoPerQuantita {
  quantity: string
  unit: string
}

/** Stesso rifiuto: stesse cifre e stesso asterisco (20 01 21* non e 20 01 21). */
function stessoCer(a: string, b: string): boolean {
  return chiaveConfrontoCer(a) === chiaveConfrontoCer(b) && a.includes('*') === b.includes('*')
}

/**
 * Riga V proposta dal CER: ogni elemento di `cerProposta` e `CER`, `CER/` o `CER/*`
 * (riferimento vuoto o qualsiasi); `CER/<riferimento>` specifico non combacia.
 */
export function rigaVCombacia(riga: RigaCandidata, cerMovimento: string): boolean {
  if (riga.tipo !== 'V') return false
  return riga.cerProposta.some(el => {
    const barra = el.indexOf('/')
    const cer = barra < 0 ? el : el.slice(0, barra)
    const rif = barra < 0 ? '' : el.slice(barra + 1).trim()
    return (rif === '' || rif === '*') && stessoCer(cer, cerMovimento)
  })
}

/**
 * Riga CER principale (decisione 12): fra le righe CER del codice, il riferimento vuoto
 * vince su "?"; con piu righe nello stesso gruppo, o solo riferimenti specifici, e ambigua.
 * Le proposte sono le righe V indicate dal CER o dagli addebiti proposti dalla principale.
 */
export function scegliRighe(righe: readonly RigaCandidata[], cerMovimento: string): EsitoRighe {
  const candidateCer = righe.filter(
    r => r.tipo === 'CER' && r.cerCode !== null && stessoCer(r.cerCode, cerMovimento)
  )
  if (candidateCer.length === 0) {
    return {
      principale: null,
      motivo: 'SENZA_RIGA_CER',
      candidateCer,
      proposte: proposte(righe, cerMovimento, null),
    }
  }
  const vuote = candidateCer.filter(r => r.riferimento === null || r.riferimento.trim() === '')
  const qualsiasi = candidateCer.filter(r => r.riferimento?.trim() === '?')
  const gruppo = vuote.length > 0 ? vuote : qualsiasi
  const principale = gruppo.length === 1 ? gruppo[0] : null
  return {
    principale,
    motivo: principale ? null : 'RIGA_AMBIGUA',
    candidateCer,
    proposte: proposte(righe, cerMovimento, principale),
  }
}

function proposte(
  righe: readonly RigaCandidata[],
  cerMovimento: string,
  principale: RigaCandidata | null
): RigaCandidata[] {
  const codici = new Set(principale?.addebitiProposti ?? [])
  return righe.filter(
    r =>
      r.tipo === 'V' &&
      (rigaVCombacia(r, cerMovimento) ||
        (r.addebitoCodice !== null && codici.has(r.addebitoCodice)))
  )
}

/**
 * Quantita proposta per una riga dal movimento. Il peso e sempre netto in kg (`quantity` +
 * `unit` del registro); il lordo non e disponibile; il volume solo con unit `L`/`MC`.
 */
export function quantitaPerRiga(
  riga: Pick<RigaCandidata, 'tipoQuantita' | 'unitaMisura'>,
  m: MovimentoPerQuantita
): string | null {
  if (riga.tipoQuantita === null) return null
  const valore = m.quantity.trim()
  if (!/^\d+(\.\d+)?$/.test(valore)) return null
  switch (riga.tipoQuantita) {
    case 'PESO_NETTO': {
      const kg = convertiInKg(Number(valore), m.unit)
      return kg === null
        ? null
        : quantitaDaMovimento('PESO_NETTO', riga.unitaMisura, { netto: String(kg) })
    }
    case 'VOLUME': {
      const u = m.unit.trim().toUpperCase()
      if (u !== 'L' && u !== 'MC') return null
      return quantitaDaMovimento('VOLUME', riga.unitaMisura, {
        volume: valore,
        umVolume: u === 'L' ? 'L' : 'M',
      })
    }
    case 'UNO':
      return quantitaDaMovimento('UNO', riga.unitaMisura, {})
    case 'PESO_LORDO':
    case 'ALTRO':
      return null
  }
}
