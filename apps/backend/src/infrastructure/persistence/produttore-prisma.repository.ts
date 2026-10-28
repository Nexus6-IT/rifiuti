/**
 * Produttore Prisma Repository Implementation
 * Il produttore e' un ruolo di una ditta (F2-10): identita' fiscale e ragione sociale stanno sulla
 * ditta, indirizzo e contatti sulla sede predefinita. La parte comune e' in `RuoloDittaPrismaBase`.
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { ProduttoreRepository } from '../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../domain/registry/entities/produttore'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'
import { ClientDitte } from './ditta-prisma.repository'
import {
  ContestoDittaLetto,
  RecordSedeLetto,
  RuoloDittaPrismaBase,
} from './ruolo-ditta-prisma.base'

@Injectable()
export class ProduttorePrismaRepository
  extends RuoloDittaPrismaBase<Produttore>
  implements ProduttoreRepository<ClientDitte>
{
  protected readonly modello = 'produttore' as const
  protected readonly ruolo = 'PRODUTTORE' as const

  constructor(prisma: PrismaService) {
    super(prisma)
  }

  protected indirizzoDi(p: Produttore): Indirizzo {
    return p.sedeLegale
  }

  protected campiRuolo(): Record<string, unknown> {
    return {}
  }

  protected daRecord(riga: any, sede: RecordSedeLetto, contesto: ContestoDittaLetto): Produttore {
    return Produttore.reconstitute({
      id: riga.id,
      dittaId: riga.dittaId,
      sedeId: riga.sedeId,
      ragioneSociale: contesto.ditta.ragioneSociale,
      // le P.IVA migrate possono non passare il checksum: in lettura non si controlla mai
      partitaIVA: contesto.ditta.partitaIva ? PartitaIVA.create(contesto.ditta.partitaIva) : null,
      codiceFiscale: contesto.ditta.codiceFiscale,
      sedeLegale: Indirizzo.create({
        via: sede.via,
        civico: sede.civico,
        cap: sede.cap,
        citta: sede.comune, // Map database "comune" to domain "citta"
        provincia: sede.provincia,
      }),
      email: sede.email || undefined,
      telefono: sede.telefono || undefined,
      pec: sede.pec || undefined,
      numeroSedi: contesto.numeroSedi,
      ruoliDitta: contesto.ruoliDitta,
      createdAt: riga.createdAt,
      updatedAt: riga.updatedAt,
    })
  }
}
