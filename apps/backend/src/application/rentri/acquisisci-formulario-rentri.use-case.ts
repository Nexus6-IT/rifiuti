import { Inject, Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { FIR, RentriOrigineLegame } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import { assertRuoloScritturaRentri } from './verifica-ruolo-scrittura-rentri'
import {
  CREA_FIR_DA_FORMULARIO_RENTRI_PORT,
  CreaFIRDaFormularioRENTRIPort,
} from './crea-fir-da-formulario-rentri.port'

/**
 * Scelta esplicita dell'utente su come agganciare un formulario trovato:
 * mai una terza opzione implicita "indovina tu" (v. brief).
 */
export type SceltaAggancioFormulario =
  | { tipo: 'NUOVO' }
  | { tipo: 'COLLEGA_ESISTENTE'; firId: string }

export interface AcquisisciFormularioRENTRIInput {
  tenantId: string
  userId: string
  userRole: string
  numeroFir: string
  /**
   * Unità locale (numIscrSito) su cui acquisire la visibilità. NB: il FIR
   * non porta un campo dedicato per "quale sede l'ha acquisita" (nessuna
   * migrazione in questo giro) — resta solo nell'ActivityLog (traccia
   * storica, v. classe), va quindi passato di nuovo esplicitamente anche in
   * un eventuale rilascio (v. `RilasciaFormularioRENTRIUseCase`).
   */
  numIscrSito: string
  /**
   * Dal risultato di `CercaFormulariRENTRIUseCase`: se true, la visibilità
   * è già stata acquisita in un giro precedente (dalla stessa sede o da
   * un'altra del tenant) — non richiamare `acquisisciVisibilita`.
   */
  visibilitaGiaAcquisita: boolean
  scelta: SceltaAggancioFormulario
  correlationId?: string
}

export interface AcquisisciFormularioRENTRIResult {
  firId: string
  numeroFir: string
}

/**
 * Acquisisci Formulario RENTRI — Use Case (R2 Task 4, secondo passo di
 * "cercare → verificare → acquisire").
 *
 * ## Il punto delicato: ordine delle due scritture
 *
 * Acquisire la visibilità presso RENTRI e scrivere il legame in locale sono
 * due scritture su due sistemi diversi, non transazionali insieme. Se una
 * fallisse dopo l'altra il formulario risulterebbe incoerente: acquisito da
 * un lato, non registrato dall'altro.
 *
 * **Scelta: RENTRI PRIMA, locale DOPO.** Motivazione — delle due, la
 * scrittura locale è quella che possiamo ripetere in sicurezza (nostro
 * database, nessun rischio di "richiesta superflua" verso un ente che banna
 * su richieste non valide); la chiamata a RENTRI NON è sicura da ripetere
 * alla cieca (una seconda `acquisisciVisibilita` su un formulario già
 * acquisito rischia di essere trattata come richiesta superflua/non valida —
 * v. commento del client). Fare quindi PRIMA l'operazione "pericolosa da
 * ripetere" (RENTRI) e DOPO quella "sicura da ripetere" (locale) rende
 * l'eventuale orfano riconoscibile e il retry sicuro:
 *
 * - Se la scrittura locale fallisce DOPO che RENTRI ha acquisito la
 *   visibilità, il formulario resta "orfano" (acquisito dall'ente, non
 *   agganciato da noi). Non esiste un endpoint RENTRI per "disfare"
 *   un'acquisizione: l'incoerenza si ripara così — (1) questo use case logga
 *   un errore esplicito (`INCOERENZA: ...`) con tutto il necessario per
 *   intervenire a mano; (2) la PROSSIMA `CercaFormulariRENTRIUseCase` la
 *   segnala da sola, perché quel formulario avrà ora
 *   `visibilitaGiaAcquisita=true` ma `giaAgganciatoLocalmente=false` — la
 *   stessa combinazione che il flusso normale userebbe per evitare una
 *   doppia acquisizione diventa qui il segnale dell'orfano; (3) un secondo
 *   tentativo di aggancio è SICURO: `visibilitaGiaAcquisita` sarà true, quindi
 *   `acquisisciVisibilita` non viene richiamata (v. sotto), si passa
 *   direttamente alla lettura del dettaglio e alla scrittura locale.
 *
 * Le precondizioni (ruolo, numero_fir non già agganciato localmente, FIR
 * target valido nel ramo COLLEGA_ESISTENTE) sono tutte verificate PRIMA di
 * qualunque chiamata a RENTRI: un errore di dominio leggibile è sempre
 * preferibile a un 400/423 dell'ente per una richiesta che sapevamo già
 * essere invalida (fail-closed, stesso principio di R1 Task 2).
 */
@Injectable()
export class AcquisisciFormularioRENTRIUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly prisma: PrismaService,
    @Inject(CREA_FIR_DA_FORMULARIO_RENTRI_PORT)
    private readonly creaFirDaFormularioPort: CreaFIRDaFormularioRENTRIPort,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('AcquisisciFormularioRENTRIUseCase')
  }

  async execute(input: AcquisisciFormularioRENTRIInput): Promise<AcquisisciFormularioRENTRIResult> {
    assertRuoloScritturaRentri(input.userRole)

    if (!input.numeroFir?.trim()) {
      throw DomainException.validationFailed('NUMERO_FIR_MANCANTE', 'Numero FIR RENTRI mancante')
    }

    // Precondizione ridondante col vincolo unico a DB (R2 Task 3), ma
    // verificata PRIMA per dare un errore di dominio leggibile invece di un
    // errore di vincolo scoperto dopo aver già contattato RENTRI.
    const giaAgganciato = await this.firRepository.findByRentriNumeroFir(
      input.tenantId,
      input.numeroFir
    )
    if (giaAgganciato) {
      throw DomainException.businessRuleViolation(
        'FORMULARIO_GIA_AGGANCIATO',
        `Il formulario RENTRI ${input.numeroFir} è già collegato al FIR locale ${giaAgganciato.id} ` +
          'di questo tenant: rilasciare quel legame prima di agganciarlo di nuovo.'
      )
    }

    let firTarget: FIR | null = null
    if (input.scelta.tipo === 'COLLEGA_ESISTENTE') {
      firTarget = await this.firRepository.findById(input.scelta.firId)
      if (!firTarget || firTarget.tenantId !== input.tenantId) {
        // 404, non 403: non conferma a un altro tenant che l'id esiste.
        throw DomainException.notFound('FIR', input.scelta.firId)
      }
      if (firTarget.rentriNumeroFir) {
        throw DomainException.businessRuleViolation(
          'FIR_GIA_LEGATO',
          `Il FIR locale ${firTarget.id} è già legato al formulario RENTRI ${firTarget.rentriNumeroFir}: ` +
            'rilasciare quel legame prima di agganciarne un altro.'
        )
      }
    }

    // v. commento di classe: nessuna chiamata ridondante se la visibilità è
    // già acquisita (dal risultato di ricerca, o da un retry dopo un
    // orfano — v. sotto).
    if (!input.visibilitaGiaAcquisita) {
      await this.rentriApiClient.acquisisciVisibilita(
        input.tenantId,
        input.numeroFir,
        input.numIscrSito,
        input.correlationId
      )
    } else {
      this.logger.info(
        'Visibilità già acquisita in precedenza: nessuna chiamata ridondante a RENTRI',
        { tenantId: input.tenantId, numeroFir: input.numeroFir }
      )
    }

    const dettaglio = await this.rentriApiClient.leggiFormulario(input.tenantId, input.numeroFir)

    let firId: string
    let origine: RentriOrigineLegame
    try {
      if (input.scelta.tipo === 'NUOVO') {
        const nuovoFir = await this.creaFirDaFormularioPort.creaDaDettaglio(
          input.tenantId,
          input.userId,
          dettaglio,
          input.numeroFir
        )
        nuovoFir.agganciaFormularioAcquisito(input.numeroFir, input.correlationId)
        await this.firRepository.save(nuovoFir)
        firId = nuovoFir.id
        origine = RentriOrigineLegame.ACQUISITO_DA_TERZI
      } else {
        firTarget!.agganciaManualmente(input.numeroFir, input.correlationId)
        await this.firRepository.save(firTarget!)
        firId = firTarget!.id
        origine = RentriOrigineLegame.AGGANCIO_MANUALE
      }
    } catch (error) {
      // v. commento di classe: la visibilità è ORMAI acquisita su RENTRI,
      // non annullabile da qui. Log esplicito per la riconciliazione manuale
      // + segnale automatico (la prossima ricerca mostrerà questo
      // numero_fir con visibilitaGiaAcquisita=true e
      // giaAgganciatoLocalmente=false).
      this.logger.error(
        'INCOERENZA: visibilità acquisita su RENTRI ma scrittura locale fallita — riconciliare a mano ' +
          '(il prossimo tentativo di aggancio è sicuro: la visibilità risulterà già acquisita)',
        error as Error,
        { tenantId: input.tenantId, numeroFir: input.numeroFir, scelta: input.scelta }
      )
      throw error
    }

    await this.scriviAuditLog(input, firId, origine)

    return { firId, numeroFir: input.numeroFir }
  }

  /**
   * Audit non bloccante (stesso principio di `SignatureAuditHandler`):
   * l'aggancio è già riuscito quando questo metodo viene chiamato, un
   * fallimento della sola scrittura di audit non deve far fallire
   * l'operazione principale né essere confuso con un'incoerenza RENTRI↔locale.
   */
  private async scriviAuditLog(
    input: AcquisisciFormularioRENTRIInput,
    firId: string,
    origine: RentriOrigineLegame
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          firId,
          action: 'RENTRI_AGGANCIO_FORMULARIO',
          description: `Formulario RENTRI ${input.numeroFir} agganciato al FIR ${firId} (${input.scelta.tipo})`,
          metadata: {
            numeroFir: input.numeroFir,
            numIscrSito: input.numIscrSito,
            origine,
          },
          correlationId: input.correlationId,
        },
      })
    } catch (error) {
      this.logger.error('Scrittura ActivityLog fallita dopo aggancio riuscito', error as Error, {
        tenantId: input.tenantId,
        numeroFir: input.numeroFir,
        firId,
      })
    }
  }
}
