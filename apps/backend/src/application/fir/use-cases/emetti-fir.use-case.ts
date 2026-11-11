/**
 * Emetti FIR Use Case - Application Layer
 * Business logic per emissione FIR con numero progressivo e firma
 *
 * Task 4 (pipeline P3): la firma del produttore non è più una costante
 * ('FIRMA-NON-QUALIFICATA') ma una firma crittografica reale, prodotta dal
 * sottosistema di firma digitale (DigitalSignatureService) sul documento
 * canonico del FIR (fir.aggregate.ts — l'aggregate "crittografico", separato
 * dal ciclo di vita qui gestito: si collegano i due, non si fondono).
 *
 * Fail-closed: se la firma non può essere prodotta (es. provider non
 * configurato, vedi Task 1), la transizione di stato NON avviene — il FIR
 * resta in BOZZA. Una transizione senza la firma richiesta è un difetto di
 * conformità, non una degradazione accettabile.
 *
 * R1 Task 2: subito dopo l'emissione (persistita), l'use case chiama
 * `TrasmettiFIRSecondoModalitaUseCase` — è QUESTO il punto di aggancio tra il
 * ciclo di vita del FIR e la trasmissione a RENTRI secondo la modalità del
 * tenant (AUTOMATICA/IBRIDA/MANUALE). Non un handler di eventi di dominio
 * (v. commento in `TrasmettiFIRSecondoModalitaUseCase` sul perché). Un
 * fallimento imprevisto dell'orchestrazione RENTRI NON deve invalidare
 * un'emissione altrimenti valida — un formulario emesso è un atto compiuto
 * indipendentemente da RENTRI, che ha una propria via di recupero (retry,
 * trigger manuale) — quindi viene isolato in un try/catch e solo loggato.
 */

import { FIR, FirmaDigitale } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { EmettiFIRCommand } from '../commands/emetti-fir.command'
import { FIRRepository as CryptoFIRRepository } from '../../../domain/fir/fir.repository'
import { DigitalSignatureService } from '../../signatures/digital-signature.service'
import { TrasmettiFIRSecondoModalitaUseCase } from '../../rentri/trasmetti-fir-secondo-modalita.use-case'
import { LoggerService } from '../../../core/logger/logger.service'
import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import {
  DomainError,
  FirAnnullatoNelFrattempoError,
  FirNonPiuInBozzaError,
  FirModificatoNelFrattempoError,
  FirNonModificabileError,
} from '../../../core/domain/errors'

/** Codice macchina del fallimento della firma del produttore (il frontend ferma l'emissione in serie). */
export const CODICE_FIRMA_NON_RIUSCITA = 'FIRMA_NON_RIUSCITA'

export class EmettiFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly cryptoFirRepository: CryptoFIRRepository,
    private readonly signatureService: DigitalSignatureService,
    private readonly trasmissioneRentri: TrasmettiFIRSecondoModalitaUseCase,
    private readonly logger: LoggerService
  ) {}

  async execute(command: EmettiFIRCommand): Promise<Result<FIR>> {
    // 1. Retrieve FIR aggregate (ciclo di vita)
    const fir = await this.firRepository.findById(command.firId)
    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${command.firId}`)
    }

    // 2. Firma crittografica del produttore, PRIMA di applicare la transizione:
    //    se fallisce lo use-case esce qui, il FIR resta BOZZA (fail-closed).
    //    Firmato intenzionalmente mentre il FIR è ancora BOZZA (firNumber non
    //    assegnato): il documento canonico esclude firNumber, quindi la firma
    //    resta verificabile dopo l'emissione (vedi toSignableDocument).
    let firma: FirmaDigitale
    try {
      firma = await this.firmaProduttore(command)
    } catch (error) {
      return Result.fail<FIR>(
        `Firma produttore non riuscita: ${error.message}`,
        CODICE_FIRMA_NON_RIUSCITA
      )
    }

    // 3-5. Numero progressivo, transizione di dominio e salvataggio in UNA transaction
    //    del repository, serializzata per tenant e anno di emissione (anno solare
    //    italiano dell'istante di emissione, non quello UTC del processo).
    //    È qui che il piano della scorta innesterà il consumo del numero vidimato
    //    (Decisione 7).
    //    Se fallisce, `applicaEmissione` può aver già mutato `fir` in memoria: l'aggregate
    //    NON si riusa né si salva, si restituisce l'errore.
    const anno = annoSolareItaliano(new Date())
    try {
      await this.firRepository.emettiConNumerazione(fir, anno, numero => fir.emetti(numero, firma))
    } catch (error) {
      // Conflitti di concorrenza: non sono un input sbagliato (400) ma una corsa persa (409,
      // risposta del filtro globale).
      if (
        error instanceof FirModificatoNelFrattempoError ||
        error instanceof FirAnnullatoNelFrattempoError ||
        error instanceof FirNonPiuInBozzaError ||
        error instanceof FirNonModificabileError
      ) {
        throw error
      }
      if (error instanceof DomainError) {
        return Result.fail<FIR>(`Failed to emit FIR: ${error.message}`)
      }
      throw error
    }

    // 6. Publish domain events (TODO: event bus integration)
    // await this.eventBus.publishAll(fir.domainEvents)
    // fir.clearDomainEvents()

    // 7. Trasmissione a RENTRI secondo la modalità del tenant (R1 Task 2):
    //    nessun intervento manuale richiesto in AUTOMATICA/IBRIDA, nulla
    //    parte da solo in MANUALE. Isolata: un errore qui non deve rendere
    //    fallita un'emissione già valida e persistita.
    let esitoRegistrato = false
    try {
      const esito = await this.trasmissioneRentri.eseguiSeAutomatica({
        firId: fir.id,
        tenantId: fir.tenantId ?? fir.produttoreId,
      })
      esitoRegistrato = esito?.esitoRegistrato === true
    } catch (error: any) {
      this.logger.error('Orchestrazione RENTRI non riuscita dopo l’emissione del FIR', error, {
        firId: fir.id,
      })
    }

    // L'orchestrazione ha salvato un esito RENTRI sul FIR (es. certificato mancante) su
    // un'istanza propria: l'aggregate in memoria e' ancora PENDING e la risposta lo
    // mostrerebbe «da trasmettere» fino al ricaricamento. Si rilegge; se non riesce si
    // ripiega sull'istanza in memoria (il DB e' comunque corretto).
    if (esitoRegistrato) {
      try {
        const riletto = await this.firRepository.findById(fir.id)
        if (riletto) return Result.ok<FIR>(riletto)
        this.logger.warn(
          'FIR non trovato nella rilettura dopo l’esito RENTRI: risposta con lo stato in memoria',
          {
            firId: fir.id,
          }
        )
      } catch (error: any) {
        this.logger.warn(
          'Rilettura del FIR dopo l’esito RENTRI non riuscita: risposta con lo stato in memoria',
          {
            firId: fir.id,
            // Solo il messaggio della causa: mai l'oggetto errore, che puo' portare dati del FIR.
            causa: error instanceof Error ? error.message : String(error),
          }
        )
      }
    }

    return Result.ok<FIR>(fir)
  }

  /**
   * Produce la firma crittografica del produttore invocando il sottosistema
   * di firma digitale sul documento canonico dello stesso FIR (stessa riga
   * fisica, letta tramite l'aggregate crittografico dedicato).
   */
  private async firmaProduttore(command: EmettiFIRCommand): Promise<FirmaDigitale> {
    const cryptoFir = await this.cryptoFirRepository.findById(command.firId)
    if (!cryptoFir) {
      throw new Error(`Documento firmabile non disponibile per FIR ${command.firId}`)
    }

    const document = cryptoFir.toSignableDocument()
    const signatureData = await this.signatureService.createSignature(document, command.userId)

    return {
      firmatario: command.firmatario,
      timestamp: new Date(),
      certificato: signatureData.signatureValue,
      userId: command.userId,
      documentHash: signatureData.documentHash,
      certificateHash: signatureData.certificateHash,
      publicKey: signatureData.publicKey,
      timestampToken: signatureData.timestampToken,
      signatureMethod: signatureData.signatureMethod,
      isQualified: signatureData.isQualified,
    }
  }
}
