/**
 * Destinatario Prisma Repository Implementation
 * Il destinatario e' un ruolo di una ditta (F2-10): identita' fiscale e ragione sociale stanno
 * sulla ditta, indirizzo e contatti sulla sede predefinita. Parte comune in `RuoloDittaPrismaBase`.
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { DestinatarioRepository } from '../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'
import { ClientDitte } from './ditta-prisma.repository'
import {
  ContestoDittaLetto,
  RecordSedeLetto,
  RuoloDittaPrismaBase,
} from './ruolo-ditta-prisma.base'

@Injectable()
export class DestinatarioPrismaRepository
  extends RuoloDittaPrismaBase<Destinatario>
  implements DestinatarioRepository<ClientDitte>
{
  protected readonly modello = 'destinatario' as const
  protected readonly ruolo = 'DESTINATARIO' as const

  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async findByNumeroAutorizzazione(numeroAutorizzazione: string): Promise<Destinatario | null> {
    return this.primoPer({ numeroAutorizzazione })
  }

  protected indirizzoDi(d: Destinatario): Indirizzo {
    return d.sede
  }

  protected campiRuolo(d: Destinatario): Record<string, unknown> {
    return {
      numeroAutorizzazione: d.numeroAutorizzazione,
      scadenzaAutorizzazione: d.scadenzaAutorizzazione || null,
    }
  }

  protected daRecord(riga: any, sede: RecordSedeLetto, contesto: ContestoDittaLetto): Destinatario {
    return Destinatario.reconstitute({
      id: riga.id,
      dittaId: riga.dittaId,
      sedeId: riga.sedeId,
      ragioneSociale: contesto.ditta.ragioneSociale,
      partitaIVA: contesto.ditta.partitaIva ? PartitaIVA.create(contesto.ditta.partitaIva) : null,
      codiceFiscale: contesto.ditta.codiceFiscale,
      sede: Indirizzo.create({
        via: sede.via,
        civico: sede.civico,
        cap: sede.cap,
        citta: sede.comune, // Map database "comune" to domain "citta"
        provincia: sede.provincia,
      }),
      numeroAutorizzazione: riga.numeroAutorizzazione,
      email: sede.email || undefined,
      telefono: sede.telefono || undefined,
      pec: sede.pec || undefined,
      scadenzaAutorizzazione: riga.scadenzaAutorizzazione || undefined,
      numeroSedi: contesto.numeroSedi,
      ruoliDitta: contesto.ruoliDitta,
      createdAt: riga.createdAt,
      updatedAt: riga.updatedAt,
    })
  }
}
