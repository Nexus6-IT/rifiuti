/**
 * FIRPartyResolver
 *
 * Risolve quale utente ricopre ciascun ruolo di parte su un FIR
 * (produttore / trasportatore / destinatario).
 *
 * PERCHÉ SERVE: la firma del FIR ha senso giuridico solo se ogni ruolo è
 * sottoscritto dalla parte corrispondente. Senza questo controllo, qualsiasi
 * operatore del tenant potrebbe apporre tutte e tre le firme, annullando la
 * separazione dei ruoli che è la ragione d'essere del formulario
 * (DM 59/2023 art. 6-7; art. 193 D.Lgs. 152/2006).
 *
 * L'aggregate FIR usato dal contesto firma non trasporta le parti: espone solo
 * id, numero, tenant, produttore (P.IVA), CER, quantità. La risoluzione avviene
 * quindi direttamente sulla riga `FIR`, che è la fonte autoritativa dei tre
 * `*_user_id`.
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma.service'
import { SignatureRole } from '../../domain/fir/digital-signature.vo'

/** Assegnazione delle parti su un FIR. `null` = ruolo non ancora assegnato. */
export interface FIRPartyAssignment {
  tenantId: string
  producerUserId: string
  carrierUserId: string | null
  receiverUserId: string | null
}

@Injectable()
export class FIRPartyResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Legge le parti del FIR. Usa `prisma.db` (RLS-aware): un FIR di un altro
   * tenant risulta inesistente, coerentemente con il resto del contesto firma.
   */
  async findParties(firId: string): Promise<FIRPartyAssignment | null> {
    const record = await this.prisma.db.fIR.findFirst({
      where: { id: firId },
      select: {
        tenantId: true,
        producerUserId: true,
        carrierUserId: true,
        receiverUserId: true,
      },
    })
    return record ?? null
  }

  /** Utente atteso per il ruolo richiesto; `null` se il ruolo non è assegnato. */
  static expectedUserIdFor(parties: FIRPartyAssignment, role: SignatureRole): string | null {
    switch (role) {
      case 'PRODUCER':
        return parties.producerUserId
      case 'CARRIER':
        return parties.carrierUserId
      case 'RECEIVER':
        return parties.receiverUserId
      default:
        return null
    }
  }
}
