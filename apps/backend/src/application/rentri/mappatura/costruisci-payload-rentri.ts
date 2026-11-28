import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriUnitaLocaleService } from '../../../infrastructure/rentri/rentri-unita-locale.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { FIR, ParteFIR, TipoTratta } from '../../../domain/fir/aggregates/fir.aggregate'
import { IDatiViaggioFirRepository } from '../dati-viaggio-fir.port'
import { RentriScortaRepository } from '../../../infrastructure/persistence/rentri-scorta.repository'
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
    private readonly logger: LoggerService,
    private readonly datiViaggio: IDatiViaggioFirRepository,
    /** Scorta vidimata: il numero consumato all'emissione entra nel corpo di creazione. */
    private readonly scorta?: RentriScortaRepository
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

    // Dati noti del viaggio (FIR in viaggio P2, D2): quantita' e trasporto di partenza entrano nel corpo
    // di creazione SOLO se completi; altrimenti li invia l'utente dopo, dai due dialog.
    const viaggio = await this.datiViaggio.leggi(tenantId, fir.id)
    const tipoTrasporto = this.tipoTrasportoDelContratto(fir)
    const rifiutoFir = fir.rifiuto
    const targaAutomezzo = fir.trasportatore?.targaVeicolo?.trim() ?? ''

    // Numero dell'ente consumato dalla scorta all'emissione (stesso FIR = stesso numero a ogni
    // nuovo tentativo di invio: la ricerca e' per firId, non un nuovo consumo). Senza, lo
    // assegna l'ente (`numero_fir` e' opzionale nel contratto).
    const vidimato = await this.scorta?.trovaConsumatoDaFir(tenantId, fir.id)

    return mappaNuovoFormulario(
      {
        // Il numero appartiene al blocco della sede da cui e' stato consumato: se la principale
        // e' cambiata dopo l'emissione, num_iscr_sito resta quello del numero (mai A con numero di B).
        numIscrSito: vidimato?.numIscrSito ?? sede.numIscrSito,
        numeroFir: vidimato?.numeroFir ?? null,
        provenienza: this.codiceProvenienza(fir),
        tipoTrasporto,
        caratteristichePericolo: rifiutoFir?.caratteristichePericolo ?? null,
        quantita:
          rifiutoFir && (viaggio?.rinfusa === true || rifiutoFir.numeroColli)
            ? {
                valore: rifiutoFir.quantita.valore,
                unitaMisura: rifiutoFir.quantita.unitaMisura,
                numeroColli: rifiutoFir.numeroColli ?? null,
                rinfusa: viaggio?.rinfusa ?? null,
                verificatoInPartenza: viaggio?.verificatoInPartenza ?? null,
              }
            : null,
        datiTrasportoPartenza:
          viaggio &&
          tipoTrasporto === 'Terrestre' &&
          viaggio.principale.conducenteNome?.trim() &&
          viaggio.principale.conducenteCognome?.trim() &&
          (targaAutomezzo || viaggio.principale.targaRimorchio?.trim())
            ? {
                conducenteNome: viaggio.principale.conducenteNome,
                conducenteCognome: viaggio.principale.conducenteCognome,
                targaAutomezzo,
                targaRimorchio: viaggio.principale.targaRimorchio,
                percorso: viaggio.principale.percorso,
                dataOraInizioTrasporto: viaggio.dataTrasporto,
              }
            : null,
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
          // Intermodale: ogni tratta aggiuntiva e' un trasportatore con la sua modalita'.
          ...fir.trasportatoriAggiuntivi.map(tratta => ({
            ragioneSociale: tratta.denominazione,
            partitaIVA: tratta.codiceFiscale ?? tratta.partitaIva ?? '',
            numeroIscrizione: tratta.numeroIscrizioneAlbo ?? null,
            tipoTrasporto: this.tipoTrasportoDiTratta(tratta.tipoTratta),
          })),
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
    return this.tipoTrasportoDiTratta(fir.tipoTrattaPrincipale)
  }

  private tipoTrasportoDiTratta(tratta: TipoTratta | string | null): TipoTrasporto | null {
    switch (tratta) {
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

    // Denominazione e identificativo dalla ditta (ditta_id e' NOT NULL: le colonne storiche sulla
    // riga di ruolo non esistono piu'). L'indirizzo dalla sede scelta sul FIR (filtrata per tenant
    // E ditta del ruolo: una sede di un'altra ditta non deve mai uscire) o, se il FIR non ne ha
    // una (creato prima della migration), dalla predefinita del ruolo.
    const ditta = riga.ditta
    if (!ditta) {
      throw new DatoMancantePerRentriError(
        nomeParte,
        'ditta',
        'la riga di registro non ha una ditta'
      )
    }
    let indirizzo: IndirizzoRegistro | null = riga.sede
    if (parte?.sedeId) {
      indirizzo = await this.prisma.db.sedeDitta.findFirst({
        where: { id: parte.sedeId, tenantId, dittaId: riga.dittaId },
      })
      if (!indirizzo) {
        throw new DatoMancantePerRentriError(
          nomeParte,
          'sede',
          'la sede scelta sul FIR non risulta tra le sedi della ditta'
        )
      }
    }
    if (!indirizzo) {
      throw new DatoMancantePerRentriError(nomeParte, 'sede', 'la riga di registro non ha una sede')
    }
    return {
      ragioneSociale: ditta.ragioneSociale,
      // Il contratto vuole un solo identificativo fiscale: CF della ditta se c'e', altrimenti P.IVA
      partitaIVA: ditta.codiceFiscale ?? ditta.partitaIva ?? '',
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
  dittaId: string
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
