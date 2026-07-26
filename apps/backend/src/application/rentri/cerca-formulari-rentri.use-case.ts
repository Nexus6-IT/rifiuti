import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RentriUnitaLocaleService } from '../../infrastructure/rentri/rentri-unita-locale.service'
import { RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'

/**
 * Un formulario trovato su RENTRI, arricchito con le due informazioni che
 * l'ente da solo non dà: se è già stato agganciato da un FIR di QUESTO
 * tenant (verifica locale) e — implicitamente, tramite l'assenza di
 * `firIdLocale` — se propone o no l'aggancio.
 */
export interface FormularioTrovato {
  numeroFir: string
  dataEmissione?: string | null
  dataCreazione?: string | null
  identificativoSoggetto?: string | null
  numIscrSito?: string | null
  codiceEer?: string | null
  descrizioneRifiuto?: string | null
  stato?: string | null
  /** RENTRI: la visibilità in ricerca è già stata acquisita da un'unità locale del tenant. */
  visibilitaGiaAcquisita: boolean
  /**
   * Verifica LOCALE (query sul nostro database, NON su RENTRI): questo
   * `numero_fir` è già agganciato a un FIR di questo tenant. Se true, il
   * chiamante non deve proporre un aggancio — l'utente lo aggancerebbe due
   * volte (il vincolo unico a DB lo impedirebbe comunque, ma qui l'errore va
   * evitato PRIMA, non scoperto dopo un tentativo).
   */
  giaAgganciatoLocalmente: boolean
  /** Id del FIR locale già agganciato, presente se e solo se `giaAgganciatoLocalmente` è true. */
  firIdLocale?: string
}

export interface RisultatoCercaFormulariRENTRI {
  risultati: FormularioTrovato[]
  paging: {
    page: number
    pageSize: number
    pageCount: number
    totalRecordCount: number
  }
}

/**
 * Cerca Formulari RENTRI — Use Case (R2 Task 4, primo passo di
 * "cercare → verificare → acquisire").
 *
 * **Chiave di ricerca: il codice fiscale del soggetto (Tenant.codiceFiscale),
 * non l'unità locale.** Il contratto (`RENTRIApiClient.cercaFormulari`)
 * accetta uno tra `identificativoSoggetto` (CF di un soggetto coinvolto,
 * indipendentemente da chi ha creato il FIR) e `numIscrSito` (un'unità
 * locale per cui la visibilità è GIÀ acquisita — utile per rivedere ciò che
 * si è già preso, non per scoprire cosa manca). Un'azienda con più sedi
 * (R2 multi-sede) è UN solo soggetto giuridico con UN solo CF: cercare per
 * CF trova ogni formulario in cui l'azienda compare, a prescindere da quale
 * sede lo gestirà; cercare per `numIscrSito` troverebbe solo ciò che una
 * specifica sede ha già acquisito, mancando esattamente i formulari nuovi da
 * agganciare. La scelta di QUALE sede userà la visibilità resta
 * dell'utente, ma si applica dopo (in fase di acquisizione), non qui.
 *
 * **Prerequisito fail-closed (R1 Task 2):** il brief originale del task
 * citava `RentriCredential.numIscrSito` come prerequisito da verificare
 * prima di contattare RENTRI. Quel campo è però DEPRECATO dal refactor
 * multi-sede (R2, v. `schema.prisma`): il controllo equivalente aggiornato è
 * "il tenant ha configurato almeno un'unità locale RENTRI", verificato via
 * `RentriUnitaLocaleService.getPrincipale` (che esiste se e solo se ne
 * esiste almeno una). Senza nessuna sede configurata l'eventuale
 * acquisizione non avrebbe comunque un `numIscrSito` su cui appoggiarsi: la
 * ricerca fallisce qui, con un messaggio leggibile, PRIMA di contattare
 * RENTRI — non dopo, con un elenco di risultati che l'utente non potrebbe
 * comunque agganciare.
 */
@Injectable()
export class CercaFormulariRENTRIUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitaLocaleService: RentriUnitaLocaleService,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly firRepository: IFIRRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('CercaFormulariRENTRIUseCase')
  }

  async execute(tenantId: string): Promise<RisultatoCercaFormulariRENTRI> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { codiceFiscale: true },
    })

    if (!tenant?.codiceFiscale) {
      throw DomainException.businessRuleViolation(
        'CF_TENANT_MANCANTE',
        "Codice fiscale dell'azienda non configurato: impossibile cercare formulari RENTRI. " +
          'Configuralo nei dati anagrafici del tenant.'
      )
    }

    const sedePrincipale = await this.unitaLocaleService.getPrincipale(tenantId)
    if (!sedePrincipale) {
      throw DomainException.businessRuleViolation(
        'UNITA_LOCALE_MANCANTE',
        'Configura prima la tua unità locale RENTRI prima di cercare formulari da agganciare.'
      )
    }

    const esito = await this.rentriApiClient.cercaFormulari(tenantId, {
      identificativoSoggetto: tenant.codiceFiscale,
    })

    const risultati: FormularioTrovato[] = []
    for (const item of esito.risultati) {
      if (!item.numero_fir) {
        this.logger.warn('Formulario RENTRI senza numero_fir nella ricerca: scartato', { item })
        continue
      }

      const numeroFir = item.numero_fir
      const esistente = await this.firRepository.findByRentriNumeroFir(tenantId, numeroFir)

      risultati.push({
        numeroFir,
        dataEmissione: item.data_emissione ?? null,
        dataCreazione: item.data_creazione ?? null,
        identificativoSoggetto: item.identificativo_soggetto ?? null,
        numIscrSito: item.num_iscr_sito ?? null,
        codiceEer: item.codice_eer ?? null,
        descrizioneRifiuto: item.descrizione_rifiuto ?? null,
        stato: item.stato ?? null,
        visibilitaGiaAcquisita: Boolean(item.visibilita_sito_acquisita),
        giaAgganciatoLocalmente: Boolean(esistente),
        firIdLocale: esistente?.id,
      })
    }

    return { risultati, paging: esito.paging }
  }
}
