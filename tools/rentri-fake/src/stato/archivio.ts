import { randomUUID } from 'crypto'
import { RegistroReplayMemoria } from '../auth/jwt-verifier'
import * as codifiche from './fixture-codifiche'
import { LookupItem } from './fixture-codifiche'
import * as anagrafiche from './fixture-anagrafiche'

export interface Formulario {
  numero_fir: string
  stato: string
  produttore: string
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
   * Registro anti-replay dei `jti` gia' visti (FEDELTA.md §5.2 punto 3):
   * condiviso da tutte le rotte autenticate tramite `verificaJwt`, azzerato
   * insieme al resto dello stato da `__controllo/azzera`.
   */
  readonly registroReplay = new RegistroReplayMemoria()

  azzera(): void {
    this.formulari.clear()
    this.transazioni.clear()
    this.guasto = null
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

  elencaFormulari(): Formulario[] {
    return [...this.formulari.values()]
  }

  /**
   * NONBLOCK_PULL: crea una transazione in stato `in_elaborazione` con
   * identificativo in formato uuid — `TransazioneModel.transazione_id` è
   * `format: uuid` (formulari.yaml righe 10276-10278), non un contatore
   * `TRX-000001` come nella fake precedente. La fake non la completa da
   * sola: il completamento arriva solo dal canale di controllo.
   */
  creaTransazione(): string {
    const id = randomUUID()
    this.transazioni.set(id, { id, stato: 'in_elaborazione' })
    return id
  }

  leggiTransazione(id: string): Transazione | undefined {
    return this.transazioni.get(id)
  }

  completaTransazione(id: string, esito: EsitoTransazione): void {
    const transazione = this.transazioni.get(id)
    if (!transazione) return
    transazione.stato = 'completata'
    transazione.esito = esito
  }

  // --- Servizio `codifiche` (docs/contracts/rentri/codifiche.yaml) -------
  //
  // Tutte e 25 le tabelle sono in sola lettura e statiche: nessun metodo di
  // scrittura, coerente col fatto che il contratto non offre alcuna rotta
  // di aggiornamento su questo servizio.

  codiciEer(): LookupItem[] {
    return codifiche.codiciEer
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
