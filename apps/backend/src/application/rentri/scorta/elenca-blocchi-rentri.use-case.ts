import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriUnitaLocaleService } from '../../../infrastructure/rentri/rentri-unita-locale.service'
import { RentriVidimazioneClient } from '../../../infrastructure/rentri/rentri-vidimazione.client'
import { risolviCfTenant } from './risolvi-cf-tenant'

export interface BloccoRentriDto {
  codiceBlocco: string
  descrizione: string | null
  numIscrSito: string | null
  disattivo: boolean
  numeroFirVidimati: number
  dataUltimoUtilizzo: string | null
  /** Nostro: true se questo è il blocco predefinito della sua unità locale. */
  predefinito: boolean
}

/**
 * `GET /rentri/blocchi` (R6). Legge i blocchi virtuali dall'ente — **mai**
 * un modulo "crea blocco": non esiste alcuna API di creazione (v.
 * `docs/audits/rentri-blocchi-come-fanno-gli-altri-2026-09-11.md` §5), il
 * blocco si crea SOLO sul portale RENTRI. Questo use case si limita a
 * presentarli in lista, con `predefinito` calcolato localmente
 * confrontando `codice_blocco` con `RentriUnitaLocale.codiceBloccoPredefinito`
 * della sede a cui il blocco appartiene.
 */
@Injectable()
export class ElencaBlocchiRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitaLocaleService: RentriUnitaLocaleService,
    private readonly vidimazioneClient: RentriVidimazioneClient
  ) {}

  async execute(tenantId: string): Promise<{ blocchi: BloccoRentriDto[] }> {
    const cf = await risolviCfTenant(this.prisma, tenantId)
    const unitaLocali = await this.unitaLocaleService.listForTenant(tenantId)

    const predefinitiPerSede = new Map<string, string>()
    for (const u of unitaLocali) {
      if (u.codiceBloccoPredefinito) {
        predefinitiPerSede.set(u.numIscrSito, u.codiceBloccoPredefinito)
      }
    }

    const { risultati } = await this.vidimazioneClient.elencaBlocchi(
      cf,
      { ancheDisattivi: true, paging: { page: 1, pageSize: 100 } },
      tenantId
    )

    const blocchi: BloccoRentriDto[] = risultati.map(b => {
      const numIscrSito = b.num_iscr_sito ?? null
      const codiceBlocco = b.codice_blocco ?? ''
      const predefinito =
        numIscrSito !== null && predefinitiPerSede.get(numIscrSito) === codiceBlocco
      return {
        codiceBlocco,
        descrizione: b.descrizione ?? null,
        numIscrSito,
        disattivo: b.disattivo,
        numeroFirVidimati: b.numero_fir_vidimati,
        dataUltimoUtilizzo: b.data_ultimo_utilizzo ?? null,
        predefinito,
      }
    })

    return { blocchi }
  }
}
