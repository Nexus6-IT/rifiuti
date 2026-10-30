/**
 * CreateProduttore Use Case
 * Crea il ruolo di produttore su una ditta (F2-10): ditta e sede si riusano se esistono gia'.
 * Una sola transazione (D3), vedi `creaRuoloSuDitta`.
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  ProduttoreRepository,
  PRODUTTORE_REPOSITORY,
} from '../../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'
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

export interface CreateProduttoreCommand {
  ragioneSociale: string
  /** Facoltativa se c'e' il codice fiscale (privato, D2). */
  partitaIVA?: string
  /** In aggiunta alla P.IVA, oppure da solo (privato). */
  codiceFiscale?: string
  sedeLegale: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  email?: string
  telefono?: string
  pec?: string
}

@Injectable()
export class CreateProduttoreUseCase {
  constructor(
    @Inject(PRODUTTORE_REPOSITORY)
    private readonly produttoreRepository: ProduttoreRepository<ClientDitte>,
    private readonly prisma: PrismaService,
    private readonly ditte: DitteService,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(
    command: CreateProduttoreCommand
  ): Promise<Result<EsitoCreazioneRuolo<Produttore>>> {
    try {
      // Valida comune/provincia contro le tabelle ISTAT condivise (se popolate).
      if (this.referenceData) {
        const v = await this.referenceData.validateLocalita(
          command.sedeLegale.citta,
          command.sedeLegale.provincia
        )
        if (!v.ok) return Result.fail(v.error!)
      }

      const sedeLegale = Indirizzo.create(command.sedeLegale)

      const esito = await creaRuoloSuDitta<Produttore>(this.prisma, this.ditte, {
        ruolo: 'PRODUTTORE',
        nome: 'produttore',
        dati: {
          ragioneSociale: command.ragioneSociale,
          partitaIva: command.partitaIVA,
          codiceFiscale: command.codiceFiscale,
          indirizzo: command.sedeLegale,
          email: command.email,
          telefono: command.telefono,
          pec: command.pec,
        },
        esistente: (tx, dittaId) => this.produttoreRepository.findByDittaId(tx, dittaId),
        costruisci: r =>
          Produttore.create({
            dittaId: r.dittaId,
            sedeId: r.sedeId,
            // la ragione sociale della ditta vince su quella della richiesta (D3)
            ragioneSociale: r.ragioneSocialeDitta,
            partitaIVA: r.partitaIva ? PartitaIVA.create(r.partitaIva) : null,
            codiceFiscale: r.codiceFiscale,
            sedeLegale,
            email: r.contatti.email ?? undefined,
            telefono: r.contatti.telefono ?? undefined,
            pec: r.contatti.pec ?? undefined,
          }),
        inserisci: (tx, produttore) => this.produttoreRepository.crea(tx, produttore),
      })

      return Result.ok(esito)
    } catch (error: unknown) {
      if (eErroreDiDittaDaPropagare(error)) throw error
      if (error instanceof RuoloGiaPresenteError) return Result.fail(error.message)
      return Result.fail(messaggioSicuro(error))
    }
  }
}
