import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { RentriCredentialService } from '../../infrastructure/rentri/rentri-credential.service'
import { RentriRateLimiterService } from '../../infrastructure/rentri/rentri-rate-limiter.service'
import { verificaFirmaLocale } from '../../infrastructure/rentri/rentri-firma-verifica.util'
import { StatoFormulario } from '../../domain/fir/aggregates/fir.aggregate'

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
 * Tetto (ms) di attesa dell'INVOCAZIONE, distinto dal tetto dell'ente
 * (`expires_in`).
 *
 * `expires_in` dice per quanto l'autorizzazione resta valida (può essere
 * minuti); questo dice per quanto QUESTA chiamata resta ad aspettare prima
 * di restituire `IN_ATTESA` e lasciare che sia il chiamante a decidere se
 * ripresentarsi. Senza, una richiesta HTTP interattiva resterebbe appesa
 * per l'intera durata di `expires_in` — precisamente lo spinner indefinito
 * che il piano vieta. 20 s è la soglia oltre la quale un'attesa sincrona
 * smette di essere accettabile per un utente davanti a una schermata.
 */
export const ATTESA_MASSIMA_INVOCAZIONE_MS = 20000

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
      /** Istante oltre il quale l'autorizzazione non sarà più valida. */
      scadenzaAutorizzazione: Date
    }
  | {
      /**
       * `expires_in` è trascorso senza che l'utente confermasse:
       * l'autorizzazione va richiesta di nuovo da capo. Nessuno stato è
       * stato scritto.
       */
      esito: 'SCADUTA'
      handle: string
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
 * 4. `POST /ca-rentri/.../credentials/authorize` → `sad`, `handle`, `expires_in`.
 * 5. Polling di `authorize-check` (202 → attendi, 200 → autorizzata).
 * 6. `POST /ca-rentri/.../credentials/sign-hash` → firma.
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
 */
@Injectable()
export class CompletaOperazioneConFirmaUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly credentialService: RentriCredentialService,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly rateLimiter: RentriRateLimiterService,
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

    // --- 2. Certificato della credenziale di firma remota ---

    const certificato = await this.rentriApiClient.leggiCertificatoFirmaRemota(
      tenantId,
      credentialsId
    )

    // --- 3. Digest da firmare ---

    const { digestToSign, token } = await this.rentriApiClient.richiediHashPerFirma(
      tenantId,
      numeroFir,
      certificato
    )

    // --- 4. Autorizzazione (l'utente riceve la notifica sul dispositivo) ---

    const autorizzazione = await this.rentriApiClient.autorizzaFirmaRemota(tenantId, {
      credentialsId,
      digestToSign,
      // È l'unico testo che l'utente vede prima di confermare: deve dirgli
      // COSA sta firmando, in italiano, non un identificativo tecnico.
      description: `Firma del formulario ${numeroFir} — operazione ${tipoOperazione}`,
    })

    this.logger.debug('Autorizzazione alla firma remota richiesta', {
      firId,
      tenantId,
      numeroFir,
      tipoOperazione,
      handle: autorizzazione.handle,
      expiresIn: autorizzazione.expiresIn,
      correlationId,
    })

    // --- 5. Attesa della conferma dell'utente ---

    const statoAutorizzazione = await this.attendiAutorizzazione(tenantId, autorizzazione, comando)

    if (statoAutorizzazione.esito !== 'AUTORIZZATA') {
      // Né errore né successo: nessuna scrittura di stato, in nessuno dei due
      // rami. Il chiamante distingue i due casi dal tipo, non da una stringa.
      this.logger.info(
        'Firma remota non conclusa in questa invocazione: nessuno stato modificato',
        {
          firId,
          tenantId,
          numeroFir,
          tipoOperazione,
          esito: statoAutorizzazione.esito,
          correlationId,
        }
      )
      return statoAutorizzazione.esito === 'SCADUTA'
        ? { esito: 'SCADUTA', handle: autorizzazione.handle }
        : {
            esito: 'IN_ATTESA',
            handle: autorizzazione.handle,
            scadenzaAutorizzazione: statoAutorizzazione.scadenza,
          }
    }

    // --- 6. Firma vera e propria, lato HSM RENTRI ---

    const firma = await this.rentriApiClient.firmaHashRemoto(tenantId, {
      credentialsId,
      sad: autorizzazione.sad,
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
      throw DomainException.businessRuleViolation(
        'FIRMA_RENTRI_RIFIUTATA',
        "L'ente ha rifiutato la firma del formulario " +
          `${numeroFir}: l'operazione ${tipoOperazione} NON è stata completata. ` +
          `Dettaglio della validazione RENTRI: ${JSON.stringify(esitoAcquisizione.validazione)}`
      )
    }

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
  }

  /**
   * Attende la conferma dell'utente interrogando `authorize-check`, con DUE
   * limiti indipendenti:
   * - la scadenza dell'ente (`expires_in`) → oltre, l'esito è `SCADUTA`;
   * - il tetto di questa invocazione ({@link ATTESA_MASSIMA_INVOCAZIONE_MS})
   *   → oltre, l'esito è `IN_ATTESA` e l'autorizzazione resta valida.
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
    autorizzazione: { handle: string; expiresIn: number },
    comando: ComandoCompletaOperazioneConFirma
  ): Promise<
    { esito: 'AUTORIZZATA' } | { esito: 'SCADUTA' } | { esito: 'IN_ATTESA'; scadenza: Date }
  > {
    const intervalloMs = comando.intervalloPollingMs ?? INTERVALLO_POLLING_AUTORIZZAZIONE_MS
    const attesaMassimaMs = comando.attesaMassimaMs ?? ATTESA_MASSIMA_INVOCAZIONE_MS

    const scadenzaEnteMs = Date.now() + autorizzazione.expiresIn * 1000
    const scadenzaInvocazioneMs = Date.now() + attesaMassimaMs

    for (;;) {
      const stato = await this.interrogaAutorizzazione(tenantId, autorizzazione.handle)
      if (stato === 'AUTORIZZATA') {
        return { esito: 'AUTORIZZATA' }
      }

      const adesso = Date.now()
      if (adesso >= scadenzaEnteMs) {
        return { esito: 'SCADUTA' }
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
  ): Promise<'IN_ATTESA' | 'AUTORIZZATA'> {
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
