import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { RentriOrigineLegame } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { assertRuoloScritturaRentri } from './verifica-ruolo-scrittura-rentri'

export interface RilasciaFormularioRENTRIInput {
  tenantId: string
  userId: string
  userRole: string
  firId: string
  /**
   * Unità locale (numIscrSito) da cui rilasciare la visibilità. Va indicata
   * di nuovo esplicitamente (v. `AcquisisciFormularioRENTRIUseCase`): il FIR
   * non porta un campo dedicato per la sede che l'aveva acquisita.
   */
  numIscrSito: string
  correlationId?: string
}

export interface RilasciaFormularioRENTRIResult {
  numeroFirRilasciato: string
}

/**
 * Rilascia Formulario RENTRI — Use Case (R2 Task 4). Operazione simmetrica
 * di {@link AcquisisciFormularioRENTRIUseCase}: "abbandona" la visibilità
 * senza cancellare il formulario dall'ente, il FIR locale RESTA come record
 * (solo senza più `rentriNumeroFir`) — coerente con la semantica del
 * contratto RENTRI ("rilascio", non "annullamento").
 *
 * **Precondizioni tradotte in errori leggibili.** L'invariante di dominio è
 * già garantita da `FIR.rilasciaLegameRENTRI` (solleva `DomainError` se non
 * c'è legame o se l'origine è `TRASMESSO_DA_NOI`, R2 Task 3): questo use
 * case la ri-verifica PRIMA di chiamare RENTRI, sia per fallire chiuso senza
 * un giro di rete inutile, sia per restituire un `DomainException` (con
 * `code` HTTP-mappabile) invece del `DomainError` generico dell'aggregate.
 *
 * **Stesso ordine e stessa cautela di {@link AcquisisciFormularioRENTRIUseCase}:**
 * `rilasciaVisibilita` (RENTRI) PRIMA, `rilasciaLegameRENTRI` + `save`
 * (locale) DOPO. Se la scrittura locale fallisce dopo un rilascio riuscito
 * sull'ente, il FIR locale resta stalely agganciato (mostra ancora il
 * vecchio `rentriNumeroFir`) mentre RENTRI lo considera già rilasciato:
 * un'incoerenza simmetrica a quella dell'acquisizione, loggata qui in modo
 * esplicito (`INCOERENZA: ...`) perché sia visibile a chi monitora i log e
 * possa essere corretta a mano (non c'è, in questo giro, uno strumento di
 * riconciliazione automatica per il rilascio: la prossima ricerca la
 * segnalerebbe solo indirettamente, come formulario non più con visibilità
 * acquisita ma ancora agganciato localmente — un'estensione futura, non
 * implementata qui).
 */
@Injectable()
export class RilasciaFormularioRENTRIUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('RilasciaFormularioRENTRIUseCase')
  }

  async execute(input: RilasciaFormularioRENTRIInput): Promise<RilasciaFormularioRENTRIResult> {
    assertRuoloScritturaRentri(input.userRole)

    const fir = await this.firRepository.findById(input.firId)
    if (!fir || fir.tenantId !== input.tenantId) {
      throw DomainException.notFound('FIR', input.firId)
    }

    if (!fir.rentriNumeroFir || !fir.rentriOrigineLegame) {
      throw DomainException.businessRuleViolation(
        'NESSUN_LEGAME_RENTRI',
        'Nessun legame RENTRI da rilasciare per questo FIR'
      )
    }

    if (fir.rentriOrigineLegame === RentriOrigineLegame.TRASMESSO_DA_NOI) {
      throw DomainException.businessRuleViolation(
        'LEGAME_NON_RILASCIABILE',
        'Un formulario trasmesso da questo gestionale non si rilascia: per annullarlo usare gli ' +
          'endpoint del ciclo di vita RENTRI (R3)'
      )
    }

    const numeroFir = fir.rentriNumeroFir
    const origineRilasciata = fir.rentriOrigineLegame

    // v. commento di classe: RENTRI prima, locale dopo.
    await this.rentriApiClient.rilasciaVisibilita(
      input.tenantId,
      numeroFir,
      input.numIscrSito,
      input.correlationId
    )

    try {
      fir.rilasciaLegameRENTRI(input.correlationId)
      await this.firRepository.save(fir)
    } catch (error) {
      this.logger.error(
        'INCOERENZA: visibilità rilasciata su RENTRI ma scrittura locale fallita — riconciliare a mano',
        error as Error,
        { tenantId: input.tenantId, firId: input.firId, numeroFir }
      )
      throw error
    }

    await this.scriviAuditLog(input, numeroFir, origineRilasciata)

    return { numeroFirRilasciato: numeroFir }
  }

  /** Audit non bloccante — v. `AcquisisciFormularioRENTRIUseCase.scriviAuditLog`. */
  private async scriviAuditLog(
    input: RilasciaFormularioRENTRIInput,
    numeroFir: string,
    origineRilasciata: RentriOrigineLegame
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          firId: input.firId,
          action: 'RENTRI_RILASCIO_FORMULARIO',
          description: `Legame con il formulario RENTRI ${numeroFir} rilasciato per il FIR ${input.firId}`,
          metadata: {
            numeroFir,
            numIscrSito: input.numIscrSito,
            origineRilasciata,
          },
          correlationId: input.correlationId,
        },
      })
    } catch (error) {
      this.logger.error('Scrittura ActivityLog fallita dopo rilascio riuscito', error as Error, {
        tenantId: input.tenantId,
        firId: input.firId,
        numeroFir,
      })
    }
  }
}
