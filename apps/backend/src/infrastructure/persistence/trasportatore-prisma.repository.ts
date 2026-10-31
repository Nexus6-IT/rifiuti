/**
 * Trasportatore Prisma Repository Implementation
 * Il trasportatore e' un ruolo di una ditta (F2-10): identita' fiscale e ragione sociale stanno
 * sulla ditta, indirizzo e contatti sulla sede predefinita. Parte comune in `RuoloDittaPrismaBase`.
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { TrasportatoreRepository } from '../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../domain/registry/entities/trasportatore'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'
import { ClientDitte } from './ditta-prisma.repository'
import {
  ContestoDittaLetto,
  RecordSedeLetto,
  RuoloDittaPrismaBase,
} from './ruolo-ditta-prisma.base'

@Injectable()
export class TrasportatorePrismaRepository
  extends RuoloDittaPrismaBase<Trasportatore>
  implements TrasportatoreRepository<ClientDitte>
{
  protected readonly modello = 'trasportatore' as const
  protected readonly ruolo = 'TRASPORTATORE' as const

  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async findByNumeroIscrizione(numeroIscrizione: string): Promise<Trasportatore | null> {
    return this.primoPer({ numeroIscrizione })
  }

  protected indirizzoDi(t: Trasportatore): Indirizzo {
    return t.sedeLegale
  }

  protected campiRuolo(t: Trasportatore): Record<string, unknown> {
    return {
      numeroIscrizione: t.numeroIscrizione,
      scadenzaIscrizione: t.scadenzaIscrizione || null,
    }
  }

  protected daRecord(
    riga: any,
    sede: RecordSedeLetto,
    contesto: ContestoDittaLetto
  ): Trasportatore {
    return Trasportatore.reconstitute({
      id: riga.id,
      dittaId: riga.dittaId,
      sedeId: riga.sedeId,
      ragioneSociale: contesto.ditta.ragioneSociale,
      partitaIVA: contesto.ditta.partitaIva ? PartitaIVA.create(contesto.ditta.partitaIva) : null,
      codiceFiscale: contesto.ditta.codiceFiscale,
      sedeLegale: Indirizzo.create({
        via: sede.via,
        civico: sede.civico,
        cap: sede.cap,
        citta: sede.comune, // Map database "comune" to domain "citta"
        provincia: sede.provincia,
      }),
      numeroIscrizione: riga.numeroIscrizione,
      email: sede.email || undefined,
      telefono: sede.telefono || undefined,
      pec: sede.pec || undefined,
      scadenzaIscrizione: riga.scadenzaIscrizione || undefined,
      numeroSedi: contesto.numeroSedi,
      ruoliDitta: contesto.ruoliDitta,
      createdAt: riga.createdAt,
      updatedAt: riga.updatedAt,
    })
  }
}
