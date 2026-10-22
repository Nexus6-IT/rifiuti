import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { formattaDataItaliana } from '../../core/time/anno-italiano'
import { MudVersionRegistry } from './export/mud-version.registry'
import { aziendaDichiarante } from './export/mud-export.service'
import { MudAggregazioneService, type MudAggregato } from './aggregazione/mud-aggregazione.service'
import {
  avvisiNonConfermati,
  codiciAvvisoDaConfermare,
  haBloccanti,
  riepilogaAvvisi,
} from './aggregazione/mud-controlli'
import { hashAggregato, hashDichiarante } from './aggregazione/mud-regole'
import { aggiornaReportData, type ReportDataJson, type RecordMudReport } from './mud-report-data'

export interface StatoPresentazioneMud {
  year: number
  status: 'DRAFT' | 'REVIEWING' | 'SUBMITTED' | 'ARCHIVED'
  submittedAt: Date | null
  /** SUBMITTED e dati attuali (righe o dichiarante) diversi da quelli salvati alla segnatura */
  datiModificatiDopoPresentazione: boolean
  /** null se non SUBMITTED; false se il file non è uscito da questa versione (Decisione 22) */
  fileTracciato: boolean | null
}

const isRecord = (v: unknown): v is ReportDataJson =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const stringaONull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const elenco = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/**
 * Segnatura del MUD come presentato e suo annullamento, con lo storico in
 * `MUDReport.reportData` e nel registro attività.
 *
 * La segnatura si lega a una esportazione registrata (A-W-03): l'hash salvato è quello del file
 * uscito, non uno ricalcolato al momento, così `stato()` dice se i dati sono cambiati rispetto
 * a ciò che è stato davvero presentato. Senza esportazioni (file fatto altrove, A-W-02) si
 * salva l'hash attuale e una fotografia dei controlli.
 */
@Injectable()
export class MudPresentazioneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: MudVersionRegistry,
    private readonly aggregazione: MudAggregazioneService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(MudPresentazioneService.name)
  }

  async stato(tenantId: string, year: number): Promise<StatoPresentazioneMud> {
    const record = await this.prisma.mUDReport.findUnique({
      where: { tenantId_year: { tenantId, year } },
    })
    if (!record) {
      return {
        year,
        status: 'DRAFT',
        submittedAt: null,
        datiModificatiDopoPresentazione: false,
        fileTracciato: null,
      }
    }
    const status = record.status as StatoPresentazioneMud['status']
    if (status !== 'SUBMITTED') {
      return {
        year,
        status,
        submittedAt: record.submittedAt ?? null,
        datiModificatiDopoPresentazione: false,
        fileTracciato: null,
      }
    }

    const reportData = isRecord(record.reportData) ? record.reportData : {}
    const hashSalvato = stringaONull(reportData.hashAggregato)
    let datiModificatiDopoPresentazione = false
    if (hashSalvato !== null) {
      const aggregato = await this.aggregazione.aggrega(tenantId, year)
      datiModificatiDopoPresentazione = hashAggregato(aggregato.righe) !== hashSalvato
      // hashAggregato copre solo le righe: ATECO, comune e il resto dell'anagrafica si
      // confrontano a parte (segnature precedenti a questo controllo non lo hanno)
      const dichiaranteSalvato = stringaONull(reportData.hashDichiarante)
      if (!datiModificatiDopoPresentazione && dichiaranteSalvato !== null) {
        const attuale = await this.hashDichiaranteAttuale(tenantId, aggregato)
        datiModificatiDopoPresentazione = attuale !== dichiaranteSalvato
      }
    }
    return {
      year,
      status,
      submittedAt: record.submittedAt ?? null,
      datiModificatiDopoPresentazione,
      // un record segnato prima di questo piano non ha la chiave: vale false
      fileTracciato: reportData.fileTracciato === true,
    }
  }

  async segnaPresentato(
    tenantId: string,
    year: number,
    userId: string,
    dataPresentazione?: Date,
    avvisiConfermati?: readonly string[],
    esportazioneGenerataIl?: string
  ): Promise<StatoPresentazioneMud> {
    // anno non supportato: 404 col messaggio del registro
    this.registry.getForYear(year)

    if (dataPresentazione && dataPresentazione.getTime() > Date.now()) {
      throw new BadRequestException('La data di presentazione non può essere nel futuro.')
    }
    const submittedAt = dataPresentazione ?? new Date()

    const aggregato = await this.aggregazione.aggrega(tenantId, year)
    const controlli = aggregato.controlli
    const hashAttuale = hashAggregato(aggregato.righe)
    const dichiaranteAttuale = await this.hashDichiaranteAttuale(tenantId, aggregato)

    let traccia: Record<string, unknown> = {}
    await this.prisma.$transaction(async tx => {
      // Le esportazioni si leggono sotto il lock del report: un'esportazione concorrente non
      // può cambiare la voce a cui si lega la segnatura.
      await aggiornaReportData(tx, tenantId, year, p => {
        const esportazioni = elenco(p.esportazioni)
        const fileTracciato = esportazioni.length > 0

        let presentazione: {
          hashAggregato: string
          hashDichiarante: string | null
          esportazionePresentata: string | null
          avvisiConfermatiAllaPresentazione: string[]
          riepilogoAllaPresentazione: Record<string, unknown> | null
          controlliAllaPresentazione: Array<{ codice: string; gravita: string }> | null
        }
        if (!fileTracciato) {
          // A-W-02: il file è stato fatto altrove, non c'è nulla da confermare né da bloccare;
          // i controlli del momento restano come fotografia.
          presentazione = {
            hashAggregato: hashAttuale,
            hashDichiarante: dichiaranteAttuale,
            esportazionePresentata: null,
            avvisiConfermatiAllaPresentazione: [],
            riepilogoAllaPresentazione: null,
            controlliAllaPresentazione: controlli.map(c => ({
              codice: c.codice,
              gravita: c.gravita,
            })),
          }
        } else {
          const voce = this.esportazioneScelta(esportazioni, esportazioneGenerataIl)
          this.verificaControlli(aggregato, avvisiConfermati ?? [])
          const riepilogo = riepilogaAvvisi(controlli)
          presentazione = {
            // A-W-03: l'hash del file esportato, non quello ricalcolato adesso
            hashAggregato: stringaONull(voce.hashAggregato) ?? hashAttuale,
            hashDichiarante: stringaONull(voce.hashDichiarante),
            esportazionePresentata: stringaONull(voce.generatoIl),
            avvisiConfermatiAllaPresentazione: codiciAvvisoDaConfermare(controlli),
            riepilogoAllaPresentazione: {
              kgInMeno: riepilogo.kgInMeno,
              kgInPiu: riepilogo.kgInPiu,
              movimentiNonQuantificati: riepilogo.movimentiNonQuantificati,
              voci: riepilogo.voci,
            },
            controlliAllaPresentazione: null,
          }
        }

        traccia = {
          year,
          submittedAt: submittedAt.toISOString(),
          hashAggregato: presentazione.hashAggregato,
          hashDichiarante: presentazione.hashDichiarante,
          esportazionePresentata: presentazione.esportazionePresentata,
          avvisiConfermati: presentazione.avvisiConfermatiAllaPresentazione,
          riepilogo: presentazione.riepilogoAllaPresentazione,
          fileTracciato,
        }
        return {
          reportData: {
            ...p,
            ...presentazione,
            fileTracciato,
            annullamenti: elenco(p.annullamenti),
          },
          campi: { status: 'SUBMITTED', submittedAt, submittedBy: userId },
        }
      })

      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'MUD_PRESENTATO',
          description:
            `MUD dei dati ${year} segnato come presentato il ${formattaDataItaliana(submittedAt)}` +
            (traccia.fileTracciato ? '' : ' (file non generato da questa versione)'),
          metadata: traccia as Prisma.InputJsonValue,
        },
      })
    })

    this.logger.info(`MUD segnato come presentato: tenant ${tenantId}, anno ${year}`)
    return this.stato(tenantId, year)
  }

  async annullaPresentazione(
    tenantId: string,
    year: number,
    userId: string
  ): Promise<StatoPresentazioneMud> {
    await this.prisma.$transaction(async tx => {
      // voce dello storico costruita sotto il lock, riusata nel registro attività
      const annullamento: Record<string, unknown> = {}
      const { scritto } = await aggiornaReportData(
        tx,
        tenantId,
        year,
        (p: ReportDataJson, record: RecordMudReport | null) => {
          if (!record || record.status !== 'SUBMITTED') return null
          Object.assign(annullamento, {
            annullataIl: new Date().toISOString(),
            annullataDa: userId,
            submittedAt: record.submittedAt?.toISOString() ?? null,
            submittedBy: record.submittedBy,
            hashAggregato: stringaONull(p.hashAggregato),
            hashDichiarante: stringaONull(p.hashDichiarante),
            esportazionePresentata: stringaONull(p.esportazionePresentata),
            avvisiConfermati: elenco(p.avvisiConfermatiAllaPresentazione),
            riepilogo: isRecord(p.riepilogoAllaPresentazione) ? p.riepilogoAllaPresentazione : null,
            controlli: Array.isArray(p.controlliAllaPresentazione)
              ? p.controlliAllaPresentazione
              : null,
            fileTracciato: typeof p.fileTracciato === 'boolean' ? p.fileTracciato : null,
          })
          return {
            reportData: {
              ...p,
              hashAggregato: null,
              hashDichiarante: null,
              esportazionePresentata: null,
              avvisiConfermatiAllaPresentazione: [],
              riepilogoAllaPresentazione: null,
              controlliAllaPresentazione: null,
              fileTracciato: null,
              annullamenti: [...elenco(p.annullamenti), annullamento],
            },
            campi: { status: 'DRAFT', submittedAt: null, submittedBy: null },
          }
        }
      )
      if (!scritto) return

      await tx.activityLog.create({
        data: {
          tenantId,
          userId,
          action: 'MUD_PRESENTAZIONE_ANNULLATA',
          description: `Annullata la presentazione del MUD dei dati ${year}`,
          metadata: { year, ...annullamento } as Prisma.InputJsonValue,
        },
      })
      this.logger.info(`Presentazione del MUD annullata: tenant ${tenantId}, anno ${year}`)
    })
    return this.stato(tenantId, year)
  }

  /** Voce di `reportData.esportazioni` indicata, o l'ultima. */
  private esportazioneScelta(esportazioni: unknown[], generatoIl?: string): ReportDataJson {
    if (generatoIl === undefined) {
      const ultima = esportazioni[esportazioni.length - 1]
      return isRecord(ultima) ? ultima : {}
    }
    const voce = esportazioni.find(v => isRecord(v) && v.generatoIl === generatoIl)
    if (!voce) {
      throw new BadRequestException("Esportazione indicata non trovata fra quelle dell'anno.")
    }
    return voce as ReportDataJson
  }

  /**
   * Stesse regole dell'export: con bloccanti il file non si sarebbe potuto generare, e gli
   * avvisi vanno confermati (Decisione 19). La riserva agli amministratori degli avvisi che
   * cambiano le quantità è già coperta: solo un amministratore segna la presentazione.
   */
  private verificaControlli(aggregato: MudAggregato, avvisiConfermati: readonly string[]): void {
    const controlli = aggregato.controlli
    if (haBloccanti(controlli)) {
      const n = controlli.filter(c => c.gravita === 'BLOCCANTE').length
      throw new UnprocessableEntityException({
        message: `Il MUD non può essere segnato come presentato: ci sono errori da correggere (${n}).`,
        error: 'MUD_NON_GENERABILE',
        details: { controlli },
      })
    }
    const avvisiDaConfermare = avvisiNonConfermati(controlli, avvisiConfermati)
    if (avvisiDaConfermare.length > 0) {
      throw new UnprocessableEntityException({
        message: `Il MUD non è stato segnato come presentato: ci sono avvisi da confermare (${avvisiDaConfermare.length}).`,
        error: 'MUD_AVVISI_DA_CONFERMARE',
        details: { controlli, avvisiDaConfermare },
      })
    }
  }

  /** Hash dell'anagrafica del dichiarante di oggi, come entrerebbe nel file. */
  private async hashDichiaranteAttuale(
    tenantId: string,
    aggregato: MudAggregato
  ): Promise<string | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    return tenant ? hashDichiarante(aziendaDichiarante(tenant, aggregato.dichiarante)) : null
  }
}
