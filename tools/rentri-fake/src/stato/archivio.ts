import { createSign, randomUUID } from 'crypto'
import { RegistroReplayMemoria } from '../auth/jwt-verifier'
import { emettiCertificatoAccreditato } from '../auth/ca-test'
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
  /**
   * Versione del formulario (`InfoFormulario.versione`/`AzioniResult.versione`,
   * formulari.yaml righe 2265/1330): incrementata a ogni operazione di
   * scrittura reale sull'ente. La fake non la incrementa da sola (nessuna
   * operazione di scrittura esiste ancora, Task 2 R3) — resta il valore
   * impostato dal canale di controllo o `null` di default.
   */
  versione?: number | null
  /**
   * Operazione di dominio in corso su questo formulario, in attesa che la
   * transazione NONBLOCK_PULL che l'ha originata (`POST /accettazione`) si
   * completi (R3 Task 4). Applicata e svuotata da
   * {@link Archivio.applicaEffettoOperazione} quando la SUCCESSIVA
   * `POST /acquisizione-firma` si completa con successo — il meccanismo
   * minimo che dimostra il ciclo scrivi→firma→esito senza replicare l'intera
   * macchina a stati reale dell'ente (fuori scope, v. `operazione.ts`).
   */
  pendingOperazione?:
    | { tipo: 'Accettazione'; corpo: Record<string, unknown> }
    | { tipo: 'Annulla'; corpo: Record<string, unknown> }
  /**
   * Testo delle note di annullamento (R3 Task 5), impostato
   * dall'applicazione dell'effetto `NoteAnnullamento` — non da una firma
   * (quella chiamata non ha stato `Firma*` successivo, v. `operazione.ts`).
   * Usato da `GET /azioni` per distinguere "nota non ancora trasmessa" da
   * "nota già registrata" sullo stato `Annullato`.
   */
  note?: string
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
  /**
   * Contesto di un'operazione di dominio diversa dalla creazione (R3 Task 4):
   * quale formulario, quale operazione, quale corpo. Popolato da
   * `registraOperazioneAsincrona` in `formulari.ts` per `accettazione` e
   * `acquisizione-firma` (NON per `hash`, che non ha alcun effetto di dominio
   * da applicare). Usato da {@link Archivio.completaTransazione} per
   * decidere se e quale transizione di stato applicare al completamento.
   */
  contestoOperazione?: {
    numeroFir: string
    operazione: 'Accettazione' | 'AcquisizioneFirma' | 'Annulla' | 'NoteAnnullamento'
    corpo?: Record<string, unknown>
  }
}

/** Stato di una sessione di autorizzazione alla firma remota (`ca-rentri`). */
export type StatoSessioneFirma = 'IN_ATTESA' | 'AUTORIZZATA' | 'RIFIUTATA'

/**
 * Sessione di autorizzazione creata da `POST /ca-rentri/v1.0/credentials/authorize`
 * e interrogata da `GET /credentials/authorize-check/{handle}`.
 *
 * La fake NON passa da sola a `AUTORIZZATA`: la conferma dell'utente avviene
 * sul dispositivo con l'app ufficiale RENTRI, un gesto che il nostro backend
 * non compie mai. Nella fake lo compie il canale di controllo
 * (`POST /__controllo/ca-rentri/autorizza/{handle}`) — se la fake si
 * autorizzasse da sola, nessun test potrebbe distinguere «l'utente ha
 * confermato» da «l'utente non ha ancora confermato», cioè esattamente la
 * distinzione che questo ciclo esiste per gestire.
 */
export interface SessioneFirma {
  handle: string
  sad: string
  credentialsId: string
  hashes: string[]
  stato: StatoSessioneFirma
  /** Istante (ms epoch) oltre il quale l'autorizzazione non è più valida. */
  scadenzaMs: number
}

/**
 * Valore di default di `expires_in` (secondi) restituito da
 * `POST /credentials/authorize`. Il tempo reale concesso da RENTRI non è
 * documentato da alcuna fonte (v. ADR, «Lacune ancora aperte»): questo
 * valore è una scelta della fake, non un dato dell'ente.
 */
export const EXPIRES_IN_DEFAULT_SECONDI = 120

/**
 * Stato in memoria della fake. Volutamente non persistente: ogni avvio
 * riparte pulito, così i test non dipendono dall'ordine di esecuzione.
 */
export class Archivio {
  private formulari = new Map<string, Formulario>()
  private transazioni = new Map<string, Transazione>()
  private guasto: Guasto | null = null
  private sessioniFirma = new Map<string, SessioneFirma>()

  /**
   * Materiale crittografico di test della "CA RENTRI" simulata: il
   * certificato restituito da `GET /credentials/info` e la chiave con cui
   * `POST /credentials/sign-hash` firma DAVVERO.
   *
   * Generato una volta sola per istanza di `Archivio` (pigro: la generazione
   * di una coppia RSA 2048 costa ~centinaia di ms, e la maggior parte dei
   * test non tocca la firma remota). NON viene azzerato da {@link azzera}:
   * è materiale di infrastruttura, non stato di scenario, e rigenerarlo a
   * ogni test renderebbe la suite molto più lenta senza alcun guadagno di
   * isolamento.
   */
  private materialeFirmaRemota: { certificatoBase64Der: string; chiavePrivataPem: string } | null =
    null

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
    this.sessioniFirma.clear()
    this.registroReplay.azzera()
    // `materialeFirmaRemota` NON si azzera: v. il commento del campo.
  }

  // --- Firma remota (`ca-rentri`, R3 Task 3) --------------------------------

  /**
   * Certificato X.509 (base64 DER) della credenziale di firma remota
   * simulata, servito da `GET /credentials/info?cert_info=true`. È lo stesso
   * certificato la cui chiave privata firma in {@link firmaHash}: un test può
   * quindi verificare DAVVERO la firma con la chiave pubblica estratta da qui.
   */
  certificatoFirmaRemota(): string {
    return this.materiale().certificatoBase64Der
  }

  private materiale(): { certificatoBase64Der: string; chiavePrivataPem: string } {
    if (!this.materialeFirmaRemota) {
      this.materialeFirmaRemota = emettiCertificatoAccreditato('CREDENZIALE-FIRMA-REMOTA-TEST')
    }
    return this.materialeFirmaRemota
  }

  /**
   * `POST /ca-rentri/v1.0/credentials/authorize`: crea una sessione in stato
   * `IN_ATTESA`. Restituisce la sessione creata (`sad`, `handle`, scadenza).
   */
  creaSessioneFirma(
    credentialsId: string,
    hashes: string[],
    expiresInSecondi: number
  ): SessioneFirma {
    const sessione: SessioneFirma = {
      handle: randomUUID(),
      sad: randomUUID(),
      credentialsId,
      hashes,
      stato: 'IN_ATTESA',
      scadenzaMs: Date.now() + expiresInSecondi * 1000,
    }
    this.sessioniFirma.set(sessione.handle, sessione)
    return sessione
  }

  leggiSessioneFirma(handle: string): SessioneFirma | undefined {
    return this.sessioniFirma.get(handle)
  }

  /** Tutte le sessioni note: serve a `sign-hash` per risalire dalla `sad` alla sessione. */
  elencaSessioniFirma(): SessioneFirma[] {
    return [...this.sessioniFirma.values()]
  }

  /**
   * Canale di controllo: simula la conferma dell'utente sul proprio
   * dispositivo (che nella realtà chiama `PUT /credentials/authorize-confirmation`
   * — mai il nostro backend). `false` se la sessione non esiste.
   */
  autorizzaSessioneFirma(handle: string): boolean {
    const sessione = this.sessioniFirma.get(handle)
    if (!sessione) return false
    sessione.stato = 'AUTORIZZATA'
    return true
  }

  /**
   * Canale di controllo: simula l'utente che RIFIUTA la firma sul proprio
   * dispositivo. Senza di questo lo stato `RIFIUTATA` sarebbe irraggiungibile
   * e il ramo corrispondente di `authorize-check` resterebbe codice morto —
   * la stessa categoria di difetto (un comportamento dichiarato che nulla può
   * esercitare) che questa fake esiste per evitare.
   */
  rifiutaSessioneFirma(handle: string): boolean {
    const sessione = this.sessioniFirma.get(handle)
    if (!sessione) return false
    sessione.stato = 'RIFIUTATA'
    return true
  }

  /**
   * Canale di controllo: porta la scadenza nel passato, così un test può
   * verificare il ramo «scaduta» senza attendere `expires_in` reale (che
   * renderebbe la suite oracolo lunga minuti per nessun guadagno di fedeltà).
   */
  scadiSessioneFirma(handle: string): boolean {
    const sessione = this.sessioniFirma.get(handle)
    if (!sessione) return false
    sessione.scadenzaMs = Date.now() - 1
    return true
  }

  /** `true` se la sessione è oltre la propria scadenza (calcolata dal tempo, non da un contatore). */
  sessioneFirmaScaduta(sessione: SessioneFirma): boolean {
    return Date.now() > sessione.scadenzaMs
  }

  /**
   * `POST /ca-rentri/v1.0/credentials/sign-hash`: firma DAVVERO il digest con
   * la chiave privata di test.
   *
   * **Divergenza dichiarata dall'ente reale**: RENTRI dichiara `sign_algo`
   * ECDSA-SHA256 su un digest già calcolato (firma «prehash»). Qui si firma
   * con RSA-SHA256 sui byte del digest (`createSign('sha256')`), perché è la
   * combinazione che il verificatore lato backend
   * (`rentri-firma-verifica.util.ts`) può effettivamente verificare con la
   * sola API pubblica di Node — v. il commento di quella funzione per il
   * perché la verifica prehash EC non è realizzabile senza dipendenze nuove.
   * La fake resta quindi utile a provare il CICLO (202 → 200 → firma →
   * acquisizione) e a far passare la verifica locale nel caso positivo, NON a
   * dimostrare la conformità crittografica all'algoritmo dell'ente.
   */
  firmaHash(digestBase64: string): string {
    const firmatore = createSign('sha256')
    firmatore.update(Buffer.from(digestBase64, 'base64'))
    firmatore.end()
    return firmatore.sign(this.materiale().chiavePrivataPem, 'base64')
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
   *
   * `contestoOperazione`, se indicato (R3 Task 4), collega la transazione a
   * un'operazione di dominio su un formulario ESISTENTE (`accettazione`,
   * `acquisizione-firma`): {@link completaTransazione} lo usa per applicare
   * la transizione di stato corrispondente. Parametro opzionale in coda per
   * compatibilità con le chiamate esistenti che non lo passano (creazione).
   */
  creaTransazione(
    richiestaCreazione?: Record<string, unknown>,
    contestoOperazione?: Transazione['contestoOperazione']
  ): string {
    const id = randomUUID()
    this.transazioni.set(id, {
      id,
      stato: 'in_elaborazione',
      richiestaCreazione,
      contestoOperazione,
    })
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

    if (!esito.errore && transazione.contestoOperazione) {
      this.applicaEffettoOperazione(transazione.contestoOperazione)
    }
  }

  /**
   * Macchina a stati MINIMA per il ciclo scrivi→firma→esito (R3 Task 4),
   * volutamente non una replica della macchina reale dell'ente (v. commento
   * di testata di `operazione.ts`):
   *
   * - `accettazione` completata con successo → il formulario passa a
   *   `FirmaAccettazione` e memorizza `tipo_accettazione` come operazione
   *   pendente (non applica ancora l'esito finale: manca ancora la firma).
   * - `acquisizione-firma` completata con successo E un'operazione pendente
   *   di tipo `Accettazione` presente → il formulario transita allo stato
   *   terminale (`A` → `Accettato`; `P`/`R` → `RespintoAccettatoParzialmente`)
   *   e l'operazione pendente viene svuotata.
   * - `annulla-fir` completata con successo (R3 Task 5) → il formulario
   *   passa a `FirmaAnnullamento` e memorizza un'operazione pendente di tipo
   *   `Annulla` (nessun corpo rilevante: il contratto non ne ha uno).
   * - `acquisizione-firma` completata con successo E un'operazione pendente
   *   di tipo `Annulla` presente → il formulario transita a `Annullato`.
   * - `note-annullamento` completata con successo (R3 Task 5) → **nessuna
   *   firma successiva** (a differenza di `annulla-fir`, v. `operazione.ts`):
   *   l'effetto (`formulario.note`) si applica subito al completamento della
   *   transazione, non c'è un `pendingOperazione` da attendere.
   *
   * **Non regressivo per costruzione**: le suite che seminano il formulario
   * direttamente in `FirmaAccettazione`/`FirmaAnnullamento` via
   * `/__controllo/formulario` (es. `rentri-firma-operazione.oracolo.spec.ts`)
   * non passano mai da `accettazione`/`annulla-fir`, quindi il formulario non
   * ha mai `pendingOperazione` — il ramo sotto per `acquisizione-firma` non
   * scatta e lo stato resta quello seminato dal test, esattamente come prima
   * di questo task.
   */
  private applicaEffettoOperazione(contesto: NonNullable<Transazione['contestoOperazione']>): void {
    const formulario = this.formulari.get(contesto.numeroFir)
    if (!formulario) return

    if (contesto.operazione === 'Accettazione') {
      formulario.stato = 'FirmaAccettazione'
      formulario.pendingOperazione = {
        tipo: 'Accettazione',
        corpo: contesto.corpo ?? {},
      }
      return
    }

    if (contesto.operazione === 'Annulla') {
      formulario.stato = 'FirmaAnnullamento'
      formulario.pendingOperazione = { tipo: 'Annulla', corpo: contesto.corpo ?? {} }
      return
    }

    if (contesto.operazione === 'NoteAnnullamento') {
      const note = contesto.corpo?.note
      if (typeof note === 'string') {
        formulario.note = note
      }
      return
    }

    if (contesto.operazione === 'AcquisizioneFirma') {
      const pendente = formulario.pendingOperazione
      if (!pendente) return

      if (pendente.tipo === 'Accettazione') {
        const tipoAccettazione = pendente.corpo.tipo_accettazione
        formulario.stato = tipoAccettazione === 'A' ? 'Accettato' : 'RespintoAccettatoParzialmente'
        formulario.pendingOperazione = undefined
        return
      }

      if (pendente.tipo === 'Annulla') {
        formulario.stato = 'Annullato'
        formulario.pendingOperazione = undefined
        return
      }
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
