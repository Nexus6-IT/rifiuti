/**
 * Registri RENTRI della sede di un registro locale, per scegliere a quale collegarlo
 * (eREGI E2, T3). Sola lettura su RENTRI (una chiamata paginata).
 */
import { Injectable } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriAnagraficheClient } from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import {
  leggiContestoRegistroRentri,
  registroRentriChiuso,
  richiediOperatore,
} from './contesto-registro-rentri'

export interface CandidatoRegistroRentri {
  identificativo: string
  descrizione: string | null
  attivita: string[]
  attivitaRecSmalt: string[]
  dataCreazione: string | null
  /** Id del registro locale a cui questo identificativo e' gia' collegato (`null` = libero). */
  collegatoA: string | null
  /** E' proprio il registro che si sta collegando. */
  questoRegistro: boolean
}

const PAGINE_MASSIME = 5
const DIMENSIONE_PAGINA = 100

@Injectable()
export class CandidatiRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RentriAnagraficheClient
  ) {}

  async esegui(tenantId: string, registroId: string): Promise<CandidatoRegistroRentri[]> {
    const { contesto, collegati } = await TenantContext.run({ tenantId }, async () => {
      return await this.prisma.$transaction(async tx => {
        const contesto = await leggiContestoRegistroRentri(tx, tenantId, registroId)
        const righe = await tx.registroRifiuti.findMany({
          where: { tenantId, identificativoRentri: { not: null } },
          select: { id: true, identificativoRentri: true },
        })
        return { contesto, collegati: righe }
      })
    })
    const numIscrOperatore = richiediOperatore(contesto)

    const risultati = []
    for (let page = 1; page <= PAGINE_MASSIME; page++) {
      const pagina = await this.client.elencaRegistriSito(
        numIscrOperatore,
        contesto.numIscrSito,
        { chiuso: false, paging: { page, pageSize: DIMENSIONE_PAGINA } },
        tenantId
      )
      risultati.push(...pagina.risultati)
      if (page >= pagina.paging.pageCount) break
    }

    const candidati: CandidatoRegistroRentri[] = []
    for (const r of risultati) {
      if (typeof r.identificativo !== 'string' || registroRentriChiuso(r)) continue
      const collegato = collegati.find(c => c.identificativoRentri === r.identificativo)
      candidati.push({
        identificativo: r.identificativo,
        descrizione: r.descrizione ?? null,
        attivita: (r.attivita ?? []).filter(a => typeof a === 'string'),
        attivitaRecSmalt: (r.attivita_rec_smalt ?? []).filter(a => typeof a === 'string'),
        dataCreazione: r.data_creazione ?? null,
        collegatoA: collegato?.id ?? null,
        questoRegistro: collegato?.id === registroId,
      })
    }
    return candidati
  }
}
