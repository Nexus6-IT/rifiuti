// Valutazione pura delle soglie del deposito temporaneo (art. 185-bis D.Lgs 152/2006).
// Dominio puro: niente Prisma, niente Nest, niente data di sistema (`oggi` e' un parametro).
//
// Fonti (testo citato dal piano `docs/superpowers/plans/2026-10-28-fase2-6-deposito.md`,
// sezione "Fonti"). Art. 185-bis, comma 2 lett. b): i rifiuti sono raccolti ed avviati a
// recupero o smaltimento "secondo una delle seguenti modalita' alternative, a scelta del
// produttore": "con cadenza almeno trimestrale, indipendentemente dalle quantita' in
// deposito"; "quando il quantitativo di rifiuti in deposito raggiunga complessivamente i 30
// metri cubi di cui al massimo 10 metri cubi di rifiuti pericolosi". "In ogni caso, allorche'
// il quantitativo di rifiuti non superi il predetto limite all'anno, il deposito temporaneo
// non puo' avere durata superiore ad un anno".
//
// Scelte del piano (N2-N6), riassunte:
//  - N2: il criterio (TEMPORALE / QUANTITATIVO) si sceglie per registro; finche' non e'
//    scelto (NON_SCELTO) si controllano entrambi.
//  - N3: "cadenza almeno trimestrale" = tre mesi di calendario dal giorno del lotto residuo
//    piu' vecchio di ogni CER; una soglia in giorni (`giorniMax`) puo' solo anticiparli.
//  - N4: il quantitativo e' la somma del registro (tutti i CER), con sottolimite per i
//    pericolosi; si avvisa al raggiungimento (`>=`), mentre la durata supera con `>`.
//  - N5: il limite e' volumetrico, qui e' in kg come conversione dichiarata dall'azienda.
//  - N6: col criterio QUANTITATIVO vale comunque il tetto di un anno (lettura prudente).
// Per i dubbi si rimanda al piano, decisioni D2-D7 e note N1-N7.

import { formattaQuantita } from '../../core/format/formatta-quantita'

export type CriterioDeposito = 'NON_SCELTO' | 'TEMPORALE' | 'QUANTITATIVO'

export interface SoglieDeposito {
  criterio: CriterioDeposito
  /** Soglia in giorni piu' severa dei tre mesi; null = nessuna soglia aggiuntiva. */
  giorniMax: number | null
  kgMaxTotale: number
  kgMaxPericolosi: number
  preavvisoGiorni: number
  preavvisoPercentuale: number
}

export const SOGLIE_PREDEFINITE: SoglieDeposito = {
  criterio: 'NON_SCELTO',
  giorniMax: null,
  kgMaxTotale: 30000,
  kgMaxPericolosi: 10000,
  preavvisoGiorni: 15,
  preavvisoPercentuale: 80,
}

/** I m3 servono solo ai messaggi (D5): i controlli lavorano in kg dichiarati dall'azienda. */
export const LIMITI_LEGGE = {
  giorniMaxConsentiti: 92,
  preavvisoGiorniMax: 88,
  m3Totale: 30,
  m3Pericolosi: 10,
} as const

export const FRASE_CRITERIO_NON_SCELTO = 'Criterio non ancora scelto: si controllano entrambi.'

const KG_MASSIMO = 10_000_000

function interoInRange(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max
}

function alPiuDueDecimali(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
}

/** Messaggi italiani; array vuoto = soglie valide. */
export function validaSoglie(s: SoglieDeposito): string[] {
  const errori: string[] = []
  if (s.giorniMax !== null && !interoInRange(s.giorniMax, 1, LIMITI_LEGGE.giorniMaxConsentiti)) {
    errori.push(
      `La soglia in giorni può solo anticipare i tre mesi di legge: al massimo ${LIMITI_LEGGE.giorniMaxConsentiti} giorni, numero intero (almeno 1).`
    )
  }
  if (!(s.kgMaxTotale > 0) || s.kgMaxTotale > KG_MASSIMO) {
    errori.push(
      `La soglia totale in kg deve essere maggiore di zero e al massimo ${formattaQuantita(KG_MASSIMO)}.`
    )
  } else if (!alPiuDueDecimali(s.kgMaxTotale)) {
    errori.push('La soglia totale in kg può avere al massimo 2 decimali.')
  }
  if (!(s.kgMaxPericolosi > 0)) {
    errori.push('La soglia dei pericolosi in kg deve essere maggiore di zero.')
  } else {
    if (s.kgMaxPericolosi > s.kgMaxTotale) {
      errori.push('La soglia dei pericolosi non può superare la soglia totale.')
    }
    if (!alPiuDueDecimali(s.kgMaxPericolosi)) {
      errori.push('La soglia dei pericolosi in kg può avere al massimo 2 decimali.')
    }
  }
  if (!interoInRange(s.preavvisoGiorni, 0, LIMITI_LEGGE.preavvisoGiorniMax)) {
    errori.push(
      `Il preavviso in giorni deve essere un numero intero da 0 a ${LIMITI_LEGGE.preavvisoGiorniMax} (meno della durata minima di tre mesi).`
    )
  } else if (
    s.giorniMax !== null &&
    interoInRange(s.giorniMax, 1, LIMITI_LEGGE.giorniMaxConsentiti) &&
    s.preavvisoGiorni >= s.giorniMax
  ) {
    errori.push('Il preavviso in giorni deve essere inferiore alla soglia in giorni.')
  }
  if (!interoInRange(s.preavvisoPercentuale, 0, 99)) {
    errori.push(
      'La percentuale di preavviso deve essere un numero intero da 0 a 99 (0 = nessun preavviso).'
    )
  }
  return errori
}

// ---------------------------------------------------------------------------------------
// Date di calendario: stringhe YYYY-MM-DD, aritmetica solo con Date.UTC (mai ms locali,
// quindi il cambio d'ora non sposta nulla).

const MS_GIORNO = 86_400_000

function parseGiorno(g: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(g)
  if (!match) throw new Error(`Giorno non valido: ${g}`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function formatGiorno(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function utc(g: string): number {
  const { y, m, d } = parseGiorno(g)
  return Date.UTC(y, m - 1, d)
}

export function giorniTra(daGiorno: string, aGiorno: string): number {
  return Math.round((utc(aGiorno) - utc(daGiorno)) / MS_GIORNO)
}

export function aggiungiGiorni(giorno: string, n: number): string {
  const dt = new Date(utc(giorno) + n * MS_GIORNO)
  return formatGiorno(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function aggiungiMesi(giorno: string, mesi: number): string {
  const { y, m, d } = parseGiorno(giorno)
  const indice = y * 12 + (m - 1) + mesi
  const yy = Math.floor(indice / 12)
  const mm = (indice % 12) + 1
  const ultimo = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  return formatGiorno(yy, mm, Math.min(d, ultimo))
}

/** Stesso giorno del terzo mese successivo; se non esiste, l'ultimo giorno di quel mese. */
export function treMesiDopo(giorno: string): string {
  return aggiungiMesi(giorno, 3)
}

/** Stesso giorno dell'anno dopo, con la regola di fine mese di `treMesiDopo` (29/02 -> 28/02). */
export function unAnnoDopo(giorno: string): string {
  return aggiungiMesi(giorno, 12)
}

/** Scadenza effettiva: la prima fra i tre mesi di calendario e la soglia in giorni, se c'e'. */
export function scadenzaTemporale(giorno: string, giorniMax: number | null): string {
  const treMesi = treMesiDopo(giorno)
  if (giorniMax === null) return treMesi
  const perGiorni = aggiungiGiorni(giorno, giorniMax)
  return treMesi < perGiorni ? treMesi : perGiorni
}

// ---------------------------------------------------------------------------------------
// Valutazione

export interface InputValutazione {
  cer: Array<{
    cerCode: string
    pericoloso: boolean
    residuoKg: number
    /** Giorno del lotto residuo piu' vecchio di QUALUNQUE famiglia di unita'; null se nessuno. */
    giornoPiuVecchio: string | null
  }>
}

export type TipoAvvisoDeposito =
  | 'DURATA'
  | 'DURATA_ANNUALE'
  | 'QUANTITA_TOTALE'
  | 'QUANTITA_PERICOLOSI'

export interface AvvisoDeposito {
  tipo: TipoAvvisoDeposito
  livello: 'PREAVVISO' | 'SUPERATO'
  /** null per i due avvisi quantitativi: sono del registro. */
  cerCode: string | null
  /** Giorni d'eta' o kg. */
  valore: number
  /** Giorni fino alla scadenza effettiva, o kg. */
  soglia: number
  unita: 'giorni' | 'kg'
  giornoPiuVecchio: string | null
  scadenza: string | null
  messaggio: string
}

const ORDINE_TIPO: Record<TipoAvvisoDeposito, number> = {
  DURATA: 0,
  DURATA_ANNUALE: 1,
  QUANTITA_TOTALE: 2,
  QUANTITA_PERICOLOSI: 3,
}

function dataIt(g: string): string {
  const { y, m, d } = parseGiorno(g)
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

function valutaScadenza(
  tipo: 'DURATA' | 'DURATA_ANNUALE',
  cer: InputValutazione['cer'][number],
  giorno: string,
  scadenza: string,
  motivo: string,
  soglie: SoglieDeposito,
  oggi: string
): AvvisoDeposito | null {
  const superato = oggi > scadenza
  const preavviso =
    !superato &&
    soglie.preavvisoGiorni > 0 &&
    oggi >= aggiungiGiorni(scadenza, -soglie.preavvisoGiorni)
  if (!superato && !preavviso) return null
  const eta = giorniTra(giorno, oggi)
  const verbo = superato ? 'andava avviato' : 'va avviato'
  const messaggio =
    `CER ${cer.cerCode}: il rifiuto più vecchio è in deposito dal ${dataIt(giorno)} ` +
    `(${eta} giorni); ${verbo} entro il ${dataIt(scadenza)} (${motivo}).`
  return {
    tipo,
    livello: superato ? 'SUPERATO' : 'PREAVVISO',
    cerCode: cer.cerCode,
    valore: eta,
    soglia: giorniTra(giorno, scadenza),
    unita: 'giorni',
    giornoPiuVecchio: giorno,
    scadenza,
    messaggio,
  }
}

function valutaQuantita(
  tipo: 'QUANTITA_TOTALE' | 'QUANTITA_PERICOLOSI',
  totaleKg: number,
  sogliaKg: number,
  soglie: SoglieDeposito
): AvvisoDeposito | null {
  // Millesimi interi: niente deriva da virgola mobile.
  const totaleM = Math.round(totaleKg * 1000)
  const sogliaM = Math.round(sogliaKg * 1000)
  const superato = totaleM >= sogliaM
  const preavviso =
    !superato &&
    soglie.preavvisoPercentuale > 0 &&
    totaleM * 100 >= sogliaM * soglie.preavvisoPercentuale
  if (!superato && !preavviso) return null
  const oggetto =
    tipo === 'QUANTITA_TOTALE' ? 'Rifiuti in deposito' : 'Rifiuti pericolosi in deposito'
  const limiteM3 = tipo === 'QUANTITA_TOTALE' ? LIMITI_LEGGE.m3Totale : LIMITI_LEGGE.m3Pericolosi
  const stato = superato ? 'ha raggiunto' : `è all'${soglie.preavvisoPercentuale}% di`
  const messaggio =
    `${oggetto}: ${formattaQuantita(totaleKg)} kg, ${stato} la soglia di ${formattaQuantita(sogliaKg)} kg. ` +
    `La soglia in kg è la conversione indicata dall'azienda del limite di ${limiteM3} m³ fissato dalla norma.`
  return {
    tipo,
    livello: superato ? 'SUPERATO' : 'PREAVVISO',
    cerCode: null,
    valore: totaleKg,
    soglia: sogliaKg,
    unita: 'kg',
    giornoPiuVecchio: null,
    scadenza: null,
    messaggio,
  }
}

export function valutaDeposito(
  input: InputValutazione,
  soglie: SoglieDeposito,
  oggi: string
): AvvisoDeposito[] {
  const avvisi: AvvisoDeposito[] = []
  const nonScelto = soglie.criterio === 'NON_SCELTO'
  const conDurata = nonScelto || soglie.criterio === 'TEMPORALE'
  const conQuantitativo = nonScelto || soglie.criterio === 'QUANTITATIVO'

  for (const cer of input.cer) {
    const giorno = cer.giornoPiuVecchio
    if (giorno === null) continue
    if (conDurata) {
      const scadenza = scadenzaTemporale(giorno, soglie.giorniMax)
      const daGiorni =
        soglie.giorniMax !== null && scadenza === aggiungiGiorni(giorno, soglie.giorniMax)
      const motivo = daGiorni ? `soglia dell'azienda di ${soglie.giorniMax} giorni` : 'tre mesi'
      const a = valutaScadenza('DURATA', cer, giorno, scadenza, motivo, soglie, oggi)
      if (a) avvisi.push(a)
    }
    if (conQuantitativo) {
      const a = valutaScadenza(
        'DURATA_ANNUALE',
        cer,
        giorno,
        unAnnoDopo(giorno),
        'un anno',
        soglie,
        oggi
      )
      if (a) avvisi.push(a)
    }
  }

  if (conQuantitativo) {
    const totale = input.cer.reduce((s, c) => s + c.residuoKg, 0)
    const pericolosi = input.cer.reduce((s, c) => s + (c.pericoloso ? c.residuoKg : 0), 0)
    const t = valutaQuantita('QUANTITA_TOTALE', totale, soglie.kgMaxTotale, soglie)
    if (t) avvisi.push(t)
    const p = valutaQuantita('QUANTITA_PERICOLOSI', pericolosi, soglie.kgMaxPericolosi, soglie)
    if (p) avvisi.push(p)
  }

  const finale = nonScelto
    ? avvisi.map(a => ({ ...a, messaggio: `${a.messaggio} ${FRASE_CRITERIO_NON_SCELTO}` }))
    : avvisi

  return finale.sort((a, b) => {
    if (a.livello !== b.livello) return a.livello === 'SUPERATO' ? -1 : 1
    if (a.tipo !== b.tipo) return ORDINE_TIPO[a.tipo] - ORDINE_TIPO[b.tipo]
    return (a.cerCode ?? '').localeCompare(b.cerCode ?? '')
  })
}
