import { createHash } from 'crypto'
import { Injectable } from '@nestjs/common'
import {
  DatiAutorizzazioneFirma,
  ISessioniFirmaRentriRepository,
  PrenotazioneSessioneFirma,
  SessioneFirmaGiaApertaError,
  SessioneFirmaRentri,
  STATI_SESSIONE_APERTA,
  StatoSessioneChiusa,
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

const APERTE = STATI_SESSIONE_APERTA as unknown as Array<'IN_AVVIO' | 'IN_ATTESA' | 'IN_FIRMA'>

/** Persistenza Prisma delle sessioni di firma; ogni query filtra anche per tenant (oltre alla RLS). */
@Injectable()
export class SessioniFirmaRentriRepository extends ISessioniFirmaRentriRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async trovaAperta(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null> {
    const r = await this.prisma.firSessioneFirmaRentri.findFirst({
      where: { tenantId, firId, stato: { in: APERTE } },
    })
    return r ? aDominio(r) : null
  }

  async trovaPerId(tenantId: string, id: string): Promise<SessioneFirmaRentri | null> {
    const r = await this.prisma.firSessioneFirmaRentri.findFirst({ where: { id, tenantId } })
    return r ? aDominio(r) : null
  }

  async ultima(tenantId: string, firId: string): Promise<SessioneFirmaRentri | null> {
    const r = await this.prisma.firSessioneFirmaRentri.findFirst({
      where: { tenantId, firId },
      orderBy: { createdAt: 'desc' },
    })
    return r ? aDominio(r) : null
  }

  async prenota(dati: PrenotazioneSessioneFirma): Promise<SessioneFirmaRentri> {
    try {
      const r = await this.prisma.firSessioneFirmaRentri.create({
        data: {
          tenantId: dati.tenantId,
          firId: dati.firId,
          tipoOperazione: dati.tipoOperazione,
          scadenza: dati.scadenza,
          stato: 'IN_AVVIO',
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

  async completaAvvio(
    tenantId: string,
    id: string,
    dati: DatiAutorizzazioneFirma
  ): Promise<boolean> {
    const { count } = await this.prisma.firSessioneFirmaRentri.updateMany({
      where: { id, tenantId, stato: 'IN_AVVIO' },
      data: {
        stato: 'IN_ATTESA',
        handle: dati.handle,
        tokenAcquisizione: dati.tokenAcquisizione,
        tokenHash: createHash('sha256').update(dati.tokenAcquisizione).digest('hex'),
        digestToSign: dati.digestToSign,
        scadenza: dati.scadenza,
      },
    })
    return count === 1
  }

  async prendiPerFirma(tenantId: string, id: string, scadenzaPresa: Date): Promise<boolean> {
    const { count } = await this.prisma.firSessioneFirmaRentri.updateMany({
      where: { id, tenantId, stato: 'IN_ATTESA' },
      data: { stato: 'IN_FIRMA', scadenza: scadenzaPresa },
    })
    return count === 1
  }

  async chiudi(
    tenantId: string,
    id: string,
    stato: StatoSessioneChiusa,
    dettaglioEnte?: string
  ): Promise<boolean> {
    const { count } = await this.prisma.firSessioneFirmaRentri.updateMany({
      where: { id, tenantId, stato: { in: APERTE } },
      data: {
        stato,
        tokenAcquisizione: null,
        ...(dettaglioEnte !== undefined ? { dettaglioEnte } : {}),
      },
    })
    return count === 1
  }
}
