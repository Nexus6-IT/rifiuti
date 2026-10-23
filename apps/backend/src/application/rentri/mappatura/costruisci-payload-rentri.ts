import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriUnitaLocaleService } from '../../../infrastructure/rentri/rentri-unita-locale.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { FIR, ParteFIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { RisolutoreComuneIstat } from './risolutore-comune-istat'
import { mappaNuovoFormulario } from './mappa-nuovo-formulario'
import { DatoMancantePerRentriError, TipoTrasporto } from './mappa-parti'
import { ProvenienzaRifiutoRentri } from './mappa-rifiuto'

/**
 * Raccoglie dal database quello che il mappatore chiede e glielo passa.
 *
 * PERCHE' SERVE UN PASSAGGIO IN PIU'. Lo snapshot delle parti dentro il FIR
 * appiattisce l'indirizzo in una sola stringa (`producerAddress` e simili),
 * mentre il contratto vuole via, civico, CAP e un `comune_id` codificato. I
 * dati strutturati vivono nei registri anagrafici e si raggiungono dal
 * `registroId` dello snapshot: se quel legame manca, l'invio viene rifiutato
 * invece di essere completato con un indirizzo ricostruito a occhio da una
 * stringa libera.
 *
 * Tutto il modulo resta FAIL-CLOSED: ogni assenza diventa un errore con il
 * nome del dato mancante, mai un valore di ripiego.
 */
@Injectable()
export class CostruisciPayloadRentri {
  private readonly risolutoreComune: RisolutoreComuneIstat

  constructor(
    private readonly prisma: PrismaService,
    private readonly unitaLocale: RentriUnitaLocaleService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('CostruisciPayloadRentri')
    this.risolutoreComune = new RisolutoreComuneIstat(this.prisma)
  }

  async costruisci(fir: FIR, tenantId: string): Promise<Record<string, unknown>> {
    const sede = await this.unitaLocale.getPrincipale(tenantId)
    if (!sede?.numIscrSito) {
      throw new DatoMancantePerRentriError(
        'azienda',
        'unita locale RENTRI',
        'nessuna sede principale configurata: il formulario non puo essere associato ad alcuna unita locale'
      )
    }

    const produttore = await this.leggiRegistro('produttore', fir.produttore, tenantId)
    const destinatario = await this.leggiRegistro('destinatario', fir.destinatario, tenantId)
    const trasportatore = await this.leggiRegistro('trasportatore', fir.trasportatore, tenantId)

    return mappaNuovoFormulario(
      {
        numIscrSito: sede.numIscrSito,
        provenienza: this.codiceProvenienza(fir),
        tipoTrasporto: this.tipoTrasportoDelContratto(fir),
        produttore: {
          ragioneSociale: produttore.ragioneSociale,
          partitaIVA: produttore.partitaIVA,
          indirizzo: indirizzoDi(produttore),
        },
        destinatario: {
          ragioneSociale: destinatario.ragioneSociale,
          partitaIVA: destinatario.partitaIVA,
          indirizzo: indirizzoDi(destinatario),
        },
        trasportatori: [
          {
            ragioneSociale: trasportatore.ragioneSociale,
            partitaIVA: trasportatore.partitaIVA,
            numeroIscrizione: trasportatore.numeroIscrizione ?? null,
          },
        ],
        rifiuto: {
          cerCode: fir.rifiuto?.cerCode ?? '',
          wastePhysicalState: fir.rifiuto?.statoFisico ?? null,
          wasteDescription: fir.rifiuto?.descrizione ?? null,
        },
      } as never,
      this.risolutoreComune
    )
  }

  /**
   * Traduce la provenienza di dominio (URBANO/SPECIALE) nel codice del
   * contratto (U/S). La traduzione sta qui e non nel dominio: i valori
   * leggibili sono nostri, i codici sono dell'ente.
   */
  private codiceProvenienza(fir: FIR): ProvenienzaRifiutoRentri | null {
    const valore = fir.provenienza
    if (valore === 'URBANO') return 'U'
    if (valore === 'SPECIALE') return 'S'
    return null
  }

  /**
   * Traduce la modalita' di trasporto di dominio nei valori del contratto.
   *
   * NON e' un passaggio diretto e non lo si puo' rendere tale: il nostro enum
   * usa il femminile della «tratta» (FERROVIARIA, MARITTIMA) mentre il
   * contratto usa il maschile del «trasporto» (Ferroviario, Marittimo). Una
   * conversione a maiuscole/minuscole avrebbe prodotto valori rifiutati
   * dall'ente — e' stato il test contro il validatore del contratto a
   * scoprirlo, non la lettura del codice.
   */
  private tipoTrasportoDelContratto(fir: FIR): TipoTrasporto | null {
    switch (fir.tipoTrattaPrincipale) {
      case 'TERRESTRE':
        return 'Terrestre'
      case 'FERROVIARIA':
        return 'Ferroviario'
      case 'MARITTIMA':
        return 'Marittimo'
      default:
        return null
    }
  }

  private async leggiRegistro(
    nomeParte: 'produttore' | 'destinatario' | 'trasportatore',
    parte: ParteFIR | null,
    tenantId: string
  ): Promise<{
    ragioneSociale: string
    partitaIVA: string
    via: string
    civico: string
    cap: string
    comune: string
    provincia: string
    numeroIscrizione?: string | null
  }> {
    const registroId = parte?.registroId
    if (!registroId) {
      throw new DatoMancantePerRentriError(
        nomeParte,
        'registroId',
        'la parte non e agganciata al registro anagrafico, quindi non ha un indirizzo strutturato'
      )
    }

    const tabella = this.prisma.db[nomeParte] as {
      findFirst: (args: unknown) => Promise<Record<string, unknown> | null>
    }
    const riga = await tabella.findFirst({ where: { id: registroId, tenantId } })
    if (!riga) {
      throw new DatoMancantePerRentriError(
        nomeParte,
        'anagrafica',
        `nessuna riga nel registro con id ${registroId} per questa azienda`
      )
    }

    return riga as never
  }
}

function indirizzoDi(riga: {
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
}) {
  return {
    via: riga.via,
    civico: riga.civico,
    cap: riga.cap,
    comune: riga.comune,
    provincia: riga.provincia,
  }
}
