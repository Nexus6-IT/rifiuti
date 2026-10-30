import type {
  MudAzienda,
  MudDichiarazioneExport,
  MudRifiutoLine,
  MudUnitaLocaleAnagrafica as MudUnitaLocaleExport,
} from '../export/mud-export.types'

// Regole pure delle dichiarazioni MUD per unità locale (Fase 2 pezzo 8, D2, D4-D7).
// Nessun accesso al database: il servizio carica i dati e li passa qui, così l'attribuzione
// dei movimenti e quella delle giacenze usano la stessa funzione e non possono divergere.

/** Chiave della dichiarazione "azienda" (azienda senza unità locali): codice 1 (D2, D4). */
export const CHIAVE_AZIENDA = 'AZIENDA'

/** Anagrafica di una unità locale come la legge la dichiarazione (colonne di D4 e D5). */
export interface MudUnitaLocaleAnagrafica {
  id: string
  denominazione: string
  numIscrSito: string
  principale: boolean
  createdAt: Date
  indirizzo: string | null
  civico: string | null
  cap: string | null
  comune: string | null
  provincia: string | null
  numeroAddetti: number | null
  /** NULL impossibile dopo la migration: vale "dopo tutti gli altri" (D4) */
  progressivoMud: number | null
}

export interface ProgressivoUnitaLocale {
  progressivo: number
  /** vero se il progressivo era NULL e il valore è di ripiego (il servizio scrive un warn) */
  ripiego: boolean
}

export interface ContestoSedi {
  unitaLocali: MudUnitaLocaleAnagrafica[]
  /** registro -> unità locale (`sediDeiRegistri`) */
  registri: Map<string, string | null>
  progressivi: Map<string, ProgressivoUnitaLocale>
}

export interface MudDichiarazione {
  /** 15 cifre */
  codice: string
  progressivo: number
  unitaLocale: {
    id: string | null
    denominazione: string
    numIscrSito: string | null
    principale: boolean
  }
  /** null = anagrafica dell'azienda */
  anagrafica: MudUnitaLocaleAnagrafica | null
  /** addetti della dichiarazione (D5), sempre valorizzati anche se l'anagrafica è dell'azienda */
  numeroAddetti: number
  /** codice ISTAT a 6 cifre del comune della dichiarazione (sede o azienda); null se non trovato */
  comuneCode: string | null
  conAutorizzazioni: boolean
  /** AR e INT: primo pacchetto per codice */
  conAllegatiAzienda: boolean
  righe: MudRifiutoLine[]
  movimentiPerCer: Record<string, number>
  pericolosiPerCer: Record<string, true>
}

/** Codice dell'unità locale nel file: progressivo a 15 cifre (D4). */
export function codiceUnitaLocale(progressivo: number): string {
  return String(progressivo).padStart(15, '0')
}

/**
 * Progressivo di ogni unità locale. Un `progressivoMud` NULL prende i numeri successivi al
 * massimo, in ordine di `createdAt` (poi id): dopo tutte le altre, mai un errore (D4).
 */
export function progressiviUnitaLocali(
  unitaLocali: MudUnitaLocaleAnagrafica[]
): Map<string, ProgressivoUnitaLocale> {
  const esito = new Map<string, ProgressivoUnitaLocale>()
  let massimo = 0
  for (const u of unitaLocali) {
    if (u.progressivoMud !== null) {
      esito.set(u.id, { progressivo: u.progressivoMud, ripiego: false })
      massimo = Math.max(massimo, u.progressivoMud)
    }
  }
  const senza = unitaLocali
    .filter(u => u.progressivoMud === null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  for (const u of senza) esito.set(u.id, { progressivo: ++massimo, ripiego: true })
  return esito
}

export function creaContestoSedi(
  unitaLocali: MudUnitaLocaleAnagrafica[],
  registri: Map<string, string | null>
): ContestoSedi {
  return { unitaLocali, registri, progressivi: progressiviUnitaLocali(unitaLocali) }
}

export type AttribuzioneRegistro =
  | {
      tipo: 'dichiarazione'
      /** id dell'unità locale oppure CHIAVE_AZIENDA */
      chiave: string
      /** null = dichiarazione "azienda" */
      unitaLocale: MudUnitaLocaleAnagrafica | null
      /** vero se il registro non ha sede e il movimento è finito sulla principale (D2) */
      senzaSede: boolean
    }
  | { tipo: 'nessuna'; motivo: 'SEDE_PRINCIPALE_MANCANTE' }

/**
 * D2: a quale dichiarazione va un registro. UNICA funzione, usata per i movimenti e per i saldi.
 * Un registro sconosciuto, o legato a una sede che non è fra le unità locali del contesto, vale
 * come registro senza sede.
 */
export function dichiarazioneDelRegistro(
  registroId: string,
  contesto: ContestoSedi
): AttribuzioneRegistro {
  const sedeId = contesto.registri.get(registroId) ?? null
  if (sedeId !== null) {
    const sede = contesto.unitaLocali.find(u => u.id === sedeId)
    if (sede) return { tipo: 'dichiarazione', chiave: sede.id, unitaLocale: sede, senzaSede: false }
  }
  if (contesto.unitaLocali.length === 0) {
    return { tipo: 'dichiarazione', chiave: CHIAVE_AZIENDA, unitaLocale: null, senzaSede: false }
  }
  const principale = contesto.unitaLocali.find(u => u.principale)
  if (!principale) return { tipo: 'nessuna', motivo: 'SEDE_PRINCIPALE_MANCANTE' }
  return { tipo: 'dichiarazione', chiave: principale.id, unitaLocale: principale, senzaSede: true }
}

export interface GruppoSede<T> {
  chiave: string
  unitaLocale: MudUnitaLocaleAnagrafica | null
  progressivo: number
  codice: string
  movimenti: T[]
}

export interface AttribuzioneMovimenti<T> {
  /** una per dichiarazione, in ordine di codice */
  gruppi: Array<GruppoSede<T>>
  /** movimenti di registri senza sede attribuiti alla principale (MOVIMENTI_SENZA_SEDE) */
  senzaSede: T[]
  /** movimenti fuori da ogni dichiarazione per mancanza della principale */
  senzaPrincipale: T[]
}

export function attribuisciSedi<T extends { registroId: string }>(
  movimenti: T[],
  contesto: ContestoSedi
): AttribuzioneMovimenti<T> {
  const perChiave = new Map<string, GruppoSede<T>>()
  const senzaSede: T[] = []
  const senzaPrincipale: T[] = []
  for (const m of movimenti) {
    const a = dichiarazioneDelRegistro(m.registroId, contesto)
    if (a.tipo === 'nessuna') {
      senzaPrincipale.push(m)
      continue
    }
    let gruppo = perChiave.get(a.chiave)
    if (!gruppo) {
      const progressivo = a.unitaLocale
        ? (contesto.progressivi.get(a.unitaLocale.id)?.progressivo ?? Number.MAX_SAFE_INTEGER)
        : 1
      gruppo = {
        chiave: a.chiave,
        unitaLocale: a.unitaLocale,
        progressivo,
        codice: codiceUnitaLocale(progressivo),
        movimenti: [],
      }
      perChiave.set(a.chiave, gruppo)
    }
    gruppo.movimenti.push(m)
    if (a.senzaSede) senzaSede.push(m)
  }
  const gruppi = [...perChiave.values()].sort((a, b) => a.progressivo - b.progressivo)
  return { gruppi, senzaSede, senzaPrincipale }
}

const vuoto = (v: string | null | undefined) => (v ?? '').trim() === ''

/** Campi obbligatori mancanti dell'indirizzo della sede, nell'ordine dei messaggi (D5, D16). */
export function campiMancanti(
  ul: Pick<MudUnitaLocaleAnagrafica, 'indirizzo' | 'cap' | 'comune' | 'provincia'>
): Array<'indirizzo' | 'CAP' | 'comune' | 'provincia'> {
  const mancanti: Array<'indirizzo' | 'CAP' | 'comune' | 'provincia'> = []
  if (vuoto(ul.indirizzo)) mancanti.push('indirizzo')
  if (vuoto(ul.cap)) mancanti.push('CAP')
  if (vuoto(ul.comune)) mancanti.push('comune')
  if (vuoto(ul.provincia)) mancanti.push('provincia')
  return mancanti
}

export interface AnagraficaDichiarazione {
  /** anagrafica della sede; null = si usa quella dell'azienda */
  anagrafica: MudUnitaLocaleAnagrafica | null
  numeroAddetti: number
  /** AVVISO PRINCIPALE_CON_INDIRIZZO_AZIENDA: principale senza indirizzo con più dichiarazioni */
  principaleConIndirizzoAzienda: boolean
  /** BLOCCANTE UNITA_LOCALE_SENZA_INDIRIZZO: altra sede senza indirizzo completo */
  campiMancanti: Array<'indirizzo' | 'CAP' | 'comune' | 'provincia'>
  /** AVVISO UNITA_LOCALE_SENZA_ADDETTI: addetti della sede assenti con più dichiarazioni */
  addettiMancanti: boolean
}

/**
 * D5 (senza ISTAT, che richiede la ricerca del comune). `ul` null = dichiarazione "azienda";
 * `unica` = il file ha una sola dichiarazione.
 */
export function anagraficaDichiarazione(
  ul: MudUnitaLocaleAnagrafica | null,
  unica: boolean,
  tenant: { numeroAddetti?: number | null }
): AnagraficaDichiarazione {
  const mancanti = ul ? campiMancanti(ul) : []
  const completa = ul !== null && mancanti.length === 0
  let numeroAddetti: number
  let addettiMancanti = false
  if (ul && ul.numeroAddetti !== null) numeroAddetti = ul.numeroAddetti
  else if (unica) numeroAddetti = tenant.numeroAddetti ?? 0
  else {
    numeroAddetti = 0
    addettiMancanti = true
  }
  return {
    anagrafica: completa ? ul : null,
    numeroAddetti,
    principaleConIndirizzoAzienda: ul !== null && ul.principale && !completa && !unica,
    campiMancanti: ul && !ul.principale ? mancanti : [],
    addettiMancanti,
  }
}

export interface VoceProvincia {
  denominazione: string
  /** 3 cifre: prime del codice ISTAT del comune */
  codice: string
  /** sigla se nota, altrimenti il codice */
  etichetta: string
}

/**
 * D6: se le dichiarazioni hanno province diverse restituisce le voci, ordinate per codice;
 * altrimenti []. Le dichiarazioni senza codice ISTAT non contano (hanno un bloccante a parte).
 */
export function provinceDiverse(
  dichiarazioni: Array<{ denominazione: string; comuneCode: string | null; sigla?: string | null }>
): VoceProvincia[] {
  const voci: VoceProvincia[] = []
  for (const d of dichiarazioni) {
    if (!d.comuneCode || !/^\d{3}/.test(d.comuneCode)) continue
    const codice = d.comuneCode.slice(0, 3)
    voci.push({ denominazione: d.denominazione, codice, etichetta: d.sigla?.trim() || codice })
  }
  if (new Set(voci.map(v => v.codice)).size <= 1) return []
  return voci.sort((a, b) => a.codice.localeCompare(b.codice))
}

/**
 * D7: `dichiarazioni` sono quelle con pacchetto (D3). AU alla principale se ha un pacchetto,
 * altrimenti alla prima per codice; AR e INT sempre alla prima per codice.
 */
export function dichiarazionePerAllegati<T extends { codice: string; principale: boolean }>(
  dichiarazioni: T[]
): { au: T | undefined; arEInt: T | undefined } {
  const ordinate = [...dichiarazioni].sort((a, b) => a.codice.localeCompare(b.codice))
  const prima = ordinate[0]
  return { au: ordinate.find(d => d.principale) ?? prima, arEInt: prima }
}

/** Quanto serve di una dichiarazione per portarla nel file (sottoinsieme di `MudDichiarazione`). */
export type DichiarazionePerExport = Pick<
  MudDichiarazione,
  'codice' | 'progressivo' | 'anagrafica' | 'numeroAddetti' | 'comuneCode' | 'righe'
> & { unitaLocale: Pick<MudDichiarazione['unitaLocale'], 'principale'> }

const senzaVuoti = (v: string | null | undefined): string | undefined => {
  const t = (v ?? '').trim()
  return t === '' ? undefined : t
}

/**
 * Anagrafica del pacchetto come la legge il generatore. Sede con indirizzo completo (D5) → i suoi
 * dati. Anagrafica dell'azienda (null): resta null, salvo che gli addetti della dichiarazione
 * differiscano da quelli dell'azienda (più dichiarazioni, D5: 0 o il dato della sede): allora
 * si ripetono i dati dell'azienda con gli addetti giusti, perché il generatore con `null`
 * scriverebbe il totale dell'azienda.
 */
function anagraficaPacchetto(
  d: DichiarazionePerExport,
  azienda: MudAzienda
): MudUnitaLocaleExport | null {
  if (d.anagrafica) {
    return {
      via: senzaVuoti(d.anagrafica.indirizzo),
      civico: senzaVuoti(d.anagrafica.civico),
      cap: senzaVuoti(d.anagrafica.cap),
      comune: senzaVuoti(d.anagrafica.comune),
      provincia: senzaVuoti(d.anagrafica.provincia),
      comuneCode: d.comuneCode ?? undefined,
      numeroAddetti: d.numeroAddetti,
    }
  }
  if (d.numeroAddetti === (azienda.numeroAddetti ?? 0)) return null
  return {
    via: azienda.via,
    civico: azienda.civico,
    cap: azienda.cap,
    comune: azienda.comune,
    provincia: azienda.provincia,
    comuneCode: d.comuneCode ?? azienda.comuneCode,
    numeroAddetti: d.numeroAddetti,
  }
}

/**
 * Pacchetti del file dalle dichiarazioni dell'aggregazione, in ordine di codice. AU, AR e INT
 * escono in UN solo pacchetto ciascuno (D7, `dichiarazionePerAllegati`), qualunque siano i flag
 * portati dalle dichiarazioni: altrimenti le schede sarebbero duplicate. Elenco vuoto → [].
 */
export function pacchettiPerExport(
  dichiarazioni: DichiarazionePerExport[],
  azienda: MudAzienda
): MudDichiarazioneExport[] {
  const ordinate = [...dichiarazioni].sort((a, b) => a.codice.localeCompare(b.codice))
  const { au, arEInt } = dichiarazionePerAllegati(
    ordinate.map(d => ({ codice: d.codice, principale: d.unitaLocale.principale }))
  )
  return ordinate.map(d => ({
    progressivoUnitaLocale: d.progressivo,
    unitaLocale: anagraficaPacchetto(d, azienda),
    rifiuti: d.righe,
    conAutorizzazioni: au?.codice === d.codice,
    conAllegatiAzienda: arEInt?.codice === d.codice,
  }))
}
