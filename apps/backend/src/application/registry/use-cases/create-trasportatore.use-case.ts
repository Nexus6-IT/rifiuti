/**
 * CreateTrasportatore Use Case
 * Crea il ruolo di trasportatore su una ditta (F2-10): ditta e sede si riusano se esistono gia'.
 * Una sola transazione (D3), vedi `creaRuoloSuDitta`. Il privato (solo codice fiscale) non puo'
 * essere trasportatore: lo rifiuta `DitteService.risolviPerRuolo` (400).
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  TrasportatoreRepository,
  TRASPORTATORE_REPOSITORY,
} from '../../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import { ClientDitte } from '../../../infrastructure/persistence/ditta-prisma.repository'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { ReferenceDataService } from '../../reference-data/reference-data.service'
import { DitteService } from '../ditte/ditte.service'
import {
  EsitoCreazioneRuolo,
  RuoloGiaPresenteError,
  creaRuoloSuDitta,
  eErroreDiDittaDaPropagare,
  messaggioSicuro,
} from '../crea-ruolo-su-ditta'

export interface CreateTrasportatoreCommand {
  ragioneSociale: string
  /** Obbligatoria in questo task (le colonne vecchie sono NOT NULL, Task 3b-2). */
  partitaIVA: string
  /** In aggiunta alla P.IVA. */
  codiceFiscale?: string
  sedeLegale: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  numeroIscrizione: string
  email?: string
  telefono?: string
  pec?: string
  scadenzaIscrizione?: Date
}

@Injectable()
export class CreateTrasportatoreUseCase {
  constructor(
    @Inject(TRASPORTATORE_REPOSITORY)
    private readonly trasportatoreRepository: TrasportatoreRepository<ClientDitte>,
    private readonly prisma: PrismaService,
    private readonly ditte: DitteService,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(
    command: CreateTrasportatoreCommand
  ): Promise<Result<EsitoCreazioneRuolo<Trasportatore>>> {
    try {
      // Check if Numero Iscrizione already exists
      const existingByNumero = await this.trasportatoreRepository.findByNumeroIscrizione(
        command.numeroIscrizione
      )

      if (existingByNumero) {
        return Result.fail('Trasportatore with this Numero Iscrizione already exists')
      }

      // Valida comune/provincia contro le tabelle ISTAT condivise (se popolate).
      if (this.referenceData) {
        const v = await this.referenceData.validateLocalita(
          command.sedeLegale.citta,
          command.sedeLegale.provincia
        )
        if (!v.ok) return Result.fail(v.error!)
      }

      const sedeLegale = Indirizzo.create(command.sedeLegale)

      const esito = await creaRuoloSuDitta<Trasportatore>(this.prisma, this.ditte, {
        ruolo: 'TRASPORTATORE',
        nome: 'trasportatore',
        dati: {
          ragioneSociale: command.ragioneSociale,
          partitaIva: command.partitaIVA,
          codiceFiscale: command.codiceFiscale,
          indirizzo: command.sedeLegale,
          email: command.email,
          telefono: command.telefono,
          pec: command.pec,
        },
        esistente: (tx, dittaId) => this.trasportatoreRepository.findByDittaId(tx, dittaId),
        costruisci: r =>
          Trasportatore.create({
            dittaId: r.dittaId,
            sedeId: r.sedeId,
            // la ragione sociale della ditta vince su quella della richiesta (D3)
            ragioneSociale: r.ragioneSocialeDitta,
            partitaIVA: r.partitaIva ? PartitaIVA.create(r.partitaIva) : null,
            codiceFiscale: r.codiceFiscale,
            sedeLegale,
            numeroIscrizione: command.numeroIscrizione,
            email: command.email,
            telefono: command.telefono,
            pec: command.pec,
            scadenzaIscrizione: command.scadenzaIscrizione,
          }),
        inserisci: (tx, trasportatore) => this.trasportatoreRepository.crea(tx, trasportatore),
      })

      return Result.ok(esito)
    } catch (error: unknown) {
      if (eErroreDiDittaDaPropagare(error)) throw error
      if (error instanceof RuoloGiaPresenteError) return Result.fail(error.message)
      return Result.fail(messaggioSicuro(error))
    }
  }
}
