import { createHash } from 'crypto'
import { Injectable } from '@nestjs/common'
import {
  ISessioniFirmaRentriRepository,
  NuovaSessioneFirmaRentri,
  SessioneFirmaGiaApertaError,
  SessioneFirmaRentri,
  StatoSessioneFirma,
} from '../../application/rentri/sessioni-firma-rentri.port'
import { PrismaService } from './prisma.service'

type Riga = NonNullable<Awaited<ReturnType<PrismaService['firSessioneFirmaRentri']['findFirst']>>>

function aDominio(r: Riga): SessioneFirmaRentri {
  return {
    id: r.id,
    tenantId: r.tenantId,
    firId: r.firId,
    tipoOperazione: r.tipoOperazione,
    handle: r.handle,
    tokenHash: r.tokenHash,
    tokenAcquisizione: r.tokenAcquisizione,
    digestToSign: r.digestToSign,
    scadenza: r.scadenza,
    stato: r.stato as StatoSessioneFirma,
    dettaglioEnte: r.dettaglioEnte,
    utenteId: r.utenteId,
    createdAt: r.createdAt,
  }
}

/** Persistenza Prisma delle sessioni di firma; ogni query filtra anche per tenant (oltre alla RLS). */
@Injectable()
export class SessioniFirmaRentriRepository extends ISessioniFirmaRentriRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async trovaAperta(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null> {
    const r = await this.prisma.firSessioneFirmaRentri.findFirst({
      where: { tenantId, firId, stato: 'IN_ATTESA' },
    })
    return r ? aDominio(r) : null
  }

  async trovaPerId(tenantId: string, id: string): Promise<SessioneFirmaRentri | null> {
    const r = await this.prisma.firSessioneFirmaRentri.findFirst({ where: { id, tenantId } })
    return r ? aDominio(r) : null
  }

  async apri(dati: NuovaSessioneFirmaRentri): Promise<SessioneFirmaRentri> {
    try {
      const r = await this.prisma.firSessioneFirmaRentri.create({
        data: {
          tenantId: dati.tenantId,
          firId: dati.firId,
          tipoOperazione: dati.tipoOperazione,
          handle: dati.handle,
          tokenHash: createHash('sha256').update(dati.tokenAcquisizione).digest('hex'),
          tokenAcquisizione: dati.tokenAcquisizione,
          digestToSign: dati.digestToSign,
          scadenza: dati.scadenza,
          utenteId: dati.utenteId ?? null,
        },
      })
      return aDominio(r)
    } catch (errore) {
      // Indice unico parziale `fir_sessioni_firma_rentri_aperta_key`.
      if ((errore as { code?: string }).code === 'P2002') {
        throw new SessioneFirmaGiaApertaError(dati.firId)
      }
      throw errore
    }
  }

  async chiudi(
    tenantId: string,
    id: string,
    stato: Exclude<StatoSessioneFirma, 'IN_ATTESA'>,
    dettaglioEnte?: string
  ): Promise<boolean> {
    const { count } = await this.prisma.firSessioneFirmaRentri.updateMany({
      where: { id, tenantId, stato: 'IN_ATTESA' },
      data: { stato, ...(dettaglioEnte !== undefined ? { dettaglioEnte } : {}) },
    })
    return count === 1
  }
}
