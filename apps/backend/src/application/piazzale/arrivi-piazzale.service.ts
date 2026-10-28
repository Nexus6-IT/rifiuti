import { Injectable, NotFoundException } from '@nestjs/common'
import { FIR, FIRStato } from '../../domain/fir/aggregates/fir.aggregate'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { MudIntegrazioniService } from '../mud/mud-integrazioni.service'
import {
  corrispondeRicercaPiazzale,
  eArrivoPiazzale,
  normalizzaRicercaPiazzale,
} from './arrivo-piazzale'

export interface ArriviPiazzale {
  azienda: { id: string; ragioneSociale: string }
  codiciAziendaConfigurati: boolean
  arrivi: FIR[]
}

/** Elenco dei FIR in arrivo al piazzale dell'azienda (tenant) richiesta. */
@Injectable()
export class ArriviPiazzaleService {
  constructor(
    private readonly firRepository: FIRPrismaRepository,
    private readonly integrazioniMud: MudIntegrazioniService,
    private readonly prisma: PrismaService
  ) {}

  async elenca(tenantId: string, cerca?: string): Promise<ArriviPiazzale> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, ragioneSociale: true },
    })
    if (!tenant) throw new NotFoundException('Azienda non trovata')

    const codici = new Set(await this.integrazioniMud.codiciAzienda(tenantId))
    const azienda = { id: tenant.id, ragioneSociale: tenant.ragioneSociale }
    if (codici.size === 0) {
      return { azienda, codiciAziendaConfigurati: false, arrivi: [] }
    }

    const [inTransito, bozze] = await Promise.all([
      this.firRepository.findByTenant(tenantId, { stato: FIRStato.IN_TRANSITO }),
      this.firRepository.findByTenant(tenantId, { stato: FIRStato.BOZZA }),
    ])
    const ricerca = normalizzaRicercaPiazzale(cerca)
    const arrivi = [...inTransito, ...bozze].filter(
      (fir) => eArrivoPiazzale(fir, codici) && corrispondeRicercaPiazzale(fir, ricerca)
    )
    return { azienda, codiciAziendaConfigurati: true, arrivi }
  }
}
