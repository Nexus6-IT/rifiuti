/**
 * Periodi di fatturazione del contratto cliente (D10, 4.1a): regole pure.
 *
 * Un periodo e' una coppia giorno/mese di inizio e di fine, ripetuta ogni anno (E6: es.
 * trimestrale = 01/01-31/03, 01/04-30/06, ...). Regole: al massimo 12 periodi, date valide in un
 * anno bisestile (29/02 ammesso), inizio non successivo alla fine nello stesso anno (i periodi
 * non attraversano l'anno), nessuna sovrapposizione.
 *
 * Semantica per 4.4 (E7, regola di `periodofisso` di WinWaste): nessun periodo = il contratto si
 * fattura a ogni elaborazione; con i periodi, `periodoDaFatturare` cerca la fine di periodo che
 * cade nell'intervallo richiesto e restituisce il periodo corrispondente (fine 28/02 diventa
 * 29/02 negli anni bisestili). Oggi nessuno la chiama fuori dai test: e' il contratto con 4.4,
 * scritta qui perche' il dato senza la sua regola tornerebbe un'etichetta. Vedi il piano
 * `docs/superpowers/plans` della fase 4.1.
 *
 * Le date sono stringhe `YYYY-MM-DD`, nessun fuso orario.
 */

export interface PeriodoFatturazione {
  giornoInizio: number
  meseInizio: number
  giornoFine: number
  meseFine: number
}

export type FrequenzaPredefinita =
  | 'MENSILE'
  | 'BIMESTRALE'
  | 'TRIMESTRALE'
  | 'QUADRIMESTRALE'
  | 'SEMESTRALE'
  | 'ANNUALE'

export type EsitoPeriodo =
  | { esito: 'NESSUN_PERIODO' }
  | { esito: 'NESSUNA_SCADENZA' }
  | { esito: 'PERIODO'; dal: string; al: string }
  | { esito: 'ERRORE'; messaggio: string }

const MESI_PER_FREQUENZA: Readonly<Record<FrequenzaPredefinita, number>> = {
  MENSILE: 1,
  BIMESTRALE: 2,
  TRIMESTRALE: 3,
  QUADRIMESTRALE: 4,
  SEMESTRALE: 6,
  ANNUALE: 12,
}

const MAX_PERIODI = 12

function bisestile(anno: number): boolean {
  return (anno % 4 === 0 && anno % 100 !== 0) || anno % 400 === 0
}

function giorniDelMese(mese: number, anno: number): number {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate()
}

/** Data valida in un anno bisestile (29/02 ammesso). */
function dataValida(giorno: number, mese: number): boolean {
  return (
    Number.isInteger(giorno) &&
    Number.isInteger(mese) &&
    mese >= 1 &&
    mese <= 12 &&
    giorno >= 1 &&
    giorno <= giorniDelMese(mese, 2024)
  )
}

const ordinale = (mese: number, giorno: number): number => mese * 100 + giorno
const inizioOrd = (p: PeriodoFatturazione): number => ordinale(p.meseInizio, p.giornoInizio)
const fineOrd = (p: PeriodoFatturazione): number => ordinale(p.meseFine, p.giornoFine)
/** Fine per il confronto fra periodi: 28/02 vale 29/02 (negli anni bisestili e' cosi', R26). */
const fineOrdBisestile = (p: PeriodoFatturazione): number =>
  p.meseFine === 2 && p.giornoFine === 28 ? ordinale(2, 29) : fineOrd(p)

function formatta(anno: number, mese: number, giorno: number): string {
  // il 29/02 negli anni non bisestili scivola al 28/02, il 28/02 non cambia mai verso il basso
  const g = Math.min(giorno, giorniDelMese(mese, anno))
  return `${String(anno).padStart(4, '0')}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`
}

/** Fine del periodo nell'anno: 28/02 diventa 29/02 se l'anno e' bisestile. */
function fineNellAnno(p: PeriodoFatturazione, anno: number): string {
  const giorno = p.meseFine === 2 && p.giornoFine === 28 && bisestile(anno) ? 29 : p.giornoFine
  return formatta(anno, p.meseFine, giorno)
}

function inizioNellAnno(p: PeriodoFatturazione, anno: number): string {
  return formatta(anno, p.meseInizio, p.giornoInizio)
}

export function periodiDaFrequenza(f: FrequenzaPredefinita): PeriodoFatturazione[] {
  const passo = MESI_PER_FREQUENZA[f]
  const periodi: PeriodoFatturazione[] = []
  for (let mese = 1; mese <= 12; mese += passo) {
    const meseFine = mese + passo - 1
    periodi.push({
      giornoInizio: 1,
      meseInizio: mese,
      giornoFine: giorniDelMese(meseFine, 2026),
      meseFine,
    })
  }
  return periodi
}

/** Copia ordinata per data di inizio. */
export function ordinaPeriodi(p: PeriodoFatturazione[]): PeriodoFatturazione[] {
  return [...p].sort((a, b) => inizioOrd(a) - inizioOrd(b) || fineOrd(a) - fineOrd(b))
}

export function validaPeriodi(p: PeriodoFatturazione[]): string[] {
  const errori: string[] = []
  if (p.length > MAX_PERIODI) errori.push('Al massimo 12 periodi di fatturazione.')

  const validi: number[] = []
  p.forEach((periodo, i) => {
    const n = i + 1
    if (
      !dataValida(periodo.giornoInizio, periodo.meseInizio) ||
      !dataValida(periodo.giornoFine, periodo.meseFine)
    ) {
      errori.push(`Periodo ${n}: data non valida.`)
    } else if (inizioOrd(periodo) > fineOrd(periodo)) {
      errori.push(
        `Periodo ${n}: l'inizio non può seguire la fine (i periodi non attraversano l'anno).`
      )
    } else {
      validi.push(i)
    }
  })

  for (let a = 0; a < validi.length; a++) {
    for (let b = a + 1; b < validi.length; b++) {
      const x = p[validi[a]]
      const y = p[validi[b]]
      if (inizioOrd(x) <= fineOrdBisestile(y) && inizioOrd(y) <= fineOrdBisestile(x)) {
        errori.push(`I periodi ${validi[a] + 1} e ${validi[b] + 1} si sovrappongono.`)
      }
    }
  }
  return errori
}

/** Periodo da fatturare per un intervallo richiesto (E7). `dal` e `al` sono `YYYY-MM-DD`. */
export function periodoDaFatturare(
  p: PeriodoFatturazione[],
  dal: string,
  al: string
): EsitoPeriodo {
  if (p.length === 0) return { esito: 'NESSUN_PERIODO' }
  if (dal > al) {
    return { esito: 'ERRORE', messaggio: "L'intervallo di fatturazione non è valido." }
  }
  const anno = Number(dal.slice(0, 4))
  if (Number(al.slice(0, 4)) !== anno) {
    return {
      esito: 'ERRORE',
      messaggio: "L'intervallo di fatturazione non può attraversare l'anno.",
    }
  }
  const terminano = p.filter(periodo => {
    const fine = fineNellAnno(periodo, anno)
    return fine >= dal && fine <= al
  })
  if (terminano.length === 0) return { esito: 'NESSUNA_SCADENZA' }
  if (terminano.length > 1) {
    return {
      esito: 'ERRORE',
      messaggio: "Nell'intervallo terminano più periodi del contratto: restringi le date.",
    }
  }
  return {
    esito: 'PERIODO',
    dal: inizioNellAnno(terminano[0], anno),
    al: fineNellAnno(terminano[0], anno),
  }
}

/** Prima fine di periodo non anteriore a `oggi` (anche nell'anno dopo); null senza periodi. */
export function prossimaFinePeriodo(p: PeriodoFatturazione[], oggi: string): string | null {
  if (p.length === 0) return null
  const anno = Number(oggi.slice(0, 4))
  const ordinati = [...p].sort((a, b) => fineOrd(a) - fineOrd(b))
  for (const periodo of ordinati) {
    const fine = fineNellAnno(periodo, anno)
    if (fine >= oggi) return fine
  }
  return fineNellAnno(ordinati[0], anno + 1)
}
