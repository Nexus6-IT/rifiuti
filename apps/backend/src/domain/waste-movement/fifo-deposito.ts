/**
 * FIFO puro del deposito temporaneo: dato l'insieme degli eventi di un registro
 * (aperture, carichi e scarichi vigenti di UN solo CER e UNA sola famiglia di unita),
 * calcola i lotti residui (quanto di ogni carico e ancora in deposito) e gli abbinamenti
 * (quale carico ha coperto quale scarico, e per quanto).
 *
 * Non persiste nulla e non conosce Prisma, Nest, unita o date di sistema: il chiamante
 * costruisce gli eventi (giorni italiani YYYY-MM-DD, quantita nella famiglia dell'insieme)
 * e chiama `calcolaFifo` una volta per famiglia (`famigliaFifo`), mai mescolando kg e m3.
 *
 * Ordine degli eventi (lo impone la funzione, ordinando una copia: il chiamante puo passare
 * gli eventi in qualunque ordine): vedi `confrontaEventiFifo`.
 *   1. giorno crescente;
 *   2. nello stesso giorno prima i carichi, poi gli scarichi;
 *   3. fra i carichi, le aperture prima dei movimenti;
 *   4. `ordine` crescente;
 *   5. `riferimento.id` in ordine lessicografico (l'ordine e totale e deterministico
 *      anche con dati duplicati).
 *
 * Perche i carichi precedono gli scarichi nello stesso giorno (M13, per 4.6): uno scarico
 * del giorno D puo prendere un carico dello stesso giorno (WinWaste filtra
 * `dtuk <= data dello scarico`, `giacenze.md` §3.1 punto 2). E una scelta di questa
 * funzione, non della norma: 4.6, che abbina davvero, la propone e l'utente puo correggerla
 * con l'override manuale; se 4.6 introduce l'ora del movimento, va aggiunta come criterio
 * fra (1) e (2). Le aperture si ordinano per data come gli altri carichi, non "sempre per
 * prime" come la G di WinWaste: in rifiuti l'apertura ha una data vera ("giorno dal quale
 * la quantita e in deposito").
 *
 * `ordine` (M3): `anno * 1e7 + progressivo` per i movimenti, 0 per le aperture (le ordina
 * gia il criterio 3). Il prefisso dell'anno serve perche il progressivo riparte ogni anno.
 * Il valore e confrontabile solo dentro lo stesso registro (la numerazione e per registro),
 * che e l'unico ambito in cui si chiama `calcolaFifo`.
 *
 * Debito: uno scarico oltre i lotti disponibili non e un errore ma un debito (`scoperto`),
 * tenuto come coda di (scarico, quantita mancante). Un carico successivo salda prima il
 * debito, dal piu vecchio, registrando l'abbinamento (scarico in debito, carico, quantita);
 * solo il resto forma un lotto. Un `scoperto` finale > 0 significa storico incoerente.
 *
 * Con `{ saldaDebiti: false }` (4.6, D5) il carico non entra nel ciclo dei debiti: lo
 * scarico resta in debito e `debiti` lo espone (anche col predefinito, dove e la stessa
 * quota di `scoperto`).
 *
 * Aritmetica: si lavora in millesimi interi (`Math.round(q * 1000)`) e si restituisce
 * `/1000`, cosi migliaia di eventi non accumulano deriva di virgola mobile.
 *
 * Riuso previsto da 4.6 (`roadmap-fasi3-4-import-gestori.md` §5, 4.6): l'abbinamento
 * scarico-carico dell'import dai gestori riusa questa funzione come proposta; per questo
 * gli `abbinamenti` sono calcolati qui anche se l'API di F2-6 non li espone.
 */
import { convertiInKg, normalizzaUnitaRegistro } from './unita-misura-registro'

export type OrigineEventoFifo = 'APERTURA' | 'MOVIMENTO'

// I `riferimento` negli esiti (lotti e abbinamenti) sono gli STESSI oggetti passati in
// ingresso, non copie: il chiamante non deve mutarli.
export interface RiferimentoFifo {
  /** id del movimento o della giacenza iniziale: ultimo criterio di spareggio */
  id: string
  /** "N/AAAA" per i movimenti */
  numero?: string
}

export interface EventoFifo {
  /** un'APERTURA e sempre CARICO */
  tipo: 'CARICO' | 'SCARICO'
  /** giorno italiano YYYY-MM-DD */
  giorno: string
  /** > 0, gia nella famiglia dell'insieme (kg per la massa) */
  quantita: number
  origine: OrigineEventoFifo
  /** anno * 1e7 + progressivo per i movimenti, 0 per le aperture */
  ordine: number
  riferimento: RiferimentoFifo
}

export interface LottoResiduo {
  giorno: string
  quantita: number
  residuo: number
  origine: OrigineEventoFifo
  riferimento: RiferimentoFifo
}

/** Una riga di abbinamento: quanto di un carico ha coperto uno scarico. */
export interface AbbinamentoFifo {
  scarico: RiferimentoFifo
  carico: RiferimentoFifo
  quantita: number
}

export interface EsitoFifo {
  /** solo residuo > 0, in ordine FIFO */
  lotti: LottoResiduo[]
  residuoTotale: number
  /** scarichi non coperti alla fine: > 0 solo se lo storico e incoerente */
  scoperto: number
  /** `lotti[0]?.giorno`, null senza lotti */
  giornoPiuVecchio: string | null
  /** prodotti durante il consumo, debito compreso; per 4.6, l'API di F2-6 non li espone */
  abbinamenti: AbbinamentoFifo[]
  /** scarichi (o parti di scarico) rimasti senza carico: somma = `scoperto` */
  debiti: DebitoFifo[]
}

/** Parte di uno scarico che nessun carico ha coperto. */
export interface DebitoFifo {
  scarico: RiferimentoFifo
  quantita: number
}

export interface OpzioniFifo {
  /**
   * Predefinito `true` (comportamento F2-6): un carico successivo salda i debiti. Con `false`
   * (abbinamento 4.6) un carico non copre mai uno scarico che lo precede: il debito resta
   * tale e compare in `debiti`.
   */
  saldaDebiti?: boolean
}

const GIORNO_ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Quantita in millesimi; <= 0 significa che calcolaFifo rifiuterebbe l'evento (es. 0,0004). */
export function millesimiFifo(q: number): number {
  return Math.round(q * 1000)
}

function rangoTipo(e: EventoFifo): number {
  return e.tipo === 'CARICO' ? 0 : 1
}
function rangoOrigine(e: EventoFifo): number {
  return e.origine === 'APERTURA' ? 0 : 1
}

/** Ordine totale degli eventi (vedi il commento di testa). */
export function confrontaEventiFifo(a: EventoFifo, b: EventoFifo): number {
  if (a.giorno !== b.giorno) return a.giorno < b.giorno ? -1 : 1
  if (rangoTipo(a) !== rangoTipo(b)) return rangoTipo(a) - rangoTipo(b)
  if (rangoOrigine(a) !== rangoOrigine(b)) return rangoOrigine(a) - rangoOrigine(b)
  if (a.ordine !== b.ordine) return a.ordine < b.ordine ? -1 : 1
  if (a.riferimento.id !== b.riferimento.id) return a.riferimento.id < b.riferimento.id ? -1 : 1
  return 0
}

function convalida(e: EventoFifo): number {
  if (!GIORNO_ISO.test(e.giorno)) {
    throw new Error(`FIFO: giorno non valido "${e.giorno}" (atteso YYYY-MM-DD)`)
  }
  if (!e.riferimento.id) throw new Error('FIFO: riferimento.id vuoto')
  if (e.tipo === 'SCARICO' && e.origine === 'APERTURA') {
    throw new Error('FIFO: uno SCARICO non puo avere origine APERTURA')
  }
  if (!Number.isFinite(e.ordine)) throw new Error(`FIFO: ordine non valido (${String(e.ordine)})`)
  const mill = millesimiFifo(e.quantita)
  if (!Number.isFinite(e.quantita) || !Number.isFinite(mill) || mill <= 0) {
    throw new Error(`FIFO: quantita non valida (${String(e.quantita)}), deve essere > 0`)
  }
  return mill
}

interface LottoInterno {
  evento: EventoFifo
  quantita: number // millesimi
  residuo: number // millesimi
}
interface DebitoInterno {
  scarico: RiferimentoFifo
  mancante: number // millesimi
}

export function calcolaFifo(eventi: readonly EventoFifo[], opzioni: OpzioniFifo = {}): EsitoFifo {
  const saldaDebiti = opzioni.saldaDebiti !== false
  const conMillesimi = eventi.map(evento => ({ evento, mill: convalida(evento) }))
  conMillesimi.sort((a, b) => confrontaEventiFifo(a.evento, b.evento))

  const lotti: LottoInterno[] = []
  const debiti: DebitoInterno[] = []
  const abbinamenti: AbbinamentoFifo[] = []

  for (const { evento, mill } of conMillesimi) {
    if (evento.tipo === 'CARICO') {
      let resto = mill
      // il carico salda prima i debiti, dal piu vecchio
      while (saldaDebiti && resto > 0 && debiti.length > 0) {
        const d = debiti[0]
        const preso = Math.min(resto, d.mancante)
        abbinamenti.push({ scarico: d.scarico, carico: evento.riferimento, quantita: preso / 1000 })
        d.mancante -= preso
        resto -= preso
        if (d.mancante === 0) debiti.shift()
      }
      if (resto > 0) lotti.push({ evento, quantita: mill, residuo: resto })
    } else {
      let resto = mill
      while (resto > 0 && lotti.length > 0) {
        const l = lotti[0]
        const preso = Math.min(resto, l.residuo)
        abbinamenti.push({
          scarico: evento.riferimento,
          carico: l.evento.riferimento,
          quantita: preso / 1000,
        })
        l.residuo -= preso
        resto -= preso
        if (l.residuo === 0) lotti.shift()
      }
      if (resto > 0) debiti.push({ scarico: evento.riferimento, mancante: resto })
    }
  }

  const risultato: LottoResiduo[] = lotti.map(l => ({
    giorno: l.evento.giorno,
    quantita: l.quantita / 1000,
    residuo: l.residuo / 1000,
    origine: l.evento.origine,
    riferimento: l.evento.riferimento,
  }))
  const residuoTotale = lotti.reduce((s, l) => s + l.residuo, 0)
  const scoperto = debiti.reduce((s, d) => s + d.mancante, 0)

  return {
    lotti: risultato,
    residuoTotale: residuoTotale / 1000,
    scoperto: scoperto / 1000,
    giornoPiuVecchio: risultato[0]?.giorno ?? null,
    abbinamenti,
    debiti: debiti.map(d => ({ scarico: d.scarico, quantita: d.mancante / 1000 })),
  }
}

/**
 * Insieme di appartenenza di un'unita: 'KG' per kg, t e unita vuota, altrimenti l'unita
 * normalizzata (es. 'M3'). Un `calcolaFifo` per famiglia, mai mescolate.
 */
export function famigliaFifo(unit: string | null | undefined): string {
  const u = normalizzaUnitaRegistro(unit)
  return u.massa ? 'KG' : u.unita
}

/** Quantita nella scala della famiglia: le tonnellate diventano kg, il resto resta. */
export function quantitaFifo(q: number, unit: string | null | undefined): number {
  return convertiInKg(q, unit) ?? q
}
