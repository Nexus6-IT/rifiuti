import { Injectable } from '@nestjs/common'
import { verificaFirNonBloccato } from '../../domain/fir/guardia-invio-rentri'
import { descrizioneAutorizzazioneFirma } from './descrizione-autorizzazione-firma'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import {
  RENTRIApiClient,
  EsitoVerificaAutorizzazione,
} from '../../infrastructure/rentri/rentri-api.client'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import { RentriRateLimiterService } from '../../infrastructure/rentri/rentri-rate-limiter.service'
import { verificaFirmaLocale } from '../../infrastructure/rentri/rentri-firma-verifica.util'
import { StatoFormulario } from '../../domain/fir/aggregates/fir.aggregate'
import {
  ISessioniFirmaRentriRepository,
  SessioneFirmaGiaApertaError,
  SessioneFirmaRentri,
  StatoSessioneChiusa,
} from './sessioni-firma-rentri.port'

/**
 * Intervallo (ms) fra due interrogazioni di `authorize-check`.
 *
 * 2000 ms, lo stesso valore già scelto per il polling NONBLOCK_PULL del
 * client (`RENTRIApiClient.INTERVALLO_POLLING_DEFAULT_MS`): l'attesa qui è
 * quella di una persona che prende in mano il telefono e conferma
 * sull'app — un intervallo più fitto non anticiperebbe di nulla quel gesto,
 * consumerebbe soltanto capacità del rate limiter per-tenant (e quindi
 * avvicinerebbe il 429/423 dell'ente) per nessun beneficio percepibile.
 */
export const INTERVALLO_POLLING_AUTORIZZAZIONE_MS = 2000

/**
 * Tetto (ms) di attesa dell'INVOCAZIONE, distinto dal limite di attesa della
 * conferma ({@link ATTESA_CONFERMA_FIRMA_PREDEFINITA_S}).
 *
 * Quel limite dice per quanto l'autorizzazione resta in attesa (minuti);
 * questo dice per quanto QUESTA chiamata resta ad aspettare prima
 * di restituire `IN_ATTESA` e lasciare che sia il chiamante a decidere se
 * ripresentarsi. Senza, una richiesta HTTP interattiva resterebbe appesa
 * per l'intero limite di attesa della conferma — precisamente lo spinner indefinito
 * che il piano vieta. 20 s è la soglia oltre la quale un'attesa sincrona
 * smette di essere accettabile per un utente davanti a una schermata.
 */
export const ATTESA_MASSIMA_INVOCAZIONE_MS = 20000

/**
 * Limite (secondi) dell'attesa della conferma sul dispositivo, SEMPRE questo.
 * Per il contratto (ca-rentri.yaml:2665) `expires_in` è la durata del SAD e
 * arriva solo insieme al `sad`, cioè quando l'autorizzazione è già concessa e
 * non c'è nulla da attendere: non dice per quanto l'utente può confermare. I
 * 60 secondi del contratto sono la durata del SAD, non il tempo concesso
 * all'utente; il limite è una scelta di WasteFlow.
 */
export const ATTESA_CONFERMA_FIRMA_PREDEFINITA_S = 120

/** Durata (ms) della presa esclusiva di una sessione per `sign-hash` + `acquisizione-firma`; poi la sessione e' ripresa o chiusa. */
export const DURATA_PRESA_FIRMA_MS = 120_000

/** Esito interno dell'attesa; il sad esiste solo se AUTORIZZATA. */
type EsitoAttesa =
  | { esito: 'AUTORIZZATA'; sad: string }
  | { esito: 'SCADUTA'; rilevataDa: 'ente' | 'orologio-locale'; dettaglioEnte?: string }
  | { esito: 'RIFIUTATA'; dettaglioEnte?: string }
  | { esito: 'IN_ATTESA'; scadenza: Date }

/**
 * Esito di {@link CompletaOperazioneConFirmaUseCase}. Unione discriminata,
 * NON una stringa da confrontare: i tre esiti non-eccezionali sono
 * distinguibili a livello di tipo dal chiamante (i Task 4-7), che deve
 * poterli tradurre in tre messaggi diversi senza fare match su testo.
 */
export type EsitoCompletamentoFirma =
  | {
      /** L'ente ha accettato la firma; `statoFormulario` è stato RILETTO dall'ente, non dedotto. */
      esito: 'COMPLETATA'
      statoFormulario: StatoFormulario
    }
  | {
      /**
       * L'autorizzazione è ancora valida ma l'utente non ha ancora
       * confermato sul proprio dispositivo. NON è un errore: è uno stato
       * legittimo, da mostrare come «in attesa di firma sul tuo dispositivo».
       */
      esito: 'IN_ATTESA'
      handle: string
      /** Sessione di firma da riprendere (`POST .../firme/:sessioneId/riprendi`). */
      sessioneId?: string
      /**
       * Limite di attesa calcolato da WasteFlow (120 s dalla richiesta), NON
       * una scadenza comunicata dall'ente: l'ente non ne dichiara una.
       */
      scadenzaAutorizzazione: Date
    }
  | {
      /**
       * L'autorizzazione non è più valida: va richiesta di nuovo da capo.
       * Nessuno stato è stato scritto.
       */
      esito: 'SCADUTA'
      handle: string
      /** Sessione chiusa come SCADUTA. */
      sessioneId?: string
      /**
       * Chi ha rilevato la scadenza — distinzione che il chiamante deve poter
       * fare a livello di tipo, senza ispezionare stringhe:
       * - `'ente'` → `authorize-check` ha risposto **400**. È la verità:
       *   l'ente considera morta l'autorizzazione.
       * - `'orologio-locale'` → il nostro limite di attesa (120 s) è trascorso
       *   prima che l'ente ci dicesse qualcosa. È un'inferenza sul NOSTRO orologio,
       *   che potrebbe non coincidere con quello dell'ente.
       */
      rilevataDa: 'ente' | 'orologio-locale'
      /** Causa comunicata dall'ente nel ProblemDetails (title/detail/model_state), se presente. */
      dettaglioEnte?: string
    }
  | {
      /**
       * L'ente non ha concesso l'autorizzazione (`authorize-check` → 403):
       * rifiuto dell'utente o operazione non consentita, vedi `dettaglioEnte`.
       * Diverso da `SCADUTA`: non è il tempo a essere finito — riproporre la
       * stessa operazione senza dirlo all'utente significherebbe insistere su
       * un rifiuto. Nessuno stato è stato scritto.
       */
      esito: 'RIFIUTATA'
      handle: string
      /** Sessione chiusa come RIFIUTATA. */
      sessioneId?: string
      /** Causa comunicata dall'ente nel ProblemDetails (title/detail/model_state), se presente. */
      dettaglioEnte?: string
    }

/** Parametri di {@link CompletaOperazioneConFirmaUseCase.execute}. */
export interface ComandoCompletaOperazioneConFirma {
  firId: string
  tenantId: string
  /**
   * Tipo dell'operazione che ha portato il formulario nello stato `Firma*`
   * (es. `'ACCETTAZIONE'`, `'ANNULLAMENTO'`). Usato SOLO per la
   * tracciabilità e per il testo che l'utente vede sul proprio dispositivo:
   * questo use case non conosce e non deve conoscere i dettagli
   * dell'operazione precedente.
   */
  tipoOperazione: string
  correlationId?: string
  /** V. {@link ATTESA_MASSIMA_INVOCAZIONE_MS}. Sovrascrivibile dai test e da un chiamante non interattivo. */
  attesaMassimaMs?: number
  /** V. {@link INTERVALLO_POLLING_AUTORIZZAZIONE_MS}. Sovrascrivibile dai test. */
  intervalloPollingMs?: number
  /** Utente che ha chiesto la firma: finisce sulla sessione, per la tracciabilita'. */
  utenteId?: string
  /**
   * Richiesta ESPLICITA di una nuova sessione. Senza, una sessione aperta ma scaduta chiude la
   * sessione come SCADUTA e restituisce `SCADUTA` senza mandare all'utente una nuova richiesta sul
   * telefono: la nuova sessione la decide la persona (pulsante del banner), non il codice.
   */
  nuovaSessione?: boolean
}

/**
 * Completa un'operazione RENTRI rimasta in attesa di firma, usando la
 * **firma remota RENTRI** (R3 Task 3).
 *
 * Decisione architetturale e sua motivazione:
 * `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md`. In sintesi: la
 * chiave privata non passa MAI da noi — è custodita dal sistema RENTRI, e
 * l'utente autorizza l'uso dal proprio dispositivo con l'app ufficiale
 * *RENTRI FIR Digitale*. Noi siamo il «canale primario» che chiede
 * l'autorizzazione e ne rileva l'esito in polling; non calcoliamo alcuna
 * firma e non chiamiamo mai `PUT /credentials/authorize-confirmation`
 * (quella è l'app dell'utente).
 *
 * ## Responsabilità del CHIAMANTE, non di questo use case
 *
 * Il chiamante (i Task 4-7: accettazione, annullamento, trasbordo, ...) ha
 * già eseguito la propria `POST` di dominio e il formulario è già in uno
 * stato `Firma*`. **Questo use case NON verifica che lo stato sia `Firma*`**:
 * è deliberatamente generico e non ha visibilità sull'operazione specifica
 * che l'ha preceduto, quindi non potrebbe sapere QUALE stato `Firma*`
 * attendersi. Si limita a portare il formulario da uno stato `Firma*` a un
 * esito stabile confermato dall'ente.
 *
 * ## Sequenza
 *
 * 1. Precondizioni locali (FIR, tenant, `rentriNumeroFir`, `credentials_id`).
 * 2. `GET /ca-rentri/.../credentials/info` → certificato.
 * 3. `POST /{numero_fir}/hash` → `digest_to_sign`, `token`.
 * 4. `POST /ca-rentri/.../credentials/authorize` → `handle`.
 * 5. Polling di `authorize-check` (202 → attendi, 200 → `sad`, autorizzata).
 * 6. `POST /ca-rentri/.../signatures/sign-hash` → firma.
 * 7. Verifica locale della firma (indicativa, mai bloccante — v.
 *    `verificaFirmaLocale`).
 * 8. `POST /{numero_fir}/acquisizione-firma` → esito dell'ente.
 * 9. Solo se l'esito è positivo: `GET /{numero_fir}/stato` e
 *    `FIR.applyRentriStato` con lo stato **letto dall'ente**.
 *
 * ## Fail-closed
 *
 * `applyRentriStato`/`save` sono invocati in UN SOLO punto, l'ultimo, e solo
 * dopo che l'ente ha confermato l'acquisizione della firma. Ogni altro esito
 * — autorizzazione rifiutata, scaduta, non ancora confermata, `sign-hash`
 * fallito, `acquisizione-firma` con `esito.errore: true` — esce prima, senza
 * toccare `rentriStatoFormulario`. Lo stato finale non viene MAI dedotto
 * («dopo un'accettazione dev'essere Accettato»): viene riletto dall'ente,
 * come già fa `GetAzioniDisponibiliUseCase`.
 *
 * ## Sessione di firma riprendibile (FIR in viaggio, P1)
 *
 * Il vecchio limite («`execute()` ricomincia sempre da `/hash` e manda una NUOVA autorizzazione») e'
 * chiuso: dopo `authorize` la sessione (handle, digest, token di `/hash`, scadenza) e' salvata in
 * `fir_sessioni_firma_rentri`, una sola `IN_ATTESA` per FIR. Una seconda invocazione sullo stesso FIR e
 * stessa operazione **riprende il polling dello stesso `handle`** con digest e token salvati: l'utente
 * vede una sola richiesta sul telefono, mai due. Se l'ente dice 400 o il limite dei 120 s e' passato
 * la sessione diventa SCADUTA e una nuova parte solo su richiesta esplicita (`nuovaSessione`).
 * Una sessione aperta per un'ALTRA operazione blocca con `SESSIONE_FIRMA_IN_CORSO` (409): prima va
 * ripresa o annullata (reset).
 */
@Injectable()
export class CompletaOperazioneConFirmaUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly credentialService: RentriCredentialService,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly rateLimiter: RentriRateLimiterService,
    private readonly sessioni: ISessioniFirmaRentriRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('CompletaOperazioneConFirmaUseCase')
  }

  async execute(comando: ComandoCompletaOperazioneConFirma): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, tipoOperazione, correlationId } = comando

    // --- 1. Precondizioni, tutte PRIMA di qualunque chiamata all'ente ---

    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw DomainException.notFound('FIR', firId)
    }
    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }
    // Fase 3 (D4): FIR importato = nessuna scrittura verso RENTRI prima della riconciliazione.
    verificaFirNonBloccato(fir)

    if (!fir.rentriNumeroFir) {
      throw DomainException.businessRuleViolation(
        'FIR_NON_LEGATO_RENTRI',
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è nulla da firmare presso l'ente."
      )
    }

    const credentialsId = await this.credentialService.getCredentialsIdFirmaRemota(tenantId)
    if (!credentialsId) {
      throw DomainException.businessRuleViolation(
        'CREDENZIALE_FIRMA_REMOTA_MANCANTE',
        'Configura la credenziale di firma remota RENTRI prima di completare questa operazione. ' +
          "Si ottiene dall'area Operatori del portale RENTRI (QR Code + PIN) e va inserita nella " +
          'configurazione RENTRI del tenant.'
      )
    }

    const numeroFir = fir.rentriNumeroFir

    // --- 1b. Sessione di firma gia' aperta su questo FIR? ---
    //
    // IN_ATTESA e valida: si RIPRENDE (nessuna seconda autorizzazione sul telefono). IN_AVVIO o
    // IN_FIRMA valide: un'altra richiesta sta lavorando su questo FIR, si rifiuta (409) senza toccare
    // l'ente. Scadute: IN_ATTESA -> SCADUTA (poi nuova sessione solo su richiesta esplicita); le altre
    // sono richieste morte a meta' (processo caduto) e si chiudono ANNULLATA.

    let sessione: SessioneFirmaRentri | null = await this.sessioni.trovaAperta(tenantId, firId)
    if (sessione && sessione.scadenza.getTime() <= Date.now()) {
      const eraInAttesa = sessione.stato === 'IN_ATTESA'
      await this.chiudiSessione(
        sessione,
        eraInAttesa ? 'SCADUTA' : 'ANNULLATA',
        eraInAttesa ? undefined : "Sessione rimasta a meta': scaduta senza completarsi"
      )
      if (eraInAttesa && sessione.tipoOperazione === tipoOperazione && !comando.nuovaSessione) {
        // Stessa operazione e nessuna richiesta esplicita: non si riparte da soli.
        return {
          esito: 'SCADUTA',
          handle: sessione.handle ?? '',
          sessioneId: sessione.id,
          rilevataDa: 'orologio-locale',
        }
      }
      sessione = null
    }
    if (
      sessione &&
      (sessione.tipoOperazione !== tipoOperazione || sessione.stato !== 'IN_ATTESA')
    ) {
      throw DomainException.businessRuleViolation(
        'SESSIONE_FIRMA_IN_CORSO',
        sessione.tipoOperazione !== tipoOperazione
          ? `Su questo formulario c'e' gia' una firma in attesa di conferma (${sessione.tipoOperazione}): ` +
              "riprendila oppure annulla la richiesta prima di avviare un'altra firma."
          : "Un'altra richiesta di firma su questo formulario e' appena partita o sta firmando: " +
              'attendi qualche secondo e controlla di nuovo.'
      )
    }

    let certificato: string
    let digestToSign: string
    let token: string
    let handle: string
    let statoAutorizzazione: EsitoAttesa

    if (sessione) {
      // --- Ripresa: stessi digest, token e handle della sessione salvata. Nessuna chiamata a `/hash`
      // ne' ad `authorize`.
      certificato = await this.rentriApiClient.leggiCertificatoFirmaRemota(tenantId, credentialsId)
      digestToSign = sessione.digestToSign ?? ''
      token = sessione.tokenAcquisizione ?? ''
      handle = sessione.handle ?? ''
      this.logger.info('Firma remota RENTRI: ripresa della sessione in attesa', {
        firId,
        tenantId,
        numeroFir,
        tipoOperazione,
        sessioneId: sessione.id,
        correlationId,
      })
      statoAutorizzazione = await this.attendiAutorizzazione(
        tenantId,
        { handle },
        comando,
        sessione.scadenza.getTime()
      )
    } else {
      // --- Nuova sessione. La riga si PRENOTA prima di toccare l'ente: vince sempre l'INSERT (indice
      // unico parziale), chi perde la corsa riceve 409 senza aver mandato nulla al telefono.
      try {
        sessione = await this.sessioni.prenota({
          tenantId,
          firId,
          tipoOperazione,
          scadenza: new Date(Date.now() + ATTESA_CONFERMA_FIRMA_PREDEFINITA_S * 1000),
          utenteId: comando.utenteId ?? null,
        })
      } catch (errore) {
        if (errore instanceof SessioneFirmaGiaApertaError) {
          throw DomainException.businessRuleViolation(
            'SESSIONE_FIRMA_IN_CORSO',
            "Un'altra richiesta di firma su questo formulario e' appena partita: riprendila " +
              'invece di avviarne una nuova.'
          )
        }
        throw errore
      }
      const prenotata = sessione

      let sadImmediato: string | undefined
      try {
        // --- 2. Certificato della credenziale di firma remota ---
        certificato = await this.rentriApiClient.leggiCertificatoFirmaRemota(
          tenantId,
          credentialsId
        )

        // --- 3. Digest da firmare ---
        const hash = await this.rentriApiClient.richiediHashPerFirma(
          tenantId,
          numeroFir,
          certificato
        )
        digestToSign = hash.digestToSign
        token = hash.token

        // --- 4. Autorizzazione (l'utente riceve la notifica sul dispositivo) ---
        const autorizzazione = await this.rentriApiClient.autorizzaFirmaRemota(tenantId, {
          credentialsId,
          digestToSign,
          // È l'unico testo che l'utente vede prima di confermare: deve dirgli
          // COSA sta firmando, in italiano, non un identificativo tecnico. I
          // caratteri che il contratto non ammette (es. `_` del numero FIR) sono
          // già sostituiti dalla funzione.
          description: descrizioneAutorizzazioneFirma(numeroFir, tipoOperazione),
        })
        handle = autorizzazione.handle
        sadImmediato = autorizzazione.sad

        this.logger.debug('Autorizzazione alla firma remota richiesta', {
          firId,
          tenantId,
          numeroFir,
          tipoOperazione,
          handle,
          correlationId,
        })

        const avviata = await this.sessioni.completaAvvio(tenantId, prenotata.id, {
          handle,
          tokenAcquisizione: token,
          digestToSign,
        })
        if (!avviata) {
          throw DomainException.businessRuleViolation(
            'SESSIONE_FIRMA_NON_ATTIVA',
            "La richiesta di firma e' stata annullata mentre partiva: avviala di nuovo."
          )
        }
      } catch (errore) {
        // Prima del telefono o subito dopo: la riga prenotata non deve bloccare il FIR.
        await this.chiudiSessione(
          prenotata,
          'ANNULLATA',
          errore instanceof Error ? errore.message : String(errore)
        )
        throw errore
      }

      // --- 5. Attesa della conferma dell'utente ---
      //
      // Se `authorize` ha già concesso (porta il `sad`) non c'è nulla da attendere; altrimenti il `sad`
      // arriva dall'esito AUTORIZZATA di `authorize-check`.
      statoAutorizzazione =
        sadImmediato !== undefined
          ? { esito: 'AUTORIZZATA', sad: sadImmediato }
          : await this.attendiAutorizzazione(
              tenantId,
              { handle },
              comando,
              prenotata.scadenza.getTime()
            )
    }

    if (statoAutorizzazione.esito !== 'AUTORIZZATA') {
      // Né errore né successo: nessuna scrittura di stato, in NESSUNO di
      // questi rami. Il chiamante li distingue dal tipo, non da una stringa.
      this.logger.info(
        'Firma remota non conclusa in questa invocazione: nessuno stato modificato',
        {
          firId,
          tenantId,
          numeroFir,
          tipoOperazione,
          esito: statoAutorizzazione.esito,
          rilevataDa:
            statoAutorizzazione.esito === 'SCADUTA' ? statoAutorizzazione.rilevataDa : undefined,
          correlationId,
        }
      )

      const sessioneId = sessione?.id
      switch (statoAutorizzazione.esito) {
        case 'SCADUTA':
          await this.chiudiSessione(sessione, 'SCADUTA', statoAutorizzazione.dettaglioEnte)
          return {
            esito: 'SCADUTA',
            handle,
            ...(sessioneId && { sessioneId }),
            rilevataDa: statoAutorizzazione.rilevataDa,
            ...(statoAutorizzazione.dettaglioEnte && {
              dettaglioEnte: statoAutorizzazione.dettaglioEnte,
            }),
          }
        case 'RIFIUTATA':
          await this.chiudiSessione(sessione, 'RIFIUTATA', statoAutorizzazione.dettaglioEnte)
          return {
            esito: 'RIFIUTATA',
            handle,
            ...(sessioneId && { sessioneId }),
            ...(statoAutorizzazione.dettaglioEnte && {
              dettaglioEnte: statoAutorizzazione.dettaglioEnte,
            }),
          }
        default:
          // IN_ATTESA: la sessione RESTA aperta, e' proprio quella che si riprende.
          return {
            esito: 'IN_ATTESA',
            handle,
            ...(sessioneId && { sessioneId }),
            scadenzaAutorizzazione: statoAutorizzazione.scadenza,
          }
      }
    }

    // --- Presa esclusiva della sessione prima di firmare ---
    //
    // Due riprese concorrenti arrivano entrambe ad AUTORIZZATA con lo stesso `sad`: una sola puo'
    // chiamare `sign-hash` e `acquisizione-firma`. Chi perde restituisce IN_ATTESA (il banner si
    // aggiorna da solo alla rilettura) senza firmare. La presa ha una scadenza di sicurezza.
    if (
      sessione &&
      !(await this.sessioni.prendiPerFirma(
        tenantId,
        sessione.id,
        new Date(Date.now() + DURATA_PRESA_FIRMA_MS)
      ))
    ) {
      return {
        esito: 'IN_ATTESA',
        handle,
        sessioneId: sessione.id,
        scadenzaAutorizzazione: sessione.scadenza,
      }
    }

    // Da qui l'autorizzazione e' concessa: se un passo lancia (sign-hash, rete...) la sessione NON deve
    // restare aperta a bloccare il FIR per sempre; si chiude ANNULLATA e l'errore risale.
    const sadAutorizzato = statoAutorizzazione.sad
    try {
      // --- 6. Firma vera e propria, lato HSM RENTRI ---

      const firma = await this.rentriApiClient.firmaHashRemoto(tenantId, {
        credentialsId,
        sad: sadAutorizzato,
        digestToSign,
      })

      // --- 7. Verifica locale: SEMPRE eseguita, MAI bloccante ---
      //
      // V. il commento di `verificaFirmaLocale` per il motivo per cui un esito
      // negativo non ferma l'operazione: il controllo è indicativo (l'API di
      // Node ri-hasha il digest, mentre l'ente firma in prehash) e l'autorità
      // sull'esito resta l'ente. Silenziarlo però sarebbe peggio: se un giorno
      // fallisse sistematicamente, questo warning è l'unica traccia.
      const firmaVerificata = verificaFirmaLocale(certificato, digestToSign, firma)
      if (firmaVerificata) {
        this.logger.debug('Verifica locale della firma remota: esito positivo', {
          firId,
          numeroFir,
          correlationId,
        })
      } else {
        this.logger.warn(
          'Verifica locale della firma remota NON riuscita (controllo indicativo, non bloccante): ' +
            "l'esito dell'operazione resta determinato dall'ente.",
          { firId, tenantId, numeroFir, tipoOperazione, correlationId }
        )
      }

      // --- 8. Trasmissione della firma all'ente ---

      const esitoAcquisizione = await this.rentriApiClient.inviaAcquisizioneFirma(
        tenantId,
        numeroFir,
        { certificato, token, firma }
      )

      if (esitoAcquisizione.errore) {
        // L'ente ha rifiutato la firma: nessuno stato scritto, messaggio
        // leggibile invece di un successo apparente.
        await this.chiudiSessione(
          sessione,
          'RIFIUTATA',
          JSON.stringify(esitoAcquisizione.validazione)
        )
        throw DomainException.businessRuleViolation(
          'FIRMA_RENTRI_RIFIUTATA',
          "L'ente ha rifiutato la firma del formulario " +
            `${numeroFir}: l'operazione ${tipoOperazione} NON è stata completata. ` +
            `Dettaglio della validazione RENTRI: ${JSON.stringify(esitoAcquisizione.validazione)}`
        )
      }

      // L'ente ha acquisito la firma: la sessione e' COMPLETATA anche se la rilettura che segue fallisse
      // (il FIR si riallinea alla prossima lettura di /azioni).
      await this.chiudiSessione(sessione, 'COMPLETATA')

      // --- 9. Stato finale: LETTO dall'ente, mai dedotto ---

      const statoEnte = await this.rentriApiClient.leggiStato(tenantId, numeroFir)
      fir.applyRentriStato(statoEnte.stato_formulario, correlationId)
      await this.firRepository.save(fir)

      this.logger.info('Operazione RENTRI completata con firma remota', {
        firId,
        tenantId,
        numeroFir,
        tipoOperazione,
        statoFormulario: statoEnte.stato_formulario,
        correlationId,
      })

      return { esito: 'COMPLETATA', statoFormulario: statoEnte.stato_formulario }
    } catch (errore) {
      await this.chiudiSessione(
        sessione,
        'ANNULLATA',
        errore instanceof Error ? errore.message : String(errore)
      )
      throw errore
    }
  }

  /** Chiude la sessione (se c'e' e se e' ancora aperta). Un errore di database qui non deve mai far perdere l'esito dell'ente. */
  private async chiudiSessione(
    sessione: SessioneFirmaRentri | null,
    stato: StatoSessioneChiusa,
    dettaglioEnte?: string
  ): Promise<void> {
    if (!sessione) return
    try {
      await this.sessioni.chiudi(
        sessione.tenantId,
        sessione.id,
        stato,
        dettaglioEnte?.slice(0, 2000)
      )
    } catch (errore) {
      this.logger.warn('Chiusura della sessione di firma RENTRI non riuscita', {
        sessioneId: sessione.id,
        stato,
        errore: errore instanceof Error ? errore.message : String(errore),
      })
    }
  }

  /**
   * Attende la conferma dell'utente interrogando `authorize-check`.
   *
   * Il ciclo termina per una di QUATTRO ragioni, tutte tipizzate:
   * - l'ente conferma → `AUTORIZZATA`, con il `sad` da usare per la firma;
   * - l'ente dichiara scaduta l'autorizzazione (400) → `SCADUTA`
   *   (`rilevataDa: 'ente'`) — è la verità, e ha la precedenza sul nostro
   *   orologio: si esce SUBITO, senza attendere che scada anche il nostro
   *   limite di attesa calcolato;
   * - l'ente non concede l'autorizzazione (403: rifiuto dell'utente o operazione
   *   non consentita) → `RIFIUTATA`;
   * - scade un nostro limite: {@link ATTESA_CONFERMA_FIRMA_PREDEFINITA_S}
   *   (120 s, mai un `expires_in`) calcolato localmente → `SCADUTA`
   *   (`rilevataDa: 'orologio-locale'`), oppure il tetto di questa
   *   invocazione ({@link ATTESA_MASSIMA_INVOCAZIONE_MS}) → `IN_ATTESA`, con
   *   l'autorizzazione ancora valida.
   *
   * Ogni singola interrogazione acquisisce e rilascia capacità dal rate
   * limiter per-tenant: la capacità NON viene tenuta per tutta la durata
   * dell'attesa dell'utente (potrebbero essere minuti), perché
   * bloccherebbe ogni altra operazione RENTRI dello stesso tenant per un
   * tempo che dipende da quando una persona prende in mano il telefono. Il
   * rilascio è in `finally`: uno slot di concorrenza non rilasciato
   * resterebbe occupato fino alla potatura per età.
   */
  private async attendiAutorizzazione(
    tenantId: string,
    autorizzazione: { handle: string },
    comando: ComandoCompletaOperazioneConFirma,
    scadenzaEnteMs: number
  ): Promise<EsitoAttesa> {
    const intervalloMs = comando.intervalloPollingMs ?? INTERVALLO_POLLING_AUTORIZZAZIONE_MS
    const attesaMassimaMs = comando.attesaMassimaMs ?? ATTESA_MASSIMA_INVOCAZIONE_MS

    const scadenzaInvocazioneMs = Date.now() + attesaMassimaMs

    for (;;) {
      const stato = await this.interrogaAutorizzazione(tenantId, autorizzazione.handle)
      if (stato.stato === 'AUTORIZZATA') {
        return { esito: 'AUTORIZZATA', sad: stato.sad }
      }
      // L'ente ha parlato: la sua parola vince sul nostro orologio, e si esce
      // subito invece di continuare a interrogare un'autorizzazione morta.
      if (stato.stato === 'SCADUTA') {
        return { esito: 'SCADUTA', rilevataDa: 'ente', dettaglioEnte: stato.dettaglioEnte }
      }
      if (stato.stato === 'RIFIUTATA') {
        return { esito: 'RIFIUTATA', dettaglioEnte: stato.dettaglioEnte }
      }

      const adesso = Date.now()
      if (adesso >= scadenzaEnteMs) {
        return { esito: 'SCADUTA', rilevataDa: 'orologio-locale' }
      }
      if (adesso >= scadenzaInvocazioneMs) {
        return { esito: 'IN_ATTESA', scadenza: new Date(scadenzaEnteMs) }
      }

      // Non attendere oltre nessuna delle due scadenze: un'attesa che le
      // scavalca ritarderebbe l'esito senza cambiarlo.
      const prossimaScadenza = Math.min(scadenzaEnteMs, scadenzaInvocazioneMs)
      await this.attendi(Math.max(0, Math.min(intervalloMs, prossimaScadenza - adesso)))
    }
  }

  /** Una sola interrogazione, con acquisizione/rilascio della capacità per-tenant. */
  private async interrogaAutorizzazione(
    tenantId: string,
    handle: string
  ): Promise<EsitoVerificaAutorizzazione> {
    const permesso = await this.rateLimiter.acquisisci(tenantId)
    try {
      return await this.rentriApiClient.verificaAutorizzazioneFirma(tenantId, handle)
    } finally {
      await permesso.rilascia()
    }
  }

  private attendi(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
