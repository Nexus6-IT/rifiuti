import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { StatoFormulario } from '../../domain/fir/aggregates/fir.aggregate'
import { AzioneTradotta, traduciOperazioniRentri } from './operazione-rentri-traduzione'

export interface GetAzioniDisponibiliResult {
  stato: StatoFormulario
  versione: number | null
  azioni: AzioneTradotta[]
}

/**
 * Get Azioni Disponibili — Use Case (R3 Task 2, "il motore della UI").
 *
 * Interroga `GET /{numero_fir}/azioni` — QUESTO è il modo con cui WasteFlow
 * scopre quali operazioni di scrittura hanno senso ORA su un formulario,
 * PRIMA di proporle come pulsante: l'ente banna (423) chi insiste con
 * un'operazione fuori sequenza, quindi ogni scrittura futura (accettazione,
 * annullamento, allegati, ...) dovrà verificare che l'operazione desiderata
 * compaia nella lista restituita qui, non fidarsi di una lettura precedente
 * (v. commento di classe di `RENTRIApiClient.leggiAzioniDisponibili`).
 *
 * Ogni lettura è anche un'occasione di riconciliazione: lo stato che l'ente
 * restituisce (`AzioniResult.stato`) viene applicato al FIR via
 * `FIR.applyRentriStato` (R3 Task 1) — silenziosa se non cambia nulla,
 * salvifica se nel frattempo l'ente ha cambiato esito senza che nessuna
 * sincronizzazione esplicita lo sapesse ancora.
 *
 * **Fail-closed, in ordine:**
 * 1. FIR non trovato / di un altro tenant → errori già visti negli altri use
 *    case RENTRI (`NOT_FOUND`/`UNAUTHORIZED`).
 * 2. FIR non legato a RENTRI (`rentriNumeroFir` assente) → errore di dominio
 *    leggibile PRIMA di contattare l'ente: chiedere le azioni disponibili su
 *    un formulario che l'ente non conosce non ha senso (e
 *    `FIR.applyRentriStato` lo rifiuterebbe comunque con
 *    `FIRNonLegatoRentriError`, ma qui lo si intercetta prima, con un
 *    messaggio specifico di questo caso d'uso).
 * 3. Codice fiscale del tenant mancante → l'ente richiede
 *    `identificativo_soggetto`: senza, non si può nemmeno tentare la
 *    chiamata (stesso principio fail-closed di `CercaFormulariRENTRIUseCase`).
 *
 * **Difesa in profondità**: se l'ente rifiuta comunque la chiamata (400/403,
 * v. `RENTRIApiClient.leggiAzioniDisponibili`), l'eccezione propaga PRIMA che
 * `applyRentriStato`/`save` vengano invocati — nessuna corruzione dello stato
 * locale su un rifiuto dell'ente (v. `rentri-azioni.oracolo.spec.ts`).
 */
@Injectable()
export class GetAzioniDisponibiliUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firRepository: IFIRRepository,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('GetAzioniDisponibiliUseCase')
  }

  async execute(
    firId: string,
    tenantId: string,
    correlationId?: string
  ): Promise<GetAzioniDisponibiliResult> {
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
        'Questo FIR non è ancora legato a un formulario RENTRI: nessuna azione da consultare.'
      )
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { codiceFiscale: true },
    })

    if (!tenant?.codiceFiscale) {
      throw DomainException.businessRuleViolation(
        'CF_TENANT_MANCANTE',
        "Codice fiscale dell'azienda non configurato: impossibile consultare le azioni RENTRI. " +
          'Configuralo nei dati anagrafici del tenant.'
      )
    }

    // Se l'ente rifiuta questa chiamata (400/403), `leggiAzioniDisponibili`
    // propaga: nessuna riga sotto viene eseguita, nessuno stato viene
    // toccato — la difesa in profondità richiesta dal piano.
    const risposta = await this.rentriApiClient.leggiAzioniDisponibili(
      tenantId,
      fir.rentriNumeroFir,
      tenant.codiceFiscale
    )

    fir.applyRentriStato(risposta.stato, correlationId)
    await this.firRepository.save(fir)

    this.logger.debug('Azioni RENTRI disponibili lette', {
      firId,
      tenantId,
      numeroFir: fir.rentriNumeroFir,
      stato: risposta.stato,
      numeroAzioni: risposta.azioni?.length ?? 0,
    })

    return {
      stato: risposta.stato,
      versione: risposta.versione,
      azioni: traduciOperazioniRentri(risposta.azioni ?? []),
    }
  }
}
