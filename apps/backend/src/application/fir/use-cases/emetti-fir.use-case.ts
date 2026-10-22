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
import { DomainError } from '../../../core/domain/errors'

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
      return Result.fail<FIR>(`Firma produttore non riuscita: ${error.message}`)
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
    try {
      await this.trasmissioneRentri.eseguiSeAutomatica({
        firId: fir.id,
        tenantId: fir.tenantId ?? fir.produttoreId,
      })
    } catch (error: any) {
      this.logger.error('Orchestrazione RENTRI non riuscita dopo l’emissione del FIR', error, {
        firId: fir.id,
      })
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
