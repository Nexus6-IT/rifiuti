/**
 * Regole pure del contratto cliente (Fase 4.1, piano docs/superpowers/plans della fase 4.1).
 *
 * Decide, senza Nest ne' Prisma, cosa si puo' fare a un contratto cliente in un dato stato. Ha la
 * stessa forma di `domain/contracts/regole-contratto.ts` (4.0) ma il codice e' indipendente: il
 * contratto cliente e' un modello separato (D1) con altro vocabolario, altri stati e altri campi.
 *
 * Stati e transizioni (D8):
 *   Da \ A              ATTIVO   SOSPESO   SOSPESO_MOVIMENTI   ANNULLATO
 *   BOZZA               si (*)   -         -                   -   (la bozza si elimina)
 *   ATTIVO              -        si        si                  si (**)
 *   SOSPESO             si       -         si                  si
 *   SOSPESO_MOVIMENTI   si       si        -                   si
 *   ANNULLATO           -        -         -                   -   (definitivo)
 *   (*) richiede condizione di pagamento e registro IVA; (**) richiede il motivo.
 *
 * Campi modificabili (D9): BOZZA tutti e 37; ATTIVO, SOSPESO e SOSPESO_MOVIMENTI tutti tranne
 * numero, cliente e data di inizio (cambiarli fa un altro contratto); ANNULLATO nessuno. Si
 * eliminano solo le bozze. Modifica parziale: campo assente = invariato, `null` svuota solo i
 * campi facoltativi. Confronto sui valori normalizzati (date per giorno, decimali per valore,
 * periodi e annotazioni come elenchi), cosi' un corpo senza differenze non scrive nulla.
 *
 * Dove va ogni colonna di WinWaste (D5, mappa completa nel piano): `PRECOD` -> clienteId,
 * `CLIFAT` -> clienteFatturazioneId, `PAG` -> condizionePagamentoId, `BAN` -> contoCorrenteId,
 * `AGE` -> agenteId, `SPB`/`BOLLO` -> speseIncassoId/bolloId, `AN1-3` -> annotazioni, `TFAT` ->
 * testoFatturazioneId, `IVAS` -> esigibilitaIva, `PERIODI` -> periodi, `RINNOVO` ->
 * rinnovoAutomatico, `C1` -> registroIvaId, `C2` -> contrattoPrincipaleId, `C3` 4-19 -> soglia,
 * codice destinatario e riferimento, stipula, commessa, sede, validita', rinnovo, ISTAT, intento.
 *
 * Semantica di fatturazione per 4.4 (E7, E8), documentata qui perche' nessuno la applica ancora:
 *  - SOSPESO = nessuna fattura; SOSPESO_MOVIMENTI = solo gli addebiti fissi; BOZZA e ANNULLATO =
 *    mai fatturati; ATTIVO = fatturato. "Scaduto" (`dataFine` < oggi) e' un'informazione della
 *    vista, nessuna transizione automatica.
 *  - Nessun periodo di fatturazione = il contratto si fattura a ogni elaborazione (E7); con i
 *    periodi vale `periodoDaFatturare` di `periodi-fatturazione.ts`.
 *
 * Valori effettivi (D4): alla creazione il servizio copia dal cliente i campi di
 * `CAMPI_EREDITATI_DAL_CLIENTE` se assenti nel corpo; da li' il contratto ha i suoi valori. Due
 * eccezioni sono calcolate e non copiate: `destinatarioEffettivo` (codice e riferimento del
 * contratto, altrimenti del cliente di fatturazione, altrimenti `0000000`) e
 * `contoCorrenteEffettivo` (conto del contratto, altrimenti del cliente). 4.4 legge queste.
 *
 * Messaggi in italiano, mai con dati fiscali. Importi come stringhe decimali. Date `YYYY-MM-DD`
 * (nessun fuso orario).
 */
import { decimaleValido, confrontaDecimali, normalizzaDecimale } from '../clienti/decimali'
import {
  ESIGIBILITA_IVA,
  validaCodiceDestinatario,
  validaRiferimentoAmministrazione,
  validaRitenuta,
  type EsigibilitaIva,
} from '../clienti/dati-fiscali-cliente'
import { ordinaPeriodi, validaPeriodi, type PeriodoFatturazione } from './periodi-fatturazione'

export type StatoContrattoCliente =
  | 'BOZZA'
  | 'ATTIVO'
  | 'SOSPESO'
  | 'SOSPESO_MOVIMENTI'
  | 'ANNULLATO'

export const ETICHETTE_STATO: Readonly<Record<StatoContrattoCliente, string>> = {
  BOZZA: 'Bozza',
  ATTIVO: 'Attivo',
  SOSPESO: 'Sospeso',
  SOSPESO_MOVIMENTI: 'Sospeso (solo movimenti)',
  ANNULLATO: 'Annullato',
}

/** Transizioni ammesse (D8). */
export const TRANSIZIONI: Readonly<
  Record<StatoContrattoCliente, readonly StatoContrattoCliente[]>
> = {
  BOZZA: ['ATTIVO'],
  ATTIVO: ['SOSPESO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'],
  SOSPESO: ['ATTIVO', 'SOSPESO_MOVIMENTI', 'ANNULLATO'],
  SOSPESO_MOVIMENTI: ['ATTIVO', 'SOSPESO', 'ANNULLATO'],
  ANNULLATO: [],
}

export type UnitaValidita = 'A' | 'S' | 'M' | 'G'

export const ETICHETTE_UNITA_VALIDITA: Readonly<Record<UnitaValidita, string>> = {
  A: 'Anni',
  S: 'Semestri',
  M: 'Mesi',
  G: 'Giorni',
}

export type CodiceRinnovo = 'S' | 'N'

export type CampoContrattoCliente =
  | 'numero'
  | 'descrizione'
  | 'clienteId'
  | 'clienteFatturazioneId'
  | 'sedeId'
  | 'categoriaId'
  | 'tipoId'
  | 'dataInizio'
  | 'dataFine'
  | 'dataStipula'
  | 'validitaQuantita'
  | 'validitaUnita'
  | 'contrattoPrincipaleId'
  | 'condizionePagamentoId'
  | 'contoCorrenteId'
  | 'speseIncassoId'
  | 'bolloId'
  | 'registroIvaId'
  | 'esigibilitaIva'
  | 'ritenutaPercentuale'
  | 'agenteId'
  | 'testoFatturazioneId'
  | 'codiceDestinatario'
  | 'riferimentoAmministrazione'
  | 'codiceCig'
  | 'codiceCup'
  | 'idDocumentoPa'
  | 'escludiDichiarazioneIntento'
  | 'sogliaDal'
  | 'sogliaImporto'
  | 'sogliaIvaEsclusa'
  | 'rinnovoAutomatico'
  | 'codiceRinnovo'
  | 'incrementoIstat'
  | 'commessa'
  | 'annotazioni'
  | 'periodi'

/** Valori normalizzati: date `YYYY-MM-DD`, decimali stringa, periodi ordinati. */
export interface DatiContrattoCliente {
  numero: string
  descrizione: string
  clienteId: string
  clienteFatturazioneId: string | null
  sedeId: string | null
  categoriaId: string | null
  tipoId: string | null
  /** Obbligatoria: `null` solo prima della validazione. */
  dataInizio: string | null
  dataFine: string | null
  dataStipula: string | null
  validitaQuantita: number | null
  validitaUnita: UnitaValidita | null
  contrattoPrincipaleId: string | null
  condizionePagamentoId: string | null
  contoCorrenteId: string | null
  speseIncassoId: string | null
  bolloId: string | null
  registroIvaId: string | null
  esigibilitaIva: EsigibilitaIva
  ritenutaPercentuale: string | null
  agenteId: string | null
  testoFatturazioneId: string | null
  codiceDestinatario: string | null
  riferimentoAmministrazione: string | null
  codiceCig: string | null
  codiceCup: string | null
  idDocumentoPa: string | null
  escludiDichiarazioneIntento: boolean
  sogliaDal: string | null
  sogliaImporto: string | null
  sogliaIvaEsclusa: boolean
  rinnovoAutomatico: boolean
  codiceRinnovo: CodiceRinnovo | null
  incrementoIstat: boolean
  commessa: string | null
  annotazioni: string[]
  periodi: PeriodoFatturazione[]
}

export type ModificaContrattoCliente = {
  [K in CampoContrattoCliente]?: DatiContrattoCliente[K] | null
}

/** Ordine canonico dei campi (anche dei messaggi). */
const ORDINE_CAMPI: readonly CampoContrattoCliente[] = [
  'numero',
  'descrizione',
  'clienteId',
  'clienteFatturazioneId',
  'sedeId',
  'categoriaId',
  'tipoId',
  'dataInizio',
  'dataFine',
  'dataStipula',
  'validitaQuantita',
  'validitaUnita',
  'contrattoPrincipaleId',
  'condizionePagamentoId',
  'contoCorrenteId',
  'speseIncassoId',
  'bolloId',
  'registroIvaId',
  'esigibilitaIva',
  'ritenutaPercentuale',
  'agenteId',
  'testoFatturazioneId',
  'codiceDestinatario',
  'riferimentoAmministrazione',
  'codiceCig',
  'codiceCup',
  'idDocumentoPa',
  'escludiDichiarazioneIntento',
  'sogliaDal',
  'sogliaImporto',
  'sogliaIvaEsclusa',
  'rinnovoAutomatico',
  'codiceRinnovo',
  'incrementoIstat',
  'commessa',
  'annotazioni',
  'periodi',
]

export const ETICHETTE_CAMPI: Readonly<Record<CampoContrattoCliente, string>> = {
  numero: 'Numero',
  descrizione: 'Descrizione',
  clienteId: 'Cliente',
  clienteFatturazioneId: 'Cliente di fatturazione',
  sedeId: 'Sede di servizio',
  categoriaId: 'Categoria',
  tipoId: 'Tipo di contratto',
  dataInizio: 'Data di inizio',
  dataFine: 'Data di fine',
  dataStipula: 'Data di stipula',
  validitaQuantita: 'Durata della validità',
  validitaUnita: 'Unità della validità',
  contrattoPrincipaleId: 'Contratto principale',
  condizionePagamentoId: 'Condizione di pagamento',
  contoCorrenteId: 'Conto corrente di accredito',
  speseIncassoId: 'Spese di incasso',
  bolloId: 'Bollo',
  registroIvaId: 'Registro IVA',
  esigibilitaIva: 'Esigibilità IVA',
  ritenutaPercentuale: "Ritenuta d'acconto (%)",
  agenteId: 'Agente',
  testoFatturazioneId: 'Testo di fatturazione',
  codiceDestinatario: 'Codice destinatario',
  riferimentoAmministrazione: 'Riferimento amministrazione',
  codiceCig: 'CIG',
  codiceCup: 'CUP',
  idDocumentoPa: 'Documento della PA',
  escludiDichiarazioneIntento: "Escludi la dichiarazione d'intento",
  sogliaDal: 'Inizio controllo soglia',
  sogliaImporto: 'Soglia massima',
  sogliaIvaEsclusa: 'Soglia IVA esclusa',
  rinnovoAutomatico: 'Rinnovo automatico',
  codiceRinnovo: 'Codice rinnovo',
  incrementoIstat: 'Incremento ISTAT',
  commessa: 'Commessa',
  annotazioni: 'Annotazioni',
  periodi: 'Periodi di fatturazione',
}

/** "<Etichetta> è obbligatorio/a.", con accordo di genere, solo per i campi non svuotabili. */
const MESSAGGI_OBBLIGATORIO: Readonly<Partial<Record<CampoContrattoCliente, string>>> = {
  numero: 'Numero è obbligatorio.',
  descrizione: 'Descrizione è obbligatoria.',
  clienteId: 'Cliente è obbligatorio.',
  dataInizio: 'Data di inizio è obbligatoria.',
  esigibilitaIva: 'Esigibilità IVA è obbligatoria.',
  escludiDichiarazioneIntento: "Escludi la dichiarazione d'intento è obbligatorio.",
  sogliaIvaEsclusa: 'Soglia IVA esclusa è obbligatoria.',
  rinnovoAutomatico: 'Rinnovo automatico è obbligatorio.',
  incrementoIstat: 'Incremento ISTAT è obbligatorio.',
}

/** Campi che `null` puo' svuotare: tutti gli altri sono obbligatori. */
export const CAMPI_FACOLTATIVI: readonly CampoContrattoCliente[] = ORDINE_CAMPI.filter(
  c => !(c in MESSAGGI_OBBLIGATORIO)
)

const NON_MODIFICABILI_SE_ATTIVO: readonly CampoContrattoCliente[] = [
  'numero',
  'clienteId',
  'dataInizio',
]

export const CAMPI_MODIFICABILI: Readonly<
  Record<StatoContrattoCliente, readonly CampoContrattoCliente[]>
> = {
  BOZZA: ORDINE_CAMPI,
  ATTIVO: ORDINE_CAMPI.filter(c => !NON_MODIFICABILI_SE_ATTIVO.includes(c)),
  SOSPESO: ORDINE_CAMPI.filter(c => !NON_MODIFICABILI_SE_ATTIVO.includes(c)),
  SOSPESO_MOVIMENTI: ORDINE_CAMPI.filter(c => !NON_MODIFICABILI_SE_ATTIVO.includes(c)),
  ANNULLATO: [],
}

/** Predefiniti copiati dal cliente alla creazione del contratto (D4). */
export const CAMPI_EREDITATI_DAL_CLIENTE: readonly CampoContrattoCliente[] = [
  'condizionePagamentoId',
  'agenteId',
  'registroIvaId',
  'speseIncassoId',
  'bolloId',
  'esigibilitaIva',
  'ritenutaPercentuale',
  'codiceDestinatario',
  'riferimentoAmministrazione',
]

const CODICE_NESSUN_DESTINATARIO = '0000000'
const UNITA_VALIDITA: readonly string[] = ['A', 'S', 'M', 'G']
const CODICI_RINNOVO: readonly string[] = ['S', 'N']

// ---------------------------------------------------------------------------------------------
// Normalizzazione
// ---------------------------------------------------------------------------------------------

function testo(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

function data(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const t = testo(v)
  if (t === null) return null
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t
}

/** `YYYY-MM-DD` di un giorno che esiste (`2026-02-30` no). Unica definizione del dominio. */
export function dataReale(d: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return false
  const [anno, mese, giorno] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(anno, mese - 1, giorno))
  return t.getUTCFullYear() === anno && t.getUTCMonth() === mese - 1 && t.getUTCDate() === giorno
}

/** Accetta anche i `Decimal` di Prisma (oggetti con `toString`). */
function decimale(v: unknown): string | null {
  if (v !== null && typeof v === 'object' && !(v instanceof Date))
    return normalizzaDecimale(String(v))
  return normalizzaDecimale(v)
}

function intero(v: unknown): number | null {
  if (typeof v === 'number') return v
  const t = testo(v)
  return t === null ? null : Number(t)
}

function periodi(v: unknown): PeriodoFatturazione[] {
  if (!Array.isArray(v)) return []
  return ordinaPeriodi(
    v.map((x: PeriodoFatturazione) => ({
      giornoInizio: x.giornoInizio,
      meseInizio: x.meseInizio,
      giornoFine: x.giornoFine,
      meseFine: x.meseFine,
    }))
  )
}

export function normalizzaContratto(
  g: Partial<Record<CampoContrattoCliente, unknown>>
): DatiContrattoCliente {
  // minuscoli: un id UUID uguale a meno delle maiuscole e' lo stesso cliente (M8)
  const clienteId = testo(g.clienteId)?.toLowerCase() ?? ''
  const clienteFatturazioneId = testo(g.clienteFatturazioneId)?.toLowerCase() ?? null
  const sogliaImporto = decimale(g.sogliaImporto)
  const codiceRinnovo = testo(g.codiceRinnovo)?.toUpperCase() ?? null
  const unita = testo(g.validitaUnita)?.toUpperCase() ?? null
  const esigibilita = testo(g.esigibilitaIva)?.toUpperCase() ?? 'IMMEDIATA'
  return {
    numero: testo(g.numero) ?? '',
    descrizione: testo(g.descrizione) ?? '',
    clienteId,
    // E5: il cliente di fatturazione uguale al cliente non e' un errore, e' "nessuno"
    clienteFatturazioneId: clienteFatturazioneId === clienteId ? null : clienteFatturazioneId,
    sedeId: testo(g.sedeId),
    categoriaId: testo(g.categoriaId),
    tipoId: testo(g.tipoId),
    dataInizio: data(g.dataInizio),
    dataFine: data(g.dataFine),
    dataStipula: data(g.dataStipula),
    validitaQuantita: intero(g.validitaQuantita),
    validitaUnita: unita as UnitaValidita | null,
    contrattoPrincipaleId: testo(g.contrattoPrincipaleId),
    condizionePagamentoId: testo(g.condizionePagamentoId),
    contoCorrenteId: testo(g.contoCorrenteId),
    speseIncassoId: testo(g.speseIncassoId),
    bolloId: testo(g.bolloId),
    registroIvaId: testo(g.registroIvaId),
    esigibilitaIva: esigibilita as EsigibilitaIva,
    ritenutaPercentuale: decimale(g.ritenutaPercentuale),
    agenteId: testo(g.agenteId),
    testoFatturazioneId: testo(g.testoFatturazioneId),
    codiceDestinatario: testo(g.codiceDestinatario)?.toUpperCase() ?? null,
    riferimentoAmministrazione: testo(g.riferimentoAmministrazione),
    codiceCig: testo(g.codiceCig)?.toUpperCase() ?? null,
    codiceCup: testo(g.codiceCup)?.toUpperCase() ?? null,
    idDocumentoPa: testo(g.idDocumentoPa),
    escludiDichiarazioneIntento: g.escludiDichiarazioneIntento === true,
    sogliaDal: data(g.sogliaDal),
    sogliaImporto,
    sogliaIvaEsclusa: g.sogliaIvaEsclusa === true && sogliaImporto !== null,
    // S spunta, N toglie (Contratti.cs:5423-5433); senza codice vale il campo
    rinnovoAutomatico:
      codiceRinnovo === 'S' ? true : codiceRinnovo === 'N' ? false : g.rinnovoAutomatico === true,
    codiceRinnovo: codiceRinnovo as CodiceRinnovo | null,
    incrementoIstat: g.incrementoIstat === true,
    commessa: testo(g.commessa),
    annotazioni: Array.isArray(g.annotazioni)
      ? g.annotazioni.map(a => testo(a)).filter((a): a is string => a !== null)
      : [],
    periodi: periodi(g.periodi),
  }
}

// ---------------------------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------------------------

/**
 * CIG, CUP e riferimento del documento della PA: unica definizione, usata dal contratto cliente e
 * dall'elenco degli addebiti (R33, R58). I valori sono gia' normalizzati (maiuscolo, vuoto = null).
 */
export function validaRiferimentiPa(d: {
  codiceCig: string | null
  codiceCup: string | null
  idDocumentoPa: string | null
}): string[] {
  const m: string[] = []
  if (d.codiceCig !== null && !/^[A-Z0-9]{10}$/.test(d.codiceCig)) {
    m.push('Il CIG deve avere 10 caratteri alfanumerici.')
  }
  if (d.codiceCup !== null && !/^[A-Z0-9]{15}$/.test(d.codiceCup)) {
    m.push('Il CUP deve avere 15 caratteri alfanumerici.')
  }
  if (d.idDocumentoPa !== null && d.idDocumentoPa.length > 20) {
    m.push('Il documento della PA non può superare 20 caratteri.')
  } else if (d.idDocumentoPa === null && (d.codiceCig !== null || d.codiceCup !== null)) {
    m.push(
      'Con CIG o CUP indica anche il riferimento del documento della PA (contratto, convenzione o ordine).'
    )
  }
  return m
}

/**
 * Messaggi nell'ordine dei campi (D9, D27, D28); elenco vuoto = dati validi. `contesto.id` e' l'id
 * del contratto che si sta modificando (assente alla creazione).
 */
export function validaContrattoCliente(
  d: DatiContrattoCliente,
  contesto: { id?: string | null } = {}
): string[] {
  const m: string[] = []

  if (d.numero === '') m.push(MESSAGGI_OBBLIGATORIO.numero as string)
  else if (d.numero.length > 50) m.push('Il numero non può superare 50 caratteri.')

  if (d.descrizione === '') m.push('Inserisci una descrizione per questo contratto.')
  else if (d.descrizione.length > 255) m.push('La descrizione non può superare 255 caratteri.')

  if (d.clienteId === '') m.push(MESSAGGI_OBBLIGATORIO.clienteId as string)

  const dataNonValida = (campo: CampoContrattoCliente) =>
    m.push(`${ETICHETTE_CAMPI[campo]}: data non valida.`)

  if (d.dataInizio === null) m.push(MESSAGGI_OBBLIGATORIO.dataInizio as string)
  else if (!dataReale(d.dataInizio)) dataNonValida('dataInizio')

  if (d.dataFine !== null) {
    if (!dataReale(d.dataFine)) dataNonValida('dataFine')
    else if (d.dataInizio !== null && dataReale(d.dataInizio) && d.dataFine < d.dataInizio) {
      m.push('La data di fine non può precedere la data di inizio.')
    }
  }
  if (d.dataStipula !== null && !dataReale(d.dataStipula)) dataNonValida('dataStipula')

  if ((d.validitaQuantita === null) !== (d.validitaUnita === null)) {
    m.push("Indica sia la durata sia l'unità della validità.")
  } else if (d.validitaQuantita !== null && d.validitaUnita !== null) {
    if (
      !Number.isInteger(d.validitaQuantita) ||
      d.validitaQuantita < 1 ||
      d.validitaQuantita > 999
    ) {
      m.push('La durata della validità va da 1 a 999.')
    }
    if (!UNITA_VALIDITA.includes(d.validitaUnita)) m.push("L'unità della validità non è ammessa.")
  }

  if (
    d.contrattoPrincipaleId !== null &&
    contesto.id !== undefined &&
    contesto.id !== null &&
    d.contrattoPrincipaleId === contesto.id
  ) {
    m.push('Un contratto non può essere allegato a sé stesso.')
  }

  if (!ESIGIBILITA_IVA.includes(d.esigibilitaIva)) {
    m.push("L'esigibilità IVA scelta non è ammessa.")
  }

  const mRitenuta = validaRitenuta(d.ritenutaPercentuale)
  if (mRitenuta) m.push(mRitenuta)

  const mCodice = validaCodiceDestinatario(d.codiceDestinatario)
  if (mCodice) m.push(mCodice)

  const mRiferimento = validaRiferimentoAmministrazione(
    d.riferimentoAmministrazione,
    d.codiceDestinatario
  )
  if (mRiferimento) m.push(mRiferimento)

  m.push(...validaRiferimentiPa(d))

  if (d.sogliaDal !== null) {
    if (!dataReale(d.sogliaDal)) dataNonValida('sogliaDal')
    else if (d.sogliaImporto === null) {
      m.push('La data di inizio controllo soglia richiede la soglia massima.')
    }
  }
  if (
    d.sogliaImporto !== null &&
    !(decimaleValido(d.sogliaImporto, 10) && confrontaDecimali(d.sogliaImporto, '0') > 0)
  ) {
    m.push('La soglia massima deve essere un importo positivo con al massimo due decimali.')
  }

  if (d.rinnovoAutomatico && d.dataFine === null) {
    m.push('Il rinnovo automatico richiede una data di fine.')
  }
  if (d.codiceRinnovo !== null && !CODICI_RINNOVO.includes(d.codiceRinnovo)) {
    m.push('Il codice di rinnovo non è ammesso.')
  }

  if (d.commessa !== null && !/^[A-Za-z0-9._/-]{1,12}$/.test(d.commessa)) {
    m.push(
      'La commessa può contenere al massimo 12 caratteri fra lettere, cifre, punto, barra, trattino e trattino basso.'
    )
  }

  if (d.annotazioni.length > 3 || d.annotazioni.some(a => a.length > 45)) {
    m.push('Al massimo 3 annotazioni di 45 caratteri ciascuna.')
  }

  m.push(...validaPeriodi(d.periodi))
  return m
}

// ---------------------------------------------------------------------------------------------
// Stati
// ---------------------------------------------------------------------------------------------

export function motivoNonModificabile(stato: StatoContrattoCliente): string | null {
  return stato === 'ANNULLATO' ? 'Un contratto annullato non si modifica.' : null
}

export function motivoNonEliminabile(stato: StatoContrattoCliente): string | null {
  return stato === 'BOZZA'
    ? null
    : 'Si eliminano solo i contratti in bozza: per chiudere questo contratto annullalo.'
}

/** Messaggio se la transizione non e' ammessa o mancano dati; `null` = ammessa (D8). */
export function verificaTransizione(
  da: StatoContrattoCliente,
  a: StatoContrattoCliente,
  d: {
    condizionePagamentoId: string | null
    registroIvaId: string | null
    motivo?: string | null
    motivoAnnulloId?: string | null
  }
): string | null {
  if (!TRANSIZIONI[da].includes(a)) {
    return `Dallo stato ${ETICHETTE_STATO[da]} non si passa a ${ETICHETTE_STATO[a]}.`
  }
  if (da === 'BOZZA' && a === 'ATTIVO') {
    if (d.condizionePagamentoId === null) {
      return 'Per attivare il contratto indica la condizione di pagamento.'
    }
    if (d.registroIvaId === null) return 'Per attivare il contratto indica il registro IVA.'
  }
  if (a === 'ANNULLATO') {
    const haMotivo = (d.motivo ?? '').trim() !== ''
    const haCodice = (d.motivoAnnulloId ?? '').trim() !== ''
    if (!haMotivo && !haCodice) return "Indica il motivo dell'annullo."
  }
  return null
}

/** Rinnovo (D11): contratti attivi o sospesi con una data di fine. */
export function rinnovabile(stato: StatoContrattoCliente, dataFine: string | null): boolean {
  return (
    dataFine !== null &&
    (stato === 'ATTIVO' || stato === 'SOSPESO' || stato === 'SOSPESO_MOVIMENTI')
  )
}

/** Un anno dopo; il 29/02 diventa 28/02 (2024-02-29 -> 2025-02-28). */
export function dataPiuUnAnno(data: string): string {
  const anno = Number(data.slice(0, 4)) + 1
  const resto = data.slice(4)
  return `${String(anno).padStart(4, '0')}${resto === '-02-29' ? '-02-28' : resto}`
}

/** Scaduto = data di fine anteriore a oggi (entrambe `YYYY-MM-DD`). */
export function scaduto(dataFine: string | null, oggi: string): boolean {
  return dataFine !== null && dataFine < oggi
}

// ---------------------------------------------------------------------------------------------
// Valori effettivi (D4)
// ---------------------------------------------------------------------------------------------

export function destinatarioEffettivo(
  contratto: { codiceDestinatario: string | null; riferimentoAmministrazione: string | null },
  clienteFatturazione: {
    codiceDestinatario: string | null
    riferimentoAmministrazione: string | null
  }
): { codiceDestinatario: string; riferimentoAmministrazione: string | null } {
  // `0000000` vuol dire "nessun codice" (R35): come l'assenza, ripiega sul cliente di fatturazione
  if (
    contratto.codiceDestinatario !== null &&
    contratto.codiceDestinatario !== CODICE_NESSUN_DESTINATARIO
  ) {
    return {
      codiceDestinatario: contratto.codiceDestinatario,
      riferimentoAmministrazione: contratto.riferimentoAmministrazione,
    }
  }
  return {
    codiceDestinatario: clienteFatturazione.codiceDestinatario ?? CODICE_NESSUN_DESTINATARIO,
    riferimentoAmministrazione: clienteFatturazione.riferimentoAmministrazione,
  }
}

export function contoCorrenteEffettivo(
  contratto: { contoCorrenteId: string | null },
  cliente: { contoCorrenteId: string | null }
): string | null {
  return contratto.contoCorrenteId ?? cliente.contoCorrenteId
}

// ---------------------------------------------------------------------------------------------
// Modifica parziale (D9)
// ---------------------------------------------------------------------------------------------

function uguali(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => uguali(v, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>
    const y = b as Record<string, unknown>
    const chiavi = Object.keys(x)
    return chiavi.length === Object.keys(y).length && chiavi.every(k => uguali(x[k], y[k]))
  }
  return a === b
}

export type PianoModifica =
  | { esito: 'NESSUNA_MODIFICA' }
  | { esito: 'CAMPI_NON_AMMESSI'; campi: CampoContrattoCliente[]; messaggio: string }
  | { esito: 'NON_VALIDA'; messaggi: string[] }
  | { esito: 'OK'; dopo: DatiContrattoCliente; cambiati: CampoContrattoCliente[] }

export function pianificaModifica(
  stato: StatoContrattoCliente,
  attuale: DatiContrattoCliente,
  modifica: ModificaContrattoCliente,
  contesto: { id: string }
): PianoModifica {
  const prima = normalizzaContratto(attuale)
  const unione: Record<string, unknown> = { ...prima }
  const obbligatori: string[] = []

  for (const campo of ORDINE_CAMPI) {
    if (!(campo in modifica) || modifica[campo] === undefined) continue
    const v = modifica[campo]
    if (v === null) {
      if (CAMPI_FACOLTATIVI.includes(campo)) {
        unione[campo] = campo === 'annotazioni' || campo === 'periodi' ? [] : null
      } else {
        obbligatori.push(MESSAGGI_OBBLIGATORIO[campo] as string)
      }
      continue
    }
    unione[campo] = v
  }
  if (obbligatori.length > 0) return { esito: 'NON_VALIDA', messaggi: obbligatori }

  // rinnovo automatico cambiato da solo: il codice di rinnovo, se c'e', lo segue (altrimenti la
  // normalizzazione lo riporterebbe al valore vecchio); se arrivano entrambi vince il codice
  if (
    modifica.rinnovoAutomatico !== undefined &&
    modifica.rinnovoAutomatico !== null &&
    modifica.codiceRinnovo === undefined &&
    prima.codiceRinnovo !== null
  ) {
    unione.codiceRinnovo = modifica.rinnovoAutomatico ? 'S' : 'N'
  }

  const dopo = normalizzaContratto(unione as Partial<Record<CampoContrattoCliente, unknown>>)
  const cambiati = ORDINE_CAMPI.filter(c => !uguali(prima[c], dopo[c]))
  if (cambiati.length === 0) return { esito: 'NESSUNA_MODIFICA' }

  const ammessi = CAMPI_MODIFICABILI[stato]
  const nonAmmessi = cambiati.filter(c => !ammessi.includes(c))
  if (nonAmmessi.length > 0) {
    return {
      esito: 'CAMPI_NON_AMMESSI',
      campi: nonAmmessi,
      messaggio:
        ammessi.length === 0
          ? (motivoNonModificabile(stato) ?? 'Il contratto non si modifica.')
          : `In un contratto attivo o sospeso non si possono cambiare: ${nonAmmessi
              .map(c => ETICHETTE_CAMPI[c])
              .join(', ')}.`,
    }
  }

  const messaggi = validaContrattoCliente(dopo, contesto)
  if (messaggi.length > 0) return { esito: 'NON_VALIDA', messaggi }
  return { esito: 'OK', dopo, cambiati }
}
