import { Prisma } from '@prisma/client'
import type { StatoContrattoCliente } from '../contratti-cliente/regole-contratto-cliente'
import type { AvvisoDocumento, ErroreDocumento, Segnalazione } from './codici'
import { famigliaCalcolata } from './costanti-fiscali'
import { controllaCoerenzaSdi } from './controlli-sdi'
import type { EsitoRighe, RigaSenzaLinea } from './esito-righe'
import { righeFisse, type MarcatoreEsistente } from './righe-fisse'
import { riepiloghiIva, rigaSpeseIncasso, valutaBollo } from './iva-bollo'
import { applicaMinimi } from './minimi'
import { calcolaRate, type DatiBanca } from './pagamento'
import { righeDaLegami } from './righe-movimento'
import { righeQuantitaMovimenti } from './righe-quantita'
import { oltreTermineDifferita, tipoDocumento } from './tipo-documento'
import type {
  CodiceIvaDaFatturare,
  RataCalcolata,
  RigaDocumentoCalcolata,
  RigaLegameDaFatturare,
  RigaListinoDaFatturare,
  RiepilogoIvaCalcolato,
} from './tipi'

/**
 * Calcolo di un documento intero (spec §6, scansione P16): dominio puro, nessun database.
 * Date come 'AAAA-MM-GG' puro, senza ora. Importi come stringhe decimali.
 */

export interface ContrattoDaFatturare {
  id: string
  versione: number
  stato: StatoContrattoCliente
  dataInizio: string
  dataFine: string | null
  esigibilita: 'I' | 'D' | 'S'
  ritenutaPercentuale: string | null
  condizione: { modalita: string; giorniRate: number[]; fineMese: boolean } | null
  contoCedente: DatiBanca | null
  bancaCliente: DatiBanca | null
  speseIncasso: {
    descrizione: string
    importo: string
    codiceIva: CodiceIvaDaFatturare | null
  } | null
  bollo: { importo: string; codiceIva: CodiceIvaDaFatturare | null } | null
  registroIvaId: string | null
  codiceDestinatario: string | null
  pec: string | null
  cig: string | null
  cup: string | null
  idDocumento: string | null
  clienteCompleto: { datiFiscali: boolean; sede: boolean }
}

export interface InputDocumento {
  raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'
  contratto: ContrattoDaFatturare
  periodo: { dal: string; al: string }
  dataDocumento: string
  legami: RigaLegameDaFatturare[]
  /**
   * TUTTE le righe attive degli elenchi del documento (principale e allegati), nell'ordine del
   * listino e senza riordinarle (scansione P12): il «riga n» dei dettagli e' la posizione da 1 in
   * questa mappa. `categoriaCodice` (3 cifre) serve a `M<cat>`. Le costruisce il Task 17.
   */
  listino: ReadonlyMap<string, RigaListinoDaFatturare>
  /**
   * Codice (es. «001») e numero del contratto di ogni elenco del listino, per `elencoId`. Serve al
   * «riga p dell'elenco X (contratto N)» dei dettagli; se manca un elenco, o la posizione nel suo
   * elenco, il dettaglio cita la posizione nel listino unito.
   */
  elenchi?: ReadonlyMap<string, { codice: string; contratto: string }>
  righeFisse: RigaListinoDaFatturare[]
  righeQuantita: RigaListinoDaFatturare[]
  minimi: RigaListinoDaFatturare[]
  marcatori: MarcatoreEsistente[]
  codiciIva: ReadonlyMap<string, CodiceIvaDaFatturare>
  legamiDaCollegareEsclusi: number
  arretrati: number
}

export interface DocumentoCalcolato {
  tipoDocumento: 'TD01' | 'TD24'
  formatoTrasmissione: 'FPR12' | 'FPA12'
  righe: RigaDocumentoCalcolata[]
  riepiloghi: RiepilogoIvaCalcolato[]
  rate: RataCalcolata[]
  condizioniPagamento: 'TP01' | 'TP02' | null
  totaleImponibile: string
  totaleIva: string
  totaleDocumento: string
  nettoAPagare: string
  bolloDovuto: boolean
  /** Importo del bollo per `DatiBollo`; la riga BOLLO addebitata e' gia' nei riepiloghi. */
  importoBollo: string | null
  errori: Segnalazione<ErroreDocumento>[]
  avvisi: Segnalazione<AvvisoDocumento>[]
}

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v)
const FORMA_DATA = /^\d{4}-\d{2}-\d{2}$/
const CODICE_NESSUN_DESTINATARIO = '0000000'

function validaData(nome: string, valore: string): void {
  const [a, m, g] = valore.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, g))
  const esiste =
    FORMA_DATA.test(valore) &&
    d.getUTCFullYear() === a &&
    d.getUTCMonth() === m - 1 &&
    d.getUTCDate() === g
  if (!esiste) {
    throw new Error(`${nome}: atteso un giorno valido in forma AAAA-MM-GG senza ora.`)
  }
}

function numera(righe: readonly RigaSenzaLinea[]): RigaDocumentoCalcolata[] {
  return righe.map((r, indice) => ({ ...r, numeroLinea: indice + 1 }))
}

const vuoto = (testo: string | null): boolean => testo === null || testo.trim() === ''

/**
 * Ordine (scansione P16): controllo del listino → righe movimento → righe TT/TF → fisse → minimi →
 * spese di incasso → riepiloghi provvisori → bollo (sui riepiloghi SENZA la riga BOLLO) → riga
 * BOLLO → numeri di linea → riepiloghi finali → totali → rate → errori di contratto →
 * TOTALE_NON_POSITIVO → coerenza SDI → avvisi.
 *
 * Il bollo addebitato e' una riga N1 dei riepiloghi finali e nel totale entra una volta sola.
 * Con esigibilita `S` il netto a pagare (e le rate) escludono l'imposta.
 */
export function calcolaDocumento(i: InputDocumento): DocumentoCalcolato {
  validaData('dataDocumento', i.dataDocumento)
  validaData('periodo.dal', i.periodo.dal)
  validaData('periodo.al', i.periodo.al)
  for (const l of i.legami) validaData('dataMovimento', l.dataMovimento)

  const c = i.contratto
  if (c.stato === 'BOZZA' || c.stato === 'ANNULLATO') {
    throw new Error(
      `Contratto in stato ${c.stato}: non entra in un documento (invariante del chiamante).`
    )
  }
  for (const r of [...i.righeFisse, ...i.righeQuantita, ...i.minimi]) {
    if (!i.listino.has(r.id)) {
      throw new Error(
        'Una riga fissa, TT/TF o minimo non e nel listino del documento (invariante).'
      )
    }
  }
  const errori: Segnalazione<ErroreDocumento>[] = []
  const avvisi: Segnalazione<AvvisoDocumento>[] = []

  // 1. Controllo del listino: ogni riga attiva del documento, citata o no dai legami.
  for (const [id, r] of i.listino) {
    if (!famigliaCalcolata(r)) {
      errori.push({ codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio: r.tipo, rigaId: id })
    }
  }

  const accoda = (esito: EsitoRighe): void => {
    errori.push(...esito.errori)
    for (const a of esito.avvisi) {
      if (!avvisi.some(x => x.codice === a.codice)) avvisi.push(a)
    }
  }

  /**
   * Unico punto in cui una segnalazione su una riga di listino (`rigaId`) prende il suo
   * dettaglio: «<regola> riga p dell'elenco <codice> (contratto <numero>)», con p = posizione
   * della riga nel suo elenco completo. Senza elenco o posizione noti cita la posizione da 1
   * nel listino unito (P12). `rigaId` non esce dal calcolo.
   */
  const posizioneNelListino = new Map([...i.listino.keys()].map((id, k) => [id, k + 1]))
  const localizzaRiga = <T extends { dettaglio?: string; rigaId?: string }>(s: T): T => {
    const { rigaId, ...resto } = s
    if (rigaId === undefined) return s
    const riga = i.listino.get(rigaId)
    const elenco = riga === undefined ? undefined : i.elenchi?.get(riga.elencoId)
    const dove =
      riga?.posizioneInElenco !== undefined && elenco !== undefined
        ? `riga ${riga.posizioneInElenco} dell'elenco ${elenco.codice} (contratto ${elenco.contratto})`
        : `riga ${posizioneNelListino.get(rigaId)}`
    return { ...resto, dettaglio: [s.dettaglio, dove].filter(x => x !== undefined).join(' ') } as T
  }

  const sospeso = c.stato === 'SOSPESO'
  const righe: RigaSenzaLinea[] = []

  if (!sospeso) {
    if (c.stato === 'SOSPESO_MOVIMENTI') {
      // Solo le righe fisse: niente movimenti e niente TT/TF.
      avvisi.push({ codice: 'MOVIMENTI_SOSPESI' })
    } else {
      // 2. Righe movimento. Un FAMIGLIA_NON_CALCOLATA di `righeDaLegami` e' un doppione solo se
      // il controllo del listino ha gia' segnalato la stessa riga (stessa posizione n). Se tipo o
      // prezzo speciale congelati nel legame divergono dal listino attuale, l'errore del legame e'
      // l'unico segnale: scartarlo farebbe sparire il legame dal documento senza errore.
      const giaSegnalate = new Set(
        errori.filter(e => e.codice === 'FAMIGLIA_NON_CALCOLATA').map(e => e.rigaId)
      )
      const mov = righeDaLegami(i.legami, i.listino)
      accoda({
        ...mov,
        errori: mov.errori.filter(
          e => e.codice !== 'FAMIGLIA_NON_CALCOLATA' || !giaSegnalate.has(e.rigaId)
        ),
      })
      righe.push(...mov.righe)
      // 3. TT/TF
      const qta = righeQuantitaMovimenti({
        righe: i.righeQuantita,
        legami: i.legami,
        periodo: i.periodo,
      })
      accoda(qta)
      righe.push(...qta.righe)
    }
    // 4. Fisse
    const fisse = righeFisse({
      righe: i.righeFisse,
      periodo: i.periodo,
      contratto: { dataInizio: c.dataInizio, dataFine: c.dataFine },
      marcatori: i.marcatori,
    })
    accoda(fisse)
    righe.push(...fisse.righe)
    // 5. Minimi: con SOSPESO_MOVIMENTI entrano solo i fissi (spec §6.4), niente minimi.
    if (c.stato !== 'SOSPESO_MOVIMENTI') {
      const minimi = applicaMinimi(righe, i.minimi, i.listino)
      accoda(minimi)
      righe.push(...minimi.righe)
    }
    // 6. Spese di incasso: solo se c'e' altro da fatturare.
    if (righe.length > 0) {
      const spese = rigaSpeseIncasso(c.speseIncasso, c.condizione?.giorniRate.length ?? 0)
      errori.push(...spese.errori)
      if (spese.riga !== null) righe.push(spese.riga)
    }
  }

  // 7. Riepiloghi provvisori e bollo (la base del bollo non contiene la riga BOLLO).
  const provvisori = riepiloghiIva(numera(righe), c.esigibilita, i.codiciIva).riepiloghi
  const bollo = valutaBollo(provvisori, i.dataDocumento, c.bollo)
  errori.push(...bollo.errori)
  avvisi.push(...bollo.avvisi)
  if (bollo.rigaBollo !== null) righe.push(bollo.rigaBollo)

  // 8. Numeri di linea e riepiloghi finali.
  const righeFinali = numera(righe)
  const finale = riepiloghiIva(righeFinali, c.esigibilita, i.codiciIva)
  errori.push(...finale.errori)
  const riepiloghi = finale.riepiloghi

  // 9. Totali
  const imponibile = riepiloghi.reduce((s, r) => s.plus(D(r.imponibile)), new Prisma.Decimal(0))
  const iva = riepiloghi.reduce((s, r) => s.plus(D(r.imposta)), new Prisma.Decimal(0))
  const totale = imponibile.plus(iva)
  const netto = c.esigibilita === 'S' ? totale.minus(iva) : totale

  // 10. Rate
  let rate: RataCalcolata[] = []
  let condizioniPagamento: 'TP01' | 'TP02' | null = null
  if (c.condizione === null) {
    errori.push({ codice: 'SENZA_CONDIZIONE_PAGAMENTO' })
  } else {
    const p = calcolaRate({
      netto: netto.toFixed(2),
      dataDocumento: i.dataDocumento,
      condizione: c.condizione,
      esigibilita: c.esigibilita,
      contoCedente: c.contoCedente,
      bancaCliente: c.bancaCliente,
    })
    rate = p.rate
    condizioniPagamento = rate.length === 0 ? null : p.condizioniPagamento
    errori.push(...p.errori)
  }

  // 11. Errori di contratto
  if (sospeso) {
    errori.push({
      codice: 'CONTRATTO_SOSPESO',
    })
  }
  if (c.registroIvaId === null) errori.push({ codice: 'SENZA_REGISTRO_IVA' })
  if (!c.clienteCompleto.datiFiscali) errori.push({ codice: 'CLIENTE_SENZA_DATI_FISCALI' })
  if (!c.clienteCompleto.sede) errori.push({ codice: 'SEDE_CLIENTE_INCOMPLETA' })

  const destinatario = (c.codiceDestinatario ?? '').trim()
  const formatoTrasmissione: 'FPR12' | 'FPA12' = destinatario.length === 6 ? 'FPA12' : 'FPR12'
  if (formatoTrasmissione === 'FPA12' && (!vuoto(c.cig) || !vuoto(c.cup)) && vuoto(c.idDocumento)) {
    errori.push({ codice: 'DATI_PA_INCOMPLETI' })
  }
  if (c.ritenutaPercentuale !== null && D(c.ritenutaPercentuale).greaterThan(0)) {
    errori.push({ codice: 'RITENUTA_NON_GESTITA' })
  }

  // 12. Totale non positivo (un contratto non emettibile ha gia' il suo errore)
  if (!sospeso && totale.lessThanOrEqualTo(0)) errori.push({ codice: 'TOTALE_NON_POSITIVO' })

  // 13. Coerenza SDI
  errori.push(
    ...controllaCoerenzaSdi({
      righe: righeFinali,
      riepiloghi,
      totaleDocumento: totale.toFixed(2),
    })
  )

  // 14. Avvisi
  const tipo = tipoDocumento(righeFinali)
  if (i.legamiDaCollegareEsclusi > 0) {
    avvisi.push({
      codice: 'MOVIMENTI_DA_COLLEGARE_ESCLUSI',
      dettaglio: String(i.legamiDaCollegareEsclusi),
    })
  }
  // Arretrati: il numero lo derivano le righe FISSO con scadenza anteriore al periodo; il campo del
  // chiamante vale solo se maggiore (nota per il Task 17: puo' non passarlo).
  const derivati = righeFinali.filter(
    r => r.marcatore?.tipo === 'SCADENZA_FISSO' && r.marcatore.chiaveCompetenza < i.periodo.dal
  ).length
  const arretrati = Math.max(i.arretrati, derivati)
  if (arretrati > 0) {
    const avviso: Segnalazione<AvvisoDocumento> = {
      codice: 'ARRETRATI_PRESENTI',
      dettaglio: String(arretrati),
    }
    const indice = avvisi.findIndex(a => a.codice === 'ARRETRATI_PRESENTI')
    if (indice === -1) avvisi.push(avviso)
    else avvisi[indice] = avviso
  }
  if (formatoTrasmissione === 'FPA12') avvisi.push({ codice: 'FPA_DA_FIRMARE' })
  if ((destinatario === '' || destinatario === CODICE_NESSUN_DESTINATARIO) && vuoto(c.pec)) {
    avvisi.push({ codice: 'DESTINATARIO_ASSENTE' })
  }
  if (tipo === 'TD24' && oltreTermineDifferita(i.dataDocumento, i.periodo.al)) {
    avvisi.push({ codice: 'DATA_OLTRE_TERMINE_DIFFERITA' })
  }

  return {
    tipoDocumento: tipo,
    formatoTrasmissione,
    righe: righeFinali,
    riepiloghi,
    rate,
    condizioniPagamento,
    totaleImponibile: imponibile.toFixed(2),
    totaleIva: iva.toFixed(2),
    totaleDocumento: totale.toFixed(2),
    nettoAPagare: netto.toFixed(2),
    bolloDovuto: bollo.dovuto,
    importoBollo: bollo.importo,
    errori: errori.map(localizzaRiga),
    avvisi: avvisi.map(localizzaRiga),
  }
}
