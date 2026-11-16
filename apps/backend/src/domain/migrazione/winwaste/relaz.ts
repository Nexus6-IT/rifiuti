import { errore, Esito, ok } from './risultato'
import { decodificaNumeroIt } from './numero-it'

/**
 * `RELAZ`: relazione di uno scarico con i carichi che scarica
 * (`docs/giacenze.md` §2.2, `docs/movimenti.md` §2.5).
 *
 * Sequenza di segmenti di 34 caratteri:
 *   1      tipo: `C` carico dell'anno, `P` carico dell'anno precedente,
 *          `G` giacenza iniziale
 *   2-9    `COD` del carico (8 caratteri) oppure la riga di giacenza iniziale
 *          `G0`..`G5`. FORMA PRESUNTA: la documentazione dice sia "G0..G5" sia
 *          "0..5 seguito da spazi"; si accettano entrambe (da verificare sul
 *          `.bak`)
 *   10     classe `T`, `R`, `r`, `D`, `d`, `X` (minuscola = da nostre lavorazioni)
 *   11-22  kg scaricati (12 caratteri, virgola decimale)
 *   23-34  m³ scaricati (12 caratteri)
 */
export const LUNGHEZZA_SEGMENTO_RELAZ = 34

export type ClasseRelaz = 'T' | 'R' | 'r' | 'D' | 'd' | 'X'

export type SegmentoRelaz =
  | {
      readonly tipo: 'C' | 'P'
      readonly cod: number
      readonly classe: ClasseRelaz
      readonly kg: number
      readonly m3: number
    }
  | {
      readonly tipo: 'G'
      /** Riga di giacenza iniziale `G0`..`G5`. */
      readonly riga: 0 | 1 | 2 | 3 | 4 | 5
      readonly classe: ClasseRelaz
      readonly kg: number
      readonly m3: number
    }

export type CodiceRelaz =
  | 'RELAZ_LUNGHEZZA'
  | 'RELAZ_TIPO'
  | 'RELAZ_CODICE'
  | 'RELAZ_CLASSE'
  | 'RELAZ_QUANTITA'

const CLASSI = new Set(['T', 'R', 'r', 'D', 'd', 'X'])

export function decodificaRelaz(valore: string | null): Esito<SegmentoRelaz[], CodiceRelaz> {
  const testo = valore ?? ''
  if (testo === '') return ok([])
  if (testo.length % LUNGHEZZA_SEGMENTO_RELAZ !== 0) {
    return errore('RELAZ_LUNGHEZZA', 'RELAZ: lunghezza non multipla di 34 caratteri')
  }
  const segmenti: SegmentoRelaz[] = []
  for (let i = 0; i < testo.length; i += LUNGHEZZA_SEGMENTO_RELAZ) {
    const seg = testo.slice(i, i + LUNGHEZZA_SEGMENTO_RELAZ)
    const n = i / LUNGHEZZA_SEGMENTO_RELAZ + 1
    const tipo = seg[0]
    if (tipo !== 'C' && tipo !== 'P' && tipo !== 'G') {
      return errore('RELAZ_TIPO', `RELAZ segmento ${n}: tipo diverso da C, P, G`)
    }
    const classe = seg[9]
    if (!CLASSI.has(classe)) {
      return errore('RELAZ_CLASSE', `RELAZ segmento ${n}: classe diversa da T, R, r, D, d, X`)
    }
    const kg = decodificaNumeroIt(seg.slice(10, 22))
    const m3 = decodificaNumeroIt(seg.slice(22, 34))
    if (!kg.ok || kg.valore === null || !m3.ok || m3.valore === null) {
      return errore('RELAZ_QUANTITA', `RELAZ segmento ${n}: kg o m3 non validi`)
    }
    const codice = seg.slice(1, 9).trim()
    if (tipo === 'G') {
      const g = /^G?([0-5])$/.exec(codice)
      if (!g) return errore('RELAZ_CODICE', `RELAZ segmento ${n}: riga G fuori da G0..G5`)
      segmenti.push({
        tipo,
        riga: Number(g[1]) as 0 | 1 | 2 | 3 | 4 | 5,
        classe: classe as ClasseRelaz,
        kg: kg.valore,
        m3: m3.valore,
      })
    } else {
      if (!/^\d{1,8}$/.test(codice) || Number(codice) < 1) {
        return errore('RELAZ_CODICE', `RELAZ segmento ${n}: COD del carico non valido`)
      }
      segmenti.push({
        tipo,
        cod: Number(codice),
        classe: classe as ClasseRelaz,
        kg: kg.valore,
        m3: m3.valore,
      })
    }
  }
  return ok(segmenti)
}
