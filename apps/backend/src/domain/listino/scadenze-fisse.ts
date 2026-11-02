/**
 * Scadenze degli addebiti fissi (D14, E19): regole pure.
 *
 * Una riga di tipo `F` ha fino a 12 scadenze `giorno/mese/anno`; `anno` nullo = "ogni anno" (il
 * `??` di WinWaste). Il "periodo scadenze" dice a quale periodo si riferisce ogni scadenza
 * (`MP` 1 mese posticipato, `BA` 2 mesi anticipato, ... `DP` 24 mesi posticipato) oppure che si
 * tratta di una scadenza extra (`XA` aggiuntiva, `XD` detrazione, `YC` nota di credito) con un
 * periodo "dal ... al ..." scritto a parte.
 *
 * Fonti WinWaste (`ADDEBCON.cs`): `calcaut` (calendario automatico), `forma` (giorno che manca nel
 * mese = ultimo giorno del mese), `CalcolaPeriodoScadenza`, `ScadenzaDaFatturare`.
 * Differenza dichiarata: con l'anno esplicito `calendarioAutomatico` usa i giorni reali del mese
 * (29/02 negli anni bisestili); WinWaste usava sempre 28. Con anno vuoto resta 28, perche' la data
 * vale in ogni anno.
 *
 * Il servizio NON rifiuta scadenze fuori dal contratto (D14): `scadenzeNelPeriodo` le esclude al
 * momento di fatturare (4.4). Le date sono stringhe `YYYY-MM-DD`, nessun fuso orario. Le date del
 * calendario riusano gli helper di `periodi-fatturazione.ts` (29/02 che scivola al 28/02).
 */
import { formatta, giorniDelMese } from '../contratti-cliente/periodi-fatturazione'

export interface Scadenza {
  ordine: number
  giorno: number
  mese: number
  anno: number | null
}

export type PeriodoScadenze =
  | 'MP'
  | 'BA'
  | 'BP'
  | 'TA'
  | 'TP'
  | 'QA'
  | 'QP'
  | 'SA'
  | 'SP'
  | 'AA'
  | 'AP'
  | 'DA'
  | 'DP'
  | 'XA'
  | 'XD'
  | 'YC'

export type FrequenzaCalendario =
  | 'MENSILE'
  | 'BIMESTRALE'
  | 'TRIMESTRALE'
  | 'QUADRIMESTRALE'
  | 'SEMESTRALE'

const MAX_SCADENZE = 12
const ANNO_MIN = 1900
const ANNO_MAX = 2999

/** Mesi coperti da ogni periodo ordinario (`periodoscadenza` di WinWaste). */
const MESI_PERIODO: Readonly<Record<string, number>> = {
  M: 1,
  B: 2,
  T: 3,
  Q: 4,
  S: 6,
  A: 12,
  D: 24,
}

const PERIODI_EXTRA: readonly string[] = ['XA', 'XD', 'YC']

const PASSO_FREQUENZA: Readonly<Record<FrequenzaCalendario, number>> = {
  MENSILE: 1,
  BIMESTRALE: 2,
  TRIMESTRALE: 3,
  QUADRIMESTRALE: 4,
  SEMESTRALE: 6,
}

/** Messaggi di E19 riscritti: prima data ammessa con anno vuoto. */
const MESSAGGIO_ANNO_VUOTO: Readonly<Record<FrequenzaCalendario, string>> = {
  MENSILE: 'Con scadenze mensili e anno vuoto la prima data va in gennaio.',
  BIMESTRALE: 'Con scadenze bimestrali e anno vuoto la prima data va in gennaio o febbraio.',
  TRIMESTRALE:
    'Con scadenze trimestrali e anno vuoto la prima data va tra il 1° gennaio e il 31 marzo.',
  QUADRIMESTRALE:
    'Con scadenze quadrimestrali e anno vuoto la prima data va tra il 1° gennaio e il 30 aprile.',
  SEMESTRALE:
    'Con scadenze semestrali e anno vuoto la prima data va tra il 1° gennaio e il 30 giugno.',
}

const MESSAGGIO_EXTRA = 'Per una scadenza extra indica il periodo dal … al ….'

/** 29/02 ammesso senza anno (vale negli anni bisestili) e con un anno bisestile. */
function dataValida(giorno: number, mese: number, anno: number | null): boolean {
  if (!Number.isInteger(giorno) || !Number.isInteger(mese) || mese < 1 || mese > 12) return false
  if (anno !== null && (!Number.isInteger(anno) || anno < ANNO_MIN || anno > ANNO_MAX)) return false
  return giorno >= 1 && giorno <= giorniDelMese(mese, anno ?? 2024)
}

function isoValida(d: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return false
  return dataValida(Number(m[3]), Number(m[2]), Number(m[1]))
}

/** Chiave di confronto fra due scadenze con lo stesso tipo di anno (entrambe con o senza). */
const chiave = (s: Scadenza): number => (s.anno ?? 0) * 10000 + s.mese * 100 + s.giorno

/**
 * Due scadenze (valide) che fatturerebbero lo stesso giorno: stessa data, con anno vuoto o
 * uguale; oppure il 29/02 senza anno e un 28/02 senza anno o in un anno non bisestile (il 29/02
 * scivola al 28/02, vedi `scadenzeNelPeriodo`).
 */
function stessaFatturazione(a: Scadenza, b: Scadenza): boolean {
  if (a.giorno === b.giorno && a.mese === b.mese) {
    return a.anno === b.anno || a.anno === null || b.anno === null
  }
  const [x, y] = a.giorno === 29 ? [a, b] : [b, a]
  return (
    x.mese === 2 &&
    x.giorno === 29 &&
    x.anno === null &&
    y.mese === 2 &&
    y.giorno === 28 &&
    (y.anno === null || giorniDelMese(2, y.anno) === 28)
  )
}

/**
 * Valida le scadenze di una riga. I messaggi "Scadenza n" e il controllo d'ordine usano la
 * POSIZIONE nell'array (n = indice + 1), non `ordine`: il chiamante passa le scadenze gia'
 * ordinate per `ordine`.
 */
export function validaScadenze(
  s: readonly Scadenza[],
  periodo: PeriodoScadenze | null,
  extra: { dal: string | null; al: string | null }
): string[] {
  const errori: string[] = []
  if (s.length > MAX_SCADENZE) errori.push('Al massimo 12 scadenze.')

  const ordiniVisti = new Set<number>()
  s.forEach((x, i) => {
    const n = i + 1
    if (!Number.isInteger(x.ordine) || x.ordine < 1 || x.ordine > MAX_SCADENZE) {
      errori.push(`Scadenza ${n}: il numero d'ordine deve essere da 1 a 12.`)
    } else if (ordiniVisti.has(x.ordine)) {
      errori.push(`Scadenza ${n}: il numero d'ordine ${x.ordine} è ripetuto.`)
    } else {
      ordiniVisti.add(x.ordine)
    }
    if (!dataValida(x.giorno, x.mese, x.anno)) errori.push(`Scadenza ${n}: data non valida.`)
  })

  const valida = s.map(x => dataValida(x.giorno, x.mese, x.anno))
  for (let b = 1; b < s.length; b++) {
    if (!valida[b]) continue
    const uguale = s.findIndex((a, i) => i < b && valida[i] && stessaFatturazione(a, s[b]))
    if (uguale >= 0) {
      errori.push(`Scadenza ${b + 1}: data ripetuta (uguale alla scadenza ${uguale + 1}).`)
      continue
    }
    // ordine: si confronta con l'ultima scadenza valida dello STESSO tipo di anno (vuoto/esplicito)
    let precedente = -1
    for (let i = b - 1; i >= 0; i--) {
      if (valida[i] && (s[i].anno === null) === (s[b].anno === null)) {
        precedente = i
        break
      }
    }
    if (precedente >= 0 && chiave(s[b]) < chiave(s[precedente])) {
      errori.push(`Scadenza ${b + 1}: le scadenze vanno in ordine di data.`)
    }
  }

  const extraInviato = extra.dal !== null || extra.al !== null
  if (periodo !== null && PERIODI_EXTRA.includes(periodo)) {
    if (extra.dal === null || extra.al === null) {
      errori.push(MESSAGGIO_EXTRA)
    } else if (!isoValida(extra.dal) || !isoValida(extra.al)) {
      errori.push('Il periodo extra non è valido: le date non sono corrette.')
    } else if (extra.dal > extra.al) {
      errori.push("Il periodo extra non è valido: l'inizio non può seguire la fine.")
    }
  } else if (extraInviato) {
    errori.push('Il periodo extra si indica solo per una scadenza extra.')
  }
  return errori
}

/**
 * Calendario dalla prima data (`calcaut`). Con anno vuoto la prima data deve cadere nel primo
 * periodo dell'anno; con anno esplicito le date oltre dicembre passano all'anno dopo.
 */
export function calendarioAutomatico(
  prima: Omit<Scadenza, 'ordine'>,
  frequenza: FrequenzaCalendario
): { scadenze: Scadenza[] } | { errore: string } {
  if (!dataValida(prima.giorno, prima.mese, prima.anno)) {
    return { errore: 'La prima scadenza non è una data valida.' }
  }
  const passo = PASSO_FREQUENZA[frequenza]
  if (prima.anno === null && prima.mese > passo) {
    return { errore: MESSAGGIO_ANNO_VUOTO[frequenza] }
  }
  const scadenze: Scadenza[] = []
  for (let k = 0; k < 12 / passo; k++) {
    const mesi = prima.mese - 1 + k * passo
    const mese = (mesi % 12) + 1
    const anno = prima.anno === null ? null : prima.anno + Math.floor(mesi / 12)
    // giorno che manca nel mese = fine mese (`forma`); senza anno il 29/02 e' il 28
    const massimo = giorniDelMese(mese, anno ?? 2023)
    scadenze.push({
      ordine: k + 1,
      giorno: k === 0 ? prima.giorno : Math.min(prima.giorno, massimo),
      mese,
      anno,
    })
  }
  return { scadenze }
}

/**
 * Periodo a cui si riferisce la scadenza nell'`anno` di fatturazione (`CalcolaPeriodoScadenza`):
 * anticipato = dal 1 del mese della scadenza per N mesi, posticipato = N mesi che finiscono a
 * fine del mese della scadenza. `null` per i periodi extra (li da' il periodo extra della riga) e
 * quando la scadenza ha un anno diverso da `anno` ("Non fatturabile quest'anno").
 */
export function periodoCompetenza(
  s: Scadenza,
  periodo: PeriodoScadenze,
  anno: number
): { dal: string; al: string } | null {
  if (PERIODI_EXTRA.includes(periodo)) return null
  if (s.anno !== null && s.anno !== anno) return null
  const n = MESI_PERIODO[periodo[0]]
  const direzione = periodo[1]
  if (n === undefined || (direzione !== 'A' && direzione !== 'P')) return null

  // indice assoluto del mese (anno * 12 + mese - 1): evita i riporti a mano
  const base = anno * 12 + (s.mese - 1)
  const primo = direzione === 'A' ? base : base - (n - 1)
  const ultimo = direzione === 'A' ? base + (n - 1) : base
  const annoFine = Math.floor(ultimo / 12)
  const meseFine = (ultimo % 12) + 1
  return {
    dal: formatta(Math.floor(primo / 12), (primo % 12) + 1, 1),
    al: formatta(annoFine, meseFine, giorniDelMese(meseFine, annoFine)),
  }
}

/**
 * Le scadenze che cadono in `[dal, al]` e dentro le date del contratto, con la data effettiva
 * (`ScadenzaDaFatturare`). L'anno vuoto vale per ogni anno dell'intervallo; il 29/02 negli anni
 * non bisestili scivola al 28/02. Ordinate per data, poi per `ordine`.
 */
export function scadenzeNelPeriodo(
  s: readonly Scadenza[],
  dal: string,
  al: string,
  contratto: { dataInizio: string; dataFine: string | null }
): { scadenza: Scadenza; data: string }[] {
  if (dal > al) return []
  const dalAnno = Number(dal.slice(0, 4))
  const alAnno = Number(al.slice(0, 4))
  const trovate: { scadenza: Scadenza; data: string }[] = []
  for (const scadenza of s) {
    const anni = scadenza.anno === null ? range(dalAnno, alAnno) : [scadenza.anno]
    for (const anno of anni) {
      if (!dataValida(scadenza.giorno, scadenza.mese, scadenza.anno === null ? null : anno)) {
        continue
      }
      const giorno = Math.min(scadenza.giorno, giorniDelMese(scadenza.mese, anno))
      const data = formatta(anno, scadenza.mese, giorno)
      if (data < dal || data > al) continue
      if (data < contratto.dataInizio) continue
      if (contratto.dataFine !== null && data > contratto.dataFine) continue
      trovate.push({ scadenza, data })
    }
  }
  return trovate.sort(
    (a, b) => a.data.localeCompare(b.data) || a.scadenza.ordine - b.scadenza.ordine
  )
}

function range(da: number, a: number): number[] {
  const r: number[] = []
  for (let x = da; x <= a; x++) r.push(x)
  return r
}
