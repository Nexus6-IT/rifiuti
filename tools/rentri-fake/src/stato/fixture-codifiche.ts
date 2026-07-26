/**
 * Fixture statiche del servizio `codifiche` (`docs/contracts/rentri/codifiche.yaml`,
 * 25 path, tutti `GET` e tutti in sola lettura). Il contratto non offre
 * alcun meccanismo di aggiornamento incrementale su queste tabelle: la fake
 * le espone come cataloghi fissi, popolati con termini di dominio reali
 * (codici CER/EER, classi ADR, stati fisici del rifiuto...) invece di
 * segnaposto (`foo`/`bar`), perché serviranno da riferimento ai test
 * applicativi dei task successivi di R4.
 *
 * Le tre forme di risposta dichiarate dal contratto (`ByteLookupModel`,
 * `Int16LookupModel`, `Int32LookupModel`, `StringLookupModel`) condividono
 * tutte la stessa forma esterna `{ id, code, name, properties }`: qui non le
 * distinguiamo a runtime, la differenza è solo nel tipo di `id` atteso dal
 * contratto (int32 per Byte/Int16/Int32LookupModel, string per
 * StringLookupModel).
 */
export interface LookupItem {
  id: number | string
  code: string | null
  name: string | null
  properties?: Record<string, unknown> | null
}

/**
 * Codici EER (Int16LookupModel). Include un codice pericoloso (l'asterisco
 * nella denominazione ufficiale segnala la pericolosità, qui esposta anche
 * nella proprietà `pericoloso`) e un codice non pericoloso, più una voce di
 * "capitolo" (terminante in "0000") per esercitare il filtro `escludi00`.
 */
export const codiciEer: LookupItem[] = [
  {
    id: 1,
    code: '130000',
    name: 'Oli esauriti e residui di combustibili liquidi (capitolo)',
    properties: { pericoloso: false, capitolo: true },
  },
  {
    id: 2,
    code: '130208*',
    name: 'Altri oli per motori, ingranaggi e lubrificazione',
    properties: { pericoloso: true, capitolo: false },
  },
  {
    id: 3,
    code: '150101',
    name: 'Imballaggi in carta e cartone',
    properties: { pericoloso: false, capitolo: false },
  },
  {
    id: 4,
    code: '160601*',
    name: 'Batterie al piombo',
    properties: { pericoloso: true, capitolo: false },
  },
  {
    id: 5,
    code: '200301',
    name: 'Rifiuti urbani non differenziati',
    properties: { pericoloso: false, capitolo: false },
  },
]

/** Operazioni di recupero/smaltimento (ByteLookupModel), descrizioni ufficiali (v. AutRecerModel del contratto anagrafiche). */
export const attivitaRs: LookupItem[] = [
  {
    id: 1,
    code: 'R1',
    name: 'Utilizzazione principale come combustibile o come altro mezzo per produrre energia',
  },
  {
    id: 3,
    code: 'R3',
    name: 'Riciclo/recupero delle sostanze organiche non utilizzate come solventi',
  },
  {
    id: 13,
    code: 'R13',
    name: 'Messa in riserva di rifiuti per sottoporli a una delle operazioni indicate nei punti da R1 a R12',
  },
  { id: 21, code: 'D1', name: 'Deposito sul o nel suolo' },
  {
    id: 35,
    code: 'D15',
    name: 'Deposito preliminare prima di una delle operazioni di cui ai punti da D1 a D14',
  },
]

/** Stati fisici del rifiuto (ByteLookupModel), nomenclatura standard dei formulari italiani. */
export const statiFisici: LookupItem[] = [
  { id: 1, code: '1', name: 'Solido pulverulento' },
  { id: 2, code: '2', name: 'Solido non pulverulento' },
  { id: 3, code: '3', name: 'Fangoso palabile' },
  { id: 4, code: '4', name: 'Liquido' },
  { id: 5, code: '5', name: 'Aeriforme' },
]

/** Caratteristiche di pericolo (ByteLookupModel), codici HP del Regolamento UE 1357/2014. */
export const caratteristichePericolo: LookupItem[] = [
  { id: 4, code: 'HP4', name: 'Irritante' },
  { id: 6, code: 'HP6', name: 'Tossicità acuta' },
  { id: 7, code: 'HP7', name: 'Cancerogeno' },
]

/** Classi ADR (ByteLookupModel). */
export const adrClassi: LookupItem[] = [
  { id: 3, code: '3', name: 'Liquidi infiammabili' },
  { id: 8, code: '8', name: 'Sostanze corrosive' },
  { id: 9, code: '9', name: 'Sostanze e oggetti pericolosi diversi' },
]

/** Categorie RAEE (ByteLookupModel), D.Lgs. 49/2014. */
export const categorieRaee: LookupItem[] = [
  { id: 1, code: 'R1', name: 'Frigoriferi e congelatori' },
  { id: 3, code: 'R3', name: 'TV e monitor' },
  { id: 4, code: 'R4', name: 'IT ed elettronica di consumo' },
]

/** Materiali (ByteLookupModel). */
export const materiali: LookupItem[] = [
  { id: 1, code: 'FE', name: 'Ferro e acciaio' },
  { id: 2, code: 'AL', name: 'Alluminio' },
  { id: 3, code: 'PL', name: 'Plastica' },
  { id: 4, code: 'VE', name: 'Vetro' },
  { id: 5, code: 'CA', name: 'Carta e cartone' },
]

/** Provenienza del rifiuto (ByteLookupModel). */
export const provenienza: LookupItem[] = [
  { id: 1, code: 'U', name: 'Urbana' },
  { id: 2, code: 'S', name: 'Speciale' },
]

/** Unità di misura (ByteLookupModel). */
export const unitaMisura: LookupItem[] = [
  { id: 1, code: 'Kg', name: 'Chilogrammi' },
  { id: 2, code: 't', name: 'Tonnellate' },
  { id: 3, code: 'l', name: 'Litri' },
  { id: 4, code: 'mc', name: 'Metri cubi' },
]

/** Attività (StringLookupModel), coincide con l'enum `Attivita` del contratto anagrafiche. */
export const attivita: LookupItem[] = [
  { id: 'CentroRaccolta', code: 'CentroRaccolta', name: 'Centro di raccolta' },
  { id: 'Produzione', code: 'Produzione', name: 'Produzione di rifiuti' },
  { id: 'Recupero', code: 'Recupero', name: 'Recupero di rifiuti' },
  { id: 'Smaltimento', code: 'Smaltimento', name: 'Smaltimento di rifiuti' },
  { id: 'Trasporto', code: 'Trasporto', name: 'Trasporto di rifiuti' },
  {
    id: 'IntermediazioneSenzaDetenzione',
    code: 'IntermediazioneSenzaDetenzione',
    name: 'Intermediazione e commercio di rifiuti senza detenzione',
  },
]

/** Stati del formulario (StringLookupModel), coerente con il ciclo di vita FIR del progetto (BOZZA→EMESSO→IN_TRANSITO→CONSEGNATO). */
export const statiFormulario: LookupItem[] = [
  { id: 'Bozza', code: 'Bozza', name: 'Bozza' },
  { id: 'Emesso', code: 'Emesso', name: 'Emesso' },
  { id: 'InTrasporto', code: 'InTrasporto', name: 'In trasporto' },
  { id: 'Consegnato', code: 'Consegnato', name: 'Consegnato' },
  { id: 'Respinto', code: 'Respinto', name: 'Respinto' },
  { id: 'Annullato', code: 'Annullato', name: 'Annullato' },
]

/** Tipi di accettazione del formulario (ByteLookupModel). */
export const tipiAccettazione: LookupItem[] = [
  { id: 1, code: 'Totale', name: 'Accettazione totale' },
  { id: 2, code: 'Parziale', name: 'Accettazione parziale' },
  { id: 3, code: 'Respinto', name: 'Respinto' },
]

/** Tipi di autorizzazione (ByteLookupModel), enum ufficiale `TipiAutorizzazione` (v. AutRecerModel del contratto anagrafiche). */
export const tipiAutorizzazione: LookupItem[] = [
  {
    id: 1,
    code: 'RecSmalArt208',
    name: 'Autorizzazione unica per i nuovi impianti di recupero/smaltimento - art. 208 D.Lgs. 152/2006',
  },
  {
    id: 4,
    code: 'AIA',
    name: 'Autorizzazione Integrata Ambientale - artt. 29-ter e 213 D.Lgs. 152/2006',
  },
  {
    id: 5,
    code: 'RecProcSemplificata',
    name: 'Operazioni di recupero in procedura semplificata - artt. 214 e 216 D.Lgs. 152/2006',
  },
]

/** Tipi di respingimento (ByteLookupModel). */
export const tipiRespingimento: LookupItem[] = [
  { id: 1, code: 'Totale', name: 'Respingimento totale' },
  { id: 2, code: 'Parziale', name: 'Respingimento parziale' },
]

/** Causali operazione di carico/scarico registro (ByteLookupModel). */
export const causaliOperazione: LookupItem[] = [
  { id: 1, code: 'Produzione', name: 'Produzione di rifiuti' },
  { id: 2, code: 'Trasporto', name: 'Trasporto di rifiuti' },
  { id: 3, code: 'Recupero', name: 'Recupero di rifiuti' },
  { id: 4, code: 'Smaltimento', name: 'Smaltimento di rifiuti' },
]

/** Causali di respingimento (ByteLookupModel). */
export const causaliRespingimento: LookupItem[] = [
  { id: 1, code: 'NonConformita', name: 'Non conformità del carico' },
  { id: 2, code: 'DocumentazioneErrata', name: 'Documentazione errata o incompleta' },
  { id: 3, code: 'QuantitaNonCorrispondente', name: 'Quantità non corrispondente al formulario' },
]

/** Tipi di tratta (ByteLookupModel), per il trasporto con più vettori. */
export const tipiTratte: LookupItem[] = [
  { id: 1, code: 'PrimaTratta', name: 'Prima tratta' },
  { id: 2, code: 'SecondaTratta', name: 'Seconda tratta' },
]

/** Tipi documento per il trasporto transfrontaliero (ByteLookupModel). */
export const tipiTrasportoTransfrontaliero: LookupItem[] = [
  { id: 1, code: 'Notifica', name: 'Notifica di trasporto transfrontaliero' },
  { id: 2, code: 'Movimento', name: 'Documento di movimento' },
]

/** Codici di errore RENTRI (StringLookupModel). */
export const codiciErrore: LookupItem[] = [
  { id: 'ERR_CF_NON_VALIDO', code: 'ERR_CF_NON_VALIDO', name: 'Codice fiscale non valido' },
  { id: 'ERR_CER_NON_VALIDO', code: 'ERR_CER_NON_VALIDO', name: 'Codice CER non valido' },
]

/** Regioni (Int32LookupModel), codici ISTAT reali. */
export const regioni: LookupItem[] = [
  { id: 3, code: '03', name: 'Lombardia' },
  { id: 9, code: '09', name: 'Toscana' },
  { id: 12, code: '12', name: 'Lazio' },
]

/** Nazioni (StringLookupModel): id = ISO 3166-1 alpha-2, code = ISO 3166-1 numerico. */
export const nazioni: LookupItem[] = [
  { id: 'IT', code: '380', name: 'Italia' },
  { id: 'DE', code: '276', name: 'Germania' },
]

/**
 * Province (StringLookupModel), id = codice ISTAT provincia. `properties`
 * riporta `regione-id`, `attivo`, `fine-validita` come dichiarato dal
 * contratto (codifiche.yaml, descrizione di `/lookup/province`).
 */
export interface ProvinciaFixture {
  id: string
  code: string
  name: string
  regioneId: string
  attivo: boolean
}

export const province: ProvinciaFixture[] = [
  { id: '015', code: 'MI', name: 'Milano', regioneId: '03', attivo: true },
  { id: '048', code: 'FI', name: 'Firenze', regioneId: '09', attivo: true },
  { id: '058', code: 'RM', name: 'Roma', regioneId: '12', attivo: true },
]

export function provinciaALookupItem(p: ProvinciaFixture): LookupItem {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    properties: { 'regione-id': p.regioneId, attivo: p.attivo, 'fine-validita': null },
  }
}

/**
 * Comuni (StringLookupModel), id = codice ISTAT comune. Include un caso di
 * comune soppresso/accorpato (Task 1 Step 1 del piano R4): "San Piero a
 * Sieve" è confluito nel 2014 nel nuovo comune "Scarperia e San Piero"
 * (evento reale di fusione comunale toscana; i codici ISTAT usati qui sono
 * a scopo illustrativo, non garantiti cifra-per-cifra fedeli al registro
 * ufficiale, ma la semantica `attivo=false` + `nuovo-id` + `fine-validita`
 * è quella che il contratto documenta per un comune non più valido).
 */
export interface ComuneFixture {
  id: string
  code: string
  name: string
  provinciaId: string
  cciaa: string
  attivo: boolean
  nuovoId?: string | null
  fineValidita?: string | null
}

export const comuni: ComuneFixture[] = [
  { id: '015146', code: 'F205', name: 'Milano', provinciaId: '015', cciaa: 'MI', attivo: true },
  { id: '058091', code: 'H501', name: 'Roma', provinciaId: '058', cciaa: 'RM', attivo: true },
  {
    id: '048033',
    code: 'I001',
    name: 'San Piero a Sieve',
    provinciaId: '048',
    cciaa: 'FI',
    attivo: false,
    nuovoId: '048038',
    fineValidita: '2014-01-01T00:00:00Z',
  },
  {
    id: '048038',
    code: 'I004',
    name: 'Scarperia e San Piero',
    provinciaId: '048',
    cciaa: 'FI',
    attivo: true,
  },
]

export function comuneALookupItem(c: ComuneFixture): LookupItem {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    properties: {
      cciaa: c.cciaa,
      attivo: c.attivo,
      'nuovo-id': c.nuovoId ?? null,
      'fine-validita': c.fineValidita ?? null,
    },
  }
}
