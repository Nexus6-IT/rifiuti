import { errore, Esito, ok } from './risultato'
import { decodificaNumeroIt } from './numero-it'

/**
 * `C4`: campo composito con sottocampi separati da `§` (`docs/formulari.md`
 * §2.2, `docs/rentri/03-aggancio-a-winwaste.md` §3.2). Gli indici sono quelli
 * del codice (`xc4[k]`, base 0: esiste `C4§0`).
 *
 * FORMA PRESUNTA: la mappa e' ricostruita dai soli consumatori, "servirebbe un
 * campione di dati per confermarla" (rentri/03 §7.6). Va riverificata sul `.bak`.
 *
 *  5      trasbordo: FIR d'origine, `\`, note
 *  14     se racchiuso fra `^` = identificativo esterno (deve essere unico)
 *  15-16  quantita' all'origine e unita' (`K`/`L`)
 *  22     peso di verifica
 *  23-26  respingimento: causale, altra causale, quantita', unita'
 *  27     solo detentore (`1`)
 *  28     trasporto estero (primo carattere)
 *  29     verificato in partenza (`1`)
 *  30     centro di raccolta (`1`/`0` destinatario, `S`/`N` produttore)
 */
export interface C4Decodificato {
  readonly trasbordo: { readonly firOrigine: string; readonly note: string } | null
  readonly idEsterno: string | null
  readonly quantitaOrigine: number | null
  readonly unitaOrigine: 'K' | 'L' | null
  readonly pesoVerifica: number | null
  readonly respingimento: {
    readonly causale: string
    readonly altraCausale: string
    readonly quantita: number | null
    readonly unita: 'K' | 'L' | null
  } | null
  readonly soloDetentore: boolean
  readonly trasportoEstero: string
  readonly verificatoInPartenza: boolean
  readonly centroRaccolta: string
}

export type CodiceC4 = 'C4_NUMERO' | 'C4_UNITA'

function pos(v: string[], i: number): string {
  return v[i] ?? ''
}

function unita(testo: string): 'K' | 'L' | null | undefined {
  const t = testo.trim().toUpperCase()
  if (t === '') return null
  if (t === 'K' || t === 'L') return t
  return undefined
}

export function decodificaC4(valore: string | null): Esito<C4Decodificato, CodiceC4> {
  const v = (valore ?? '').split('§')
  const numero = (i: number, nome: string): Esito<number | null, CodiceC4> => {
    const r = decodificaNumeroIt(pos(v, i))
    return r.ok ? r : errore('C4_NUMERO', `C4 posizione ${i} (${nome}): numero non valido`)
  }
  const quantitaOrigine = numero(15, 'quantita origine')
  if (!quantitaOrigine.ok) return quantitaOrigine
  const pesoVerifica = numero(22, 'peso di verifica')
  if (!pesoVerifica.ok) return pesoVerifica
  const quantitaRespinta = numero(25, 'quantita respinta')
  if (!quantitaRespinta.ok) return quantitaRespinta
  const unitaOrigine = unita(pos(v, 16))
  if (unitaOrigine === undefined) return errore('C4_UNITA', 'C4 posizione 16: unita attesa K o L')
  const unitaRespinta = unita(pos(v, 26))
  if (unitaRespinta === undefined) return errore('C4_UNITA', 'C4 posizione 26: unita attesa K o L')

  const trasb = pos(v, 5)
  let trasbordo: C4Decodificato['trasbordo'] = null
  if (trasb !== '') {
    const k = trasb.indexOf('\\')
    trasbordo =
      k < 0
        ? { firOrigine: trasb, note: '' }
        : { firOrigine: trasb.slice(0, k), note: trasb.slice(k + 1) }
  }
  const ext = /^\^(.+)\^$/.exec(pos(v, 14))
  const causale = pos(v, 23)
  const altra = pos(v, 24)
  const haRespingimento =
    causale !== '' || altra !== '' || quantitaRespinta.valore !== null || unitaRespinta !== null
  return ok({
    trasbordo,
    idEsterno: ext ? ext[1] : null,
    quantitaOrigine: quantitaOrigine.valore,
    unitaOrigine,
    pesoVerifica: pesoVerifica.valore,
    respingimento: haRespingimento
      ? { causale, altraCausale: altra, quantita: quantitaRespinta.valore, unita: unitaRespinta }
      : null,
    soloDetentore: pos(v, 27) === '1',
    trasportoEstero: pos(v, 28).slice(0, 1),
    verificatoInPartenza: pos(v, 29) === '1',
    centroRaccolta: pos(v, 30),
  })
}
