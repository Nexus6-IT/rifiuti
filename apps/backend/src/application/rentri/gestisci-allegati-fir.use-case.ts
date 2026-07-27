import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  RENTRIApiClient,
  estraiAllegatoIdDaEsito,
} from '../../infrastructure/rentri/rentri-api.client'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'

/** Tipo di documento ammesso dal contratto per `POST /{numero_fir}/allegato`. */
const CONTENT_TYPE_AMMESSO = 'application/pdf'

/** Parametri di {@link GestisciAllegatiFIRUseCase.caricaAllegato}. */
export interface ComandoCaricaAllegato {
  firId: string
  tenantId: string
  /** Utente che carica l'allegato (FK obbligatoria su `FIRAllegatoRentri.caricatoDa`). */
  userId: string
  nomeFile: string
  contentType: string
  /** Contenuto GIA' codificato base64, come richiesto dal contratto. */
  contenutoBase64: string
  correlationId?: string
}

/** Riga locale di {@link GestisciAllegatiFIRUseCase}, in forma di dominio. */
export interface AllegatoFIR {
  id: string
  rentriAllegatoId: number
  filename: string
  mimeType: string
  sizeBytes: number
  caricatoDa: string
  caricatoAlle: Date
}

/** Parametri di {@link GestisciAllegatiFIRUseCase.eliminaAllegato}. */
export interface ComandoEliminaAllegato {
  firId: string
  tenantId: string
  /** Chiave primaria LOCALE della riga (`FIRAllegatoRentri.id`), non l'`allegato_id` dell'ente. */
  allegatoLocaleId: string
  correlationId?: string
}

/**
 * Gestisce gli allegati di un formulario RENTRI (R3 Task 6):
 * `POST/GET/DELETE /{numero_fir}/allegato` (`docs/contracts/rentri/formulari.yaml`,
 * righe 776-1017).
 *
 * Sostituisce l'uso — mai realizzato, nessuna occorrenza nel codice —
 * previsto per il generico `FIR.attachmentUrls Json?`: quel campo non
 * tipizzava il singolo allegato e non permetteva di elencarli o cancellarli
 * singolarmente. `FIRAllegatoRentri` (Prisma) è la tabella dedicata: una riga
 * per allegato, creata SOLO dopo la conferma dell'ente, cancellata SOLO dopo
 * la sua conferma.
 *
 * A differenza di accettazione/annullamento (Task 4/5), **questa operazione
 * non apre un ciclo di firma remota**: il contratto dichiara esplicitamente
 * (riga 788) che il file aggiunto all'xFIR "non necessita di essere
 * firmato" — l'esito del polling NONBLOCK_PULL di
 * `RENTRIApiClient.caricaAllegato`/`eliminaAllegato` è definitivo così
 * com'è, nessuna chiamata a `CompletaOperazioneConFirmaUseCase`.
 *
 * **Il vincolo di dimensione (Step 2 del piano) è verificato QUI, PRIMA di
 * qualunque chiamata di rete — nemmeno `/azioni`**: un allegato oltre il
 * limite è una richiesta non valida, e RENTRI conta le richieste non valide
 * contro il chiamante fino al "ban" (423, v. commento di classe di
 * `RENTRIApiClient.LIMITE_ALLEGATO_BYTES`). Il limite usato è quello
 * **dichiarato dal contratto per QUESTO endpoint** (1 MB,
 * `DatiAllegatoModel.contenuto`, formulari.yaml riga 6926) — non i 3 MB
 * dell'xFIR risultante (vincolo sul FIR nel suo complesso, non verificabile
 * localmente prima dell'upload) né i 5 MB di xFIR/copia cartacea interi
 * (vincoli di altri oggetti).
 */
@Injectable()
export class GestisciAllegatiFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly prisma: PrismaService,
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('GestisciAllegatiFIRUseCase')
  }

  /**
   * Carica un allegato. **Sequenza fail-closed, in ordine:**
   * 1. Precondizioni sul FIR (esiste, tenant coincide, legato a RENTRI).
   * 2. Validazione locale di formato (solo PDF) e dimensione (1 MB) — PRIMA
   *    di QUALUNQUE chiamata di rete, `/azioni` compresa: un allegato
   *    rifiutato qui non genera MAI una richiesta verso l'ente.
   * 3. Precondizione da `/azioni`: `'Allegato'` deve comparire — se assente,
   *    nessuna chiamata a `caricaAllegato`.
   * 4. Risolve `identificativo_soggetto` (CF del soggetto a cui riferire
   *    l'allegato) dal codice fiscale del TENANT — stessa fonte, stesso
   *    principio fail-closed (`CF_TENANT_MANCANTE`) già usato da
   *    `GetAzioniDisponibiliUseCase` per il proprio `identificativo_soggetto`
   *    di query: nessuna ragione di chiedere questo CF al chiamante (FE)
   *    quando il backend lo conosce già e verificarlo qui evita che un
   *    client possa inviarne uno arbitrario.
   * 5. `RENTRIApiClient.caricaAllegato` — se l'ente rifiuta (`esito.errore`),
   *    errore di dominio leggibile, NESSUNA riga locale creata.
   * 6. Se l'ente conferma ma non restituisce `allegato_id` in una forma
   *    leggibile, errore esplicito: senza quell'id non è possibile in futuro
   *    scaricare o cancellare l'allegato, quindi non ha senso registrarlo
   *    come se tutto fosse andato bene.
   * 7. Persistenza locale (`FIRAllegatoRentri`), SOLO ora.
   */
  async caricaAllegato(comando: ComandoCaricaAllegato): Promise<AllegatoFIR> {
    const { firId, tenantId, userId, nomeFile, contentType, contenutoBase64, correlationId } =
      comando

    // --- 1. Precondizioni sul FIR ---

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
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è alcun formulario a cui allegare un file."
      )
    }

    // --- 2. Validazione locale, PRIMA di qualunque rete (nemmeno /azioni) ---

    if (contentType !== CONTENT_TYPE_AMMESSO) {
      throw DomainException.businessRuleViolation(
        'FORMATO_ALLEGATO_NON_AMMESSO',
        `Il formato '${contentType}' non è ammesso: l'ente accetta solo file PDF ('${CONTENT_TYPE_AMMESSO}').`
      )
    }

    const sizeBytes = GestisciAllegatiFIRUseCase.byteLengthDaBase64(contenutoBase64)
    if (sizeBytes > RENTRIApiClient.LIMITE_ALLEGATO_BYTES) {
      throw DomainException.businessRuleViolation(
        'ALLEGATO_TROPPO_GRANDE',
        `Il file supera 1 MB (${sizeBytes} byte): l'ente rifiuta allegati oltre questa dimensione. ` +
          'Nessuna richiesta è stata inviata a RENTRI.'
      )
    }

    // --- 3. Precondizione da /azioni: 'Allegato' deve comparire ---

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const allegatoDisponibile = azioni.some(azione => azione.operazione === 'Allegato')
    if (!allegatoDisponibile) {
      throw DomainException.businessRuleViolation(
        'ALLEGATO_NON_DISPONIBILE',
        'Questo formulario non è (più) nella fase in cui è possibile aggiungere allegati ' +
          "(l'ente non lo consente negli stati Annullato/FirmaAnnullamento): nessuna richiesta è stata inviata."
      )
    }

    const numeroFir = fir.rentriNumeroFir

    // --- 4. Risoluzione di identificativo_soggetto dal CF del tenant ---

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { codiceFiscale: true },
    })
    if (!tenant?.codiceFiscale) {
      throw DomainException.businessRuleViolation(
        'CF_TENANT_MANCANTE',
        "Codice fiscale dell'azienda non configurato: impossibile allegare un file a RENTRI. " +
          'Configuralo nei dati anagrafici del tenant.'
      )
    }

    // --- 5. Caricamento presso l'ente ---

    const esito = await this.rentriApiClient.caricaAllegato(tenantId, numeroFir, {
      contentType,
      nomeFile,
      contenutoBase64,
      identificativoSoggetto: tenant.codiceFiscale,
    })

    if (esito.errore) {
      throw DomainException.businessRuleViolation(
        'ALLEGATO_RENTRI_RIFIUTATO',
        `L'ente ha rifiutato l'allegato del formulario ${numeroFir}. ` +
          `Dettaglio della validazione RENTRI: ${JSON.stringify(esito.validazione)}`
      )
    }

    // --- 6. allegato_id leggibile? Senza, non registriamo nulla ---

    const rentriAllegatoId = estraiAllegatoIdDaEsito(esito)
    if (rentriAllegatoId === undefined) {
      throw new DomainException(
        `L'ente ha confermato l'aggiunta dell'allegato al formulario ${numeroFir}, ma non ha ` +
          "restituito un 'allegato_id' leggibile: l'allegato NON è stato registrato localmente " +
          '(non sarebbe possibile scaricarlo o cancellarlo in seguito senza questo identificativo).',
        'ALLEGATO_ID_MANCANTE'
      )
    }

    // --- 7. Persistenza locale, SOLO ora ---

    const riga = await this.prisma.fIRAllegatoRentri.create({
      data: {
        firId,
        rentriAllegatoId,
        filename: nomeFile,
        mimeType: contentType,
        sizeBytes,
        caricatoDa: userId,
      },
    })

    this.logger.info('Allegato RENTRI caricato e registrato localmente', {
      firId,
      tenantId,
      numeroFir,
      rentriAllegatoId,
      sizeBytes,
      correlationId,
    })

    return GestisciAllegatiFIRUseCase.mappaRiga(riga)
  }

  /**
   * Elenca gli allegati registrati localmente per il FIR (lettura pura, mai
   * una chiamata a RENTRI: l'elenco locale È la fonte di verità di ciò che
   * WasteFlow ha caricato con successo — v. commento di classe).
   */
  async elencaAllegati(firId: string, tenantId: string): Promise<AllegatoFIR[]> {
    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw DomainException.notFound('FIR', firId)
    }
    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }

    const righe = await this.prisma.fIRAllegatoRentri.findMany({
      where: { firId },
      orderBy: { caricatoAlle: 'desc' },
    })
    return righe.map(GestisciAllegatiFIRUseCase.mappaRiga)
  }

  /**
   * Elimina un allegato. **Sequenza fail-closed, in ordine:**
   * 1. Precondizioni sul FIR + la riga locale deve esistere PER QUESTO FIR.
   * 2. Precondizione da `/azioni`: `'Allegato'` deve comparire (il contratto
   *    non distingue un'operazione separata per la rimozione — stesso
   *    vincolo di stato dichiarato per l'aggiunta, riga 952).
   * 3. `RENTRIApiClient.eliminaAllegato` — se l'ente rifiuta, errore di
   *    dominio leggibile, la riga locale NON viene toccata (i due restano
   *    allineati: l'allegato esiste ancora su entrambi).
   * 4. Solo dopo la conferma dell'ente, cancellazione della riga locale. Se
   *    QUESTA fallisse, l'errore propaga COSÌ COM'È (mai inghiottito): un
   *    fallimento a metà — allegato rimosso su RENTRI ma non in locale — è
   *    un disallineamento che va dichiarato rumorosamente, non nascosto.
   */
  async eliminaAllegato(comando: ComandoEliminaAllegato): Promise<void> {
    const { firId, tenantId, allegatoLocaleId, correlationId } = comando

    // --- 1. Precondizioni sul FIR e sulla riga locale ---

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
        "Questo FIR non è legato a un formulario RENTRI: non c'è alcun allegato da eliminare presso l'ente."
      )
    }

    const riga = await this.prisma.fIRAllegatoRentri.findFirst({
      where: { id: allegatoLocaleId, firId },
    })
    if (!riga) {
      throw DomainException.notFound('FIRAllegatoRentri', allegatoLocaleId)
    }

    // --- 2. Precondizione da /azioni ---

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const allegatoDisponibile = azioni.some(azione => azione.operazione === 'Allegato')
    if (!allegatoDisponibile) {
      throw DomainException.businessRuleViolation(
        'ALLEGATO_NON_DISPONIBILE',
        'Questo formulario non è (più) nella fase in cui è possibile rimuovere allegati: ' +
          'nessuna richiesta è stata inviata a RENTRI.'
      )
    }

    const numeroFir = fir.rentriNumeroFir

    // --- 3. Eliminazione presso l'ente ---

    const esito = await this.rentriApiClient.eliminaAllegato(
      tenantId,
      numeroFir,
      riga.rentriAllegatoId
    )

    if (esito.errore) {
      throw DomainException.businessRuleViolation(
        'ALLEGATO_RENTRI_ELIMINAZIONE_RIFIUTATA',
        `L'ente ha rifiutato la rimozione dell'allegato dal formulario ${numeroFir}. ` +
          `Dettaglio della validazione RENTRI: ${JSON.stringify(esito.validazione)}. ` +
          'La riga locale NON è stata toccata: i due restano allineati.'
      )
    }

    // --- 4. Solo ora, cancellazione locale. Un fallimento qui NON viene
    // inghiottito: propaga così com'è, dichiarando il disallineamento. ---

    try {
      await this.prisma.fIRAllegatoRentri.delete({ where: { id: allegatoLocaleId } })
    } catch (error) {
      throw new DomainException(
        `L'allegato è stato rimosso con successo dal formulario ${numeroFir} presso l'ente, ` +
          `ma la cancellazione della copia locale (id ${allegatoLocaleId}) non è riuscita: ` +
          'RENTRI e WasteFlow sono ORA disallineati su questo allegato. Verificare manualmente.',
        'ALLEGATO_DISALLINEAMENTO_POST_ELIMINAZIONE'
      )
    }

    this.logger.info('Allegato RENTRI eliminato, su RENTRI e in locale', {
      firId,
      tenantId,
      numeroFir,
      rentriAllegatoId: riga.rentriAllegatoId,
      correlationId,
    })
  }

  /** Dimensione in byte del contenuto ORIGINALE codificato in base64. */
  private static byteLengthDaBase64(contenutoBase64: string): number {
    return Buffer.byteLength(contenutoBase64, 'base64')
  }

  private static mappaRiga(riga: {
    id: string
    rentriAllegatoId: number
    filename: string
    mimeType: string
    sizeBytes: number
    caricatoDa: string
    caricatoAlle: Date
  }): AllegatoFIR {
    return {
      id: riga.id,
      rentriAllegatoId: riga.rentriAllegatoId,
      filename: riga.filename,
      mimeType: riga.mimeType,
      sizeBytes: riga.sizeBytes,
      caricatoDa: riga.caricatoDa,
      caricatoAlle: riga.caricatoAlle,
    }
  }
}
