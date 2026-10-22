import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { MudAggregazioneService } from './aggregazione/mud-aggregazione.service'
import { cerCanonico } from '../../domain/waste-movement/cer-registro'
import {
  riepilogaAvvisi,
  type MudEsitoControllo,
  type RiepilogoAvvisi,
} from './aggregazione/mud-controlli'

export interface MudRiepilogo {
  year: number
  tenantId: string
  generatedAt: Date
  /** Una riga per CER: `cerCode` canonico (con `*` se pericoloso), `totalQuantity` = prodotto (kg), `count` = movimenti */
  wasteProduced: Array<{ cerCode: string; totalQuantity: number; count: number }>
  totals: { produced: number; recovery: number; disposal: number; recyclingRate: number }
  controlli: MudEsitoControllo[]
  riepilogoAvvisi: RiepilogoAvvisi
  /** Azienda segnata come non tenuta al MUD (A-W-10) */
  mudNonDovuto: boolean
}

const arrotondaGrammo = (n: number): number => Math.round(n * 1000) / 1000

/**
 * Riepilogo annuale del MUD, mostrato nella pagina e stampato nel PDF.
 * Parte dalla stessa aggregazione del file telematico (stessa finestra di date, stesse righe
 * per CER, stessi controlli): i numeri del riepilogo sono quelli che il file dichiara.
 * Non lancia sui controlli: anche con errori bloccanti il riepilogo si mostra, con gli errori.
 */
@Injectable()
export class MUDGeneratorService {
  constructor(
    private readonly aggregazione: MudAggregazioneService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(MUDGeneratorService.name)
  }

  async generateMUDReport(tenantId: string, year: number): Promise<MudRiepilogo> {
    this.logger.info(`Riepilogo MUD per tenant ${tenantId}, anno ${year}`)

    const aggregato = await this.aggregazione.aggrega(tenantId, year)

    let produced = 0
    let recovery = 0
    let disposal = 0
    for (const riga of aggregato.righe) {
      produced += riga.prodottoKg
      recovery += riga.recuperoKg
      disposal += riga.smaltimentoKg
    }
    produced = arrotondaGrammo(produced)
    recovery = arrotondaGrammo(recovery)
    disposal = arrotondaGrammo(disposal)
    const avviati = recovery + disposal

    return {
      year,
      tenantId,
      generatedAt: new Date(),
      wasteProduced: aggregato.righe.map(riga => ({
        // CER come lo legge l'utente, con l'asterisco se pericoloso (come nei controlli)
        cerCode: cerCanonico(
          aggregato.pericolosiPerCer[riga.cerCode] ? `${riga.cerCode}*` : riga.cerCode
        ),
        totalQuantity: riga.prodottoKg,
        count: aggregato.movimentiPerCer[riga.cerCode] ?? 0,
      })),
      totals: {
        produced,
        recovery,
        disposal,
        recyclingRate: avviati > 0 ? recovery / avviati : 0,
      },
      controlli: aggregato.controlli,
      riepilogoAvvisi: riepilogaAvvisi(aggregato.controlli),
      mudNonDovuto: aggregato.mudNonDovuto,
    }
  }
}
