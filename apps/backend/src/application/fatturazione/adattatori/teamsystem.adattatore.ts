// Adattatore TeamSystem dell'export contabile (4.4c, Task 30, spec §7.3): un file di testo a
// record fissi, due record per documento (testata con IVA e ricavi, poi scadenze con CIG e CUP).
// Il tracciato e' in `teamsystem-tracciato.ts` e descritto campo per campo in
// `riferimenti/TRACCIATO.md`. Funzione pura: nessun accesso al database.
//
// NON VERIFICATO su un'installazione reale (decisione 15): `verificato` e' `false` e le pagine di
// export lo mostrano. I valori scelti dove il tracciato non basta sono le costanti qui sotto, ognuna
// con il suo «da verificare».
import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { DocumentoPerExport } from '../export-csv'
import {
  chiaveMappatura,
  type AdattatoreExportContabile,
  type ChiaveMancante,
  type FileGenerato,
  type FormatoMappatura,
  type TipoMappatura,
} from './adattatore-export-contabile'
import { LUNGHEZZA_RECORD, RECORD_1, RECORD_2, type CampoTracciato } from './teamsystem-tracciato'

// --- Valori scelti dove il tracciato lascia dubbi: tutti da verificare su un'installazione reale.

/** Codice ditta («Codice Ditta Multi» dell'export originale, campo libero di 5 cifre). Da verificare su un'installazione reale. */
const CODICE_DITTA = '0'
/** Codifica del file: l'export originale scrive nella code page ANSI di sistema. Da verificare su un'installazione reale. */
const CODIFICA_FILE = 'latin1'
/** Tipo di contenuto del file. Da verificare su un'installazione reale. */
const CONTENT_TYPE_FILE = 'text/plain; charset=windows-1252'
/** Sigla del nome file se la denominazione del cedente e' vuota (come l'export originale). Da verificare su un'installazione reale. */
const SIGLA_PREDEFINITA = 'TFRAW'
/** Caratteri della sigla azienda nel nome file. Da verificare su un'installazione reale. */
const LUNGHEZZA_SIGLA = 4
/** Modalita di pagamento (codice SDI) che il gestionale chiama «ricevuta bancaria» (tipo effetto 2). Da verificare su un'installazione reale. */
const MODALITA_RICEVUTA_BANCARIA = 'MP12'
/** Tipo effetto di una rata con modalita diversa dalla ricevuta bancaria («altro»). Da verificare su un'installazione reale. */
/** Tipi effetto: ricevuta bancaria e «altro». Da verificare su un'installazione reale. */
const TIPO_EFFETTO_ALTRO = '3'
const TIPO_EFFETTO_RICEVUTA_BANCARIA = '2'

const MAX_RIEPILOGHI_IVA = 8
const MAX_CONTI_RICAVI = 8
const MAX_RATE = 12
/** Causali e descrizioni del gestionale per fattura e nota di credito. Da verificare su un'installazione reale. */
const CAUSALE_FATTURA = '001'
const DESCRIZIONE_FATTURA = 'FATTURA VENDITA'
const CAUSALE_NOTA_CREDITO = '002'
const DESCRIZIONE_NOTA_CREDITO = 'NOTA CREDITO EM'

export const NOMI_TIPO_RIGA: Record<string, string> = {
  MOVIMENTO: 'movimenti',
  FASCIA_SPECIALE: 'fasce speciali',
  FISSO: 'canoni fissi',
  MINIMO: 'minimi',
  SPESA_INCASSO: 'spese di incasso',
  BOLLO: 'bollo',
  STORNO: 'storni',
  QUANTITA_MOVIMENTI: 'quantità dei movimenti',
}

type Mappe = ReadonlyMap<string, string>

const nonGenerabile = (
  message: string,
  error = 'EXPORT_TEAMSYSTEM_NON_GENERABILE'
): BadRequestException => new BadRequestException({ error, message })

/**
 * Un campo a larghezza fissa. Un valore piu' lungo viene troncato; uno piu' corto si riempie con
 * `riempimento` dal lato opposto all'allineamento (`S` sinistra, `D` destra).
 */
export function campoFisso(
  valore: string,
  lunghezza: number,
  allineamento: 'S' | 'D',
  riempimento: ' ' | '0'
): string {
  const v = valore.slice(0, lunghezza)
  return allineamento === 'S'
    ? v.padEnd(lunghezza, riempimento)
    : v.padStart(lunghezza, riempimento)
}

const SOSTITUZIONI: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '«': '"',
  '»': '"',
  '–': '-',
  '—': '-',
  '€': 'E',
}

/**
 * Testo ASCII a un byte per carattere: le lettere accentate perdono l'accento, i segni tipografici
 * diventano quelli semplici, a capo e tabulazioni diventano spazi e il resto `?`. Cosi' nessun
 * carattere sposta le colonne del record.
 */
// I caratteri di controllo sono proprio quelli da sostituire.
/* eslint-disable no-control-regex */
export function normalizzaAscii(testo: string): string {
  return testo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’“”«»–—€]/g, c => SOSTITUZIONI[c] ?? '?')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
}
/* eslint-enable no-control-regex */

const alfanumerico = (valore: string | null | undefined, lunghezza: number): string =>
  campoFisso(normalizzaAscii(valore ?? ''), lunghezza, 'S', ' ')

/** Solo cifre, zeri a sinistra; piu' lungo del campo e' un errore (l'originale non tronca i numeri). */
function numerico(valore: string, lunghezza: number, dove: string): string {
  if (!/^\d+$/.test(valore) || valore.length > lunghezza) {
    throw nonGenerabile(`${dove} non è un codice numerico di al massimo ${lunghezza} cifre.`)
  }
  return campoFisso(valore, lunghezza, 'D', '0')
}

/** Cifre di un dato anagrafico (CAP, partita IVA): quello che non e' cifra si scarta, vuoto = zeri. */
function soloCifre(valore: string | null | undefined, lunghezza: number, dove: string): string {
  const cifre = (valore ?? '').replace(/\D/g, '')
  return numerico(cifre === '' ? '0' : cifre, lunghezza, dove)
}

/**
 * Importo in centesimi interi con il segno come ULTIMO carattere del campo: `-123.45` in 12
 * posizioni e' `00000012345-`. Il segno si puo' imporre (totale fattura e rate).
 */
function importoConSegno(valore: string, larghezza: number, segno?: '+' | '-'): string {
  const d = new Prisma.Decimal(valore)
  const centesimi = d.abs().mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
  const cifre = centesimi.toFixed(0)
  if (cifre.length > larghezza - 1) {
    throw nonGenerabile('Un importo del documento è troppo grande per il tracciato TeamSystem.')
  }
  const s = segno ?? (d.isNegative() && !centesimi.isZero() ? '-' : '+')
  return campoFisso(cifre, larghezza - 1, 'D', '0') + s
}

/** «1234.56» in 13 cifre intere e 3 decimali senza separatore: `0000000001234` + `560`. */
function totaleTreDecimali(valore: string): string {
  const [intera, frazione = ''] = new Prisma.Decimal(valore).abs().toFixed(2).split('.')
  if (intera.length > 13) {
    throw nonGenerabile('Un totale del documento è troppo grande per il tracciato TeamSystem.')
  }
  return campoFisso(intera, 13, 'D', '0') + campoFisso(frazione, 3, 'S', '0')
}

/** «2026-11-05» in «05112026». */
function dataGgMmAaaa(iso: string): string {
  const [a, m, g] = iso.slice(0, 10).split('-')
  return `${g}${m}${a}`
}

/** Un record: tutti i campi partono dal riempimento del loro tipo (AN spazi, NU zeri). */
class RecordFisso {
  private readonly caratteri: string[]
  private readonly campi = new Map<string, CampoTracciato>()

  constructor(tracciato: readonly CampoTracciato[]) {
    this.caratteri = new Array<string>(LUNGHEZZA_RECORD).fill(' ')
    for (const c of tracciato) {
      this.campi.set(c.nome, c)
      for (let i = 0; i < c.occorrenze; i++) {
        const inizio = c.posizione - 1 + i * c.passo
        this.caratteri.fill(c.tipo === 'NU' ? '0' : ' ', inizio, inizio + c.lunghezza)
      }
    }
  }

  /** Scrive la `occorrenza`-esima occorrenza del campo; il valore deve avere la sua lunghezza. */
  imposta(nome: string, valore: string, occorrenza = 0): void {
    const c = this.campi.get(nome)
    if (c === undefined || occorrenza >= c.occorrenze || valore.length !== c.lunghezza) {
      throw new Error(`Campo TeamSystem «${nome}» non valido (programmazione).`)
    }
    const inizio = c.posizione - 1 + occorrenza * c.passo
    this.caratteri.splice(inizio, c.lunghezza, ...valore)
  }

  impostaTutte(nome: string, valore: string): void {
    const c = this.campi.get(nome)
    if (c === undefined) throw new Error(`Campo TeamSystem «${nome}» non valido (programmazione).`)
    for (let i = 0; i < c.occorrenze; i++) this.imposta(nome, valore, i)
  }

  testo(): string {
    return this.caratteri.join('')
  }
}

const ZERO_CON_SEGNO_12 = '00000000000+'
const ZERO_CON_SEGNO_16 = '000000000000000+'

function mappa(mappature: Mappe, tipo: TipoMappatura, chiave: string, dove: string): string {
  const v = mappature.get(chiaveMappatura(tipo, chiave))
  if (v === undefined) throw nonGenerabile(`Manca la mappatura ${dove}.`)
  return v
}

/** Riga di documento, per quanto serve a scegliere la chiave del conto ricavi. */
export interface RigaPerContoRicavi {
  tipoRiga: string
  centroRicavoCodice?: string | null
  categoriaCodice?: string | null
}

/**
 * Chiave della mappatura `CONTO_RICAVI` di una riga, a cascata: `CR:<centro di ricavo>`, poi
 * `CAT:<categoria>`, poi `TIPO:<tipo riga>`. I codici sono quelli fotografati sulla riga alla
 * creazione (Task 30b): dopo l'emissione una modifica dell'addebito non sposta il ricavo. Il tipo
 * riga copre le righe senza addebito (bollo, spese di incasso, storni) e i documenti precedenti.
 * Usata da `mappatureRichieste`, da `genera` e dal servizio delle etichette: un'unica definizione.
 */
export function chiaveContoRicavi(riga: RigaPerContoRicavi): string {
  const centro = riga.centroRicavoCodice?.trim() ?? ''
  if (centro !== '') return `CR:${centro}`
  const categoria = riga.categoriaCodice?.trim() ?? ''
  if (categoria !== '') return `CAT:${categoria}`
  return `TIPO:${riga.tipoRiga}`
}

/** Inverso di `chiaveContoRicavi`: livello e valore; `null` se la chiave non ha la forma attesa. */
export function leggiChiaveContoRicavi(
  chiave: string
): { livello: 'CR' | 'CAT' | 'TIPO'; valore: string } | null {
  const m = /^(CR|CAT|TIPO):(.+)$/.exec(chiave)
  return m ? { livello: m[1] as 'CR' | 'CAT' | 'TIPO', valore: m[2] } : null
}

/**
 * Etichetta di una chiave del conto ricavi. L'adattatore e' puro e non conosce le anagrafiche:
 * per centro e categoria usa il codice; `MappatureService` la sostituisce con la descrizione.
 */
export function etichettaContoRicavi(chiave: string, descrizione?: string): string {
  const k = leggiChiaveContoRicavi(chiave)
  if (k === null) return `Ricavi: ${chiave}`
  if (k.livello === 'CR') return `Ricavi: ${descrizione ?? `centro di ricavo ${k.valore}`}`
  if (k.livello === 'CAT') return `Ricavi: categoria ${descrizione ?? k.valore}`
  return `Ricavi: ${NOMI_TIPO_RIGA[k.valore] ?? k.valore.toLowerCase()}`
}

/** Chiave della mappatura `CODICE_IVA`: l'aliquota, con la natura se l'aliquota e' zero. */
export const chiaveIva = (aliquota: string, natura: string | null): string =>
  natura !== null ? `${aliquota}/${natura}` : aliquota

/** Inverso di `chiaveIva`; `null` se la chiave non ha la forma attesa. */
export function leggiChiaveIva(chiave: string): { aliquota: string; natura: string | null } | null {
  const m = /^(\d+(?:\.\d+)?)(?:\/(.+))?$/.exec(chiave)
  return m ? { aliquota: m[1], natura: m[2] ?? null } : null
}

const eNotaDiCredito = (d: DocumentoPerExport): boolean => d.documento.tipoDocumento === 'TD04'

function cessionarioRaso(d: DocumentoPerExport): string {
  const c = d.fotografia.cessionario
  const nome = (c.nome ?? '').trim()
  const cognome = (c.cognome ?? '').trim()
  if (nome !== '' || cognome !== '') return `${cognome} ${nome}`.trim()
  return c.denominazione ?? d.documento.cliente.denominazione
}

const ePersonaFisica = (d: DocumentoPerExport): boolean => {
  const c = d.fotografia.cessionario
  return (c.nome ?? '').trim() !== '' || (c.cognome ?? '').trim() !== ''
}

function costruisciRecord1(d: DocumentoPerExport, mappature: Mappe): string {
  const doc = d.documento
  const fot = d.fotografia
  const cess = fot.cessionario
  const nota = eNotaDiCredito(d)
  const r = new RecordFisso(RECORD_1)

  if (doc.riepiloghi.length > MAX_RIEPILOGHI_IVA) {
    throw nonGenerabile(
      `Il documento ha più di ${MAX_RIEPILOGHI_IVA} riepiloghi IVA: il tracciato TeamSystem ne ammette ${MAX_RIEPILOGHI_IVA}.`
    )
  }

  // Partita IVA e codice fiscale vanno nei campi italiani: un cliente estero andrebbe nei campi
  // `*_ESTERO` (nessun cliente estero oggi, Q27).
  if ((cess.sede.nazione as string) !== 'IT') {
    throw nonGenerabile(
      'Il tracciato TeamSystem non gestisce ancora i clienti esteri.',
      'EXPORT_TEAMSYSTEM_NAZIONE_NON_SUPPORTATA'
    )
  }
  r.imposta('TRF_DITTA', numerico(CODICE_DITTA, 5, 'Il codice ditta'))
  r.imposta('TRF_VERSIONE', '3')
  r.imposta('TRF_TARC', '0')
  r.imposta(
    'TRF_COD_CLIFOR',
    numerico(
      mappa(mappature, 'CLIENTE', doc.cliente.id, 'del cliente'),
      FORMATI_MAPPATURE.CLIENTE.massimo,
      'La mappatura del cliente'
    )
  )
  r.imposta('TRF_RASO', alfanumerico(cessionarioRaso(d), 32))
  r.imposta('TRF_IND', alfanumerico(cess.sede.indirizzo, 30))
  r.imposta('TRF_CAP', soloCifre(cess.sede.cap, 5, 'Il CAP del cliente'))
  r.imposta('TRF_CITTA', alfanumerico(cess.sede.comune, 25))
  r.imposta('TRF_PROV', alfanumerico(cess.sede.provincia, 2))
  r.imposta('TRF_COFI', alfanumerico(cess.codiceFiscale, 16))
  r.imposta('TRF_PIVA', soloCifre(cess.partitaIva, 11, 'La partita IVA del cliente'))
  r.imposta('TRF_PF', ePersonaFisica(d) ? 'S' : 'N')
  r.imposta('TRF_SESSO', '*')

  const rata1 = [...doc.rate].sort((a, b) => a.ordine - b.ordine)[0]
  if (fot.pagamento !== null) {
    const codice = numerico(
      mappa(mappature, 'PAGAMENTO', fot.pagamento.codice, 'del pagamento'),
      FORMATI_MAPPATURE.PAGAMENTO.massimo,
      'La mappatura del pagamento'
    )
    r.imposta('TRF_CFCODPAG', campoFisso(codice, 4, 'D', '0'))
  }
  if (rata1 !== undefined) {
    r.imposta('TRF_CFBANCA', bancaCifre(rata1.abi))
    r.imposta('TRF_CFAGENZIA', bancaCifre(rata1.cab))
  }
  r.imposta('TRF_CAUSALE', nota ? CAUSALE_NOTA_CREDITO : CAUSALE_FATTURA)
  r.imposta('TRF_CAU_DES', alfanumerico(nota ? DESCRIZIONE_NOTA_CREDITO : DESCRIZIONE_FATTURA, 15))
  // WasteFlow non ha una data di registrazione separata dalla data del documento.
  r.imposta('TRF_DATA_REGISTRAZIONE', dataGgMmAaaa(doc.dataDocumento))
  r.imposta('TRF_DATA_DOC', dataGgMmAaaa(doc.dataDocumento))
  if (d.numero === null) throw nonGenerabile('Un documento senza numero non si può esportare.')
  r.imposta('TRF_NDOC', numerico(String(d.numero), 5, 'Il numero del documento'))
  r.imposta(
    'TRF_SERIE',
    numerico(
      mappa(mappature, 'REGISTRO', d.registroCodice, 'del registro IVA'),
      FORMATI_MAPPATURE.REGISTRO.massimo,
      'La mappatura del registro IVA'
    )
  )
  r.imposta('TRF_EC_TOT_DOC_VAL', totaleTreDecimali(doc.totaleDocumento))
  r.imposta('TRF_EC_TOT_IVA_VAL', totaleTreDecimali(doc.totaleIva))

  doc.riepiloghi.forEach((riep, i) => {
    r.imposta('TRF_IMPONIB', importoConSegno(riep.imponibile, 12), i)
    r.imposta(
      'TRF_ALIQ',
      numerico(
        mappa(mappature, 'CODICE_IVA', chiaveIva(riep.aliquota, riep.natura), 'del codice IVA'),
        FORMATI_MAPPATURE.CODICE_IVA.massimo,
        'La mappatura del codice IVA'
      ),
      i
    )
    r.imposta('TRF_IMPOSTA', importoConSegno(riep.imposta, 11), i)
  })
  for (let i = doc.riepiloghi.length; i < MAX_RIEPILOGHI_IVA; i++) {
    r.imposta('TRF_IMPONIB', ZERO_CON_SEGNO_12, i)
    r.imposta('TRF_IMPOSTA', '0000000000+', i)
  }
  r.imposta(
    'TRF_TOT_FATT',
    importoConSegno(new Prisma.Decimal(doc.totaleDocumento).abs().toFixed(2), 12, '+')
  )

  // Ricavi per conto: i prezzi totali delle righe, sommati per conto mappato.
  const perConto = new Map<string, Prisma.Decimal>()
  for (const riga of doc.righe) {
    const conto = numerico(
      mappa(mappature, 'CONTO_RICAVI', chiaveContoRicavi(riga), 'del conto dei ricavi'),
      FORMATI_MAPPATURE.CONTO_RICAVI.massimo,
      'La mappatura del conto dei ricavi'
    )
    perConto.set(conto, (perConto.get(conto) ?? new Prisma.Decimal(0)).add(riga.prezzoTotale))
  }
  const conti = [...perConto.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (conti.length > MAX_CONTI_RICAVI) {
    throw nonGenerabile(
      `Il documento ha più di ${MAX_CONTI_RICAVI} conti di ricavo: il tracciato TeamSystem ne ammette ${MAX_CONTI_RICAVI}.`
    )
  }
  conti.forEach(([conto, importo], i) => {
    r.imposta('TRF_CONTO_RIC', conto, i)
    r.imposta('TRF_IMP_RIC', importoConSegno(importo.toFixed(2), 12), i)
  })
  for (let i = conti.length; i < MAX_CONTI_RICAVI; i++)
    r.imposta('TRF_IMP_RIC', ZERO_CON_SEGNO_12, i)

  r.impostaTutte('TRF_IMPORTO', ZERO_CON_SEGNO_12)
  r.impostaTutte('TRF_EC_IMP_VAL', ZERO_CON_SEGNO_16)
  for (const n of ['ACC', 'PREV', '1', '2', '3', '4']) r.imposta(`TRF_RIT_${n}`, ZERO_CON_SEGNO_12)
  r.imposta('TRF_STORICO', 'N')
  // Scissione dei pagamenti = «K» dell'originale (esigibilita 4 e flag Art. 21); esigibilita
  // differita = IVA in sospensione (1). Da verificare su un'installazione reale.
  const scissione = doc.riepiloghi.some(x => x.esigibilita === 'S')
  const differita = doc.riepiloghi.some(x => x.esigibilita === 'D')
  if (scissione) {
    r.imposta('TRF_ESIGIBILITA_IVA', '4')
    r.imposta('TRF_ART21_ANAG', 'S')
    r.imposta('TRF_ART21_IVA', 'S')
  } else if (differita) {
    r.imposta('TRF_ESIGIBILITA_IVA', '1')
  }
  return r.testo()
}

/** ABI o CAB: 5 cifre; qualsiasi altra cosa vale «non indicato» (zeri). */
function bancaCifre(valore: string | null): string {
  return valore !== null && /^\d{1,5}$/.test(valore) ? campoFisso(valore, 5, 'D', '0') : '00000'
}

function costruisciRecord2(d: DocumentoPerExport, mappature: Mappe): string {
  const doc = d.documento
  const fot = d.fotografia
  const nota = eNotaDiCredito(d)
  const segno: '+' | '-' = nota ? '-' : '+'
  const rate = [...doc.rate].sort((a, b) => a.ordine - b.ordine)
  if (rate.length > MAX_RATE) {
    throw nonGenerabile(
      `Il documento ha più di ${MAX_RATE} rate: il tracciato TeamSystem ne ammette ${MAX_RATE}.`
    )
  }
  const r = new RecordFisso(RECORD_2)
  r.imposta('TRF1_DITTA', numerico(CODICE_DITTA, 5, 'Il codice ditta'))
  r.imposta('TRF1_VERSIONE', '3')
  r.imposta('TRF1_TARC', '1')
  if (fot.pagamento !== null) {
    r.imposta(
      'TRF_POR_CODPAG',
      numerico(
        mappa(mappature, 'PAGAMENTO', fot.pagamento.codice, 'del pagamento'),
        FORMATI_MAPPATURE.PAGAMENTO.massimo,
        'La mappatura del pagamento'
      )
    )
  }
  const prima = rate[0]
  if (prima !== undefined) {
    r.imposta('TRF_POR_BANCA', bancaCifre(prima.abi))
    r.imposta('TRF_POR_AGENZIA', bancaCifre(prima.cab))
    r.imposta('TRF_POR_DESAGENZIA', alfanumerico(prima.istituto, 30))
  }
  r.imposta('TRF_POR_TOT_RATE', campoFisso(String(rate.length), 2, 'D', '0'))
  const somma = rate.reduce((s, x) => s.add(x.importo), new Prisma.Decimal(0))
  r.imposta('TRF_POR_TOTDOC', importoConSegno(somma.abs().toFixed(2), 12, segno))
  rate.forEach((rata, i) => {
    r.imposta('TRF_POR_NUM_RATA', campoFisso(String(i + 1), 2, 'D', '0'), i)
    r.imposta('TRF_POR_DATASCAD', dataGgMmAaaa(rata.dataScadenza), i)
    r.imposta(
      'TRF_POR_TIPOEFF',
      rata.modalita === ''
        ? '0'
        : rata.modalita === MODALITA_RICEVUTA_BANCARIA
          ? TIPO_EFFETTO_RICEVUTA_BANCARIA
          : TIPO_EFFETTO_ALTRO,
      i
    )
    r.imposta(
      'TRF_POR_IMPORTO_EFF',
      importoConSegno(new Prisma.Decimal(rata.importo).abs().toFixed(2), 12, segno),
      i
    )
  })
  r.imposta('TRF_POR_CIG', alfanumerico(fot.cig, 15))
  r.imposta('TRF_POR_CUP', alfanumerico(fot.cup, 15))
  // Il campo «spazio» del tracciato riceve serie e numero del documento (come l'export originale).
  r.imposta('SPAZIO_4', alfanumerico(`${d.registroCodice}${d.numero ?? ''}`, 15))
  return r.testo()
}

const ordina = (documenti: readonly DocumentoPerExport[]): DocumentoPerExport[] =>
  [...documenti].sort(
    (a, b) =>
      a.documento.dataDocumento.localeCompare(b.documento.dataDocumento) ||
      a.registroCodice.localeCompare(b.registroCodice) ||
      (a.numero ?? 0) - (b.numero ?? 0)
  )

/**
 * Nome del file: sigla dell'azienda (primi 4 caratteri alfanumerici maiuscoli della denominazione
 * del cedente, `TFRAW` se vuota) + GGMM della prima e dell'ultima data, senza estensione. Il
 * formato delle date dell'originale e' un campo libero della maschera: GGMM e' la scelta piu'
 * probabile. Da verificare su un'installazione reale.
 */
function nomeFile(documenti: readonly DocumentoPerExport[]): string {
  const primo = documenti[0]
  if (documenti.length === 0) return SIGLA_PREDEFINITA
  const base = normalizzaAscii(primo?.fotografia.cedente.denominazione ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, LUNGHEZZA_SIGLA)
  // Senza lettere o cifre il ripiego e' `TFRAW`; una sigla corta si completa con `_` (l'originale
  // usa spazi, che in un nome di file non servono).
  const sigla = base === '' ? SIGLA_PREDEFINITA : base.padEnd(LUNGHEZZA_SIGLA, '_')
  const date = documenti.map(x => x.documento.dataDocumento).sort()
  const ggmm = (iso: string): string => `${iso.slice(8, 10)}${iso.slice(5, 7)}`
  return `${sigla}${ggmm(date[0])}${ggmm(date[date.length - 1])}`
}

/** Larghezza (cifre) del codice di ogni mappatura nel tracciato. */
const FORMATI_MAPPATURE: Readonly<Record<TipoMappatura, FormatoMappatura>> = {
  CLIENTE: { soloCifre: true, massimo: 5 },
  CONTO_RICAVI: { soloCifre: true, massimo: 7 },
  CODICE_IVA: { soloCifre: true, massimo: 3 },
  PAGAMENTO: { soloCifre: true, massimo: 3 },
  REGISTRO: { soloCifre: true, massimo: 2 },
}

export class TeamSystemAdattatore implements AdattatoreExportContabile {
  readonly codice = 'TEAMSYSTEM'
  readonly nome = 'TeamSystem'
  readonly modalita = 'FILE' as const
  /** Tracciato non verificato su un'installazione reale (decisione 15). */
  readonly verificato = false
  /** Le stesse larghezze con cui `genera` chiama `numerico()`: i due devono restare allineati. */
  readonly formatiMappature = FORMATI_MAPPATURE

  mappatureRichieste(documenti: readonly DocumentoPerExport[]): ChiaveMancante[] {
    const voci = new Map<string, ChiaveMancante>()
    const aggiungi = (tipo: TipoMappatura, chiaveWasteflow: string, etichetta: string): void => {
      const k = chiaveMappatura(tipo, chiaveWasteflow)
      if (!voci.has(k)) voci.set(k, { tipo, chiaveWasteflow, etichetta })
    }
    for (const d of documenti) {
      aggiungi('REGISTRO', d.registroCodice, `Registro IVA ${d.registroCodice}`)
      aggiungi('CLIENTE', d.documento.cliente.id, d.documento.cliente.denominazione)
      if (d.fotografia.pagamento !== null) {
        aggiungi('PAGAMENTO', d.fotografia.pagamento.codice, d.fotografia.pagamento.descrizione)
      }
      for (const riep of d.documento.riepiloghi) {
        const aliquota = new Prisma.Decimal(riep.aliquota)
        aggiungi(
          'CODICE_IVA',
          chiaveIva(riep.aliquota, riep.natura),
          riep.natura !== null ? `IVA esente ${riep.natura}` : `IVA ${aliquota.toString()}%`
        )
      }
      for (const riga of d.documento.righe) {
        aggiungi(
          'CONTO_RICAVI',
          chiaveContoRicavi(riga),
          etichettaContoRicavi(chiaveContoRicavi(riga))
        )
      }
    }
    return [...voci.values()]
  }

  genera(documenti: readonly DocumentoPerExport[], mappature: Mappe): FileGenerato[] {
    const righe: string[] = []
    for (const d of ordina(documenti)) {
      righe.push(costruisciRecord1(d, mappature), costruisciRecord2(d, mappature))
    }
    const testo = righe.map(r => `${r}\r\n`).join('')
    return [
      {
        nome: nomeFile(documenti),
        contentType: CONTENT_TYPE_FILE,
        contenuto: Buffer.from(testo, CODIFICA_FILE),
      },
    ]
  }
}
