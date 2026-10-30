import { formattaQuantita } from '../../../core/format/formatta-quantita'
import { formattaDataItaliana } from '../../../core/time/anno-italiano'
import { cerCanonico } from '../../../domain/waste-movement/cer-registro'
import { convertiInKg } from '../../../domain/waste-movement/unita-misura-registro'
import { STATO_FISICO_PREDEFINITO } from '../export/versions/mud-tracciato-v604-base'
import type { StatoFisicoRegistro } from './mud-regole'
import {
  chiaveDestinatario,
  chiaveGiacenza,
  chiaveMovimento,
  chiavePesoSpecifico,
} from './mud-integrazioni'

// Catalogo dei controlli del MUD: il testo dei messaggi è quello concordato, i test lo
// confrontano carattere per carattere. BLOCCANTE = dato correggibile dall'utente nell'applicazione;
// AVVISO = anomalia da confermare.

export type MudGravita = 'BLOCCANTE' | 'AVVISO'

export type MudCodiceControllo =
  | 'NESSUN_MOVIMENTO'
  | 'NESSUN_RIFIUTO_DICHIARABILE'
  | 'REGISTRO_VUOTO_CON_FIR'
  | 'DICHIARANTE_SENZA_COMUNE_ISTAT'
  | 'DICHIARANTE_SENZA_ATECO'
  | 'DICHIARANTE_ATECO_NON_VALIDO'
  | 'DESTINATARIO_SENZA_CF'
  | 'DESTINATARIO_ESTERO'
  | 'TRASPORTATORE_SENZA_CF'
  | 'UNITA_NON_DI_MASSA'
  | 'PROFILO_NON_SUPPORTATO'
  | 'PIU_UNITA_LOCALI'
  | 'CONVERTITO_CON_PESO_SPECIFICO'
  | 'UNITA_VUOTA_COME_KG'
  | 'CAUSALE_ESCLUSA'
  | 'FIR_ANNULLATO'
  | 'FIR_IN_BOZZA'
  | 'FIR_NON_TROVATO'
  | 'FIR_SCARICATO_PIU_VOLTE'
  | 'FIR_DOPPIO_IDENTICO'
  | 'FIR_DOPPIO_ANNO_PRECEDENTE'
  | 'FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE'
  | 'SCARICO_SENZA_FIR'
  | 'DESTINATARIO_NON_INDICATO'
  | 'TRASPORTATORE_NON_INDICATO'
  | 'DESTINATARIO_SENZA_ISTAT'
  | 'OPERAZIONE_DEDOTTA_DAL_FIR'
  | 'OPERAZIONE_NON_INDICATA'
  | 'FIR_NON_REGISTRATO'
  | 'ESITO_FIR_RESPINTO'
  | 'GIACENZE_NON_CALCOLATE'
  | 'GIACENZE_NON_DICHIARATE'
  | 'GIACENZA_RIPARTITA'
  | 'GIACENZA_DESTINAZIONE_NON_INDICATA'
  | 'STATO_FISICO_NON_UNIVOCO'
  | 'MUD_NON_DOVUTO'
  | 'MOVIMENTI_SENZA_SEDE'
  | 'SEDE_PRINCIPALE_MANCANTE'
  | 'UNITA_LOCALE_SENZA_INDIRIZZO'
  | 'UNITA_LOCALE_SENZA_COMUNE_ISTAT'
  | 'PRINCIPALE_CON_INDIRIZZO_AZIENDA'
  | 'UNITA_LOCALE_SENZA_ADDETTI'
  | 'UNITA_LOCALI_PROVINCE_DIVERSE'
  | 'AUTORIZZAZIONI_SULLA_PRINCIPALE'
  | 'SOSTITUTIVA_PIU_DICHIARAZIONI'

export type IntegrazioneRichiesta =
  | { tipo: 'CF_DESTINATARIO'; chiave: string; ragioneSociale: string }
  | { tipo: 'PESO_SPECIFICO'; chiave: string; cerCode: string; unita: string }
  | {
      tipo: 'DESTINATARIO_MOVIMENTO'
      chiave: string
      numero: number
      anno: number
      registroId: string
    }
  | { tipo: 'CF_TRASPORTATORE'; chiave: string; ragioneSociale: string }
  | {
      tipo: 'DESTINAZIONE_GIACENZA'
      chiave: string
      /** 6 cifre */
      cerCode: string
      unitaLocaleId: string | null
      sede: string
    }

export interface MudMovimentoSegnalato {
  numero: number
  anno: number
  registroId: string
  cerCode: string
  quantita: number
  unita: string
  kg: number | null
  incluso: boolean
}

export interface MudEsitoControllo {
  codice: MudCodiceControllo
  gravita: MudGravita
  messaggio: string
  movimenti?: MudMovimentoSegnalato[]
  fir?: string[]
  integrazione?: IntegrazioneRichiesta
  /** GIACENZE_NON_CALCOLATE e GIACENZE_NON_DICHIARATE: kg in deposito al 31/12 non dichiarati */
  kgNonDichiarati?: number
  /**
   * Denominazione della sede (o "Azienda") a cui si riferisce il controllo: solo con più di una
   * dichiarazione e solo per i controlli nati dentro una dichiarazione (D14)
   */
  sede?: string
}

/** Etichetta della riga d'integrazione della destinazione di una giacenza (D16). */
export const etichettaGiacenza = (cer6: string): string => `Giacenza CER ${cer6}`

/**
 * CER di un gruppo di movimenti come lo legge l'utente: forma canonica "NN NN NN", con
 * l'asterisco se almeno un movimento del gruppo lo porta (pericoloso). Le cifre restano solo
 * nella chiave d'integrazione e nell'etichetta della riga da compilare.
 */
function cerDaMostrare(cerCode6: string, ms: RifMovimento[]): string {
  return cerCanonico(ms.some(m => (m.cerCode ?? '').includes('*')) ? `${cerCode6}*` : cerCode6)
}

export interface RifMovimento {
  registroId: string
  /** Sede del registro: solo se l'azienda ha più registri (il numero da solo sarebbe ambiguo) */
  registro?: string
  progressiveNumber: number
  progressiveYear: number
  cerCode: string
  causale: string
  /** Descrizione della causale del catalogo, solo se diversa dal codice (D13) */
  causaleDescrizione?: string
  quantity: number
  unit: string
  movementDate?: Date
}

export interface RifUnitaLocale {
  denominazione: string
  numIscrSito: string
  principale: boolean
}

const q = formattaQuantita

const ETICHETTA_STATO_FISICO: Record<StatoFisicoRegistro, string> = {
  NON_RICONOSCIUTO: 'non riconosciuto',
  SOLIDO_POLVERULENTO: 'solido polverulento',
  SOLIDO_NON_POLVERULENTO: 'solido non polverulento',
  FANGOSO_PALABILE: 'fangoso palabile',
  LIQUIDO: 'liquido',
  AERIFORME: 'aeriforme',
  VISCHIOSO_SCIROPPOSO: 'vischioso sciropposo',
  ALTRO: 'altro',
}

function segnala(m: RifMovimento, incluso: boolean, kg?: number | null): MudMovimentoSegnalato {
  return {
    numero: m.progressiveNumber,
    anno: m.progressiveYear,
    registroId: m.registroId,
    cerCode: m.cerCode,
    quantita: m.quantity,
    unita: m.unit || 'kg',
    kg: kg !== undefined ? kg : convertiInKg(m.quantity, m.unit),
    incluso,
  }
}

const rif = (m: RifMovimento) =>
  `${m.progressiveNumber}/${m.progressiveYear}${m.registro ? ` (${m.registro})` : ''}`
const unitaDi = (m: RifMovimento) => m.unit || 'kg'
const elenco = (ms: RifMovimento[]) => ms.map(rif).join(', ')
const rifConData = (m: RifMovimento) =>
  m.movementDate ? `${rif(m)} del ${formattaDataItaliana(m.movementDate)}` : rif(m)
const sommaQuantita = (ms: RifMovimento[]) => ms.reduce((s, m) => s + m.quantity, 0)
const arrotondaGrammo = (n: number) => Math.round(n * 1000) / 1000

const BLOCCANTE = 'BLOCCANTE' as const
const AVVISO = 'AVVISO' as const

/** Giacenza con la destinazione stimata (D9): CER canonico per il testo, 6 cifre per la chiave. */
interface GiacenzaStimata {
  cerCode: string
  cer6: string
  unitaLocaleId: string | null
  /** denominazione della sede, "Azienda" se non c'è */
  sede: string
  kg: number
}

interface DatiRipartizione {
  recuperoKg: number
  smaltimentoKg: number
}

const integrazioneGiacenza = (g: GiacenzaStimata): IntegrazioneRichiesta => ({
  tipo: 'DESTINAZIONE_GIACENZA',
  chiave: chiaveGiacenza(g.unitaLocaleId, g.cer6),
  cerCode: g.cer6,
  unitaLocaleId: g.unitaLocaleId,
  sede: g.sede,
})

const nomeSede = (u: { denominazione: string; numIscrSito?: string | null }) =>
  u.numIscrSito ? `${u.denominazione} (${u.numIscrSito})` : u.denominazione

// Un solo campo mancante: articolo, aggettivo e pronome concordano con il genere del campo.
const CAMPO_SINGOLARE: Record<string, { articolo: string; agg: string; pron: string }> = {
  indirizzo: { articolo: "l'indirizzo", agg: 'obbligatorio', pron: 'Inserirlo' },
  CAP: { articolo: 'il CAP', agg: 'obbligatorio', pron: 'Inserirlo' },
  comune: { articolo: 'il comune', agg: 'obbligatorio', pron: 'Inserirlo' },
  provincia: { articolo: 'la provincia', agg: 'obbligatoria', pron: 'Inserirla' },
}

const DOVE_CORREGGERE_AZIENDA =
  "(Amministrazione > Aziende; se la voce non è visibile, chiederlo all'amministratore della piattaforma)"

export const controlliMud = {
  nessunMovimento: (anno: number): MudEsitoControllo => ({
    codice: 'NESSUN_MOVIMENTO',
    gravita: BLOCCANTE,
    messaggio: `Nessun movimento nel registro di carico e scarico del ${anno}: non c'è nulla da dichiarare.`,
  }),

  /**
   * Movimenti nell'anno, ma tutti esclusi (causali escluse, FIR annullati, carichi da terzi,
   * unità senza peso): senza questo il file uscirebbe con AA e AB e senza sezione rifiuti.
   */
  nessunRifiutoDichiarabile: (anno: number, movimenti: number): MudEsitoControllo => ({
    codice: 'NESSUN_RIFIUTO_DICHIARABILE',
    gravita: BLOCCANTE,
    messaggio:
      movimenti === 1
        ? `Nel ${anno} il registro ha 1 movimento, ma non entra nel MUD (il motivo è negli avvisi): il file non dichiarerebbe alcun rifiuto.`
        : `Nel ${anno} il registro ha ${movimenti} movimenti, ma nessuno entra nel MUD (i motivi sono negli avvisi): il file non dichiarerebbe alcun rifiuto.`,
  }),

  registroVuotoConFir: (anno: number, fir: string[]): MudEsitoControllo => ({
    codice: 'REGISTRO_VUOTO_CON_FIR',
    gravita: BLOCCANTE,
    messaggio: `Il registro di carico e scarico del ${anno} non ha movimenti, ma risultano ${fir.length} FIR emessi con trasporto nel ${anno}: il MUD si compila dal registro. Registrare i movimenti prima di generare il file.`,
    fir,
  }),

  dichiaranteSenzaComuneIstat: (
    city?: string | null,
    province?: string | null
  ): MudEsitoControllo => ({
    codice: 'DICHIARANTE_SENZA_COMUNE_ISTAT',
    gravita: BLOCCANTE,
    messaggio: `Comune della sede dell'azienda non trovato nelle tabelle ISTAT (${city ?? '-'} ${province ?? '-'}): correggerlo nell'anagrafica dell'azienda ${DOVE_CORREGGERE_AZIENDA}.`,
  }),

  dichiaranteSenzaAteco: (): MudEsitoControllo => ({
    codice: 'DICHIARANTE_SENZA_ATECO',
    gravita: BLOCCANTE,
    messaggio: `Codice ATECO dell'azienda mancante: è obbligatorio nella scheda anagrafica del MUD. Inserirlo nell'anagrafica dell'azienda ${DOVE_CORREGGERE_AZIENDA}.`,
  }),

  dichiaranteAtecoNonValido: (valore: string): MudEsitoControllo => ({
    codice: 'DICHIARANTE_ATECO_NON_VALIDO',
    gravita: BLOCCANTE,
    messaggio: `Codice ATECO dell'azienda non valido ("${valore}"): nel MUD servono 6 cifre, senza punti (per esempio 381100). Correggerlo nell'anagrafica dell'azienda ${DOVE_CORREGGERE_AZIENDA}.`,
  }),

  destinatarioSenzaCf: (
    ragioneSociale: string,
    origine: string,
    anno: number
  ): MudEsitoControllo => ({
    codice: 'DESTINATARIO_SENZA_CF',
    gravita: BLOCCANTE,
    messaggio: `Destinatario "${ragioneSociale}" (${origine}): manca il codice fiscale o la partita IVA, obbligatori nel modulo DR. Inserirlo in MUD > Integrazioni ${anno}, riga "${ragioneSociale}".`,
    integrazione: {
      tipo: 'CF_DESTINATARIO',
      chiave: chiaveDestinatario(ragioneSociale),
      ragioneSociale,
    },
  }),

  unitaNonDiMassa: (
    anno: number,
    cerCode6: string,
    unita: string,
    ms: RifMovimento[]
  ): MudEsitoControllo => ({
    codice: 'UNITA_NON_DI_MASSA',
    gravita: BLOCCANTE,
    messaggio: `Il rifiuto CER ${cerDaMostrare(cerCode6, ms)} ha ${ms.length} movimenti in "${unita}" per ${q(sommaQuantita(ms))} ${unita} (n. ${elenco(ms)}): il MUD accetta solo kg o tonnellate, e senza conversione questo rifiuto mancherebbe dal file. Inserire il peso specifico (kg per ${unita}) in MUD > Integrazioni ${anno}, riga "CER ${cerCode6} – ${unita}".`,
    movimenti: ms.map(m => segnala(m, false)),
    integrazione: {
      tipo: 'PESO_SPECIFICO',
      chiave: chiavePesoSpecifico(cerCode6, unita),
      cerCode: cerCode6,
      unita,
    },
  }),

  profiloNonSupportato: (anno: number, ms: RifMovimento[]): MudEsitoControllo => ({
    codice: 'PROFILO_NON_SUPPORTATO',
    gravita: AVVISO,
    messaggio: `Nel ${anno} il registro contiene ${ms.length} carichi di rifiuti ricevuti da terzi (n. ${elenco(ms)}): non sono nel file, perché i moduli RT e MG che un impianto o un intermediario deve compilare non sono ancora supportati. Se l'azienda gestisce rifiuti di terzi, la dichiarazione è incompleta per quella parte; se sono causali sbagliate, il file è corretto.`,
    movimenti: ms.map(m => segnala(m, false)),
  }),

  piuUnitaLocali: (unita: RifUnitaLocale[]): MudEsitoControllo => {
    const nome = (u: RifUnitaLocale) => `${u.denominazione} (${u.numIscrSito})`
    const principale = unita.find(u => u.principale) ?? unita[0]
    return {
      codice: 'PIU_UNITA_LOCALI',
      gravita: AVVISO,
      messaggio: `L'azienda ha ${unita.length} unità locali attive (${unita.map(nome).join(', ')}): il file attribuisce all'unità locale ${nome(principale)} i movimenti di tutti i registri. Non presentare anche dichiarazioni separate per le altre sedi con le stesse quantità: risulterebbero dichiarate due volte. La ripartizione per sede non è ancora supportata.`,
    }
  },

  /**
   * File che sostituisce una dichiarazione presentata ma con unità locali diverse da quelle
   * presentate (G2): sostitutive sono solo quelle già presentate, le altre sono nuove.
   */
  sostitutivaPiuDichiarazioni: (sostituiti: readonly number[]): MudEsitoControllo => ({
    codice: 'SOSTITUTIVA_PIU_DICHIARAZIONI',
    gravita: AVVISO,
    messaggio: `Il file sostituisce una dichiarazione presentata in precedenza ma le unità locali non coincidono: risultano sostitutive solo quelle già presentate (${sostituiti.join(', ')}), le altre sono nuove dichiarazioni. Prima dell'invio verificare il file con l'applicazione ufficiale del MUD.`,
  }),

  convertitoConPesoSpecifico: (
    cerCode6: string,
    unita: string,
    kgPerUnita: number,
    ms: RifMovimento[],
    fuoriIntervallo: boolean
  ): MudEsitoControllo => {
    const movimenti = ms.map(m => segnala(m, true, arrotondaGrammo(m.quantity * kgPerUnita)))
    const kg = arrotondaGrammo(movimenti.reduce((s, m) => s + (m.kg ?? 0), 0))
    return {
      codice: 'CONVERTITO_CON_PESO_SPECIFICO',
      gravita: AVVISO,
      messaggio:
        `Il rifiuto CER ${cerDaMostrare(cerCode6, ms)}: ${q(sommaQuantita(ms))} ${unita} convertiti in ${q(kg)} kg con il peso specifico delle integrazioni (${q(kgPerUnita)} kg per ${unita}). È una stima: verificarla.` +
        (fuoriIntervallo
          ? " Il peso specifico è fuori dall'intervallo consueto per questa unità ed è stato confermato a mano."
          : ''),
      movimenti,
    }
  },

  unitaVuotaComeKg: (m: RifMovimento): MudEsitoControllo => ({
    codice: 'UNITA_VUOTA_COME_KG',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}): unità di misura non indicata, considerata kg (${q(m.quantity)} kg).`,
    movimenti: [segnala(m, true)],
  }),

  causaleEsclusa: (m: RifMovimento): MudEsitoControllo => ({
    codice: 'CAUSALE_ESCLUSA',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}, causale ${m.causaleDescrizione ? `"${m.causaleDescrizione}"` : m.causale}, ${q(m.quantity)} ${unitaDi(m)}): escluso dal MUD, la causale non corrisponde né a una produzione né a un conferimento.`,
    movimenti: [segnala(m, false)],
  }),

  firAnnullato: (m: RifMovimento, fir: string): MudEsitoControllo => ({
    codice: 'FIR_ANNULLATO',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}, ${q(m.quantity)} ${unitaDi(m)}): è collegato al FIR ${fir}, che risulta annullato, ed è escluso dal MUD. Verificare se il conferimento è avvenuto con un altro formulario.`,
    movimenti: [segnala(m, false)],
  }),

  firInBozza: (m: RifMovimento, fir: string): MudEsitoControllo => ({
    codice: 'FIR_IN_BOZZA',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}, ${q(m.quantity)} ${unitaDi(m)}): è collegato al FIR ${fir}, che non risulta emesso (bozza senza numero RENTRI o stato non riconosciuto), ed è escluso dal MUD.`,
    movimenti: [segnala(m, false)],
  }),

  firNonTrovato: (m: RifMovimento): MudEsitoControllo => ({
    codice: 'FIR_NON_TROVATO',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}): il FIR collegato non esiste fra quelli dell'azienda; per il modulo DR si usa il destinatario scritto nel registro.`,
    movimenti: [segnala(m, true)],
  }),

  firScaricatoPiuVolte: (fir: string, ms: RifMovimento[]): MudEsitoControllo => ({
    codice: 'FIR_SCARICATO_PIU_VOLTE',
    gravita: AVVISO,
    messaggio: `Il FIR ${fir} risulta scaricato in ${ms.length} movimenti con dati diversi (n. ${elenco(ms)}): le quantità sono tutte nel MUD. Verificare che non sia lo stesso conferimento registrato due volte.`,
    movimenti: ms.map(m => segnala(m, true)),
  }),

  firDoppioIdentico: (fir: string, ms: RifMovimento[]): MudEsitoControllo => {
    const conDate = ms.map(rifConData).join(', ')
    return {
      codice: 'FIR_DOPPIO_IDENTICO',
      gravita: AVVISO,
      messaggio: `Il FIR ${fir} risulta scaricato in ${ms.length} movimenti con gli stessi dati (n. ${conDate}): nel MUD la quantità è contata una volta sola.`,
      movimenti: ms.map((m, i) => segnala(m, i === 0)),
    }
  },

  // I due avvisi sugli anni precedenti segnalano solo il movimento dell'anno: i kg già
  // dichiarati in un altro MUD non entrano nel riepilogo di questo.
  firDoppioAnnoPrecedente: (
    fir: string,
    precedente: RifMovimento,
    m: RifMovimento
  ): MudEsitoControllo => ({
    codice: 'FIR_DOPPIO_ANNO_PRECEDENTE',
    gravita: AVVISO,
    messaggio: `Il FIR ${fir} risulta già scaricato con gli stessi dati nel movimento n. ${rifConData(precedente)}: il movimento n. ${rifConData(m)} è un doppio ed è escluso da questo MUD.`,
    movimenti: [segnala(m, false)],
  }),

  firScaricatoAncheAnnoPrecedente: (
    fir: string,
    precedenti: RifMovimento[],
    m: RifMovimento
  ): MudEsitoControllo => ({
    codice: 'FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE',
    gravita: AVVISO,
    messaggio: `Il FIR ${fir} risulta scaricato anche in anni precedenti (n. ${elenco(precedenti)}): il movimento n. ${rif(m)} è nel MUD. Verificare che non sia lo stesso conferimento dichiarato due volte.`,
    movimenti: [segnala(m, true)],
  }),

  scaricoSenzaFir: (m: RifMovimento): MudEsitoControllo => ({
    codice: 'SCARICO_SENZA_FIR',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (scarico CER ${m.cerCode}, ${q(m.quantity)} ${unitaDi(m)}): nessun FIR collegato; per il modulo DR si usa il destinatario scritto nel registro, e manca il modulo TE del trasportatore.`,
    movimenti: [segnala(m, true)],
  }),

  // Bloccante (A-W-07, A-C-04): senza DR il BA dichiarerebbe "consegnato a terzi" minore di
  // recupero più smaltimento. Si corregge con il destinatario del movimento nelle integrazioni.
  destinatarioNonIndicato: (m: RifMovimento, anno: number): MudEsitoControllo => ({
    codice: 'DESTINATARIO_NON_INDICATO',
    gravita: BLOCCANTE,
    messaggio: `Movimento n. ${rif(m)} (scarico CER ${m.cerCode}, ${q(m.quantity)} ${unitaDi(m)}): né FIR né destinatario nel registro, e il modulo DR è obbligatorio. Inserire destinatario e codice fiscale in MUD > Integrazioni ${anno}, riga "Movimento n. ${rif(m)}".`,
    movimenti: [segnala(m, true)],
    integrazione: {
      tipo: 'DESTINATARIO_MOVIMENTO',
      chiave: chiaveMovimento(m.progressiveYear, m.progressiveNumber, m.registroId),
      numero: m.progressiveNumber,
      anno: m.progressiveYear,
      registroId: m.registroId,
    },
  }),

  trasportatoreSenzaCf: (ragioneSociale: string, fir: string, anno: number): MudEsitoControllo => ({
    codice: 'TRASPORTATORE_SENZA_CF',
    gravita: BLOCCANTE,
    messaggio: `Trasportatore "${ragioneSociale}" (FIR ${fir}): manca il codice fiscale o la partita IVA, obbligatori nel modulo TE. Inserirlo in MUD > Integrazioni ${anno}, riga "${ragioneSociale}".`,
    integrazione: {
      tipo: 'CF_TRASPORTATORE',
      chiave: chiaveDestinatario(ragioneSociale),
      ragioneSociale,
    },
  }),

  trasportatoreNonIndicato: (m: RifMovimento, fir: string): MudEsitoControllo => ({
    codice: 'TRASPORTATORE_NON_INDICATO',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}): il FIR ${fir} non indica il trasportatore, quindi per questo conferimento manca il modulo TE.`,
    movimenti: [segnala(m, true)],
  }),

  destinatarioSenzaIstat: (ragioneSociale: string): MudEsitoControllo => ({
    codice: 'DESTINATARIO_SENZA_ISTAT',
    gravita: AVVISO,
    messaggio: `Destinatario "${ragioneSociale}": comune non trovato nelle tabelle ISTAT, nel modulo DR il comune risulterà 000 (non dichiarato).`,
  }),

  // Avviso (A-W-05): il DR estero si compila con la nazione, ma il resto dei campi per l'estero
  // (codice del Reg. 1013/2006, quantità per operazione) resta vuoto.
  destinatarioEstero: (ragioneSociale: string, nazione: string): MudEsitoControllo => ({
    codice: 'DESTINATARIO_ESTERO',
    gravita: AVVISO,
    messaggio: `Destinatario "${ragioneSociale}" estero (${nazione}): nel modulo DR si indica la nazione al posto del codice fiscale. Il codice del Reg. 1013/2006 e le quantità per operazione non sono ancora supportati.`,
  }),

  operazioneDedottaDalFir: (m: RifMovimento, fir: string, op: 'R' | 'D'): MudEsitoControllo => ({
    codice: 'OPERAZIONE_DEDOTTA_DAL_FIR',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}): recupero o smaltimento non indicato nel registro, dedotto dal FIR ${fir} (${op === 'R' ? 'recupero' : 'smaltimento'}). Verificarlo: un FIR senza indicazione vale come smaltimento.`,
    movimenti: [segnala(m, true)],
  }),

  operazioneNonIndicata: (m: RifMovimento): MudEsitoControllo => ({
    codice: 'OPERAZIONE_NON_INDICATA',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}): recupero o smaltimento non indicato né nel registro né in un FIR, considerato smaltimento. Verificarlo.`,
    movimenti: [segnala(m, true)],
  }),

  firNonRegistrato: (anno: number, fir: string[]): MudEsitoControllo => ({
    codice: 'FIR_NON_REGISTRATO',
    gravita: AVVISO,
    messaggio: `${fir.length} FIR emessi con trasporto nel ${anno} non risultano scaricati nel registro (${fir.join(', ')}): se il conferimento è avvenuto, il MUD dichiara meno del reale. Registrare gli scarichi mancanti.`,
    fir,
  }),

  esitoFirRespinto: (m: RifMovimento, fir: string): MudEsitoControllo => ({
    codice: 'ESITO_FIR_RESPINTO',
    gravita: AVVISO,
    messaggio: `Movimento n. ${rif(m)} (CER ${m.cerCode}): il FIR ${fir} risulta respinto o accettato solo in parte dal destinatario; nel MUD c'è la quantità del registro. Verificare la quantità effettivamente conferita.`,
    movimenti: [segnala(m, true)],
  }),

  // Chiamata solo con più di uno stato fisico per lo stesso CER (A-W-11). Gli stati si elencano
  // in ordine alfabetico di etichetta, così il testo non dipende dall'ordine dei movimenti.
  // `cerCode`: il codice con l'asterisco se il rifiuto è pericoloso (lo decide il chiamante, che
  // vede i movimenti); qui si mostra solo in forma canonica.
  statoFisicoNonUnivoco: (cerCode: string, stati: StatoFisicoRegistro[]): MudEsitoControllo => {
    const predefinito = ETICHETTA_STATO_FISICO[STATO_FISICO_PREDEFINITO]
    if (stati.length === 1 && stati[0] === 'NON_RICONOSCIUTO') {
      return {
        codice: 'STATO_FISICO_NON_UNIVOCO',
        gravita: AVVISO,
        messaggio: `Il rifiuto CER ${cerCanonico(cerCode)} è registrato con uno stato fisico non riconosciuto: il file indica "${predefinito}". Il registro non si modifica: verificare che lo stato fisico indicato nel file sia corretto; se non lo è, il valore si potrà sistemare solo con una rettifica, che non è ancora supportata (contattare l'assistenza).`,
      }
    }
    return {
      codice: 'STATO_FISICO_NON_UNIVOCO',
      gravita: AVVISO,
      messaggio: `Il rifiuto CER ${cerCanonico(cerCode)} è registrato con stati fisici diversi (${stati
        .map(s => ETICHETTA_STATO_FISICO[s])
        .sort()
        .join(
          ', '
        )}): il file indica "${predefinito}". La divisione in più schede RIF non è ancora supportata.`,
    }
  },

  // A-W-10: informativo, senza movimenti; non cambia le quantità dichiarate.
  mudNonDovuto: (motivo: string): MudEsitoControllo => ({
    codice: 'MUD_NON_DOVUTO',
    gravita: AVVISO,
    messaggio: `L'azienda è segnata come non tenuta alla presentazione del MUD (${motivo}): il file si può generare comunque, ma promemoria e scadenze del MUD sono disattivati.`,
  }),

  // Chiamata solo con almeno un saldo positivo (A-W-06): senza, il file è coerente col registro.
  giacenzeNonCalcolate: (
    anno: number,
    saldi: Array<{ cerCode6: string; kg: number }>
  ): MudEsitoControllo => {
    const totale = arrotondaGrammo(saldi.reduce((s, x) => s + x.kg, 0))
    const elencoCer = saldi.map(x => `CER ${cerCanonico(x.cerCode6)}: ${q(x.kg)} kg`).join('; ')
    return {
      codice: 'GIACENZE_NON_CALCOLATE',
      gravita: AVVISO,
      messaggio: `Secondo il registro, al 31/12/${anno} risultano in deposito ${q(totale)} kg (${elencoCer}) che il file non dichiara: le giacenze di fine anno nel file risultano zero.`,
      kgNonDichiarati: totale,
    }
  },

  // Giacenze al 31/12 per dichiarazione (D8, D9, D16)

  // Chiamata solo con almeno una voce. `cerCode` è già canonico (con l'asterisco se pericoloso).
  giacenzeNonDichiarate: (
    anno: number,
    voci: Array<{ cerCode: string; kg: number; motivo: 'NESSUN_MOVIMENTO' | 'RICEVUTO_DA_TERZI' }>
  ): MudEsitoControllo => {
    const totale = arrotondaGrammo(voci.reduce((s, v) => s + v.kg, 0))
    const elencoVoci = voci
      .map(
        v =>
          `CER ${v.cerCode}: ${q(v.kg)} kg, ${
            v.motivo === 'NESSUN_MOVIMENTO' ? 'nessun movimento nel MUD' : 'ricevuto anche da terzi'
          }`
      )
      .join('; ')
    return {
      codice: 'GIACENZE_NON_DICHIARATE',
      gravita: AVVISO,
      messaggio: `Secondo il registro, al 31/12/${anno} risultano in deposito ${q(totale)} kg che il file non dichiara (${elencoVoci}): un rifiuto senza movimenti nel MUD dell'anno non ha una scheda RIF in cui scrivere la giacenza, e per un rifiuto ricevuto anche da terzi la giacenza non si può attribuire al solo produttore.`,
      kgNonDichiarati: totale,
    }
  },

  giacenzaRipartita: (anno: number, g: GiacenzaStimata & DatiRipartizione): MudEsitoControllo => ({
    codice: 'GIACENZA_RIPARTITA',
    gravita: AVVISO,
    messaggio: `Il rifiuto CER ${g.cerCode} ha ${q(g.kg)} kg in deposito al 31/12/${anno}: nell'anno è stato avviato sia a recupero sia a smaltimento, quindi la giacenza è ripartita in proporzione (${q(g.recuperoKg)} kg a recupero, ${q(g.smaltimentoKg)} kg a smaltimento). Se la destinazione è un'altra, indicarla in MUD > Integrazioni ${anno}, riga "${etichettaGiacenza(g.cer6)}".`,
    integrazione: integrazioneGiacenza(g),
  }),

  giacenzaDestinazioneNonIndicata: (anno: number, g: GiacenzaStimata): MudEsitoControllo => ({
    codice: 'GIACENZA_DESTINAZIONE_NON_INDICATA',
    gravita: AVVISO,
    messaggio: `Il rifiuto CER ${g.cerCode} ha ${q(g.kg)} kg in deposito al 31/12/${anno}, ma nell'anno non è stato avviato né a recupero né a smaltimento: la giacenza è considerata da avviare a smaltimento. Se è destinata a recupero, indicarlo in MUD > Integrazioni ${anno}, riga "${etichettaGiacenza(g.cer6)}".`,
    integrazione: integrazioneGiacenza(g),
  }),

  // Dichiarazioni per unità locale (D2, D5, D6, D7)

  movimentiSenzaSede: (
    anno: number,
    ms: RifMovimento[],
    principale: { denominazione: string; numIscrSito?: string | null }
  ): MudEsitoControllo => ({
    codice: 'MOVIMENTI_SENZA_SEDE',
    gravita: AVVISO,
    messaggio:
      ms.length === 1
        ? `Nel ${anno} il registro senza sede ha 1 movimento nel MUD (n. ${elenco(ms)}): il file lo attribuisce all'unità locale principale ${nomeSede(principale)}. Verificare che sia stato prodotto o gestito in quella sede.`
        : `Nel ${anno} il registro senza sede ha ${ms.length} movimenti nel MUD (n. ${elenco(ms)}): il file li attribuisce all'unità locale principale ${nomeSede(principale)}. Verificare che siano stati prodotti o gestiti in quella sede.`,
    movimenti: ms.map(m => segnala(m, true)),
  }),

  sedePrincipaleMancante: (
    anno: number,
    movimenti: number,
    unitaLocali: number
  ): MudEsitoControllo => ({
    codice: 'SEDE_PRINCIPALE_MANCANTE',
    gravita: BLOCCANTE,
    messaggio: `Nel ${anno} il registro senza sede ha ${movimenti === 1 ? '1 movimento' : `${movimenti} movimenti`}, ma ${
      unitaLocali === 1
        ? "l'unica unità locale dell'azienda non è indicata"
        : `nessuna delle ${unitaLocali} unità locali dell'azienda è indicata`
    } come principale: indicare la sede principale nella pagina delle unità locali RENTRI, così il MUD ${movimenti === 1 ? 'lo attribuisce' : 'li attribuisce'} a quella sede.`,
  }),

  unitaLocaleSenzaIndirizzo: (
    u: { denominazione: string; numIscrSito?: string | null },
    campi: string[]
  ): MudEsitoControllo => {
    const solo = campi.length === 1 ? CAMPO_SINGOLARE[campi[0]] : undefined
    return {
      codice: 'UNITA_LOCALE_SENZA_INDIRIZZO',
      gravita: BLOCCANTE,
      messaggio: solo
        ? `Unità locale ${nomeSede(u)}: manca ${solo.articolo} nell'anagrafica della sede, ${solo.agg} nella scheda anagrafica della sua dichiarazione MUD. ${solo.pron} nella pagina delle unità locali RENTRI.`
        : `Unità locale ${nomeSede(u)}: mancano ${campi.slice(0, -1).join(', ')} e ${campi[campi.length - 1]} nell'anagrafica della sede, obbligatori nella scheda anagrafica della sua dichiarazione MUD. Inserirli nella pagina delle unità locali RENTRI.`,
    }
  },

  unitaLocaleSenzaComuneIstat: (
    u: { denominazione: string; numIscrSito?: string | null },
    comune?: string | null,
    provincia?: string | null
  ): MudEsitoControllo => ({
    codice: 'UNITA_LOCALE_SENZA_COMUNE_ISTAT',
    gravita: BLOCCANTE,
    messaggio: `Comune dell'unità locale ${nomeSede(u)} non trovato nelle tabelle ISTAT (${comune ?? '-'} ${provincia ?? '-'}): correggerlo nella pagina delle unità locali RENTRI.`,
  }),

  principaleConIndirizzoAzienda: (u: {
    denominazione: string
    numIscrSito?: string | null
  }): MudEsitoControllo => ({
    codice: 'PRINCIPALE_CON_INDIRIZZO_AZIENDA',
    gravita: AVVISO,
    messaggio: `L'unità locale principale ${nomeSede(u)} non ha un indirizzo proprio: nella sua dichiarazione MUD compare l'indirizzo dell'azienda. Se la sede è altrove, inserirne l'indirizzo nella pagina delle unità locali RENTRI.`,
  }),

  unitaLocaleSenzaAddetti: (u: {
    denominazione: string
    numIscrSito?: string | null
  }): MudEsitoControllo => ({
    codice: 'UNITA_LOCALE_SENZA_ADDETTI',
    gravita: AVVISO,
    messaggio: `Unità locale ${nomeSede(u)}: il numero di addetti della sede non è indicato e nella sua dichiarazione MUD risulta 0. Inserirlo nella pagina delle unità locali RENTRI.`,
  }),

  /** `voci` ordinate per codice di provincia; `etichetta` = sigla o codice ISTAT (D6) */
  unitaLocaliProvinceDiverse: (
    voci: Array<{ denominazione: string; etichetta: string }>
  ): MudEsitoControllo => ({
    codice: 'UNITA_LOCALI_PROVINCE_DIVERSE',
    gravita: BLOCCANTE,
    messaggio: `Le unità locali da dichiarare sono in province diverse (${voci
      .map(v => `${v.denominazione}: ${v.etichetta}`)
      .join(
        '; '
      )}): un file MUD può contenere solo dichiarazioni della stessa provincia, altrimenti viene rifiutato. La generazione di un file per provincia non è ancora supportata (contattare l'assistenza).`,
  }),

  autorizzazioniSullaPrincipale: (
    dichiarazioni: number,
    autorizzazioni: number,
    scelta: { denominazione: string; numIscrSito?: string | null },
    sceltaPrincipale: boolean
  ): MudEsitoControllo => {
    const motivo = sceltaPrincipale ? '' : " (la principale non ha rifiuti da dichiarare nell'anno)"
    const una = autorizzazioni === 1
    return {
      codice: 'AUTORIZZAZIONI_SULLA_PRINCIPALE',
      gravita: AVVISO,
      messaggio: `Il file contiene ${dichiarazioni} dichiarazioni e l'azienda ha ${
        una ? '1 autorizzazione registrata' : `${autorizzazioni} autorizzazioni registrate`
      }: ${
        una ? "la scheda dell'autorizzazione è" : 'le schede delle autorizzazioni sono'
      } nella dichiarazione dell'unità locale ${nomeSede(scelta)}${motivo}, perché le autorizzazioni non indicano la sede. Verificare che ${
        una ? 'sia' : 'siano'
      } dell'impianto di quella sede.`,
    }
  },
}

export function haBloccanti(c: MudEsitoControllo[]): boolean {
  return c.some(e => e.gravita === BLOCCANTE)
}

/** Codici distinti degli AVVISO, in ordine alfabetico. */
export function codiciAvvisoDaConfermare(c: MudEsitoControllo[]): MudCodiceControllo[] {
  return [...new Set(c.filter(e => e.gravita === AVVISO).map(e => e.codice))].sort()
}

export function avvisiNonConfermati(
  c: MudEsitoControllo[],
  confermati: readonly string[]
): MudCodiceControllo[] {
  return codiciAvvisoDaConfermare(c).filter(codice => !confermati.includes(codice))
}

// Riepilogo quantitativo della conferma (Decisione 19, rilievi G3-C-07 e G3-D-10)

export interface VoceRiepilogoAvvisi {
  codice: MudCodiceControllo
  casi: number
  movimenti: number
  kgEsclusi: number
  kgAggiunti: number
  /** Movimenti esclusi senza kg (unità non di massa): la voce cambia il file anche a 0 kg */
  movimentiNonQuantificati: number
}

export interface RiepilogoAvvisi {
  kgInMeno: number
  kgInPiu: number
  movimentiNonQuantificati: number
  voci: VoceRiepilogoAvvisi[]
  testo: string
  /** Vero se gli avvisi fanno dichiarare quantità diverse dal registro (regola dei 403) */
  cambianoQuantita: boolean
}

/** Avvisi che spostano kg fra recupero e smaltimento senza cambiare il totale. */
export const CODICI_RIPARTIZIONE_RD: readonly MudCodiceControllo[] = [
  'OPERAZIONE_NON_INDICATA',
  'OPERAZIONE_DEDOTTA_DAL_FIR',
]

/**
 * Avvisi sulla destinazione stimata delle giacenze (D9): NON fanno parte di CODICI_RIPARTIZIONE_RD
 * (decisione di Graziano), quindi non cambiano le quantità e la conferma non è riservata agli
 * amministratori; il riepilogo li menziona con una frase dedicata.
 */
const CODICI_GIACENZA_STIMATA: readonly MudCodiceControllo[] = [
  'GIACENZA_RIPARTITA',
  'GIACENZA_DESTINAZIONE_NON_INDICATA',
]

/** Avvisi di giacenza che non cambiano le quantità (non sono una scelta di esclusione, D8). */
const CODICI_GIACENZA_NON_DICHIARATA: readonly MudCodiceControllo[] = [
  'GIACENZE_NON_CALCOLATE',
  'GIACENZE_NON_DICHIARATE',
]

const chiaveSegnalato = (m: MudMovimentoSegnalato) =>
  chiaveMovimento(m.anno, m.numero, m.registroId)

export function riepilogaAvvisi(c: MudEsitoControllo[]): RiepilogoAvvisi {
  const avvisi = c.filter(e => e.gravita === AVVISO)
  const perCodice = new Map<MudCodiceControllo, MudEsitoControllo[]>()
  for (const e of avvisi) perCodice.set(e.codice, [...(perCodice.get(e.codice) ?? []), e])

  const voci: VoceRiepilogoAvvisi[] = []
  for (const [codice, esiti] of perCodice) {
    const movimenti = esiti.flatMap(e => e.movimenti ?? [])
    const kgGiacenze = esiti.reduce((s, e) => s + (e.kgNonDichiarati ?? 0), 0)
    const kgEsclusi =
      movimenti.filter(m => !m.incluso).reduce((s, m) => s + (m.kg ?? 0), 0) + kgGiacenze
    const kgAggiunti =
      codice === 'CONVERTITO_CON_PESO_SPECIFICO'
        ? movimenti.reduce((s, m) => s + (m.kg ?? 0), 0)
        : 0
    voci.push({
      codice,
      casi: esiti.length,
      movimenti: new Set(movimenti.map(chiaveSegnalato)).size,
      kgEsclusi: arrotondaGrammo(kgEsclusi),
      kgAggiunti: arrotondaGrammo(kgAggiunti),
      movimentiNonQuantificati: new Set(
        movimenti.filter(m => !m.incluso && m.kg === null).map(chiaveSegnalato)
      ).size,
    })
  }
  const gruppo = (v: VoceRiepilogoAvvisi) => (v.kgEsclusi > 0 ? 0 : v.kgAggiunti > 0 ? 1 : 2)
  const perCodiceAlfabetico = (a: VoceRiepilogoAvvisi, b: VoceRiepilogoAvvisi) =>
    a.codice < b.codice ? -1 : a.codice > b.codice ? 1 : 0
  voci.sort((a, b) => {
    const ga = gruppo(a)
    const gb = gruppo(b)
    if (ga !== gb) return ga - gb
    if (ga === 0 && a.kgEsclusi !== b.kgEsclusi) return b.kgEsclusi - a.kgEsclusi
    if (ga === 1 && a.kgAggiunti !== b.kgAggiunti) return b.kgAggiunti - a.kgAggiunti
    return perCodiceAlfabetico(a, b)
  })

  // Movimenti esclusi, contati una volta sola anche se compaiono in più avvisi
  const esclusi = new Map<string, MudMovimentoSegnalato>()
  for (const e of avvisi) {
    for (const m of e.movimenti ?? []) if (!m.incluso) esclusi.set(chiaveSegnalato(m), m)
  }
  // Le giacenze non sono movimenti: si sommano senza deduplica
  const kgGiacenzeTotali = avvisi.reduce((s, e) => s + (e.kgNonDichiarati ?? 0), 0)
  const kgInMeno = arrotondaGrammo(
    [...esclusi.values()].reduce((s, m) => s + (m.kg ?? 0), 0) + kgGiacenzeTotali
  )
  const movimentiNonQuantificati = [...esclusi.values()].filter(m => m.kg === null).length
  const kgInPiu = arrotondaGrammo(voci.reduce((s, v) => s + v.kgAggiunti, 0))

  const haRipartizioneRD = avvisi.some(e => CODICI_RIPARTIZIONE_RD.includes(e.codice))
  // Le giacenze non dichiarate restano in kgInMeno e nel testo, ma da sole non cambiano le
  // quantità nel senso della Decisione 19: non sono una scelta di esclusione del dichiarante e
  // non si correggono nell'applicazione, quindi non riservano la conferma agli amministratori
  // (quasi ogni produttore ha rifiuti in deposito a fine anno). Restano da confermare.
  const cambianoQuantita =
    voci.some(
      v =>
        !CODICI_GIACENZA_NON_DICHIARATA.includes(v.codice) && (v.kgEsclusi > 0 || v.kgAggiunti > 0)
    ) ||
    avvisi.some(e => (e.movimenti ?? []).some(m => !m.incluso)) ||
    haRipartizioneRD

  let testo: string
  if (kgInMeno === 0 && kgInPiu === 0) {
    testo = haRipartizioneRD
      ? 'Il file dichiara le stesse quantità del registro, ma per alcuni scarichi il recupero o lo smaltimento non è indicato nel registro: verificare la ripartizione elencata sotto.'
      : 'Il file dichiara le stesse quantità del registro: gli avvisi sono informativi.'
  } else {
    const parti: string[] = []
    if (kgInMeno > 0) parti.push(`${q(kgInMeno)} kg in meno`)
    if (kgInPiu > 0) parti.push(`${q(kgInPiu)} kg in più`)
    testo =
      `Il file dichiara ${parti.join(' e ')} del registro` +
      (kgInPiu > 0 ? ' (conversioni con il peso specifico)' : '') +
      ' per i motivi elencati sotto.'
  }
  if (avvisi.some(e => CODICI_GIACENZA_STIMATA.includes(e.codice))) {
    testo +=
      ' Per alcune giacenze al 31/12 la destinazione (recupero o smaltimento) è stimata: verificarla negli avvisi sotto.'
  }
  if (movimentiNonQuantificati > 0) {
    testo +=
      movimentiNonQuantificati === 1
        ? ' Un altro movimento escluso non è in kg e non è quantificato.'
        : ` Altri ${movimentiNonQuantificati} movimenti esclusi non sono in kg e non sono quantificati.`
  }
  return { kgInMeno, kgInPiu, movimentiNonQuantificati, voci, testo, cambianoQuantita }
}

/** Regola dei 403: solo un amministratore conferma avvisi che cambiano le quantità dichiarate. */
export function avvisiCambianoQuantita(controlli: MudEsitoControllo[]): boolean {
  return riepilogaAvvisi(controlli).cambianoQuantita
}
