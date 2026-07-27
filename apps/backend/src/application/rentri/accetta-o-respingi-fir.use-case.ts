import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import {
  CompletaOperazioneConFirmaUseCase,
  EsitoCompletamentoFirma,
} from './completa-operazione-con-firma.use-case'

/** Parametri di {@link AccettaORespingiFIRUseCase.execute}. */
export interface ComandoAccettaORespingiFIR {
  firId: string
  tenantId: string
  tipoAccettazione: 'A' | 'P' | 'R'
  /** ISO 8601 UTC. Default: `new Date().toISOString()` se assente. */
  dataOraArrivo?: string
  quantitaAccettataKg?: number
  causaleRespingimento?: 'NC' | 'IR' | 'A'
  motivoRespingimento?: string
  attesaVerificaAnalitica?: boolean
  correlationId?: string
}

/** Esito di {@link AccettaORespingiFIRUseCase.execute}. */
export interface EsitoAccettaORespingiFIR {
  tipoAccettazione: 'A' | 'P' | 'R'
  esitoFirma: EsitoCompletamentoFirma
}

/**
 * Accetta o respinge (anche parzialmente) un carico da parte del
 * destinatario (R3 Task 4) — la PRIMA operazione di scrittura reale del
 * ciclo di vita del formulario digitale.
 *
 * `POST /{numero_fir}/accettazione` (`docs/contracts/rentri/formulari.yaml`,
 * righe 429-513) accetta `tipo_accettazione` come enum STRINGA `'A'|'P'|'R'`
 * (Accettato per intero / Accettato parzialmente / Respinto) — non un
 * intero. `quantita_accettata` (per 'A'/'P') e `causale_respingimento` +
 * `motivo_respingimento` (per 'P'/'R') sono richiesti "per business" (in
 * prosa nella `description` del contratto), MAI dal JSON Schema
 * `required`: questo use case è l'unico punto che li impone, PRIMA di
 * contattare l'ente — un respingimento senza motivazione, o uno scambio fra
 * `causaleRespingimento` (l'enum NC/IR/A) e `motivoRespingimento` (il testo
 * libero), sarebbe l'errore più grave possibile in questa sequenza.
 *
 * **Sequenza fail-closed, in ordine:**
 * 1. Precondizioni sul FIR (esiste, tenant coincide, legato a RENTRI) —
 *    stessi errori di dominio degli altri use case RENTRI.
 * 2. Validazione locale dei campi condizionali (sopra) — PRIMA di qualunque
 *    rete, ente compreso.
 * 3. Precondizione da `/azioni`: riusa {@link GetAzioniDisponibiliUseCase}
 *    (non duplica il lookup del CF tenant né la gestione di
 *    `CF_TENANT_MANCANTE`) per far riconciliare lo stato e verificare che
 *    `'Accettazione'` compaia nella lista — se assente, NESSUNA chiamata a
 *    `inviaAccettazione`.
 * 4. `RENTRIApiClient.inviaAccettazione` — se l'ente rifiuta (`esito.errore`),
 *    errore di dominio leggibile, NESSUNA chiamata a
 *    `CompletaOperazioneConFirmaUseCase` (l'operazione non è mai partita
 *    presso l'ente, non ha senso completarla con una firma).
 * 5. Se accettata dall'ente, il formulario è ora in stato `FirmaAccettazione`
 *    in attesa di firma: {@link CompletaOperazioneConFirmaUseCase} (R3
 *    Task 3, firma remota RENTRI) chiude il ciclo scrivi→firma→esito. Il suo
 *    esito (`EsitoCompletamentoFirma`, unione discriminata COMPLETATA/
 *    IN_ATTESA/SCADUTA/RIFIUTATA) è propagato senza alterazioni: questo use
 *    case non lo reinterpreta.
 */
@Injectable()
export class AccettaORespingiFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly completaOperazioneConFirmaUseCase: CompletaOperazioneConFirmaUseCase,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('AccettaORespingiFIRUseCase')
  }

  async execute(comando: ComandoAccettaORespingiFIR): Promise<EsitoAccettaORespingiFIR> {
    const { firId, tenantId, tipoAccettazione, correlationId } = comando

    // --- 1. Precondizioni sul FIR, PRIMA di qualunque validazione o rete ---

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
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è alcun carico da accettare o respingere presso l'ente."
      )
    }

    // --- 2. Validazione locale dei campi condizionali, PRIMA di contattare l'ente ---

    this.validaCampiCondizionali(comando)

    // --- 3. Precondizione da /azioni: riusa GetAzioniDisponibiliUseCase ---
    //
    // Riconcilia anche lo stato del FIR PRIMA di scrivere — la stessa difesa
    // in profondità già applicata dagli altri use case di scrittura RENTRI:
    // non fidarsi di una lettura precedente, ma di quella appena fatta.

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const accettazioneDisponibile = azioni.some(azione => azione.operazione === 'Accettazione')
    if (!accettazioneDisponibile) {
      throw DomainException.businessRuleViolation(
        'ACCETTAZIONE_NON_DISPONIBILE',
        'Questo formulario non è nella fase di accettazione: nessuna operazione è stata inviata a RENTRI.'
      )
    }

    const numeroFir = fir.rentriNumeroFir

    // --- 4. Scrittura presso l'ente ---

    const esito = await this.rentriApiClient.inviaAccettazione(tenantId, numeroFir, {
      tipoAccettazione,
      dataOraArrivo: comando.dataOraArrivo ?? new Date().toISOString(),
      quantitaAccettataKg: comando.quantitaAccettataKg,
      causaleRespingimento: comando.causaleRespingimento,
      motivoRespingimento: comando.motivoRespingimento,
      attesaVerificaAnalitica: comando.attesaVerificaAnalitica,
    })

    if (esito.errore) {
      throw DomainException.businessRuleViolation(
        'ACCETTAZIONE_RENTRI_RIFIUTATA',
        `L'ente ha rifiutato i dati di accettazione del formulario ${numeroFir}. ` +
          `Dettaglio della validazione RENTRI: ${JSON.stringify(esito.validazione)}`
      )
    }

    this.logger.info('Accettazione RENTRI inviata: formulario in attesa di firma', {
      firId,
      tenantId,
      numeroFir,
      tipoAccettazione,
      correlationId,
    })

    // --- 5. Chiusura del ciclo con la firma remota RENTRI (R3 Task 3) ---

    const esitoFirma = await this.completaOperazioneConFirmaUseCase.execute({
      firId,
      tenantId,
      tipoOperazione: 'ACCETTAZIONE',
      correlationId,
    })

    return { tipoAccettazione, esitoFirma }
  }

  /**
   * Impone i vincoli "per business" del contratto (mai nel JSON Schema
   * `required`, v. commento di classe): quantità per 'A'/'P', causale +
   * motivazione per 'P'/'R'. Lancia PRIMA di qualunque chiamata di rete
   * (né `/azioni` né `inviaAccettazione`).
   */
  private validaCampiCondizionali(comando: ComandoAccettaORespingiFIR): void {
    const { tipoAccettazione, quantitaAccettataKg, causaleRespingimento, motivoRespingimento } =
      comando

    if (
      (tipoAccettazione === 'A' || tipoAccettazione === 'P') &&
      (quantitaAccettataKg === undefined || quantitaAccettataKg === null)
    ) {
      throw DomainException.businessRuleViolation(
        'QUANTITA_ACCETTATA_MANCANTE',
        `La quantità accettata è obbligatoria per un'accettazione di tipo '${tipoAccettazione}' ` +
          '(intera o parziale).'
      )
    }

    if (tipoAccettazione === 'P' || tipoAccettazione === 'R') {
      if (!causaleRespingimento || !motivoRespingimento || motivoRespingimento.trim() === '') {
        throw DomainException.businessRuleViolation(
          'MOTIVAZIONE_RESPINGIMENTO_MANCANTE',
          'La causale e la motivazione del respingimento sono entrambe obbligatorie per un ' +
            "respingimento o un'accettazione parziale: indica sia la causale (non conformità, " +
            'irricevibile, altro) sia il motivo in testo libero.'
        )
      }
    }
  }
}
