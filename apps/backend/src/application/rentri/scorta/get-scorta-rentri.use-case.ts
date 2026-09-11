import { Injectable } from '@nestjs/common'
import { RentriScortaRepository } from '../../../infrastructure/persistence/rentri-scorta.repository'
import { ElencaBlocchiRentriUseCase } from './elenca-blocchi-rentri.use-case'

export interface ScortaPerBloccoDto {
  codiceBlocco: string
  descrizione: string | null
  disponibili: number
}

export interface GetScortaRentriResult {
  totaleDisponibili: number
  perBlocco: ScortaPerBloccoDto[]
}

/**
 * `GET /rentri/scorta` (R6). Il conteggio (`contaTotaleDisponibili`/
 * `contaDisponibiliPerBlocco`) è puramente locale — la scorta è già stata
 * popolata da {@link AvviaVidimazioneScortaUseCase}/
 * `RentriRifornimentoScortaJob` e persistita in `RentriNumeroVidimato` — ed
 * è un LOG di consumo, non una barra di capienza (v.
 * `docs/audits/rentri-blocchi-come-fanno-gli-altri-2026-09-11.md` §"Schemi
 * ricorrenti" punto 6): il blocco RENTRI non si esaurisce, quindi non c'è
 * alcun "totale" rispetto a cui calcolare una percentuale.
 *
 * `descrizione` invece non è nostra (la scorta non la persiste): si arricchisce
 * qui con una lettura di {@link ElencaBlocchiRentriUseCase} (che la legge
 * dall'ente), fallendo morbido a `null` — non fail-closed, a differenza
 * degli altri use case RENTRI: qui `descrizione` è solo un'etichetta di
 * comodo per la UI, non una precondizione per un'operazione. Se l'ente non
 * risponde, la sezione "scorta" resta comunque utile con la sola conta.
 */
@Injectable()
export class GetScortaRentriUseCase {
  constructor(
    private readonly scortaRepo: RentriScortaRepository,
    private readonly elencaBlocchi: ElencaBlocchiRentriUseCase
  ) {}

  async execute(tenantId: string): Promise<GetScortaRentriResult> {
    const [totaleDisponibili, gruppi] = await Promise.all([
      this.scortaRepo.contaTotaleDisponibili(tenantId),
      this.scortaRepo.contaDisponibiliPerBlocco(tenantId),
    ])

    const descrizioniPerCodice = await this.leggiDescrizioniSenzaFallire(tenantId)

    return {
      totaleDisponibili,
      perBlocco: gruppi.map(g => ({
        codiceBlocco: g.codiceBlocco,
        descrizione: descrizioniPerCodice.get(g.codiceBlocco) ?? null,
        disponibili: g.disponibili,
      })),
    }
  }

  private async leggiDescrizioniSenzaFallire(
    tenantId: string
  ): Promise<Map<string, string | null>> {
    try {
      const { blocchi } = await this.elencaBlocchi.execute(tenantId)
      return new Map(blocchi.map(b => [b.codiceBlocco, b.descrizione]))
    } catch {
      return new Map()
    }
  }
}
