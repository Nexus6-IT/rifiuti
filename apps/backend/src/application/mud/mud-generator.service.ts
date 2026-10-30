import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { MudAggregazioneService } from './aggregazione/mud-aggregazione.service'
import {
  riepilogaAvvisi,
  type MudEsitoControllo,
  type RiepilogoAvvisi,
} from './aggregazione/mud-controlli'
import { totaliMud, type TotaliDichiarazioneMud, type TotaliMud } from './mud-totali'
import { VERSIONE_CALCOLO_MUD, versioneCalcoloSalvata } from './mud-report-data'

export interface MudRiepilogo {
  year: number
  tenantId: string
  generatedAt: Date
  /**
   * Una riga per CER, somma di tutte le dichiarazioni: `cerCode` canonico (con `*` se
   * pericoloso), `totalQuantity` = prodotto (kg), `count` = movimenti; poi le quantità avviate a
   * recupero e a smaltimento e le giacenze al 31/12 (kg).
   */
  wasteProduced: Array<{
    cerCode: string
    totalQuantity: number
    count: number
    recoveryKg: number
    disposalKg: number
    giacenzaRecuperoKg: number
    giacenzaSmaltimentoKg: number
  }>
  totals: { produced: number; recovery: number; disposal: number; recyclingRate: number }
  /** Una voce per dichiarazione (unità locale), con i suoi totali per CER */
  dichiarazioni: TotaliDichiarazioneMud[]
  /** Versione del calcolo di questo riepilogo (sempre l'attuale) */
  versioneCalcolo: number
  /**
   * Versione con cui è stato fatto il MUD presentato, solo per un anno presentato o archiviato
   * con una versione diversa da quella attuale: i numeri qui sono quelli delle regole attuali.
   */
  versionePresentata: number | null
  controlli: MudEsitoControllo[]
  riepilogoAvvisi: RiepilogoAvvisi
  /** Azienda segnata come non tenuta al MUD (A-W-10) */
  mudNonDovuto: boolean
}

/**
 * Riepilogo annuale del MUD, mostrato nella pagina e stampato nel PDF.
 * Parte dalla stessa aggregazione del file telematico (stessa finestra di date, stesse righe
 * per CER, stessi controlli) e dai totali condivisi (`totaliMud`, D22): i numeri del riepilogo
 * sono quelli che il file dichiara.
 * Non lancia sui controlli: anche con errori bloccanti il riepilogo si mostra, con gli errori.
 */
@Injectable()
export class MUDGeneratorService {
  constructor(
    private readonly aggregazione: MudAggregazioneService,
    private readonly logger: LoggerService,
    private readonly prisma: PrismaService
  ) {
    this.logger.setContext(MUDGeneratorService.name)
  }

  /** Totali dell'anno col calcolo attuale, gli stessi del riepilogo (per la vista Bilancio). */
  async totaliAnno(tenantId: string, anno: number): Promise<TotaliMud> {
    return totaliMud(await this.aggregazione.aggrega(tenantId, anno))
  }

  async generateMUDReport(tenantId: string, year: number): Promise<MudRiepilogo> {
    this.logger.info(`Riepilogo MUD per tenant ${tenantId}, anno ${year}`)

    const aggregato = await this.aggregazione.aggrega(tenantId, year)
    const totali = totaliMud(aggregato)
    const { prodottoKg: produced, recuperoKg: recovery, smaltimentoKg: disposal } = totali.totali
    const avviati = recovery + disposal

    return {
      year,
      tenantId,
      generatedAt: new Date(),
      wasteProduced: totali.perCer.map(v => ({
        cerCode: v.cerCode,
        totalQuantity: v.prodottoKg,
        count: v.movimenti,
        recoveryKg: v.recuperoKg,
        disposalKg: v.smaltimentoKg,
        giacenzaRecuperoKg: v.giacenzaRecuperoKg,
        giacenzaSmaltimentoKg: v.giacenzaSmaltimentoKg,
      })),
      totals: {
        produced,
        recovery,
        disposal,
        recyclingRate: avviati > 0 ? recovery / avviati : 0,
      },
      dichiarazioni: totali.dichiarazioni,
      versioneCalcolo: VERSIONE_CALCOLO_MUD,
      versionePresentata: await this.versionePresentata(tenantId, year),
      controlli: aggregato.controlli,
      riepilogoAvvisi: riepilogaAvvisi(aggregato.controlli),
      mudNonDovuto: aggregato.mudNonDovuto,
    }
  }

  /** Versione della presentazione, solo per un anno SUBMITTED o ARCHIVED con versione diversa. */
  private async versionePresentata(tenantId: string, year: number): Promise<number | null> {
    const record = await this.prisma.mUDReport.findUnique({
      where: { tenantId_year: { tenantId, year } },
      select: { status: true, reportData: true },
    })
    if (!record || (record.status !== 'SUBMITTED' && record.status !== 'ARCHIVED')) return null
    const dati = record.reportData
    const salvata =
      typeof dati === 'object' && dati !== null && !Array.isArray(dati)
        ? (dati as Record<string, unknown>).versioneCalcolo
        : undefined
    const versione = versioneCalcoloSalvata(salvata)
    return versione === VERSIONE_CALCOLO_MUD ? null : versione
  }
}
