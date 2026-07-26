import { randomUUID } from 'crypto'
import { RegistroReplayMemoria } from '../auth/jwt-verifier'
import * as codifiche from './fixture-codifiche'
import { LookupItem } from './fixture-codifiche'
import * as anagrafiche from './fixture-anagrafiche'

export interface Formulario {
  numero_fir: string
  stato: string
  produttore: string
  /**
   * Codice fiscale di un soggetto coinvolto nel FIR (semplificazione di test:
   * la fake non modella l'intera struttura `dati_partenza`/soggetti del
   * `NuovoFormularioModel` reale, legge questo campo direttamente dal corpo
   * passato a `POST /` o al canale di controllo — sufficiente per verificare
   * che `cercaFormulari({ identificativoSoggetto })` filtri correttamente,
   * non per validare la mappatura completa xFIR, fuori scope di R2 Task 2).
   */
  identificativo_soggetto?: string
  /** Unità locale che ha creato il FIR. */
  num_iscr_sito?: string
  /**
   * Unità locali (diverse da quella creatrice) che hanno acquisito la
   * visibilità in ricerca su questo FIR (`POST /acquisizione-visibilita`).
   * Determina `FormularioItemResult.visibilita_sito_acquisita` nella
   * risposta di `GET /`.
   */
  sitiConVisibilita?: string[]
}

export type StatoTransazione = 'in_elaborazione' | 'completata'

export interface Guasto {
  stato: number
  volte: number
}

/**
 * `EsitoMessaggioModel` (formulari.yaml righe 9446-9472): messaggio di
 * validazione allegato all'esito di una transazione.
 */
export interface EsitoMessaggio {
  indice?: number
  campo?: string
  tipo: 'Errore' | 'Avvertimento'
  codice_messaggio?: string
  parametri?: unknown[]
}

/**
 * Sottoinsieme di `EsitoFormularioModel` (formulari.yaml righe 9378-9414)
 * prodotto dal completamento di una transazione: conserva sempre `errore`
 * e `validazione`, i campi con cui il client distingue un esito negativo
 * da un successo. La fake precedente li ignorava del tutto.
 */
export interface EsitoTransazione {
  esito?: unknown
  tipo?: string
  validazione: EsitoMessaggio[]
  errore: boolean
  tempo_elaborazione?: string
}

export interface Transazione {
  id: string
  stato: StatoTransazione
  esito?: EsitoTransazione
  /**
   * Corpo originale di `POST /` (creazione), conservato per collegare
   * l'esito di completamento a un `Formulario` ricercabile (v.
   * {@link Archivio.completaTransazione}). `undefined` per transazioni non
   * di creazione (nessun altro tipo esiste oggi nella fake).
   */
  richiestaCreazione?: Record<string, unknown>
}

/**
 * Stato in memoria della fake. Volutamente non persistente: ogni avvio
 * riparte pulito, così i test non dipendono dall'ordine di esecuzione.
 */
export class Archivio {
  private formulari = new Map<string, Formulario>()
  private transazioni = new Map<string, Transazione>()
  private guasto: Guasto | null = null

  /**
   * Copia per-istanza del catalogo `codici-eer`, `null` finché nessun test
   * la richiede (in quel caso `codiciEer()` serve ancora l'array statico
   * condiviso `fixture-codifiche.codiciEer`, invariato). Popolata solo da
   * {@link rimuoviCodiceEer} — simula l'ente che smette di confermare un
   * codice tra due allineamenti (R4 Task 8), senza mutare l'array statico
   * condiviso tra tutte le istanze di `Archivio` del processo.
   */
  private codiciEerOverride: LookupItem[] | null = null

  /**
   * Registro anti-replay dei `jti` gia' visti (FEDELTA.md §5.2 punto 3):
   * condiviso da tutte le rotte autenticate tramite `verificaJwt`, azzerato
   * insieme al resto dello stato da `__controllo/azzera`.
   */
  readonly registroReplay = new RegistroReplayMemoria()

  azzera(): void {
    this.formulari.clear()
    this.transazioni.clear()
    this.guasto = null
    this.codiciEerOverride = null
    this.registroReplay.azzera()
  }

  impostaGuasto(guasto: Guasto | null): void {
    this.guasto = guasto
  }

  /**
   * Restituisce il guasto se ancora attivo e ne consuma un'occorrenza.
   */
  guastoAttivo(): Guasto | null {
    if (!this.guasto || this.guasto.volte <= 0) {
      return null
    }

    this.guasto.volte -= 1
    return this.guasto
  }

  salvaFormulario(formulario: Formulario): void {
    this.formulari.set(formulario.numero_fir, formulario)
  }

  leggiFormulario(numeroFir: string): Formulario | undefined {
    return this.formulari.get(numeroFir)
  }

  /**
   * Elenca i formulari secondo `GET /` (formulari.yaml righe 15-172).
   * Senza filtro restituisce tutto (uso interno/di test); con
   * `identificativoSoggetto` filtra sul soggetto coinvolto; con
   * `numIscrSito` restituisce i FIR creati in quell'unità locale O per cui
   * quell'unità ha acquisito la visibilità (coerente con la descrizione del
   * parametro, righe 22-33).
   */
  elencaFormulari(filtro?: {
    identificativoSoggetto?: string
    numIscrSito?: string
  }): Formulario[] {
    const tutti = [...this.formulari.values()]

    if (!filtro) {
      return tutti
    }
    if (filtro.identificativoSoggetto) {
      return tutti.filter(f => f.identificativo_soggetto === filtro.identificativoSoggetto)
    }
    if (filtro.numIscrSito) {
      return tutti.filter(
        f =>
          f.num_iscr_sito === filtro.numIscrSito ||
          (f.sitiConVisibilita ?? []).includes(filtro.numIscrSito as string)
      )
    }
    return tutti
  }

  /**
   * `POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}`
   * (formulari.yaml riga 657): registra l'unità locale tra quelle con
   * visibilità sul formulario. Restituisce `false` se il formulario non
   * esiste (404 per il chiamante della rotta).
   */
  acquisisciVisibilita(numeroFir: string, numIscrSito: string): boolean {
    const formulario = this.formulari.get(numeroFir)
    if (!formulario) return false

    formulario.sitiConVisibilita = formulario.sitiConVisibilita ?? []
    if (!formulario.sitiConVisibilita.includes(numIscrSito)) {
      formulario.sitiConVisibilita.push(numIscrSito)
    }
    return true
  }

  /**
   * `POST /{numero_fir}/rilascio-visibilita/{num_iscr_sito}` (formulari.yaml
   * riga 2030): operazione inversa di {@link acquisisciVisibilita}. `false`
   * se il formulario non esiste (404 per il chiamante della rotta) — non è
   * un errore se l'unità indicata non aveva comunque la visibilità
   * (idempotente, coerente col contratto che non dichiara un caso distinto
   * per questo).
   */
  rilasciaVisibilita(numeroFir: string, numIscrSito: string): boolean {
    const formulario = this.formulari.get(numeroFir)
    if (!formulario) return false

    formulario.sitiConVisibilita = (formulario.sitiConVisibilita ?? []).filter(
      sito => sito !== numIscrSito
    )
    return true
  }

  /**
   * NONBLOCK_PULL: crea una transazione in stato `in_elaborazione` con
   * identificativo in formato uuid — `TransazioneModel.transazione_id` è
   * `format: uuid` (formulari.yaml righe 10276-10278), non un contatore
   * `TRX-000001` come nella fake precedente. La fake non la completa da
   * sola: il completamento arriva solo dal canale di controllo.
   *
   * `richiestaCreazione`, se indicato, è il corpo di `POST /` (creazione):
   * conservato per collegare l'esito di completamento a un `Formulario`
   * ricercabile (v. {@link completaTransazione}).
   */
  creaTransazione(richiestaCreazione?: Record<string, unknown>): string {
    const id = randomUUID()
    this.transazioni.set(id, { id, stato: 'in_elaborazione', richiestaCreazione })
    return id
  }

  leggiTransazione(id: string): Transazione | undefined {
    return this.transazioni.get(id)
  }

  /**
   * Completa la transazione e, se l'esito è quello di una creazione riuscita
   * (`EsitoNuovoFormularioModel` con `numero_fir` valorizzato, `errore:
   * false`), registra il formulario risultante in archivio: senza questo
   * collegamento nessun formulario creato tramite il ciclo NONBLOCK_PULL
   * sarebbe mai trovabile da `GET /` o `GET /{numero_fir}` — un gap della
   * fake precedente, che gestiva transazione ed esito senza mai produrre un
   * `Formulario` cercabile.
   */
  completaTransazione(id: string, esito: EsitoTransazione): void {
    const transazione = this.transazioni.get(id)
    if (!transazione) return
    transazione.stato = 'completata'
    transazione.esito = esito

    const numeroFir = this.estraiNumeroFirDaEsito(esito)
    if (numeroFir && !esito.errore) {
      const richiesta = transazione.richiestaCreazione ?? {}
      this.salvaFormulario({
        numero_fir: numeroFir,
        stato: typeof richiesta.stato === 'string' ? richiesta.stato : 'InserimentoQuantita',
        produttore: typeof richiesta.produttore === 'string' ? richiesta.produttore : '',
        identificativo_soggetto:
          typeof richiesta.identificativo_soggetto === 'string'
            ? richiesta.identificativo_soggetto
            : undefined,
        num_iscr_sito:
          typeof richiesta.num_iscr_sito === 'string' ? richiesta.num_iscr_sito : undefined,
      })
    }
  }

  /** V. `RENTRIApiClient.estraiNumeroFirDaEsito`: stessa forma, stessa cautela sul `oneOf`. */
  private estraiNumeroFirDaEsito(esito: EsitoTransazione): string | undefined {
    const payload = esito.esito
    if (!payload || typeof payload !== 'object' || !('numero_fir' in payload)) {
      return undefined
    }
    const numeroFir = (payload as { numero_fir?: unknown }).numero_fir
    return typeof numeroFir === 'string' && numeroFir.trim() !== '' ? numeroFir : undefined
  }

  // --- Servizio `codifiche` (docs/contracts/rentri/codifiche.yaml) -------
  //
  // Tutte e 25 le tabelle sono in sola lettura e statiche: nessun metodo di
  // scrittura, coerente col fatto che il contratto non offre alcuna rotta
  // di aggiornamento su questo servizio.

  codiciEer(): LookupItem[] {
    return this.codiciEerOverride ?? codifiche.codiciEer
  }

  /**
   * Rimuove un codice EER dal catalogo restituito da `GET /lookup/codici-eer`
   * per QUESTA istanza di `Archivio` (canale di controllo
   * `/__controllo/rimuovi-codice-eer`, R4 Task 8): simula l'ente che smette
   * di confermare un codice tra due cicli di allineamento, senza mutare
   * l'array statico condiviso `fixture-codifiche.codiciEer` (copiato al
   * primo utilizzo). Restituisce `true` se il codice era presente ed è stato
   * rimosso, `false` se non era (mai) nel catalogo — idempotente, azzerato
   * da {@link azzera}.
   */
  rimuoviCodiceEer(code: string): boolean {
    const base = this.codiciEerOverride ?? codifiche.codiciEer
    const rimane = base.filter(v => v.code !== code)
    const rimosso = rimane.length !== base.length
    if (!rimosso) {
      // Nessun elemento rimosso: non materializzare una copia per-istanza
      // identica all'array statico condiviso — l'override esiste solo
      // quando serve davvero (v. commento del campo `codiciEerOverride`).
      return false
    }
    this.codiciEerOverride = rimane
    return rimosso
  }

  attivitaRs(): LookupItem[] {
    return codifiche.attivitaRs
  }

  statiFisici(): LookupItem[] {
    return codifiche.statiFisici
  }

  caratteristichePericolo(): LookupItem[] {
    return codifiche.caratteristichePericolo
  }

  adrClassi(): LookupItem[] {
    return codifiche.adrClassi
  }

  categorieRaee(): LookupItem[] {
    return codifiche.categorieRaee
  }

  materiali(): LookupItem[] {
    return codifiche.materiali
  }

  provenienza(): LookupItem[] {
    return codifiche.provenienza
  }

  unitaMisura(): LookupItem[] {
    return codifiche.unitaMisura
  }

  attivita(): LookupItem[] {
    return codifiche.attivita
  }

  statiFormulario(): LookupItem[] {
    return codifiche.statiFormulario
  }

  tipiAccettazione(): LookupItem[] {
    return codifiche.tipiAccettazione
  }

  tipiAutorizzazione(): LookupItem[] {
    return codifiche.tipiAutorizzazione
  }

  tipiRespingimento(): LookupItem[] {
    return codifiche.tipiRespingimento
  }

  causaliOperazione(): LookupItem[] {
    return codifiche.causaliOperazione
  }

  causaliRespingimento(): LookupItem[] {
    return codifiche.causaliRespingimento
  }

  tipiTratte(): LookupItem[] {
    return codifiche.tipiTratte
  }

  tipiTrasportoTransfrontaliero(): LookupItem[] {
    return codifiche.tipiTrasportoTransfrontaliero
  }

  codiciErrore(): LookupItem[] {
    return codifiche.codiciErrore
  }

  regioni(): LookupItem[] {
    return codifiche.regioni
  }

  nazioni(): LookupItem[] {
    return codifiche.nazioni
  }

  province(): LookupItem[] {
    return codifiche.province.map(codifiche.provinciaALookupItem)
  }

  /**
   * Comuni, con filtro opzionale per provincia (path `/lookup/comuni/{provincia_id}`)
   * e per stato attivo (query `attivi`, default true su quella rotta —
   * `/lookup/comuni` senza filtro provincia non lo dichiara e restituisce
   * tutto il catalogo, inclusi i comuni non più attivi).
   */
  comuni(filtro?: { provinciaId?: string; comuneId?: string; soloAttivi?: boolean }): LookupItem[] {
    let elenco = codifiche.comuni
    if (filtro?.provinciaId) {
      elenco = elenco.filter(c => c.provinciaId === filtro.provinciaId)
    }
    if (filtro?.comuneId) {
      elenco = elenco.filter(c => c.id === filtro.comuneId)
    }
    if (filtro?.soloAttivi) {
      elenco = elenco.filter(c => c.attivo)
    }
    return elenco.map(codifiche.comuneALookupItem)
  }

  // --- Servizio `anagrafiche` (docs/contracts/rentri/anagrafiche.yaml) ---
  //
  // Solo i path di lettura su Operatore/Soggetto delegato: i `/registri`
  // (apertura/modifica/chiusura registro) sono fuori dall'ambito di R4.

  elencaOperatori(numIscrAss?: string): anagrafiche.OperatoreFixture[] {
    if (!numIscrAss) return anagrafiche.operatori
    // num_iscr_ass filtra gli operatori delegati dal soggetto delegato
    // indicato: nella fixture l'unico legame delega->operatore è espresso
    // dai siti (`delegatoDaNumIscrAss`), quindi risaliamo da lì.
    const numIscrOperatoriDelegati = new Set(
      anagrafiche.siti
        .filter(s => s.delegatoDaNumIscrAss.includes(numIscrAss))
        .map(s => s.numIscrOperatore)
    )
    return anagrafiche.operatori.filter(o => numIscrOperatoriDelegati.has(o.numIscr))
  }

  operatorePerNumIscr(numIscr: string): anagrafiche.OperatoreFixture | undefined {
    return anagrafiche.trovaOperatorePerNumIscr(numIscr)
  }

  operatorePerIdentificativo(identificativo: string): anagrafiche.OperatoreFixture | undefined {
    return anagrafiche.trovaOperatorePerIdentificativo(identificativo)
  }

  elencaSoggettiDelegati(): anagrafiche.SoggettoDelegatoFixture[] {
    return anagrafiche.soggettiDelegati
  }

  soggettoDelegato(numIscrAss: string): anagrafiche.SoggettoDelegatoFixture | undefined {
    return anagrafiche.trovaSoggettoDelegato(numIscrAss)
  }

  sitiDiOperatore(numIscr: string): anagrafiche.SitoFixture[] {
    return anagrafiche.sitiDiOperatore(numIscr)
  }

  sitoDiOperatore(numIscr: string, numIscrSito: string): anagrafiche.SitoFixture | undefined {
    return anagrafiche.sitoDiOperatore(numIscr, numIscrSito)
  }

  sitiDelegatiA(numIscrAss: string): anagrafiche.SitoFixture[] {
    return anagrafiche.sitiDelegatiA(numIscrAss)
  }

  sitoDelegatoA(numIscrAss: string, numIscrSito: string): anagrafiche.SitoFixture | undefined {
    return anagrafiche.sitoDelegatoA(numIscrAss, numIscrSito)
  }
}
