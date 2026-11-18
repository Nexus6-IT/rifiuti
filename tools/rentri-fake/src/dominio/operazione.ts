/**
 * `Operazione` (`docs/contracts/rentri/formulari.yaml`, riga 9935): le 28
 * operazioni ammesse dal ciclo di vita di un formulario, restituite da
 * `GET /{numero_fir}/azioni` (`AzioniResult.azioni`). Copiate 1:1 dal
 * contratto (stessi 28 valori, stesso ordine dichiarato), non un
 * sottoinsieme: è lo stesso vincolo di fedeltà già applicato a
 * `StatoFormulario` nell'aggregate FIR del backend (R3 Task 1).
 */
export type Operazione =
  | 'Trasporto'
  | 'TrasportoUpdate'
  | 'DatiQuantita'
  | 'DatiQuantitaUpdate'
  | 'Accettazione'
  | 'Allegato'
  | 'Annotazione'
  | 'Reset'
  | 'Rilascia'
  | 'Annulla'
  | 'NoteAnnullamento'
  | 'Hash'
  | 'TrasbordoTotale'
  | 'TrasbordoParziale'
  | 'SostaTecnica'
  | 'NuovoDestinatario'
  | 'AcquisizioneFirma'
  | 'AcquisizioneFirmaAnnullamento'
  | 'AcquisizioneFirmaTrasportatore'
  | 'AcquisizioneFirmaProduttore'
  | 'AcquisizioneFirmaProduttoreTrasportatore'
  | 'AcquisizioneFirmaDestinatario'
  | 'AcquisizioneFirmaAnnotazione'
  | 'AcquisizioneFirmaTrasbordoTotale'
  | 'AcquisizioneFirmaSostaTecnica'
  | 'AcquisizioneFirmaTrasbordoParziale'
  | 'AcquisizioneFirmaDestinatarioSuccessivo'
  | 'AcquisizioneFirmaAccettazioneSuccessiva'
  | 'RollbackFirma'
  | 'Modifica'

/**
 * Macchina degli stati della fake, ricavata dal CONTRATTO dove il contratto
 * parla e dedotta dai nomi degli stati dove tace.
 *
 * - **Dal contratto** (`docs/contracts/rentri/formulari.yaml`, sezione "Stati
 *   del formulario ammessi" nella descrizione di ogni operazione): modifica,
 *   quantita', trasporto, accettazione, annotazione, annullamento, hash,
 *   firma, reset, sosta tecnica, trasbordi, nuovo destinatario, note di
 *   annullamento.
 * - **Dedotto** (il contratto non lo dice, FEDELTA.md §7): quale delle due
 *   voci `DatiQuantita`/`DatiQuantitaUpdate` e `Trasporto`/`TrasportoUpdate`
 *   spetta a ciascuno stato (la prima inserisce, la seconda corregge un dato
 *   gia' presente), `Allegato` (senza vincoli di stato nel contratto),
 *   `RollbackFirma` (il contratto elenca le condizioni, non gli stati: qui
 *   solo dopo una firma che non ha chiuso il ciclo).
 * - **Esiti**: `Accettato` ammette solo l'annotazione; `RespintoAccettatoParzialmente`
 *   NON e' terminale, ammette `NuovoDestinatario` (riga 1393); `Annullato`
 *   ammette `NoteAnnullamento` finche' il formulario e' privo di note.
 * - Stato sconosciuto o `Indeterminato`: lista vuota (scelta conservativa: un
 *   dato incoerente non giustifica proporre scritture).
 *
 * Le transizioni fra stati restano un'ipotesi plausibile da verificare sulla
 * demo (checklist del piano `docs/superpowers/plans/2026-11-18-rentri-fir-viaggio.md`,
 * rischio 1).
 */
const STATI_INSERIMENTO_INIZIALE = [
  'InserimentoQuantitaTrasportoIniziale',
  'InserimentoTrasportoIniziale',
  'InserimentoQuantita',
] as const

/** Stati di firma che l'operazione `Hash` e `AcquisizioneFirma` ammettono (contratto, riga 531/1498). */
const STATI_DI_FIRMA = [
  'FirmaProduttoreTrasportatoreIniziale',
  'FirmaProduttore',
  'FirmaTrasportatoreIniziale',
  'FirmaTrasportatoreSuccessivo',
  'FirmaAccettazione',
  'FirmaAnnotazione',
  'FirmaAnnullamento',
  'FirmaTrasbordoParziale',
  'FirmaTrasbordoTotale',
  'FirmaSostaTecnica',
  'FirmaDestinatarioSuccessivo',
  'FirmaAccettazioneSuccessiva',
] as const

/** Stati da cui si puo' cancellare l'ultimo dato non firmato (contratto, riga 1888). */
const STATI_RESET = [
  'FirmaTrasportatoreIniziale',
  'FirmaTrasportatoreSuccessivo',
  'FirmaDestinatarioSuccessivo',
  'FirmaAccettazione',
  'FirmaAccettazioneSuccessiva',
  'FirmaAnnotazione',
  'FirmaAnnullamento',
  'FirmaTrasbordoParziale',
  'FirmaTrasbordoTotale',
  'FirmaSostaTecnica',
] as const

const STATI_ANNULLABILI = [
  'InserimentoQuantita',
  'InserimentoQuantitaTrasportoIniziale',
  'InserimentoTrasportoIniziale',
  'FirmaProduttoreTrasportatoreIniziale',
  'FirmaProduttore',
  'FirmaTrasportatoreIniziale',
] as const

const STATI_VIAGGIO = ['InserimentoAccettazione', 'InserimentoTrasportoSuccessivo'] as const

/** Stati in cui l'operazione e' proposta, nell'ordine in cui compaiono in `azioni`. */
const STATI_PER_OPERAZIONE: Readonly<Record<Operazione, readonly string[]>> = {
  Trasporto: [
    'InserimentoQuantitaTrasportoIniziale',
    'InserimentoTrasportoIniziale',
    'InserimentoTrasportoSuccessivo',
  ],
  TrasportoUpdate: [
    'InserimentoQuantita',
    'FirmaProduttoreTrasportatoreIniziale',
    'FirmaTrasportatoreIniziale',
    'FirmaTrasportatoreSuccessivo',
    'FirmaTrasbordoTotale',
  ],
  DatiQuantita: ['InserimentoQuantitaTrasportoIniziale', 'InserimentoQuantita'],
  DatiQuantitaUpdate: ['InserimentoTrasportoIniziale', 'FirmaProduttoreTrasportatoreIniziale'],
  Accettazione: ['InserimentoAccettazione'],
  Allegato: [
    ...STATI_INSERIMENTO_INIZIALE,
    'InserimentoAccettazione',
    'InserimentoTrasportoSuccessivo',
    'FirmaAccettazione',
  ],
  Annotazione: [...STATI_VIAGGIO, 'Accettato', 'RespintoAccettatoParzialmente'],
  Reset: STATI_RESET,
  Rilascia: [],
  Annulla: STATI_ANNULLABILI,
  // Solo da `Annullato` (gestito in `operazioniPerStato`): il contratto non la ammette altrove.
  NoteAnnullamento: [],
  Hash: STATI_DI_FIRMA,
  TrasbordoTotale: STATI_VIAGGIO,
  TrasbordoParziale: STATI_VIAGGIO,
  SostaTecnica: STATI_VIAGGIO,
  NuovoDestinatario: ['RespintoAccettatoParzialmente'],
  AcquisizioneFirma: STATI_DI_FIRMA,
  AcquisizioneFirmaAnnullamento: ['FirmaAnnullamento'],
  AcquisizioneFirmaTrasportatore: ['FirmaTrasportatoreIniziale', 'FirmaTrasportatoreSuccessivo'],
  AcquisizioneFirmaProduttore: ['FirmaProduttore'],
  AcquisizioneFirmaProduttoreTrasportatore: ['FirmaProduttoreTrasportatoreIniziale'],
  AcquisizioneFirmaDestinatario: ['FirmaAccettazione'],
  AcquisizioneFirmaAnnotazione: ['FirmaAnnotazione'],
  AcquisizioneFirmaTrasbordoTotale: ['FirmaTrasbordoTotale'],
  AcquisizioneFirmaSostaTecnica: ['FirmaSostaTecnica'],
  AcquisizioneFirmaTrasbordoParziale: ['FirmaTrasbordoParziale'],
  AcquisizioneFirmaDestinatarioSuccessivo: ['FirmaDestinatarioSuccessivo'],
  AcquisizioneFirmaAccettazioneSuccessiva: ['FirmaAccettazioneSuccessiva'],
  RollbackFirma: STATI_VIAGGIO,
  Modifica: [
    'InserimentoQuantita',
    'InserimentoQuantitaTrasportoIniziale',
    'InserimentoTrasportoIniziale',
    'FirmaProduttoreTrasportatoreIniziale',
    'FirmaTrasportatoreIniziale',
  ],
}

const OPERAZIONI_NELL_ORDINE = Object.keys(STATI_PER_OPERAZIONE) as Operazione[]

/**
 * Restituisce il sottoinsieme di {@link Operazione} plausibile per lo stato
 * corrente di un formulario (v. commento di testata del gruppo).
 *
 * `opzioni.noteAnnullamentoGiaPresenti` (R3 Task 5): per lo stato `Annullato`,
 * distingue "nota non ancora trasmessa" (`NoteAnnullamento` disponibile) da
 * "nota gia' registrata" (lista vuota: il formulario annullato con nota non ha
 * piu' adempimenti pendenti).
 */
export function operazioniPerStato(
  stato: string,
  opzioni?: { noteAnnullamentoGiaPresenti?: boolean }
): Operazione[] {
  // `Annullato` NON e' terminale (R3 Task 5): il contratto ammette
  // `NoteAnnullamento` finche' il formulario e' "privo di note" (riga 1656).
  if (stato === 'Annullato') {
    return opzioni?.noteAnnullamentoGiaPresenti ? [] : ['NoteAnnullamento']
  }
  return OPERAZIONI_NELL_ORDINE.filter(operazione =>
    STATI_PER_OPERAZIONE[operazione].includes(stato)
  )
}
