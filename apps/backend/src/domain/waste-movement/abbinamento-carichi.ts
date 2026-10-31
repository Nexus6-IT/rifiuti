/**
 * Dominio puro dell'abbinamento carichi-scarichi (4.6, stoccaggio R13/D15).
 *
 * Non conosce Prisma ne Nest. Il FIFO e quello di `calcolaFifo` (F2-6), chiamato con
 * `saldaDebiti: false`: uno scarico non puo essere coperto da un carico successivo.
 * Le quantita si confrontano sempre in millesimi interi (`millesimiFifo`).
 */
import { formattaQuantita } from '../../core/format/formatta-quantita'
import { calcolaFifo, confrontaEventiFifo, millesimiFifo, type EventoFifo } from './fifo-deposito'

export type ClasseStoccaggio = 'R13' | 'D15'

/**
 * Codice operazione normalizzato: maiuscolo, senza punti ne spazi (ASCII e Unicode: NBSP, U+1680, U+2000-200A,
 * U+2028/9, U+202F, U+205F, U+3000) ne BOM (U+FEFF): e il vecchio `\s` di JS.
 * La stessa regola vive in SQL (`haStoccaggioOAbbinamenti`): tenerle allineate.
 */
export function normalizzaCodiceOperazione(operationCode: string | null | undefined): string {
  return (operationCode ?? '')
    .toUpperCase()
    .replace(/[ \t\n\v\f\r.\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g, '')
}

/** R13 / D15 dal solo codice operazione (tollera spazi, punti e minuscole); altro: null. */
export function classeStoccaggio(
  operationCode: string | null | undefined
): ClasseStoccaggio | null {
  const c = normalizzaCodiceOperazione(operationCode)
  return c === 'R13' || c === 'D15' ? c : null
}

/**
 * Classe di stoccaggio attesa per uno scarico: R* (recupero) -> R13, D* (smaltimento) -> D15,
 * dal codice operazione; se manca, dalla natura R/D della causale. Vince l'operationCode.
 */
export function classeAttesaScarico(
  operationCode: string | null | undefined,
  operazioneCausale: 'R' | 'D' | null
): ClasseStoccaggio | null {
  const c = normalizzaCodiceOperazione(operationCode)
  const m = /^([RD])\d/.exec(c)
  const lettera = m ? m[1] : operazioneCausale
  if (lettera === 'R') return 'R13'
  if (lettera === 'D') return 'D15'
  return null
}

export type OrigineRiga = 'AUTOMATICO' | 'MANUALE'
/** chiave: 'M:' + id radice del carico, oppure 'A:' + id della giacenza iniziale */
export type ChiaveCarico = string

export interface CaricoAbbinabile {
  chiave: ChiaveCarico
  /** tipo CARICO, quantita = quantita vigente */
  evento: EventoFifo
  /** null solo per le giacenze iniziali */
  classe: ClasseStoccaggio | null
  numero?: string
}

export interface ScaricoAbbinabile {
  radiceId: string
  /** tipo SCARICO, riferimento.id = radiceId */
  evento: EventoFifo
  classeAttesa: ClasseStoccaggio | null
  numero: string
}

export interface RigaAbbinamento {
  scaricoRadiceId: string
  carico: ChiaveCarico
  quantita: number
  origine: OrigineRiga
}

type RigaSenzaOrigine = Omit<RigaAbbinamento, 'origine'>

/** FIFO cronologico su una partizione: carichi con quantita = residuo, scarichi con quantita = da coprire. */
export function proponiAbbinamenti(input: {
  carichi: Array<{ chiave: ChiaveCarico; evento: EventoFifo; residuo: number }>
  scarichi: Array<{ radiceId: string; evento: EventoFifo; daCoprire: number }>
}): { righe: RigaSenzaOrigine[]; scoperti: Map<string, number> } {
  const chiavePerId = new Map<string, ChiaveCarico>()
  const eventi: EventoFifo[] = []
  for (const c of input.carichi) {
    if (millesimiFifo(c.residuo) <= 0) continue
    chiavePerId.set(c.evento.riferimento.id, c.chiave)
    eventi.push({ ...c.evento, tipo: 'CARICO', quantita: c.residuo })
  }
  for (const s of input.scarichi) {
    if (millesimiFifo(s.daCoprire) <= 0) continue
    eventi.push({
      ...s.evento,
      tipo: 'SCARICO',
      quantita: s.daCoprire,
      riferimento: { ...s.evento.riferimento, id: s.radiceId },
    })
  }
  const esito = calcolaFifo(eventi, { saldaDebiti: false })
  const righe = esito.abbinamenti.map(a => ({
    scaricoRadiceId: a.scarico.id,
    carico: chiavePerId.get(a.carico.id) as ChiaveCarico,
    quantita: a.quantita,
  }))
  const scoperti = new Map<string, number>()
  for (const d of esito.debiti) scoperti.set(d.scarico.id, d.quantita)
  return { righe, scoperti }
}

/** Residuo vigente di ogni carico dopo le righe date (tutti i carichi presenti nella mappa). */
export function residui(
  carichi: CaricoAbbinabile[],
  righe: RigaAbbinamento[]
): Map<ChiaveCarico, number> {
  const usato = new Map<ChiaveCarico, number>()
  for (const r of righe) usato.set(r.carico, (usato.get(r.carico) ?? 0) + millesimiFifo(r.quantita))
  const out = new Map<ChiaveCarico, number>()
  for (const c of carichi) {
    out.set(c.chiave, (millesimiFifo(c.evento.quantita) - (usato.get(c.chiave) ?? 0)) / 1000)
  }
  return out
}

export interface EsitoValidazioneRighe {
  errori: string[]
  avvisi: string[]
}

function dataItaliana(giorno: string): string {
  const [a, m, g] = giorno.split('-')
  return `${g}/${m}/${a}`
}

function etichettaCarico(c: CaricoAbbinabile): string {
  return c.chiave.startsWith('A:')
    ? `La giacenza iniziale del ${dataItaliana(c.evento.giorno)}`
    : c.numero
      ? `Il carico n. ${c.numero}`
      : `Il carico del ${dataItaliana(c.evento.giorno)}`
}

export function validaRigheManuali(input: {
  scarico: ScaricoAbbinabile
  righe: Array<{ carico: ChiaveCarico; quantita: number }>
  candidati: CaricoAbbinabile[]
  residuoEsclusoScarico: Map<ChiaveCarico, number>
}): EsitoValidazioneRighe {
  const errori: string[] = []
  const avvisi: string[] = []
  const perChiave = new Map(input.candidati.map(c => [c.chiave, c]))
  const viste = new Set<ChiaveCarico>()
  let totale = 0

  const aggiungi = (msg: string, lista: string[]): void => {
    if (!lista.includes(msg)) lista.push(msg)
  }

  for (const r of input.righe) {
    const mill = millesimiFifo(r.quantita)
    const quantitaValida =
      Number.isFinite(r.quantita) && mill > 0 && Math.abs(r.quantita * 1000 - mill) < 1e-6
    if (!quantitaValida) {
      aggiungi('La quantità deve essere maggiore di zero, con al massimo 3 decimali.', errori)
    } else {
      totale += mill
    }
    if (viste.has(r.carico)) aggiungi('Lo stesso carico è indicato due volte.', errori)
    viste.add(r.carico)

    const c = perChiave.get(r.carico)
    if (!c) {
      aggiungi('Il carico indicato non appartiene a questo rifiuto e registro.', errori)
      continue
    }
    if (confrontaEventiFifo(c.evento, input.scarico.evento) > 0) {
      aggiungi(
        `${etichettaCarico(c)} è ${c.chiave.startsWith('A:') ? 'successiva' : 'successivo'} allo scarico: si possono abbinare solo carichi con data uguale o precedente.`,
        errori
      )
    }
    if (quantitaValida) {
      const residuo = input.residuoEsclusoScarico.get(r.carico) ?? 0
      if (mill > millesimiFifo(residuo)) {
        aggiungi(
          `${etichettaCarico(c)} ha un residuo di ${formattaQuantita(residuo)}: non basta per ${formattaQuantita(r.quantita)}.`,
          errori
        )
      }
    }
    if (c.classe && input.scarico.classeAttesa && c.classe !== input.scarico.classeAttesa) {
      aggiungi(
        `${etichettaCarico(c)} è in stoccaggio ${c.classe}, lo scarico è un'operazione ${input.scarico.classeAttesa}.`,
        avvisi
      )
    }
  }

  const quantitaScarico = millesimiFifo(input.scarico.evento.quantita)
  if (totale > quantitaScarico) {
    errori.push(
      `Il totale abbinato (${formattaQuantita(totale / 1000)}) supera la quantità dello scarico (${formattaQuantita(quantitaScarico / 1000)}).`
    )
  } else if (totale === 0) {
    avvisi.push('Lo scarico resta senza abbinamento.')
  } else if (totale < quantitaScarico) {
    avvisi.push(
      `Abbinamento parziale: restano ${formattaQuantita((quantitaScarico - totale) / 1000)} da abbinare.`
    )
  }
  return { errori, avvisi }
}

export type StatoScarico = 'ABBINATO' | 'PARZIALE' | 'NON_ABBINATO' | 'INCOERENTE'
export type StatoCarico = 'APERTO' | 'ESAURITO' | 'INCOERENTE'

export function statoScarico(quantita: number, abbinato: number): StatoScarico {
  const q = millesimiFifo(quantita)
  const a = millesimiFifo(abbinato)
  if (a > q) return 'INCOERENTE'
  if (a === q) return 'ABBINATO'
  return a === 0 ? 'NON_ABBINATO' : 'PARZIALE'
}

export function statoCarico(quantita: number, abbinato: number): StatoCarico {
  const q = millesimiFifo(quantita)
  const a = millesimiFifo(abbinato)
  if (a > q) return 'INCOERENTE'
  return a === q ? 'ESAURITO' : 'APERTO'
}

export interface DifferenzaAbbinamento {
  scaricoRadiceId: string
  carico: ChiaveCarico
  quantitaA: number
  quantitaB: number
}

function sommaPerCoppia(
  righe: RigaSenzaOrigine[]
): Map<string, { s: string; c: string; m: number }> {
  const out = new Map<string, { s: string; c: string; m: number }>()
  for (const r of righe) {
    const k = JSON.stringify([r.scaricoRadiceId, r.carico])
    const e = out.get(k) ?? { s: r.scaricoRadiceId, c: r.carico, m: 0 }
    e.m += millesimiFifo(r.quantita)
    out.set(k, e)
  }
  return out
}

/** Confronto generico per (scarico, carico): riusabile in Fase 3 con RELAZ (D9). Ordinato per scarico e carico. */
export function confrontaAbbinamenti(
  a: RigaSenzaOrigine[],
  b: RigaSenzaOrigine[]
): DifferenzaAbbinamento[] {
  const ma = sommaPerCoppia(a)
  const mb = sommaPerCoppia(b)
  const chiavi = new Set([...ma.keys(), ...mb.keys()])
  const out: DifferenzaAbbinamento[] = []
  for (const k of chiavi) {
    const ea = ma.get(k)
    const eb = mb.get(k)
    const qa = ea?.m ?? 0
    const qb = eb?.m ?? 0
    if (qa === qb) continue
    const ref = (ea ?? eb) as { s: string; c: string }
    out.push({ scaricoRadiceId: ref.s, carico: ref.c, quantitaA: qa / 1000, quantitaB: qb / 1000 })
  }
  return out.sort((x, y) =>
    x.scaricoRadiceId !== y.scaricoRadiceId
      ? x.scaricoRadiceId < y.scaricoRadiceId
        ? -1
        : 1
      : x.carico < y.carico
        ? -1
        : x.carico > y.carico
          ? 1
          : 0
  )
}
