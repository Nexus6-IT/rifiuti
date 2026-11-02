import { Prisma } from '@prisma/client'
import { arrotonda, cascataValida, prezzoCalcolato } from './importi-riga'

/**
 * Prezzo speciale a scaglioni di una riga di addebito (4.2a, D12, E12-E14): regole di validita'
 * della tabella e porta di `speciale` (FATAUTOMATICA). Funzioni pure, importi come stringhe
 * decimali con aritmetica esatta (`Prisma.Decimal`).
 *
 * Non si porta `specialegamma` (`K/M`, `K/L`, prezzo per densita'): la riga con quelle unita'
 * si valida ma non si calcola qui.
 */

export type TipoCalcoloScaglione = 'A' | 'B' | 'C' | 'D' | 'E' | 'X' | 'Y' | 'Z' | 'W' | 'H'

export interface Scaglione {
  /** 1-7: la 7 e' "oltre", senza soglia. */
  ordine: number
  finoA: string | null
  prezzo: string
  sconto: string | null
  provvigione: string | null
  tipoCalcolo: TipoCalcoloScaglione
}

export type ApplicaPrezzoSpeciale =
  | 'DOCUMENTO'
  | 'PERIODO'
  | 'PROGRESSIVO_DA_DATA'
  | 'CONGUAGLIO_365'
  | 'GIORNO'

export interface RigaScaglione {
  descrizione: string
  quantita: string
  prezzo: string
  sconto: string | null
  provvigione: string | null
}

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v)

const MSG_INCOMPLETA =
  'La tabella del prezzo speciale è incompleta: ogni fascia ha soglia, prezzo e tipo di calcolo.'
const MSG_CONSECUTIVE =
  'Le fasce del prezzo speciale devono essere consecutive e con soglie crescenti.'
const MSG_ORDINE =
  'Le fasce del prezzo speciale sono al massimo sette, ciascuna con il proprio numero.'
const MSG_PRIMA = 'La prima fascia del prezzo speciale deve avere una soglia maggiore di zero.'
const MSG_ULTIMA = 'L’ultima fascia del prezzo speciale è «oltre»: non ha soglia.'
const msgDopoDW = (n: number): string =>
  `Fascia ${n}: dopo una fascia «tutta la quantità» (D/W) non può seguire una fascia a prezzo per quantità (A/X), altrimenti la stessa quantità si pagherebbe due volte.`
const MSG_ERRORE_CALCOLO = 'Errore nel calcolo del prezzo speciale.'

const TIPI_BASE = 'ABCD'
const TIPI_CONDIZIONE = 'XYZW'
const PREZZO_RE = /^\d{1,8}(\.\d{1,6})?$/
const SOGLIA_RE = /^\d{1,11}(\.\d{1,3})?$/

function tipoAmmesso(ordine: number, tipo: string, conCondizioni: boolean): boolean {
  const ammessi =
    ordine === 7
      ? `ABCDE${conCondizioni ? 'XYZWH' : ''}`
      : `${TIPI_BASE}${conCondizioni ? TIPI_CONDIZIONE : ''}`
  return tipo.length === 1 && ammessi.includes(tipo)
}

/**
 * Regole della tabella (D12): righe 1 e 7 obbligatorie, 2-6 consecutive con soglie strettamente
 * crescenti, tipi di calcolo ammessi per posizione, formati. Restituisce tutti i messaggi.
 */
export function validaScaglioni(
  s: readonly Scaglione[],
  contesto: { conCondizioni: boolean }
): string[] {
  const messaggi: string[] = []
  const aggiungi = (m: string): void => {
    if (!messaggi.includes(m)) messaggi.push(m)
  }

  const perOrdine = new Map<number, Scaglione>()
  for (const f of s) {
    if (!Number.isInteger(f.ordine) || f.ordine < 1 || f.ordine > 7 || perOrdine.has(f.ordine)) {
      aggiungi(MSG_ORDINE)
      continue
    }
    perOrdine.set(f.ordine, f)
  }

  const prima = perOrdine.get(1)
  const ultima = perOrdine.get(7)
  if (!prima || prima.finoA === null || prima.finoA === '' || prima.prezzo === '')
    aggiungi(MSG_INCOMPLETA)
  else if (SOGLIA_RE.test(prima.finoA) && D(prima.finoA).lte(0)) aggiungi(MSG_PRIMA)
  if (!ultima || ultima.prezzo === '') aggiungi(MSG_INCOMPLETA)
  else if (ultima.finoA !== null && ultima.finoA !== '') aggiungi(MSG_ULTIMA)

  // Righe 2-6: una presente dopo una mancante e' un buco; incomplete senza soglia o prezzo.
  let buco = false
  let sogliaPrecedente: Prisma.Decimal | null = null
  for (let n = 1; n <= 6; n++) {
    const f = perOrdine.get(n)
    if (!f) {
      buco = true
      continue
    }
    if (buco) aggiungi(MSG_CONSECUTIVE)
    if (n > 1 && (f.finoA === null || f.finoA === '' || f.prezzo === '')) aggiungi(MSG_INCOMPLETA)
    if (f.finoA !== null && f.finoA !== '' && SOGLIA_RE.test(f.finoA)) {
      const soglia = D(f.finoA)
      if (sogliaPrecedente !== null && soglia.lte(sogliaPrecedente)) aggiungi(MSG_CONSECUTIVE)
      sogliaPrecedente = soglia
    }
  }

  // Q7 (02/11): dopo una fascia D/W che fattura tutta la quantita', una fascia A/X la
  // fatturerebbe di nuovo in parte.
  let dopoDW = false
  for (const [n, f] of [...perOrdine.entries()].sort((a, b) => a[0] - b[0])) {
    if (dopoDW && 'AX'.includes(f.tipoCalcolo) && f.tipoCalcolo.length === 1) aggiungi(msgDopoDW(n))
    if (f.tipoCalcolo === 'D' || f.tipoCalcolo === 'W') dopoDW = true
    if (f.finoA !== null && f.finoA !== '' && n < 7 && !SOGLIA_RE.test(f.finoA)) {
      aggiungi(`Fascia ${n}: la soglia deve essere un numero positivo con al massimo tre decimali.`)
    }
    if (f.prezzo !== '' && !PREZZO_RE.test(f.prezzo)) {
      aggiungi(
        `Fascia ${n}: il prezzo deve essere un numero non negativo con al massimo sei decimali.`
      )
    }
    if (!tipoAmmesso(n, f.tipoCalcolo, contesto.conCondizioni)) {
      aggiungi(`Fascia ${n}: il tipo di calcolo non è ammesso.`)
    }
    if (f.sconto !== null && f.sconto !== '' && !cascataValida(f.sconto)) {
      aggiungi(
        `Fascia ${n}: lo sconto si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.`
      )
    }
    if (f.provvigione !== null && f.provvigione !== '' && !cascataValida(f.provvigione)) {
      aggiungi(
        `Fascia ${n}: la provvigione si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.`
      )
    }
  }
  return messaggi
}

const GIORNI_PER_MESE = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/**
 * Regole della riga con il prezzo speciale (D12). Si chiama solo per le righe a prezzo speciale;
 * include le regole della tabella.
 */
export function validaPrezzoSpeciale(
  r: {
    applicaA: ApplicaPrezzoSpeciale | null
    condizioniRiferite: string | null
    unitaMisura: string
    riferimentoGiorno: number | null
    riferimentoMese: number | null
    condizione: number | null
    sconto: string | null
    provvigione: string | null
    minimoFatturabile: string | null
    tipoProvvigione: string | null
  },
  scaglioni: readonly Scaglione[]
): string[] {
  const messaggi: string[] = []
  const vuoto = (v: string | null): boolean => v === null || v === ''

  if (r.applicaA === null) messaggi.push('Indica a cosa si applica il prezzo speciale.')
  if (r.condizione !== null)
    messaggi.push('Il prezzo speciale non si usa negli addebiti condizionati.')
  if (r.unitaMisura === 'HR')
    messaggi.push('Il prezzo speciale non si usa con l’unità di misura HR.')
  if (!vuoto(r.sconto) || !vuoto(r.provvigione)) {
    messaggi.push('Con il prezzo speciale lo sconto e la provvigione si indicano nelle fasce.')
  }
  if (!vuoto(r.minimoFatturabile)) {
    messaggi.push('Con il prezzo speciale non si indica il minimo fatturabile.')
  }
  if (
    (r.unitaMisura === 'K/M' || r.unitaMisura === 'K/L') &&
    r.applicaA !== null &&
    r.applicaA !== 'DOCUMENTO'
  ) {
    messaggi.push('Con l’unità K/M o K/L il prezzo speciale si applica al documento.')
  }

  const conCondizioni = !vuoto(r.condizioniRiferite)
  if (conCondizioni) {
    const c = r.condizioniRiferite as string
    const cifre = c.slice(0, -1)
    if (!/^[1-9]{1,9}[CP]$/.test(c) || new Set(cifre).size !== cifre.length) {
      messaggi.push(
        'Le condizioni si scrivono come cifre da 1 a 9 tutte diverse seguite da C o P (es. 12C).'
      )
    }
    if (r.applicaA !== null && r.applicaA !== 'DOCUMENTO' && r.applicaA !== 'PERIODO') {
      messaggi.push('Con le condizioni il prezzo speciale si applica al documento o al periodo.')
    }
  }

  const conData = r.riferimentoGiorno !== null || r.riferimentoMese !== null
  const richiedeData = r.applicaA === 'PROGRESSIVO_DA_DATA' || r.applicaA === 'CONGUAGLIO_365'
  if (r.applicaA === 'CONGUAGLIO_365' && !conData) {
    messaggi.push('Per il conguaglio indica la data (giorno e mese).')
  } else if (conData && r.applicaA !== null && !richiedeData) {
    messaggi.push(
      'La data di riferimento vale solo per il progressivo da data e per il conguaglio.'
    )
  } else if (conData) {
    if (r.riferimentoGiorno === null || r.riferimentoMese === null) {
      messaggi.push('Il riferimento si indica con giorno e mese insieme.')
    } else if (
      !Number.isInteger(r.riferimentoMese) ||
      r.riferimentoMese < 1 ||
      r.riferimentoMese > 12 ||
      !Number.isInteger(r.riferimentoGiorno) ||
      r.riferimentoGiorno < 1 ||
      r.riferimentoGiorno > GIORNI_PER_MESE[r.riferimentoMese - 1]
    ) {
      messaggi.push('Il riferimento non è una data valida.')
    }
  }

  messaggi.push(...validaScaglioni(scaglioni, { conCondizioni }))
  if (scaglioni.some(f => !vuoto(f.provvigione)) && vuoto(r.tipoProvvigione)) {
    messaggi.push('Indica su cosa si calcola la provvigione.')
  }
  return messaggi
}

/** Quantita' in forma normale: tre decimali al piu' (Decimal(14,3)), senza zeri finali. */
const quantitaTesto = (v: Prisma.Decimal): string => D(arrotonda(v.toFixed(), 3)).toFixed()

/**
 * Porta di `speciale` (E14): prezza la quantita' sulla tabella e restituisce le righe di
 * fattura. `quantita` e' quella del documento o del periodo; con `quantitaPrecedente` (prezzo
 * "da data": quantita' gia' passata in precedenti fatture) si valuta la tabella sul totale e si
 * fatturano solo gli incrementi, scalando la precedente fascia per fascia. Con `condizione` la
 * quantita' di riferimento e' `quantita` (`P`) o `quantitaCondizionati` (`C`), e sono ammesse le
 * varianti X/Y/Z/W/H, che rendono vera `condizioneVerificata`. `unita` e' l'unita' di misura
 * delle righe: con le condizioni il chiamante passa quella degli addebiti condizionati (nel
 * calcolo `C` e' la loro), altrimenti quella dell'addebito. `quantitaPrecedente` insieme a
 * `condizione` e' un errore, come in WinWaste (umiscondiz non e' piu' "5 spazi").
 *
 * DIFFERENZA VOLUTA DA WINWASTE (decisione di Graziano del 02/11): la porta non e' fedele a
 * `speciale` (FATAUTOMATICA.cs decompilato, righe 17230-17290), che fattura due volte la stessa
 * quantita' in due casi:
 * - `E` (e `H`) non azzera le righe delle fasce precedenti, a differenza di `B`/`D`/`Y`/`W`
 *   (riga 17230): una tabella `D` + `E` con 6.000 kg fattura 6.000 x prezzo della fascia 1 e
 *   anche 6.000 x prezzo della 7. Qui `E`/`H` azzerano le righe precedenti come `D`/`W`.
 * - con `quantitaPrecedente`, il blocco che scala la quantita' gia' passata (righe 17239-17262)
 *   vale per qualunque tipo, ma `B`, `C` e `D` poi riscrivono la quantita' (righe 17264-17282,
 *   `1` oppure l'intera quantita' del totale): la parte gia' fatturata si ripaga. Qui `D`/`E`
 *   fatturano la sola quantita' nuova al prezzo della fascia piu' alta raggiunta dal totale;
 *   `C` il fisso delle sole fasce raggiunte per la prima volta (precedente <= soglia inferiore
 *   della fascia; la fascia 1 solo con precedente 0); `B` il fisso della fascia piu' alta solo
 *   se raggiunta per la prima volta (Q8). `A` resta com'e'.
 * Perche': la stessa quantita' non si fattura mai due volte. In piu', `validaScaglioni`
 * rifiuta una fascia `D`/`W` seguita da `A`/`X` (Q7), che duplicherebbe la quantita' alta.
 * Import 3.8: le tabelle WinWaste `...E` e quelle "da data" con `B`/`C`/`D` fatturano meno che in
 * WinWaste, e quelle con `D`/`W` seguita da `A`/`X` non si importano: il rapporto d'import
 * deve segnalarlo.
 */
export function applicaScaglioni(
  s: readonly Scaglione[],
  quantita: string,
  unita: string,
  o: {
    quantitaPrecedente?: string
    condizione?: 'P' | 'C'
    quantitaCondizionati?: string
  } = {}
): { righe: RigaScaglione[]; condizioneVerificata: boolean } | { errore: string } {
  const errore = { errore: MSG_ERRORE_CALCOLO }
  try {
    const conCondizione = o.condizione !== undefined
    if (conCondizione && o.quantitaPrecedente !== undefined) {
      return { errore: 'Il prezzo speciale con le condizioni non ammette la quantità precedente.' }
    }
    let q = D(quantita)
    // Quantita' gia' passata ancora da scalare.
    let precedente = new Prisma.Decimal(0)
    const daData = o.quantitaPrecedente !== undefined
    if (daData) {
      precedente = D(o.quantitaPrecedente as string)
      if (precedente.lt(0)) return errore
    }
    if (o.condizione === 'C') {
      if (o.quantitaCondizionati === undefined) return errore
      q = D(o.quantitaCondizionati)
    } else if (daData) {
      q = q.plus(precedente)
    }
    if (q.lt(0) || D(quantita).lt(0)) return errore

    if (validaScaglioni(s, { conCondizioni: conCondizione }).length > 0) return errore
    const f = new Map(s.map(x => [x.ordine, x]))

    // Soglie: inferiore e superiore di ogni fascia (le fasce vuote valgono 0, come l'originale);
    // la 7 parte dalla soglia dell'ultima fascia 1-6 presente e arriva alla quantita'.
    const sup: Prisma.Decimal[] = []
    const inf: Prisma.Decimal[] = []
    const zero = new Prisma.Decimal(0)
    for (let n = 1; n <= 6; n++) {
      const finoA = f.get(n)?.finoA
      sup[n] = finoA ? D(finoA) : zero
      inf[n] = n === 1 ? zero : sup[n - 1]
    }
    let ultimaPresente = 1
    for (let n = 6; n >= 1; n--) {
      if (f.has(n)) {
        ultimaPresente = n
        break
      }
    }
    inf[7] = sup[ultimaPresente]
    sup[7] = q

    const descr: string[] = new Array<string>(8).fill('')
    const qta: Prisma.Decimal[] = new Array<Prisma.Decimal>(8).fill(zero)
    let verificata = false
    let daScalare = precedente

    for (let n = 1; n <= 7; n++) {
      const riga = f.get(n)
      if (!riga) continue
      const tipo = riga.tipoCalcolo
      if (!(q.gt(inf[n]) || (q.isZero() && n === 1))) continue

      if (n === 1) {
        descr[n] = `Per q.tà fino a ${unita} ${sup[n].toFixed()}`
      } else {
        descr[n] = `Per q.tà oltre ${unita} ${inf[n].toFixed()}`
        if (n !== 7 && q.gt(inf[n + 1])) descr[n] += ` e fino a ${sup[n].toFixed()}`
      }
      if ('BDEYWH'.includes(tipo)) {
        for (let k = 1; k < n; k++) descr[k] = ''
        verificata = false
      }
      if (daData && !'AX'.includes(tipo)) {
        // Le fasce a importo fisso (o tutta-quantita') occupano comunque la propria ampiezza:
        // la quantita' precedente va scalata anche da loro, non scaricata sulla A seguente.
        const ampiezza = (q.lt(sup[n]) ? q : sup[n]).minus(inf[n])
        if (ampiezza.gt(0)) daScalare = daScalare.gt(ampiezza) ? daScalare.minus(ampiezza) : zero
      }
      if ('AX'.includes(tipo)) {
        qta[n] = sup[n].minus(inf[n])
        if (q.lt(sup[n])) qta[n] = q.minus(inf[n])
        if (daData) {
          if (qta[n].lte(daScalare)) {
            daScalare = daScalare.minus(qta[n])
            descr[n] = ''
          } else {
            qta[n] = qta[n].minus(daScalare)
            daScalare = zero
          }
        }
        if (tipo === 'X') verificata = true
      }
      if ('BCYZ'.includes(tipo)) {
        qta[n] = new Prisma.Decimal(1)
        // Quantita' precedente: il fisso e' gia' stato fatturato se la fascia era gia' raggiunta.
        if (daData && (precedente.gt(inf[n]) || D(quantita).isZero())) descr[n] = ''
        if (descr[n] !== '') descr[n] += ': imp.fisso'
        if (tipo === 'Y' || tipo === 'Z') verificata = true
      }
      if ('DEWH'.includes(tipo)) {
        // Da data: la quantita' precedente e' gia' stata fatturata, si fattura la sola nuova.
        qta[n] = daData ? q.minus(precedente) : q
        if (daData && qta[n].isZero()) descr[n] = ''
        if (tipo === 'W' || tipo === 'H') verificata = true
      }
    }

    // Le varianti X-H senza condizione sono gia' rifiutate da validaScaglioni.
    const righe: RigaScaglione[] = []
    for (let n = 1; n <= 7; n++) {
      const riga = f.get(n)
      if (!riga || descr[n] === '') continue
      righe.push({
        descrizione: descr[n],
        quantita: quantitaTesto(qta[n]),
        prezzo: prezzoCalcolato(riga.prezzo),
        sconto: riga.sconto === '' ? null : riga.sconto,
        provvigione: riga.provvigione === '' ? null : riga.provvigione,
      })
    }
    return { righe, condizioneVerificata: verificata }
  } catch {
    return errore
  }
}
