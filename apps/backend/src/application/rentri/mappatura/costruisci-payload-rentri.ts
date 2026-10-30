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
  ): Promise<ParteRegistro> {
    const registroId = parte?.registroId
    if (!registroId) {
      throw new DatoMancantePerRentriError(
        nomeParte,
        'registroId',
        'la parte non e agganciata al registro anagrafico, quindi non ha un indirizzo strutturato'
      )
    }

    // I tre delegate hanno lo stesso insieme di campi letti qui: il tipo del risultato e' esplicito
    // cosi' tsc controlla ogni campo usato (prima il cast `as never` lo nascondeva).
    const tabella = this.prisma.db[nomeParte] as unknown as {
      findFirst: (args: unknown) => Promise<RigaRegistro | null>
    }
    const riga = await tabella.findFirst({
      where: { id: registroId, tenantId },
      include: { ditta: true, sede: true },
    })
    if (!riga) {
      throw new DatoMancantePerRentriError(
        nomeParte,
        'anagrafica',
        `nessuna riga nel registro con id ${registroId} per questa azienda`
      )
    }

    // Denominazione e identificativo dalla ditta. L'indirizzo dalla sede scelta sul FIR (filtrata
    // per tenant E ditta del ruolo: una sede di un'altra ditta non deve mai uscire) o, se il FIR
    // non ne ha una (creato prima della migration), dalla predefinita del ruolo. Senza ditta/sede,
    // la copia sulla riga di ruolo.
    const ditta = riga.ditta
    let sedeScelta: IndirizzoRegistro | null = riga.sede
    if (parte?.sedeId) {
      sedeScelta = riga.dittaId
        ? await this.prisma.db.sedeDitta.findFirst({
            where: { id: parte.sedeId, tenantId, dittaId: riga.dittaId },
          })
        : null
      if (!sedeScelta) {
        throw new DatoMancantePerRentriError(
          nomeParte,
          'sede',
          'la sede scelta sul FIR non risulta tra le sedi della ditta'
        )
      }
    }
    const indirizzo = sedeScelta ?? riga
    return {
      ragioneSociale: ditta?.ragioneSociale ?? riga.ragioneSociale,
      // Il contratto vuole un solo identificativo fiscale: CF della ditta se c'e', altrimenti P.IVA
      partitaIVA: ditta ? (ditta.codiceFiscale ?? ditta.partitaIva ?? '') : riga.partitaIVA,
      via: indirizzo.via,
      civico: indirizzo.civico,
      cap: indirizzo.cap,
      comune: indirizzo.comune,
      provincia: indirizzo.provincia,
      numeroIscrizione: riga.numeroIscrizione ?? null,
    }
  }
}

interface IndirizzoRegistro {
  via: string
  civico: string
  cap: string
  comune: string
  provincia: string
}

/** Riga di ruolo con ditta e sede, come la restituisce `findFirst` con l'include. */
interface RigaRegistro extends IndirizzoRegistro {
  dittaId: string | null
  ragioneSociale: string
  partitaIVA: string
  numeroIscrizione?: string | null
  ditta: { ragioneSociale: string; partitaIva: string | null; codiceFiscale: string | null } | null
  sede: IndirizzoRegistro | null
}

/** Parte risolta pronta per il mapping. */
interface ParteRegistro extends IndirizzoRegistro {
  ragioneSociale: string
  partitaIVA: string
  numeroIscrizione?: string | null
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
