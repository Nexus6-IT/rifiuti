// Regole del prezzo speciale (fasce) e delle scadenze dei fissi, lato dialog della riga (4.2b,
// Task 28). Sono COPIE di quelle del dominio del backend (`domain/listino/prezzo-speciale.ts` e
// `scadenze-fisse.ts`, Task 16a e 18): non si importano fra app, vanno tenute allineate a mano (la
// spec ha gli stessi casi dei domini). Qui servono solo per il riscontro immediato; il backend
// resta l'arbitro e rivalida tutto (i suoi errori per campo compaiono sotto l'editor).
import { PeriodoScadenze, Scadenza, Scaglione, TipoCalcoloScaglione } from './listino.model'

// --- fasce ---------------------------------------------------------------------------------

export const MAX_FASCE = 7

const PREZZO_RE = /^\d{1,8}(\.\d{1,6})?$/
const SOGLIA_RE = /^\d{1,11}(\.\d{1,3})?$/
const TERMINE_CASCATA = /^\d{1,2}(\.\d{1,2})?$/

export const MSG_FASCE = {
  INCOMPLETA:
    'La tabella del prezzo speciale è incompleta: ogni fascia ha soglia, prezzo e tipo di calcolo.',
  CONSECUTIVE: 'Le fasce del prezzo speciale devono essere consecutive e con soglie crescenti.',
  ORDINE: 'Le fasce del prezzo speciale sono al massimo sette, ciascuna con il proprio numero.',
  PRIMA: 'La prima fascia del prezzo speciale deve avere una soglia maggiore di zero.',
  ULTIMA: 'L’ultima fascia del prezzo speciale è «oltre»: non ha soglia.',
} as const

export const msgDopoDW = (n: number): string =>
  `Fascia ${n}: dopo una fascia «tutta la quantità» (D/W) non può seguire una fascia a prezzo per quantità (A/X), altrimenti la stessa quantità si pagherebbe due volte.`

const vuoto = (v: string | null | undefined): boolean => v === null || v === undefined || v === ''

/** Cascata di percentuali (`10+5`): al massimo tre termini, ciascuno fino a 99,99. */
export function cascataValida(f: string | null): boolean {
  if (f === null) return true
  const termini = f.split('+')
  return termini.length <= 3 && termini.every(t => TERMINE_CASCATA.test(t))
}

function tipoAmmesso(ordine: number, tipo: string, conCondizioni: boolean): boolean {
  const ammessi =
    ordine === 7 ? `ABCDE${conCondizioni ? 'XYZWH' : ''}` : `ABCD${conCondizioni ? 'XYZW' : ''}`
  return tipo.length === 1 && ammessi.includes(tipo)
}

/** Tipi di calcolo che si possono scegliere per la fascia (la 7 ammette anche `E`/`H`). */
export function tipiAmmessi(ordine: number, conCondizioni: boolean): TipoCalcoloScaglione[] {
  const tutti: TipoCalcoloScaglione[] = ['A', 'B', 'C', 'D', 'E', 'X', 'Y', 'Z', 'W', 'H']
  return tutti.filter(t => tipoAmmesso(ordine, t, conCondizioni))
}

/** Regole della tabella (D12): stesse del backend, stessi messaggi (Q7 inclusa). */
export function validaFasce(s: readonly Scaglione[], conCondizioni: boolean): string[] {
  const messaggi: string[] = []
  const aggiungi = (m: string): void => {
    if (!messaggi.includes(m)) messaggi.push(m)
  }
  const perOrdine = new Map<number, Scaglione>()
  for (const f of s) {
    if (!Number.isInteger(f.ordine) || f.ordine < 1 || f.ordine > 7 || perOrdine.has(f.ordine)) {
      aggiungi(MSG_FASCE.ORDINE)
      continue
    }
    perOrdine.set(f.ordine, f)
  }
  const prima = perOrdine.get(1)
  const ultima = perOrdine.get(7)
  if (!prima || vuoto(prima.finoA) || prima.prezzo === '') aggiungi(MSG_FASCE.INCOMPLETA)
  else if (SOGLIA_RE.test(prima.finoA as string) && Number(prima.finoA) <= 0) {
    aggiungi(MSG_FASCE.PRIMA)
  }
  if (!ultima || ultima.prezzo === '') aggiungi(MSG_FASCE.INCOMPLETA)
  else if (!vuoto(ultima.finoA)) aggiungi(MSG_FASCE.ULTIMA)

  let buco = false
  let sogliaPrecedente: number | null = null
  for (let n = 1; n <= 6; n++) {
    const f = perOrdine.get(n)
    if (!f) {
      buco = true
      continue
    }
    if (buco) aggiungi(MSG_FASCE.CONSECUTIVE)
    if (n > 1 && (vuoto(f.finoA) || f.prezzo === '')) aggiungi(MSG_FASCE.INCOMPLETA)
    if (!vuoto(f.finoA) && SOGLIA_RE.test(f.finoA as string)) {
      const soglia = Number(f.finoA)
      if (sogliaPrecedente !== null && soglia <= sogliaPrecedente) aggiungi(MSG_FASCE.CONSECUTIVE)
      sogliaPrecedente = soglia
    }
  }

  let dopoDW = false
  for (const [n, f] of [...perOrdine.entries()].sort((a, b) => a[0] - b[0])) {
    if (dopoDW && (f.tipoCalcolo === 'A' || f.tipoCalcolo === 'X')) aggiungi(msgDopoDW(n))
    if (f.tipoCalcolo === 'D' || f.tipoCalcolo === 'W') dopoDW = true
    if (!vuoto(f.finoA) && n < 7 && !SOGLIA_RE.test(f.finoA as string)) {
      aggiungi(`Fascia ${n}: la soglia deve essere un numero positivo con al massimo tre decimali.`)
    }
    if (f.prezzo !== '' && !PREZZO_RE.test(f.prezzo)) {
      aggiungi(
        `Fascia ${n}: il prezzo deve essere un numero non negativo con al massimo sei decimali.`
      )
    }
    if (!tipoAmmesso(n, f.tipoCalcolo, conCondizioni)) {
      aggiungi(`Fascia ${n}: il tipo di calcolo non è ammesso.`)
    }
    if (!vuoto(f.sconto) && !cascataValida(f.sconto)) {
      aggiungi(
        `Fascia ${n}: lo sconto si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.`
      )
    }
    if (!vuoto(f.provvigione) && !cascataValida(f.provvigione)) {
      aggiungi(
        `Fascia ${n}: la provvigione si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.`
      )
    }
  }
  return messaggi
}

const numeroIt = (v: string | null | undefined): string => {
  if (vuoto(v)) return '…'
  const m = /^(\d+)(?:\.(\d+))?$/.exec((v as string).trim())
  if (!m) return v as string
  const dec = (m[2] ?? '').replace(/0+$/, '')
  return `${m[1].replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec ? ',' + dec : ''}`
}

/** Tipi di calcolo per cui vale la quantità precedente (progressivo da data, conguaglio). */
const TIPI_CON_QUANTITA_PRECEDENTE: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E'])

/**
 * Descrizione della fascia `indice` (porta di `vedilist1`, ADDEBCON.cs:8569-8688) con la
 * semantica di `applicaScaglioni` dopo il Task 16a (R50): `E`/`H` fatturano tutta la quantità al
 * prezzo dell'ultima fascia come `D`/`W` e nessuna quantità si fattura due volte. `fasce` è
 * ordinata per `ordine`; la soglia inferiore è quella della fascia precedente (per la 7, l'ultima
 * presente fra 1 e 6).
 */
export function descrizioneFascia(
  fasce: readonly Scaglione[],
  indice: number,
  unita: string,
  applicaA: string = ''
): string {
  const f = fasce[indice]
  const u = unita.trim() === '' ? '' : `${unita.trim()} `
  const sopra = fasce.slice(0, indice).filter(x => x.ordine < 7)
  const inf = sopra.length > 0 ? sopra[sopra.length - 1].finoA : '0'
  const campo =
    f.ordine === 1
      ? `fino a ${u}${numeroIt(f.finoA)}`
      : f.ordine === 7
        ? `oltre ${u}${numeroIt(inf)}`
        : `oltre ${u}${numeroIt(inf)} e fino a ${numeroIt(f.finoA)}`
  // H dice già «con condizione»: il suffisso serve solo a X, Y, Z, W.
  const cond = 'XYZW'.includes(f.tipoCalcolo) ? ' Se la condizione è verificata.' : ''
  // Con una quantità precedente (R30, Task 16a: progressivo da data e conguaglio) la quantità già
  // fatturata non si ripaga: D/E fatturano la sola quantità nuova, B/C il fisso solo la
  // prima volta che la fascia è raggiunta (Q8), A scala la precedente fascia per fascia.
  // La combinazione con la quantità precedente vale solo per A-E: per X/Y/Z/W/H non è ammessa e
  // la frase non va mostrata.
  const tipo = f.tipoCalcolo
  const daData =
    (applicaA === 'PROGRESSIVO_DA_DATA' || applicaA === 'CONGUAGLIO_365') &&
    TIPI_CON_QUANTITA_PRECEDENTE.has(tipo)
  const coda = (testo: string): string => (daData ? ` ${testo}` : '')
  switch (tipo) {
    case 'A':
    case 'X':
      return `${tipo} = Prezzo × quantità ${campo}.${cond}${coda('La quantità già fatturata dalla data si scala dalle fasce: si fattura solo la parte nuova.')}`
    case 'B':
    case 'Y':
      return `${tipo} = Importo fisso della fascia più alta raggiunta, ${campo}.${cond}${coda('Il fisso si fattura solo nella fattura in cui la fascia viene raggiunta per la prima volta.')}`
    case 'C':
    case 'Z':
      return `${tipo} = Importo fisso di ogni fascia raggiunta, ${campo}.${cond}${coda('Si fattura il fisso delle sole fasce raggiunte per la prima volta.')}`
    case 'D':
    case 'W':
      // Con la quantità precedente «tutta la quantità» sarebbe contraddittorio: si fattura la
      // sola quantità nuova, al prezzo della fascia raggiunta dal totale.
      return daData
        ? `${tipo} = Prezzo della fascia raggiunta dal totale × la sola quantità nuova (la precedente è già fatturata), ${campo}.${cond}`
        : `${tipo} = Prezzo della fascia raggiunta × tutta la quantità, ${campo}.${cond}`
    case 'E':
      return daData
        ? `E = la sola quantità nuova al prezzo dell'ultima fascia (come D), ${campo}. La precedente è già fatturata.`
        : `E = tutta la quantità al prezzo dell'ultima fascia (come D), ${campo}.`
    case 'H':
      return `H = come E, con condizione: tutta la quantità al prezzo dell'ultima fascia, ${campo}.`
  }
}

// --- scadenze ------------------------------------------------------------------------------

export const MAX_SCADENZE = 12
const ANNO_MIN = 1900
const ANNO_MAX = 2999

export type FrequenzaCalendario =
  | 'MENSILE'
  | 'BIMESTRALE'
  | 'TRIMESTRALE'
  | 'QUADRIMESTRALE'
  | 'SEMESTRALE'

export const FREQUENZE_CALENDARIO: readonly { value: FrequenzaCalendario; label: string }[] = [
  { value: 'MENSILE', label: 'Mensile' },
  { value: 'BIMESTRALE', label: 'Bimestrale' },
  { value: 'TRIMESTRALE', label: 'Trimestrale' },
  { value: 'QUADRIMESTRALE', label: 'Quadrimestrale' },
  { value: 'SEMESTRALE', label: 'Semestrale' },
]

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

export function giorniDelMese(mese: number, anno: number): number {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate()
}

/** `YYYY-MM-DD`; il 29/02 degli anni non bisestili scivola al 28/02. */
export function formatta(anno: number, mese: number, giorno: number): string {
  const g = Math.min(giorno, giorniDelMese(mese, anno))
  return `${String(anno).padStart(4, '0')}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`
}

/** `2026-01-31` come `31/01/2026`. */
export function dataItaliana(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** 29/02 ammesso senza anno (vale negli anni bisestili) e con un anno bisestile. */
function dataValida(giorno: number, mese: number, anno: number | null): boolean {
  if (!Number.isInteger(giorno) || !Number.isInteger(mese) || mese < 1 || mese > 12) return false
  if (anno !== null && (!Number.isInteger(anno) || anno < ANNO_MIN || anno > ANNO_MAX)) return false
  return giorno >= 1 && giorno <= giorniDelMese(mese, anno ?? 2024)
}

function isoValida(d: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return m ? dataValida(Number(m[3]), Number(m[2]), Number(m[1])) : false
}

const chiave = (s: Scadenza): number => (s.anno ?? 0) * 10000 + s.mese * 100 + s.giorno

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

/** Riga lasciata vuota in mezzo alle altre: nel modulo parte come 0/0 senza anno. */
const eRigaVuota = (x: Scadenza): boolean => x.giorno === 0 && x.mese === 0 && x.anno === null

/**
 * Copia di `validaScadenze` del dominio: stessi messaggi, "Scadenza n" per POSIZIONE (le
 * scadenze arrivano già in ordine).
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
    if (eRigaVuota(x)) errori.push(`Scadenza ${n}: è vuota, compilala o toglila.`)
    else if (!dataValida(x.giorno, x.mese, x.anno)) errori.push(`Scadenza ${n}: data non valida.`)
  })
  const valida = s.map(x => dataValida(x.giorno, x.mese, x.anno))
  for (let b = 1; b < s.length; b++) {
    if (!valida[b]) continue
    const uguale = s.findIndex((a, i) => i < b && valida[i] && stessaFatturazione(a, s[b]))
    if (uguale >= 0) {
      errori.push(`Scadenza ${b + 1}: data ripetuta (uguale alla scadenza ${uguale + 1}).`)
      continue
    }
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

/** Copia di `calendarioAutomatico` (`calcaut`, Task 18). */
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

/** Copia di `periodoCompetenza`: periodo cui si riferisce la scadenza nell'`anno`. */
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
