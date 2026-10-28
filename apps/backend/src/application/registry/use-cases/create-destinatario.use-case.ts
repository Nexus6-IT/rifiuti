/**
 * CreateDestinatario Use Case
 * Crea il ruolo di destinatario su una ditta (F2-10): ditta e sede si riusano se esistono gia'.
 * Una sola transazione (D3), vedi `creaRuoloSuDitta`. Il privato (solo codice fiscale) non puo'
 * essere destinatario: lo rifiuta `DitteService.risolviPerRuolo` (400).
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  DestinatarioRepository,
  DESTINATARIO_REPOSITORY,
} from '../../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../../domain/registry/entities/destinatario'
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

export interface CreateDestinatarioCommand {
  ragioneSociale: string
  /** Obbligatoria in questo task (le colonne vecchie sono NOT NULL, Task 3b-2). */
  partitaIVA: string
  /** In aggiunta alla P.IVA. */
  codiceFiscale?: string
  sede: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  numeroAutorizzazione: string
  email?: string
  telefono?: string
  pec?: string
  scadenzaAutorizzazione?: Date
}

@Injectable()
export class CreateDestinatarioUseCase {
  constructor(
    @Inject(DESTINATARIO_REPOSITORY)
    private readonly destinatarioRepository: DestinatarioRepository<ClientDitte>,
    private readonly prisma: PrismaService,
    private readonly ditte: DitteService,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(
    command: CreateDestinatarioCommand
  ): Promise<Result<EsitoCreazioneRuolo<Destinatario>>> {
    try {
      // Check if Numero Autorizzazione already exists
      const existingByNumero = await this.destinatarioRepository.findByNumeroAutorizzazione(
        command.numeroAutorizzazione
      )

      if (existingByNumero) {
        return Result.fail('Destinatario with this Numero Autorizzazione already exists')
      }

      // Valida comune/provincia contro le tabelle ISTAT condivise (se popolate).
      if (this.referenceData) {
        const v = await this.referenceData.validateLocalita(
          command.sede.citta,
          command.sede.provincia
        )
        if (!v.ok) return Result.fail(v.error!)
      }

      const sede = Indirizzo.create(command.sede)

      const esito = await creaRuoloSuDitta<Destinatario>(this.prisma, this.ditte, {
        ruolo: 'DESTINATARIO',
        nome: 'destinatario',
        dati: {
          ragioneSociale: command.ragioneSociale,
          partitaIva: command.partitaIVA,
          codiceFiscale: command.codiceFiscale,
          indirizzo: command.sede,
          email: command.email,
          telefono: command.telefono,
          pec: command.pec,
        },
        esistente: (tx, dittaId) => this.destinatarioRepository.findByDittaId(tx, dittaId),
        costruisci: r =>
          Destinatario.create({
            dittaId: r.dittaId,
            sedeId: r.sedeId,
            // la ragione sociale della ditta vince su quella della richiesta (D3)
            ragioneSociale: r.ragioneSocialeDitta,
            partitaIVA: r.partitaIva ? PartitaIVA.create(r.partitaIva) : null,
            codiceFiscale: r.codiceFiscale,
            sede,
            numeroAutorizzazione: command.numeroAutorizzazione,
            email: command.email,
            telefono: command.telefono,
            pec: command.pec,
            scadenzaAutorizzazione: command.scadenzaAutorizzazione,
          }),
        inserisci: (tx, destinatario) => this.destinatarioRepository.crea(tx, destinatario),
      })

      return Result.ok(esito)
    } catch (error: unknown) {
      if (eErroreDiDittaDaPropagare(error)) throw error
      if (error instanceof RuoloGiaPresenteError) return Result.fail(error.message)
      return Result.fail(messaggioSicuro(error))
    }
  }
}
