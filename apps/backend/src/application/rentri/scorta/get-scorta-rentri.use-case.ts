import { Injectable } from '@nestjs/common'
import { RentriScortaRepository } from '../../../infrastructure/persistence/rentri-scorta.repository'
import { ElencaBlocchiRentriUseCase } from './elenca-blocchi-rentri.use-case'

export interface ScortaPerBloccoDto {
  codiceBlocco: string
  /** Unità locale (sede) a cui appartiene questo blocco — v. il commento della classe. */
  numIscrSito: string
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
 *
 * **`totaleDisponibili` è un aggregato di TENANT (`contaTotaleDisponibili`
 * chiamato SENZA `numIscrSito`), non per sede.** È una scelta deliberata: la
 * schermata "Blocchi RENTRI" da cui questo endpoint è letto elenca già i
 * blocchi di TUTTE le sedi del tenant (ogni riga porta il proprio
 * `numIscrSito`, v. `RentriBlocco`/`ScortaPerBloccoDto` sopra), quindi un
 * totale di tenant è la lettura corretta per quella vista d'insieme — a
 * differenza di `GET /rentri/emissione-possibile`
 * (`VerificaEmissionePossibileRentriUseCase`), che risponde "posso emettere
 * ADESSO da QUESTA sede" ed è perciò per-sede per costruzione (i numeri
 * vidimati funzionano solo per la sede che li ha richiesti). Le due cifre
 * NON sono la stessa domanda: un tenant con due sedi e 10 numeri sulla sede
 * B avrà `totaleDisponibili: 10` qui e "0 disponibili" per l'emissione dalla
 * sede A, e questo è corretto — la UI deve però etichettare questo totale
 * come "su tutte le sedi", mai come "pronti per il prossimo FIR" (v.
 * `rentri-blocchi.component.ts`).
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
        numIscrSito: g.numIscrSito,
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
