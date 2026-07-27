import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import {
  RENTRIApiClient,
  PdfFormularioScaricato,
} from '../../infrastructure/rentri/rentri-api.client'

export type PdfFIRScaricato = PdfFormularioScaricato

/**
 * Scarica la stampa PDF del formulario RENTRI (R3 Task 7):
 * `GET /{numero_fir}/pdf` (`docs/contracts/rentri/formulari.yaml`, righe
 * 1739-1789).
 *
 * **Perché questo è un TRAMITE e non un redirect.** Il criterio di valore
 * del programma, invariato da R1, è che l'utente non cambi mai piattaforma:
 * questo use case scarica il PDF dall'ente (via {@link RENTRIApiClient}) e
 * lo restituisce al controller come byte decodificati — il controller
 * (`RentriFirLifecycleController.scaricaPdf`) li trasmette al browser con
 * `Content-Type`/`Content-Disposition` propri, esattamente come
 * `PdfController.downloadFIR` fa già per i PDF generati localmente. Il
 * browser dell'utente non contatta mai `demoapi.rentri.gov.it`/
 * `api.rentri.gov.it` e non riceve mai un 3xx verso il portale: il byte
 * capostipite viene da RENTRI, il canale resta WasteFlow dall'inizio alla
 * fine.
 *
 * **Autorizzazione (riga 1748 del contratto)**: "L'operazione può essere
 * eseguita da un'utenza che abbia incarichi per (o coincida con) almeno uno
 * dei soggetti coinvolti nel formulario". **Dichiarazione esplicita di cosa
 * è verificabile e cosa no**: WasteFlow non modella un incarico PER UTENTE
 * verso un singolo soggetto (produttore/trasportatore/destinatario) distinto
 * dal tenant — un tenant è, nel nostro modello dati (`FIR.tenantId`,
 * multi-tenant a schema-per-tenant), un'unica azienda/soggetto, e ogni FIR
 * appartiene a un solo tenant. La verifica realmente applicabile con i dati
 * che abbiamo è quindi quella del TENANT (equivalente a "coincide con un
 * soggetto coinvolto": il tenant che possiede il FIR), NON quella più fine
 * "questo specifico utente ha un incarico per questo specifico soggetto",
 * che richiederebbe un modello di deleghe per-utente/per-soggetto che il
 * progetto non ha — non è lasciata passare sotto silenzio, è dichiarata qui.
 *
 * Stessa cautela già adottata per il dettaglio FIR in R1 e per
 * `AcquisisciFormularioRENTRIUseCase` (R2): un FIR di un altro tenant
 * risponde **404, non 403/401** — un 403/401 confermerebbe a chi non ha
 * diritto che quell'id esiste. A differenza di `GetAzioniDisponibiliUseCase`/
 * `GestisciAllegatiFIRUseCase` (Task 2/6), che per un mismatch di tenant
 * sollevano `UNAUTHORIZED` (401): qui si segue deliberatamente la
 * convenzione più cauta richiesta dal piano per QUESTO endpoint.
 */
@Injectable()
export class ScaricaPdfFirUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('ScaricaPdfFirUseCase')
  }

  async execute(firId: string, tenantId: string): Promise<PdfFIRScaricato> {
    const fir = await this.firRepository.findById(firId)

    if (!fir || fir.tenantId !== tenantId) {
      // 404, non 403/401: non conferma a un altro tenant che l'id esiste
      // (v. commento di classe).
      throw DomainException.notFound('FIR', firId)
    }

    if (!fir.rentriNumeroFir) {
      throw DomainException.businessRuleViolation(
        'FIR_NON_LEGATO_RENTRI',
        "Questo FIR non è legato a un formulario RENTRI: non c'è alcun PDF da scaricare presso l'ente."
      )
    }

    const numeroFir = fir.rentriNumeroFir
    const pdf = await this.rentriApiClient.scaricaPdf(tenantId, numeroFir)

    this.logger.debug('PDF del formulario RENTRI richiesto', {
      firId,
      tenantId,
      numeroFir,
      disponibile: pdf.disponibile,
    })

    return pdf
  }
}
